/// <reference lib="webworker" />
// Runs all on-device inference off the UI thread: speech-to-text and local persona rewrites.
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import { findAsr, findLlm, type AsrModel } from './models';
import type { WorkerRequest, WorkerResponse } from './protocol';

env.allowLocalModels = false;

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

let asr: { key: string; pipe: AutomaticSpeechRecognitionPipeline; model: AsrModel; device: string } | null = null;
let llm: { key: string; tok: PreTrainedTokenizer; model: PreTrainedModel } | null = null;

async function gpuInfo(): Promise<{ ok: boolean; f16: boolean }> {
  try {
    const a = await (navigator as any).gpu?.requestAdapter();
    return { ok: !!a, f16: !!a?.features?.has('shader-f16') };
  } catch {
    return { ok: false, f16: false };
  }
}
const hasWebGPU = async () => (await gpuInfo()).ok;

async function pickDevice(pref: string, family: string): Promise<'webgpu' | 'wasm'> {
  if (pref === 'cpu') return 'wasm';
  const gpu = await hasWebGPU();
  if (pref === 'gpu') return gpu ? 'webgpu' : 'wasm';
  // auto: Whisper benefits a lot from GPU; small Moonshine models are fastest on WASM.
  return gpu && family === 'whisper' ? 'webgpu' : 'wasm';
}

function progress(kind: 'asr' | 'llm') {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: any) => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      post({ type: 'progress', kind, loaded, total, file: p.file });
    }
  };
}

async function loadAsr(modelId: string, devicePref: string) {
  const model = findAsr(modelId);
  const device = await pickDevice(devicePref, model.family);
  const key = `${model.id}:${device}`;
  if (asr?.key === key) return asr;
  if (asr) { await asr.pipe.dispose().catch(() => {}); asr = null; }
  const pipe = (await pipeline('automatic-speech-recognition', model.repo, {
    device,
    dtype: model.dtype as any,
    progress_callback: progress('asr'),
  })) as AutomaticSpeechRecognitionPipeline;
  asr = { key, pipe, model, device };
  return asr;
}

/** Split long audio at quiet points so each window fits the model. */
function splitAudio(audio: Float32Array, windowSec: number, sr = 16000): Float32Array[] {
  const max = windowSec * sr;
  if (audio.length <= max) return [audio];
  const out: Float32Array[] = [];
  let start = 0;
  const frame = sr / 50; // 20 ms
  while (start < audio.length) {
    if (audio.length - start <= max) { out.push(audio.subarray(start)); break; }
    // search the last 6 s of the window for the quietest 20 ms frame
    const searchFrom = start + max - 6 * sr;
    let best = start + max, bestE = Infinity;
    for (let i = searchFrom; i + frame < start + max; i += frame) {
      let e = 0;
      for (let j = i; j < i + frame; j++) e += audio[j] * audio[j];
      if (e < bestE) { bestE = e; best = i + frame / 2; }
    }
    out.push(audio.subarray(start, best));
    start = best;
  }
  return out;
}

function pad(audio: Float32Array, multiple: number, minSec = 0.5): Float32Array {
  const min = Math.ceil((minSec * 16000) / multiple) * multiple;
  const len = Math.max(min, Math.ceil(audio.length / multiple) * multiple);
  if (len === audio.length) return audio;
  const out = new Float32Array(len);
  out.set(audio);
  return out;
}

async function whisperWithPrompt(
  pipe: AutomaticSpeechRecognitionPipeline,
  audio: Float32Array,
  language: string,
  prompt: string,
): Promise<string> {
  const p = pipe as any;
  const tok = p.tokenizer;
  const one = (t: string) => tok.encode(t, { add_special_tokens: false })[0];
  const genCfg = p.model.generation_config ?? {};
  const init: number[] = [one('<|startoftranscript|>')];
  if (genCfg.is_multilingual) {
    init.push(one(`<|${language || 'en'}|>`));
    init.push(one('<|transcribe|>'));
  }
  init.push(one('<|notimestamps|>'));
  const promptIds: number[] = tok.encode(' ' + prompt.trim(), { add_special_tokens: false }).slice(-180);
  const decoder_input_ids = [one('<|startofprev|>'), ...promptIds, ...init];
  const { input_features } = await p.processor(audio);
  const out = await p.model.generate({
    inputs: input_features,
    decoder_input_ids,
    max_new_tokens: Math.max(32, 440 - decoder_input_ids.length),
  });
  const ids: number[] = (out.tolist()[0] as (number | bigint)[]).map(Number).slice(decoder_input_ids.length);
  return tok.decode(ids, { skip_special_tokens: true });
}

async function transcribe(req: Extract<WorkerRequest, { type: 'transcribe' }>) {
  const { pipe, model } = await loadAsr(req.modelId, req.device);
  const t0 = performance.now();
  const parts: string[] = [];
  for (let chunk of splitAudio(req.audio, model.windowSec)) {
    chunk = pad(chunk, model.padTo ?? 1);
    let text = '';
    if (model.family === 'whisper') {
      if (req.prompt) {
        try { text = await whisperWithPrompt(pipe, chunk, req.language, req.prompt); } catch (e) {
          console.warn('prompted decode failed, falling back', e);
        }
      }
      if (!text) {
        const opts: any = { return_timestamps: false };
        if ((pipe as any).model.generation_config?.is_multilingual) { opts.language = req.language || 'en'; opts.task = 'transcribe'; }
        text = ((await pipe(chunk, opts)) as any).text;
      }
    } else {
      text = ((await pipe(chunk)) as any).text;
    }
    parts.push(text.trim());
  }
  return { text: parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), ms: performance.now() - t0 };
}

async function loadLlm(modelId: string) {
  const m = findLlm(modelId);
  const gpu = await gpuInfo();
  if (!gpu.ok) {
    // Current ONNX exports of small LLMs use block-quantized embeddings with GPU-only kernels.
    throw new Error('On-device rewriting needs GPU acceleration (WebGPU), which this device/browser does not offer. Switch the persona engine to OpenRouter or Claude Code.');
  }
  const key = `${m.id}:${gpu.f16}`;
  if (llm?.key === key) return llm;
  if (llm) { await llm.model.dispose().catch(() => {}); llm = null; }
  const cb = progress('llm');
  const dtypes = gpu.f16 ? ['q4f16', 'q4'] : ['q4', 'fp32'];
  const errors: string[] = [];
  const tok = await AutoTokenizer.from_pretrained(m.repo, { progress_callback: cb });
  for (const dtype of dtypes) {
    try {
      const model = await AutoModelForCausalLM.from_pretrained(m.repo, { device: 'webgpu', dtype: dtype as any, progress_callback: cb });
      console.info(`Rewrite model ${m.repo} loaded as ${dtype}`);
      llm = { key, tok, model };
      return llm;
    } catch (e) {
      errors.push(`${dtype}: ${String((e as any)?.message ?? e).slice(0, 140)}`);
    }
  }
  throw new Error(`Couldn't load ${m.label}. ${errors.join(' | ')}`);
}

async function rewrite(req: Extract<WorkerRequest, { type: 'rewrite' }>) {
  const { tok, model } = await loadLlm(req.modelId);
  const messages = [
    { role: 'system', content: req.system },
    { role: 'user', content: req.user },
  ];
  const inputs: any = (tok as any).apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
    enable_thinking: false,
  });
  const inLen = inputs.input_ids.dims.at(-1);
  const out: any = await (model as any).generate({
    ...inputs,
    max_new_tokens: Math.min(1024, Math.round(req.user.length / 2) + 96),
    do_sample: false,
    repetition_penalty: 1.05,
  });
  const ids = (out.tolist()[0] as (number | bigint)[]).map(Number).slice(inLen);
  let text: string = (tok as any).decode(ids, { skip_special_tokens: true });
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return text;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    switch (req.type) {
      case 'loadAsr': {
        const a = await loadAsr(req.modelId, req.device);
        post({ id: req.id, type: 'ok', result: { device: a.device } });
        break;
      }
      case 'transcribe':
        post({ id: req.id, type: 'ok', result: await transcribe(req) });
        break;
      case 'loadLlm':
        await loadLlm(req.modelId);
        post({ id: req.id, type: 'ok', result: true });
        break;
      case 'rewrite':
        post({ id: req.id, type: 'ok', result: await rewrite(req) });
        break;
    }
  } catch (e: any) {
    post({ id: req.id, type: 'error', error: String(e?.message ?? e) });
  }
};
