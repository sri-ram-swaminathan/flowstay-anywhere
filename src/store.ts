import { useEffect, useState } from 'preact/hooks';
import type { VocabEntry } from './vocabulary';

export interface Persona {
  id: string;
  name: string;
  instruction: string;
  emoji?: string;
  isBuiltIn?: boolean;
}

export interface AppRule {
  id: string;
  appId: string; // e.g. "outlook.exe"
  appName: string;
  personaId: string;
}

export type HotkeyMode = 'toggle' | 'hold' | 'both';
export type ProviderId = 'local' | 'openrouter' | 'claude-code';

export interface Settings {
  hasCompletedOnboarding: boolean;
  // speech
  asrModel: string;
  asrDevice: 'auto' | 'gpu' | 'cpu';
  language: string;
  micDeviceId: string;
  silenceTimeoutSeconds: number;
  // output
  autoPasteEnabled: boolean;
  autoCopyEnabled: boolean;
  restoreClipboard: boolean;
  // feedback
  soundFeedbackEnabled: boolean;
  showOverlay: boolean;
  // hotkeys (Windows)
  hotkeyPressMode: HotkeyMode;
  toggleShortcut: string;
  holdShortcut: string;
  launchAtLogin: boolean;
  // history
  historyRetentionDays: number; // 0 = forever
  // personas
  personasEnabled: boolean;
  selectedPersonaId: string | null;
  userPersonas: Persona[];
  useSmartAppDetection: boolean;
  appRules: AppRule[];
  knownApps: { appId: string; appName: string }[];
  // providers
  provider: ProviderId;
  localLlmModel: string;
  openRouterModel: string;
  claudeCodeModel: 'haiku' | 'sonnet' | 'opus';
  claudeCodeMode: 'rewrite' | 'assistant';
  // confirmations
  confirmPersonaDelete: boolean;
  confirmAppRuleDelete: boolean;
  // vocabulary
  vocabulary: VocabEntry[];
  vocabEnabled: boolean;
  vocabStrictness: number;
  // updates
  checkForUpdates: boolean;
}

export const BUILT_IN_PERSONAS: Persona[] = [
  { id: 'cleanup', name: 'Cleanup', instruction: 'Remove filler words like: um, uh, like. Fix punctuation and capitalization.', emoji: '🧹', isBuiltIn: true },
  { id: 'professional', name: 'Professional', instruction: 'Rewrite in a professional business tone', emoji: '💼', isBuiltIn: true },
  { id: 'concise', name: 'Concise', instruction: 'Make this text concise while preserving the core message', emoji: '✂️', isBuiltIn: true },
];

const isPhone = typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent);

export const DEFAULTS: Settings = {
  hasCompletedOnboarding: false,
  asrModel: isPhone ? 'moonshine-base' : 'moonshine-v2-small',
  asrDevice: 'auto',
  language: 'en',
  micDeviceId: '',
  silenceTimeoutSeconds: 30,
  autoPasteEnabled: true,
  autoCopyEnabled: true,
  restoreClipboard: true,
  soundFeedbackEnabled: true,
  showOverlay: true,
  hotkeyPressMode: 'both',
  toggleShortcut: 'Alt+Space',
  holdShortcut: 'Control+Shift+Space',
  launchAtLogin: false,
  historyRetentionDays: 30,
  personasEnabled: false,
  selectedPersonaId: 'cleanup',
  userPersonas: [],
  useSmartAppDetection: false,
  appRules: [],
  knownApps: [],
  provider: isPhone ? 'openrouter' : 'local',
  localLlmModel: isPhone ? 'gemma-3-270m' : 'qwen3.5-0.8b',
  openRouterModel: 'meta-llama/llama-3.3-8b-instruct:free',
  claudeCodeModel: 'haiku',
  claudeCodeMode: 'rewrite',
  confirmPersonaDelete: true,
  confirmAppRuleDelete: true,
  vocabulary: [],
  vocabEnabled: true,
  vocabStrictness: 0.5,
  checkForUpdates: true,
};

const KEY = 'flowstay.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('settings reset (corrupt)', e);
    log('Settings were unreadable and have been reset to defaults.');
  }
  return { ...DEFAULTS };
}

type Listener = () => void;
let state: Settings = load();
const listeners = new Set<Listener>();

export const settings = {
  get: () => state,
  set(patch: Partial<Settings>) {
    state = { ...state, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
  reset() { localStorage.removeItem(KEY); state = { ...DEFAULTS }; listeners.forEach((l) => l()); },
};

// keep multiple windows (main / overlay) in sync
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { state = load(); listeners.forEach((l) => l()); }
  });
}

export function useSettings(): Settings {
  const [, force] = useState(0);
  useEffect(() => { const u = settings.subscribe(() => force((n) => n + 1)); return () => { u(); }; }, []);
  return state;
}

export const allPersonas = (s: Settings = state) => [...BUILT_IN_PERSONAS, ...s.userPersonas];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// ---- lightweight diagnostics log (Troubleshooting tab) ----
const LOG_KEY = 'flowstay.log';
export function log(msg: string) {
  try {
    const lines: string[] = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    lines.push(`${new Date().toISOString()} ${msg}`);
    localStorage.setItem(LOG_KEY, JSON.stringify(lines.slice(-300)));
  } catch {}
  console.info('[flowstay]', msg);
}
export const readLog = (): string[] => { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } };
export const clearLog = () => localStorage.removeItem(LOG_KEY);

// ---- generic reactive value ----
export function createValue<T>(initial: T) {
  let v = initial;
  const ls = new Set<Listener>();
  return {
    get: () => v,
    set: (nv: T) => { v = nv; ls.forEach((l) => l()); },
    use(): T {
      const [, f] = useState(0);
      useEffect(() => { const l = () => f((n) => n + 1); ls.add(l); return () => { ls.delete(l); }; }, []);
      return v;
    },
  };
}
