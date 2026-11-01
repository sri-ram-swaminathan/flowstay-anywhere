import type { Platform } from './index';
import { toast } from '../ui/toast';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // iOS needs a user gesture for clipboard writes; fall back to execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function webPlatform(): Platform {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  return {
    kind: 'web',
    isStandalone: standalone,
    async deliver(text, o) {
      if (o.autoCopy && (await copy(text))) return 'copied';
      return 'none';
    },
    copy,
    frontApp: async () => null,
    claudeAvailable: async () => false,
    runClaude: async () => ({ code: 1, stdout: '', stderr: 'Claude Code is only available in the Windows app.' }),
    notify(title, body) {
      if (document.visibilityState === 'visible') return toast(`${title}: ${body}`);
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
    },
    openUrl(url) {
      window.location.href = url;
    },
    async oauthBegin() {
      // Redirect flow: we leave the page and come back with ?code=…; main.tsx finishes it.
      const callbackUrl = location.origin + location.pathname;
      return { callbackUrl, result: new Promise(() => {}) };
    },
    getAutostart: async () => false,
    setAutostart: async () => {},
    async registerHotkeys(cfg, on) {
      // In-page shortcut only (browsers can't register system-wide hotkeys).
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
      keyHandler = (e) => {
        if (!cfg.toggle) return;
        const combo = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key]
          .filter(Boolean)
          .join('+');
        if (combo.toLowerCase() === cfg.toggle.toLowerCase()) {
          e.preventDefault();
          on('toggle', true);
        }
      };
      window.addEventListener('keydown', keyHandler);
      return null;
    },
    overlay() {},
    showMain() {},
    onTray() {},
  };
}
