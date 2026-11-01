export interface FrontApp { appId: string; appName: string }
export interface OverlayState {
  status: 'recording' | 'transcribing' | 'rewriting' | 'done' | 'error' | 'hidden';
  level?: number;
  elapsed?: number;
  text?: string;
  persona?: string;
}

export interface Platform {
  kind: 'windows' | 'web';
  isStandalone: boolean;
  /** Put text where the user wants it. Returns true if it was auto-pasted into another app. */
  deliver(text: string, opts: { autoPaste: boolean; autoCopy: boolean; restoreClipboard: boolean }): Promise<'pasted' | 'copied' | 'none'>;
  copy(text: string): Promise<boolean>;
  frontApp(): Promise<FrontApp | null>;
  claudeAvailable(): Promise<boolean>;
  runClaude(args: string[], stdin: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>;
  notify(title: string, body: string): void;
  openUrl(url: string): void;
  /** OpenRouter OAuth: returns the callback URL and a promise for the ?code. */
  oauthBegin(): Promise<{ callbackUrl: string; result: Promise<{ code: string; state: string }> }>;
  getAutostart(): Promise<boolean>;
  setAutostart(on: boolean): Promise<void>;
  registerHotkeys(cfg: { toggle?: string; hold?: string }, on: (which: 'toggle' | 'hold', pressed: boolean) => void): Promise<string | null>;
  overlay(state: OverlayState): void;
  showMain(): void;
  onTray(cb: (action: string) => void): void;
}

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown }
}

export const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

let impl: Platform;
export async function initPlatform(): Promise<Platform> {
  impl = isTauri ? (await import('./tauri')).tauriPlatform() : (await import('./web')).webPlatform();
  return impl;
}
export const platform = () => impl;
