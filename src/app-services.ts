import * as c from './controller';
import { platform } from './platform';
import { log, settings } from './store';
import { toast } from './ui/toast';

declare const __APP_VERSION__: string;
export const VERSION = __APP_VERSION__;
export const REPO = 'sri-ram-swaminathan/flowstay-anywhere';

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

/** Startup: shortcuts, tray, model warm-up. */
export async function boot() {
  const s = settings.get();
  const p = platform();
  log(`Starting ${VERSION} on ${p.kind}`);
  (navigator as any).storage?.persist?.().catch(() => {});
  p.onTray((a) => { if (a === 'toggle') c.toggle(); });
  const err = await c.applyShortcuts();
  if (err) { log(err); toast(err); }
  c.configureRecorder();
  // Start with Windows by default so Ctrl+Space works right after you sign in.
  // Done once; if you switch it off later, it stays off.
  if (p.kind === 'windows' && !s.autostartDefaulted) {
    try { await p.setAutostart(true); settings.set({ launchAtLogin: true, autostartDefaulted: true }); log('Start with Windows: enabled by default'); }
    catch (e) { log(`Couldn't enable start with Windows: ${e}`); }
  }
  await c.refreshModels().catch(() => {});
  // keep the speech model loaded so the first dictation doesn't wait
  c.loadModel();
  if (p.kind === 'windows' && s.checkForUpdates) setTimeout(() => checkForUpdate(false), 15_000);
}
