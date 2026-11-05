import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { EngineModel, OverlayState, Platform } from './index';

export function tauriPlatform(): Platform {
  let overlayVisible = false;
  let lastOverlay = 0;

  return {
    kind: 'windows',

    models: () => invoke<EngineModel[]>('engine_models'),
    async download(id, onProgress) {
      const un = await listen<{ id: string; loaded: number; total: number }>('model-progress', (e) => {
        if (e.payload.id === id) onProgress(e.payload.loaded, e.payload.total);
      });
      try { await invoke('engine_download', { id }); } finally { un(); }
    },
    deleteModel: (id) => invoke('engine_delete', { id }),
    load: (id) => invoke('engine_load', { id }),
    transcribe: (pcm, vocabulary, language) =>
      invoke('engine_transcribe', new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), {
        headers: { 'x-vocabulary': encodeURIComponent(JSON.stringify(vocabulary)), 'x-language': encodeURIComponent(language) },
      }),

    async registerShortcut(sc, cb) {
      try {
        await unregister(sc).catch(() => {});
        await register(sc, (e) => cb(e.state === 'Pressed'));
        return null;
      } catch (err) {
        return `Couldn't use ${sc}: another app may own it (${err}).`;
      }
    },
    unregisterShortcut: (sc) => unregister(sc).catch(() => {}),
    async copy(text) {
      try { await invoke('set_clipboard', { text }); return true; } catch { return false; }
    },
    async paste(text) {
      try { return await invoke<boolean>('paste_text', { text, restore: false }); } catch { return false; }
    },
    frontApp: () => invoke('foreground_app'),

    claudeAvailable: () => invoke<boolean>('claude_available'),
    runClaude: (args, stdin, timeoutMs) => invoke('run_claude', { args, stdin, timeoutMs }),
    async oauthBegin() {
      const port = await invoke<number>('oauth_listen');
      const result = new Promise<{ code: string; state: string }>((resolve) => {
        listen<{ code: string; state: string }>('oauth-callback', (e) => resolve(e.payload));
      });
      return { callbackUrl: `http://localhost:${port}/callback`, result };
    },

    async notify(title, body) {
      try {
        let ok = await isPermissionGranted();
        if (!ok) ok = (await requestPermission()) === 'granted';
        if (ok) sendNotification({ title, body });
      } catch {}
    },
    openUrl: (url) => { openUrl(url).catch(() => {}); },
    getAutostart: () => isEnabled(),
    setAutostart: async (on) => { on ? await enable() : await disable(); },
    overlay(state: OverlayState) {
      if (state.status === 'hidden') {
        if (overlayVisible) { overlayVisible = false; invoke('hide_overlay').catch(() => {}); }
        return;
      }
      if (!overlayVisible) { overlayVisible = true; invoke('show_overlay').catch(() => {}); }
      const now = performance.now();
      if (state.status === 'recording' && now - lastOverlay < 33) return; // ~30 fps
      lastOverlay = now;
      emitTo('overlay', 'overlay-state', state).catch(() => {});
    },
    showMain: () => { invoke('show_main').catch(() => {}); },
    onTray(cb) { listen<string>('tray-action', (e) => cb(e.payload)); },
  };
}
