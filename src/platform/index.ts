export interface FrontApp { appId: string; appName: string }
export interface OverlayState {
  status: 'recording' | 'transcribing' | 'rewriting' | 'done' | 'error' | 'hidden';
  level?: number;
  elapsed?: number;
  text?: string;
  persona?: string;
}

export interface EngineModel {
  id: string;
  name: string;
  blurb: string;
  size: number;
  englishWer: number;
  cpuSpeed: number;
  multilingual: boolean;
  downloaded: boolean;
}

export interface Platform {
  kind: 'windows' | 'mock';
  // ---- speech engine (native)
  models(): Promise<EngineModel[]>;
  download(id: string, onProgress: (loaded: number, total: number) => void): Promise<void>;
  deleteModel(id: string): Promise<void>;
  load(id: string): Promise<{ id: string; vocabulary: boolean; loadMs: number }>;
  transcribe(pcm: Float32Array, vocabulary: string[], language: string): Promise<{ text: string; ms: number }>;
  // ---- input / output
  registerShortcut(shortcut: string, cb: (pressed: boolean) => void): Promise<string | null>;
  unregisterShortcut(shortcut: string): Promise<void>;
  copy(text: string): Promise<boolean>;
  paste(text: string): Promise<boolean>;
  frontApp(): Promise<FrontApp | null>;
  // ---- providers
  claudeAvailable(): Promise<boolean>;
  runClaude(args: string[], stdin: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>;
  oauthBegin(): Promise<{ callbackUrl: string; result: Promise<{ code: string; state: string }> }>;
  // ---- shell
  notify(title: string, body: string): void;
  openUrl(url: string): void;
  getAutostart(): Promise<boolean>;
  setAutostart(on: boolean): Promise<void>;
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
  // The browser build is a mock for UI development only; the product is the Windows app.
  impl = isTauri ? (await import('./tauri')).tauriPlatform() : (await import('./mock')).mockPlatform();
  return impl;
}
export const platform = () => impl;
