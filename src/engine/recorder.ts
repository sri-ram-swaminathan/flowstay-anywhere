// Microphone capture → 16 kHz mono Float32 PCM.
//
// Latency features:
//  - Segments: at natural pauses (≥ 450 ms silence after ≥ 4 s of audio) the audio so far is
//    handed off, so it's transcribed while you keep talking. On stop only the tail remains.
//  - Instant start (optional): the mic stays open between dictations and the last 500 ms are
//    kept (500 ms), so the first syllable isn't lost to the time it takes to press the key.

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

const SR = 16000;
const SPEECH_RMS = 0.006;

export interface RecorderEvents {
  onLevel?: (rms: number) => void;
  onSilenceTimeout?: () => void;
  onSegment?: (pcm: Float32Array) => void;
}

/** Growable PCM buffer. */
class Pcm {
  buf = new Float32Array(SR * 30);
  len = 0;
  push(x: Float32Array) {
    if (this.len + x.length > this.buf.length) {
      const n = new Float32Array(Math.max(this.buf.length * 2, this.len + x.length));
      n.set(this.buf.subarray(0, this.len));
      this.buf = n;
    }
    this.buf.set(x, this.len);
    this.len += x.length;
  }
  slice(a: number, b = this.len) { return this.buf.slice(a, b); }
  reset() { this.len = 0; }
}

export class Recorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private pcm = new Pcm();
  private preroll: Float32Array[] = [];
  private capturing = false;
  private ratio = 3;
  private carry = new Float32Array(0);
  private segStart = 0;
  private segCount = 0;
  private silence = 0; // samples of trailing silence
  private voiced = 0; // voiced samples since last cut
  private lastVoice = 0;
  private startedAt = 0;
  deviceId = '';
  silenceTimeoutSec = 60;
  keepWarm = false;

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
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }

  get elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  private get open() {
    return !!this.ctx && this.ctx.state !== 'closed' && !!this.stream?.active;
  }

  /** Opens the microphone (without recording) so the next start is instant. */
  async warm() {
    if (this.open) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: this.deviceId ? { exact: this.deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ratio = this.ctx.sampleRate / SR;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'flowstay-tap');
    this.node.port.onmessage = (e) => this.push(e.data as Float32Array);
    src.connect(this.node);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  async start() {
    await this.warm();
    this.pcm.reset();
    this.carry = new Float32Array(0);
    for (const p of this.preroll) this.pcm.push(p);
    this.preroll = [];
    this.segStart = 0;
    this.segCount = 0;
    this.silence = 0;
    this.voiced = 0;
    this.capturing = true;
    this.startedAt = performance.now();
    this.lastVoice = this.startedAt;
  }

  private push(input: Float32Array) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    // resample to 16 kHz (box filter: cheap and fine for speech)
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

    if (!this.capturing) {
      // warm & idle: keep ~500 ms of pre-roll
      this.preroll.push(out);
      let n = this.preroll.reduce((k, p) => k + p.length, 0);
      while (n > SR * 0.5 && this.preroll.length > 1) n -= this.preroll.shift()!.length;
      return;
    }

    this.ev.onLevel?.(rms);
    this.pcm.push(out);
    const now = performance.now();
    if (rms > SPEECH_RMS) {
      this.silence = 0;
      this.voiced += out.length;
      this.lastVoice = now;
    } else {
      this.silence += out.length;
      if (this.silenceTimeoutSec > 0 && now - this.lastVoice > this.silenceTimeoutSec * 1000) {
        this.lastVoice = now;
        this.ev.onSilenceTimeout?.();
      }
    }
    const segLen = this.pcm.len - this.segStart;
    if (segLen >= 4 * SR && this.silence >= 0.45 * SR && this.voiced >= 0.5 * SR) {
      this.cut(this.pcm.len - Math.floor(this.silence / 2));
    } else if (segLen >= 24 * SR) {
      this.cut(this.quietestIn(this.pcm.len - 4 * SR, this.pcm.len));
    }
  }

  private quietestIn(a: number, b: number) {
    const frame = 320;
    let best = b, bestE = Infinity;
    for (let i = a; i + frame <= b; i += frame) {
      let e = 0;
      for (let j = i; j < i + frame; j++) e += this.pcm.buf[j] * this.pcm.buf[j];
      if (e < bestE) { bestE = e; best = i + frame / 2; }
    }
    return best;
  }

  private cut(at: number) {
    const seg = this.pcm.slice(this.segStart, at);
    this.segStart = at;
    this.segCount++;
    this.voiced = 0;
    this.ev.onSegment?.(seg);
  }

  /** Audio of the sentence in progress (since the last segment cut). */
  pending(): { pcm: Float32Array; segment: number } {
    return { pcm: this.pcm.slice(this.segStart), segment: this.segCount };
  }

  /** Stops recording and returns the audio not yet handed off as a segment. */
  async stop(): Promise<{ tail: Float32Array; duration: number; total: number }> {
    const duration = this.elapsed;
    this.capturing = false;
    this.startedAt = 0;
    const tail = this.pcm.slice(this.segStart);
    const total = this.pcm.len;
    if (!this.keepWarm) await this.close();
    return { tail, duration, total };
  }

  async close() {
    this.capturing = false;
    this.preroll = [];
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.stream = undefined;
  }

  cancel() {
    this.capturing = false;
    this.startedAt = 0;
    this.pcm.reset();
    if (!this.keepWarm) this.close();
  }
}
