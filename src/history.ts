// Transcription history + crash-recovery audio, stored in IndexedDB on the device.

export interface TranscriptionRecord {
  id: string;
  timestamp: number;
  duration: number;
  rawText: string;
  processedText: string;
  personaId?: string;
  personaName?: string;
  appId?: string;
  appName?: string;
  wordCount: number;
  wasProcessed: boolean;
  model?: string;
  corrections?: number;
}

const DB = 'flowstay';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('history', { keyPath: 'id' }).createIndex('ts', 'timestamp');
      d.createObjectStore('recovery', { autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : (undefined as T));
        t.onerror = () => reject(t.error);
      }),
  );
}

type L = () => void;
const listeners = new Set<L>();
const changed = () => listeners.forEach((l) => l());
export const onHistoryChange = (l: L) => { listeners.add(l); return () => listeners.delete(l); };

export const history = {
  add: async (r: TranscriptionRecord) => { await tx('history', 'readwrite', (s) => s.put(r)); changed(); },
  all: async (): Promise<TranscriptionRecord[]> => {
    const rows = await tx<TranscriptionRecord[]>('history', 'readonly', (s) => s.getAll());
    return rows.sort((a, b) => b.timestamp - a.timestamp);
  },
  remove: async (id: string) => { await tx('history', 'readwrite', (s) => s.delete(id)); changed(); },
  clear: async () => { await tx('history', 'readwrite', (s) => s.clear()); changed(); },
  prune: async (days: number) => {
    if (!days) return;
    const cutoff = Date.now() - days * 86400_000;
    const rows = await history.all();
    const old = rows.filter((r) => r.timestamp < cutoff);
    if (!old.length) return;
    await tx('history', 'readwrite', (s) => { old.forEach((r) => s.delete(r.id)); });
    changed();
  },
};

/** In-progress audio is appended here so a crash or reload doesn't lose your dictation. */
export const recovery = {
  append: (pcm: Float32Array) => tx('recovery', 'readwrite', (s) => s.add(pcm)).catch(() => {}),
  clear: () => tx('recovery', 'readwrite', (s) => s.clear()).catch(() => {}),
  load: async (): Promise<Float32Array | null> => {
    const parts = await tx<Float32Array[]>('recovery', 'readonly', (s) => s.getAll()).catch(() => []);
    if (!parts.length) return null;
    const len = parts.reduce((n, p) => n + p.length, 0);
    if (len < 16000) return null;
    const out = new Float32Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  },
};

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function exportHistory(rows: TranscriptionRecord[], format: 'json' | 'txt' | 'md'): Blob {
  if (format === 'json') return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const body = rows
    .map((r) => {
      const when = new Date(r.timestamp).toLocaleString();
      const head = format === 'md' ? `### ${when}${r.personaName ? ` · ${r.personaName}` : ''}${r.appName ? ` · ${r.appName}` : ''}` : `[${when}]`;
      const orig = r.wasProcessed ? (format === 'md' ? `\n\n> Original: ${r.rawText}` : `\n(original: ${r.rawText})`) : '';
      return `${head}\n${r.processedText}${orig}`;
    })
    .join('\n\n');
  return new Blob([body], { type: 'text/plain' });
}
