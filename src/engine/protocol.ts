export type WorkerRequest =
  | { id: number; type: 'config'; nativeCache: boolean }
  | { id: number; type: 'loadAsr'; modelId: string; device: string }
  | { id: number; type: 'transcribe'; modelId: string; device: string; audio: Float32Array; language: string; prompt: string }
  | { id: number; type: 'loadLlm'; modelId: string }
  | { id: number; type: 'rewrite'; modelId: string; system: string; user: string };

export type WorkerResponse =
  | { id: number; type: 'ok'; result: any }
  | { id: number; type: 'error'; error: string }
  | { id?: undefined; type: 'progress'; kind: 'asr' | 'llm'; loaded: number; total: number; file: string }
  | { id?: undefined; type: 'cacheReq'; cid: number; op: 'get' | 'put'; key: string; data?: ArrayBuffer };

/** Native file storage for model files (apps only); lives on the main thread because IPC does. */
export interface ModelStore {
  get(key: string): Promise<ArrayBuffer | null>;
  put(key: string, data: ArrayBuffer): Promise<void>;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export class Engine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  onProgress: (kind: 'asr' | 'llm', loaded: number, total: number) => void = () => {};
  private store: ModelStore | null = null;

  /** Use native file storage for downloaded models instead of the browser cache. */
  useModelStore(store: ModelStore) {
    this.store = store;
    this.call({ type: 'config', nativeCache: true });
  }

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') return this.onProgress(m.kind, m.loaded, m.total);
      if (m.type === 'cacheReq') return this.handleCache(m);
      const p = this.pending.get(m.id!);
      if (!p) return;
      this.pending.delete(m.id!);
      m.type === 'ok' ? p.resolve(m.result) : p.reject(new Error(m.error));
    };
  }

  private async handleCache(m: Extract<WorkerResponse, { type: 'cacheReq' }>) {
    let data: ArrayBuffer | null = null;
    let ok = true;
    try {
      if (m.op === 'get') data = (await this.store?.get(m.key)) ?? null;
      else await this.store?.put(m.key, m.data!);
    } catch (e) {
      ok = false;
      console.warn('model store', m.op, e);
    }
    this.worker.postMessage({ type: 'cacheRes', cid: m.cid, ok, data }, data ? [data] : []);
  }

  call<T = any>(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }
}
