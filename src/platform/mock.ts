// Browser mock of the Windows shell, for UI development and screenshots only.
import type { EngineModel, Platform } from './index';
import { toast } from '../ui/toast';

const MODELS: EngineModel[] = [
  { id: 'parakeet-v3', name: 'Parakeet v3 (25 languages)', blurb: 'Recommended. 25 European languages incl. English and Dutch, auto-detected.', size: 739_508_576, englishWer: 4.83, cpuSpeed: 13.7, multilingual: true, downloaded: true },
  { id: 'parakeet-unified-en', name: 'Parakeet Unified (English)', blurb: 'English only, slightly more accurate on English.', size: 731_357_568, englishWer: 3.99, cpuSpeed: 14, multilingual: false, downloaded: false },
  { id: 'parakeet-110m', name: 'Parakeet Fast 110M (English)', blurb: 'Fastest and smallest, slightly less accurate.', size: 135_373_280, englishWer: 6.11, cpuSpeed: 50, multilingual: false, downloaded: false },
];

export function mockPlatform(): Platform {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    kind: 'mock',
    models: async () => MODELS.map((m) => ({ ...m })),
    async download(id, onProgress) {
      const m = MODELS.find((x) => x.id === id)!;
      for (let i = 1; i <= 10; i++) { await sleep(120); onProgress((m.size * i) / 10, m.size); }
      m.downloaded = true;
    },
    async deleteModel(id) { MODELS.find((x) => x.id === id)!.downloaded = false; },
    async load(id) { await sleep(300); return { id, vocabulary: true, loadMs: 300 }; },
    async transcribe(pcm) { await sleep(150); return { text: pcm.length > 8000 ? 'um so I think we should move the meeting to thursday because the report is not ready yet' : '', ms: 150 }; },
    async registerShortcut() { return null; },
    async unregisterShortcut() {},
    async copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } },
    async paste() { return false; },
    frontApp: async () => null,
    claudeAvailable: async () => false,
    runClaude: async () => ({ code: 1, stdout: '', stderr: 'mock' }),
    async oauthBegin() { throw new Error('Not available in the browser preview'); },
    notify: (t, b) => toast(`${t}: ${b}`),
    openUrl: (u) => window.open(u, '_blank'),
    getAutostart: async () => false,
    setAutostart: async () => {},
    overlay() {},
    showMain() {},
    onTray() {},
  };
}
