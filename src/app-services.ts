import * as c from './controller';
import { history as historyStore } from './history';
import { platform } from './platform';
import { openRouter } from './providers';
import { log, settings } from './store';
import { toast } from './ui/toast';

declare const __APP_VERSION__: string;
export const VERSION = __APP_VERSION__;
export const REPO = 'sri-ram-swaminathan/flowstay-anywhere';

export async function applyHotkeys(): Promise<string | null> {
  const s = settings.get();
  const cfg = {
    toggle: s.hotkeyPressMode === 'hold' ? undefined : s.toggleShortcut,
    hold: s.hotkeyPressMode === 'toggle' ? undefined : s.holdShortcut,
  };
  const err = await platform().registerHotkeys(cfg, c.onHotkey);
  if (err) log(err);
  return err;
}

export async function checkForUpdate(manual = false): Promise<string | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!r.ok) return manual ? 'No releases published yet.' : null;
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    if (latest && newer(latest, VERSION)) {
      const msg = `Version ${latest} is available.`;
      if (!manual) platform().notify('Flowstay update available', msg);
      if (manual) platform().openUrl(j.html_url);
      return `${msg} Opening the download page…`;
    }
    return manual ? "You're up to date." : null;
  } catch {
    return manual ? "Couldn't reach GitHub." : null;
  }
}

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

/** Startup sequence (mirrors Flowstay's AppInitializationService). */
export async function boot() {
  const s = settings.get();
  const p = platform();
  // Apps keep model files in native storage; the browser asks not to evict its cache.
  if (p.modelStore) c.engine.useModelStore(p.modelStore);
  else (navigator as any).storage?.persist?.().then((ok: boolean) => log(`Persistent storage: ${ok}`)).catch(() => {});
  log(`Starting ${VERSION} on ${p.kind}`);

  // finish an OpenRouter redirect sign-in (web)
  const q = new URLSearchParams(location.search);
  if (q.get('code')) {
    try { await openRouter.finish(q.get('code')!, q.get('state')); toast('OpenRouter connected'); } catch (e: any) { toast(String(e.message ?? e)); }
    window.history.replaceState(null, '', location.pathname);
  }

  await historyStore.prune(s.historyRetentionDays).catch(() => {});

  if (p.kind === 'windows') {
    await applyHotkeys();
    p.onTray((a) => {
      if (a === 'toggle') c.toggle();
      if (a === 'settings') p.showMain();
    });
    if (s.checkForUpdates) setTimeout(() => checkForUpdate(false), 15_000);
  }

  // warm the speech model so the first dictation is instant
  if (s.hasCompletedOnboarding) c.loadAsr().catch(() => {});
}
