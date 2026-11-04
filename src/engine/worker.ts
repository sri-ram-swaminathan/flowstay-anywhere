/// <reference lib="webworker" />
// Runs the on-device persona rewrite model (speech recognition is native, in Rust).
import { AutoModelForCausalLM, AutoTokenizer, env, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers';
import { findLlm } from './models';
import type { WorkerRequest, WorkerResponse } from './protocol';

env.allowLocalModels = false;

// ---- Model storage: plain files in the origin-private file system (OPFS).
// Safari evicts/loses large Cache API entries; OPFS files persist. Falls back to the
// browser cache where OPFS isn't available, and migrates files already in it.
const fileName = (key: string) => key.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
async function modelsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('models', { create: true });
}
const opfsCache = {
  async match(key: string): Promise<Response | undefined> {
    const name = fileName(String(key));
    try {
      const dir = await modelsDir();
      await dir.getFileHandle(name + '.ok'); // written only after a complete download
      const file = await (await dir.getFileHandle(name)).getFile();
      return new Response(file, { headers: { 'content-length': String(file.size) } });
    } catch {}
    // migrate from the old browser cache if it's still there
    try {
      const old = await (await caches.open('transformers-cache')).match(String(key));
      if (old) { await opfsCache.put(String(key), old.clone()); return old; }
    } catch {}
    return undefined;
  },
  async put(key: string, response: Response, progress?: (p: { progress: number; loaded: number; total: number }) => void) {
    const name = fileName(String(key));
    const dir = await modelsDir();
    await dir.removeEntry(name + '.ok').catch(() => {});
    const handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
    try {
      handle.truncate(0);
      const total = Number(response.headers.get('content-length')) || 0;
      let loaded = 0;
      const reader = response.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        handle.write(value, { at: loaded });
        loaded += value.length;
        progress?.({ progress: total ? (loaded / total) * 100 : 0, loaded, total });
      }
      handle.flush();
    } finally {
      handle.close();
    }
    await dir.getFileHandle(name + '.ok', { create: true });
  },
};
const opfsSupported = (async () => {
  try {
    const dir = await modelsDir();
    const h = await (await dir.getFileHandle('.probe', { create: true })).createSyncAccessHandle();
    h.close();
    return true;
  } catch {
    return false;
  }
})();
opfsSupported.then((ok) => {
  if (!ok) return;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = opfsCache as any;
});

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

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

function progress(kind: 'llm') {
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
  await opfsSupported;
  try {
    switch (req.type) {
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
