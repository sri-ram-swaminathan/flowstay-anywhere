import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Platform, OverlayState } from './index';

export function tauriPlatform(): Platform {
  let overlayVisible = false;
  let lastOverlay = 0;

  const copy = async (text: string) => {
    try { await invoke('set_clipboard', { text }); return true; } catch { return false; }
  };

  return {
    kind: 'windows',
    isStandalone: true,
    modelStore: nativeModelStore(),
    async deliver(text, o) {
      if (o.autoPaste) {
        try {
          const ok = await invoke<boolean>('paste_text', { text, restore: !o.keepOnClipboard });
          if (ok) return 'pasted';
        } catch (e) {
          console.warn('paste failed', e);
        }
      }
      if (o.autoCopy || o.autoPaste) return (await copy(text)) ? 'copied' : 'none';
      return 'none';
    },
    copy,
    frontApp: () => invoke('foreground_app'),
    claudeAvailable: () => invoke<boolean>('claude_available'),
    runClaude: (args, stdin, timeoutMs) => invoke('run_claude', { args, stdin, timeoutMs }),
    async notify(title, body) {
      try {
        let ok = await isPermissionGranted();
        if (!ok) ok = (await requestPermission()) === 'granted';
        if (ok) sendNotification({ title, body });
      } catch {}
    },
    openUrl: (url) => { openUrl(url).catch(() => {}); },
    async oauthBegin() {
      const port = await invoke<number>('oauth_listen');
      const result = new Promise<{ code: string; state: string }>((resolve) => {
        listen<{ code: string; state: string }>('oauth-callback', (e) => resolve(e.payload));
      });
      return { callbackUrl: `http://localhost:${port}/callback`, result };
    },
    getAutostart: () => isEnabled(),
    setAutostart: async (on) => { on ? await enable() : await disable(); },
    async registerHotkeys(cfg, on) {
      await unregisterAll().catch(() => {});
      const errors: string[] = [];
      const reg = async (sc: string | undefined, which: 'toggle' | 'hold') => {
        if (!sc) return;
        try {
          await register(sc, (e) => on(which, e.state === 'Pressed'));
        } catch (err) {
          errors.push(`${sc}: ${err}`);
        }
      };
      await reg(cfg.toggle, 'toggle');
      if (cfg.hold && cfg.hold !== cfg.toggle) await reg(cfg.hold, 'hold');
      return errors.length ? `Couldn't register ${errors.join('; ')} (another app may be using it).` : null;
    },
    overlay(state: OverlayState) {
      if (state.status === 'hidden') {
        if (overlayVisible) { overlayVisible = false; invoke('hide_overlay').catch(() => {}); }
        return;
      }
      if (!overlayVisible) { overlayVisible = true; invoke('show_overlay').catch(() => {}); }
      // throttle level updates to ~30 fps
      const now = performance.now();
      if (state.status === 'recording' && now - lastOverlay < 33) return;
      lastOverlay = now;
      emitTo('overlay', 'overlay-state', state).catch(() => {});
    },
    showMain: () => { invoke('show_main').catch(() => {}); },
    onTray(cb) { listen<string>('tray-action', (e) => cb(e.payload)); },
  };
}

export function nativeModelStore() {
  return {
    async get(key: string) {
      try { return await invoke<ArrayBuffer>('model_cache_get', { key }); } catch { return null; }
    },
    async put(key: string, data: ArrayBuffer) {
      await invoke('model_cache_put', new Uint8Array(data), { headers: { 'x-key': encodeURIComponent(key) } });
    },
    clear: () => invoke<void>('model_cache_clear').catch(() => {}),
  };
}
