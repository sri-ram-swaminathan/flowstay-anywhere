export type WorkerRequest =
  | { id: number; type: 'loadAsr'; modelId: string; device: string }
  | { id: number; type: 'transcribe'; modelId: string; device: string; audio: Float32Array; language: string; prompt: string }
  | { id: number; type: 'loadLlm'; modelId: string }
  | { id: number; type: 'rewrite'; modelId: string; system: string; user: string };

export type WorkerResponse =
  | { id: number; type: 'ok'; result: any }
  | { id: number; type: 'error'; error: string }
  | { id?: undefined; type: 'progress'; kind: 'asr' | 'llm'; loaded: number; total: number; file: string };

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export class Engine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  onProgress: (kind: 'asr' | 'llm', loaded: number, total: number) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') return this.onProgress(m.kind, m.loaded, m.total);
      const p = this.pending.get(m.id!);
      if (!p) return;
      this.pending.delete(m.id!);
      m.type === 'ok' ? p.resolve(m.result) : p.reject(new Error(m.error));
    };
  }

  call<T = any>(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }
}
