// Microphone capture → 16 kHz mono Float32 PCM, with level metering and silence auto-stop.

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('flowstay-tap', Tap);
`;

export interface RecorderEvents {
  onLevel?: (rms: number) => void;
  onSilenceTimeout?: () => void;
  onChunk?: (pcm16k: Float32Array) => void; // ~every second, for crash recovery
}

export class Recorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private chunks: Float32Array[] = [];
  private pendingChunk: Float32Array[] = [];
  private pendingLen = 0;
  private ratio = 3;
  private carry = new Float32Array(0);
  private lastVoice = 0;
  private startedAt = 0;
  deviceId = '';
  silenceTimeoutSec = 30;

  constructor(private ev: RecorderEvents = {}) {}

  static async requestPermission(): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  static async listInputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  get elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  async start() {
    this.chunks = [];
    this.carry = new Float32Array(0);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ratio = this.ctx.sampleRate / 16000;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'flowstay-tap');
    this.node.port.onmessage = (e) => this.push(e.data as Float32Array);
    src.connect(this.node);
    // keep graph alive without audible output
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
    this.startedAt = performance.now();
    this.lastVoice = this.startedAt;
  }

  private push(input: Float32Array) {
    // level
    let sum = 0, peak = 0;
    for (let i = 0; i < input.length; i++) { const v = input[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
    const rms = Math.sqrt(sum / input.length);
    this.ev.onLevel?.(rms);
    const now = performance.now();
    if (rms > 0.003 || peak > 0.03) this.lastVoice = now;
    else if (this.silenceTimeoutSec > 0 && now - this.lastVoice > this.silenceTimeoutSec * 1000) {
      this.lastVoice = now;
      this.ev.onSilenceTimeout?.();
    }
    // resample by box-filter averaging (good enough for speech, cheap)
    const buf = new Float32Array(this.carry.length + input.length);
    buf.set(this.carry);
    buf.set(input, this.carry.length);
    const outLen = Math.floor(buf.length / this.ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const a = Math.floor(i * this.ratio), b = Math.max(a + 1, Math.floor((i + 1) * this.ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += buf[j];
      out[i] = s / (b - a);
    }
    this.carry = buf.slice(Math.floor(outLen * this.ratio));
    this.chunks.push(out);
    this.pendingChunk.push(out);
    this.pendingLen += out.length;
    if (this.pendingLen >= 16000) {
      this.ev.onChunk?.(concat(this.pendingChunk));
      this.pendingChunk = [];
      this.pendingLen = 0;
    }
  }

  async stop(): Promise<{ audio: Float32Array; duration: number }> {
    const duration = this.elapsed;
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.startedAt = 0;
    if (this.pendingLen) this.ev.onChunk?.(concat(this.pendingChunk));
    this.pendingChunk = [];
    this.pendingLen = 0;
    return { audio: concat(this.chunks), duration };
  }

  cancel() {
    this.stop().catch(() => {});
    this.chunks = [];
  }
}

export function concat(parts: Float32Array[]): Float32Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function isMostlySilent(audio: Float32Array): boolean {
  let voiced = 0;
  const frame = 320;
  for (let i = 0; i + frame <= audio.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) s += audio[j] * audio[j];
    if (Math.sqrt(s / frame) > 0.004) voiced++;
  }
  return voiced < 8; // < ~160 ms of speech
}
