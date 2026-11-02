import { Engine } from './engine/protocol';
import { findAsr, findLlm } from './engine/models';
import { isMostlySilent, Recorder } from './engine/recorder';
import { history, recovery, wordCount, type TranscriptionRecord } from './history';
import { platform, type FrontApp } from './platform';
import { rewrite } from './providers';
import { sounds } from './sounds';
import { allPersonas, createValue, log, settings, uid } from './store';
import { applyVocabulary, vocabularyInstruction, vocabularyPrompt } from './vocabulary';

export type Status = 'idle' | 'starting' | 'recording' | 'transcribing' | 'rewriting' | 'error';

export const status = createValue<Status>('idle');
export const level = createValue(0);
export const elapsed = createValue(0);
export const lastResult = createValue<TranscriptionRecord | null>(null);
export const lastError = createValue<string | null>(null);
export const modelState = createValue<{ asr: 'unknown' | 'loading' | 'ready' | 'error'; llm: 'unknown' | 'loading' | 'ready' | 'error'; progress: number; device?: string; error?: string }>({ asr: 'unknown', llm: 'unknown', progress: 0 });

export const engine = new Engine();
engine.onProgress = (kind, loaded, total) => {
  const m = modelState.get();
  modelState.set({ ...m, [kind]: 'loading', progress: total ? loaded / total : 0 });
};

const recorder = new Recorder({
  onLevel: (rms) => {
    level.set(rms);
    if (settings.get().showOverlay) platform().overlay({ status: 'recording', level: rms, elapsed: recorder.elapsed });
  },
  onSilenceTimeout: () => { log('Auto-stopped after silence'); stop(); },
  onChunk: (pcm) => recovery.append(pcm),
});

let target: FrontApp | null = null;
let pendingCopy: { resolve(text: string): Promise<boolean>; cancel(): void } | null = null;
// Holding a Web Lock keeps a hidden window (Windows tray mode) from being throttled mid-dictation.
let releaseLock: (() => void) | null = null;
const holdLock = () => (navigator as any).locks?.request('flowstay-active', () => new Promise<void>((r) => (releaseLock = r))).catch(() => {});
const dropLock = () => { releaseLock?.(); releaseLock = null; };
let tick: number | undefined;
let holdActive = false;

export async function loadAsr(): Promise<void> {
  const s = settings.get();
  modelState.set({ ...modelState.get(), asr: 'loading', progress: 0, error: undefined });
  try {
    const r = await engine.call<{ device: string }>({ type: 'loadAsr', modelId: s.asrModel, device: s.asrDevice });
    modelState.set({ ...modelState.get(), asr: 'ready', progress: 1, device: r.device });
    log(`Speech model ready: ${findAsr(s.asrModel).label} on ${r.device}`);
  } catch (e: any) {
    modelState.set({ ...modelState.get(), asr: 'error', error: String(e?.message ?? e) });
    log(`Speech model failed to load: ${e?.message ?? e}`);
    throw e;
  }
}

export async function loadLlm(): Promise<void> {
  const s = settings.get();
  modelState.set({ ...modelState.get(), llm: 'loading', progress: 0 });
  try {
    await engine.call({ type: 'loadLlm', modelId: s.localLlmModel });
    modelState.set({ ...modelState.get(), llm: 'ready', progress: 1 });
    log(`Local rewrite model ready: ${findLlm(s.localLlmModel).label}`);
  } catch (e: any) {
    modelState.set({ ...modelState.get(), llm: 'error', error: String(e?.message ?? e) });
    throw e;
  }
}

export async function start(): Promise<void> {
  if (status.get() !== 'idle' && status.get() !== 'error') return;
  const s = settings.get();
  status.set('starting');
  lastError.set(null);
  try {
    target = await platform().frontApp().catch(() => null);
    if (target) rememberApp(target);
    recorder.deviceId = s.micDeviceId;
    recorder.silenceTimeoutSec = s.silenceTimeoutSeconds;
    await recovery.clear();
    holdLock();
    await recorder.start();
    if (s.soundFeedbackEnabled) sounds.start();
    status.set('recording');
    elapsed.set(0);
    tick = window.setInterval(() => elapsed.set(recorder.elapsed), 250);
    if (modelState.get().asr !== 'ready' && modelState.get().asr !== 'loading') loadAsr().catch(() => {});
  } catch (e: any) {
    fail(e?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in settings and try again.' : `Couldn't start recording: ${e?.message ?? e}`);
  }
}

export async function stop(): Promise<void> {
  if (status.get() !== 'recording') return;
  clearInterval(tick);
  const s = settings.get();
  // must happen synchronously in the tap that stopped recording (iPhone clipboard rule)
  pendingCopy?.cancel();
  pendingCopy = s.autoCopyEnabled ? platform().prepareCopy?.() ?? null : null;
  const { audio, duration } = await recorder.stop();
  if (s.soundFeedbackEnabled) sounds.stop();
  level.set(0);
  if (duration < 0.3 || isMostlySilent(audio)) {
    pendingCopy?.cancel();
    pendingCopy = null;
    await recovery.clear();
    status.set('idle');
    dropLock();
    platform().overlay({ status: 'error', text: 'No speech detected' });
    setTimeout(() => platform().overlay({ status: 'hidden' }), 1200);
    return;
  }
  await process(audio, duration, target);
}

export function cancel() {
  clearInterval(tick);
  pendingCopy?.cancel();
  pendingCopy = null;
  dropLock();
  recorder.cancel();
  recovery.clear();
  status.set('idle');
  level.set(0);
  platform().overlay({ status: 'hidden' });
}

export const toggle = () => (status.get() === 'recording' ? stop() : start());

/** Hotkey entry point implementing toggle / hold / both modes. */
export function onHotkey(which: 'toggle' | 'hold', pressed: boolean) {
  const mode = settings.get().hotkeyPressMode;
  if (which === 'toggle' && (mode === 'toggle' || mode === 'both')) {
    if (pressed) toggle();
    return;
  }
  if (which === 'hold' || mode === 'hold') {
    if (pressed && !holdActive && status.get() !== 'recording') { holdActive = true; start(); }
    else if (!pressed && holdActive) { holdActive = false; stop(); }
  }
}

export async function process(audio: Float32Array, duration: number, app: FrontApp | null): Promise<TranscriptionRecord | null> {
  const s = settings.get();
  const p = platform();
  try {
    status.set('transcribing');
    p.overlay({ status: 'transcribing' });
    if (modelState.get().asr !== 'ready') await loadAsr();
    const { text: raw } = await engine.call<{ text: string; ms: number }>(
      { type: 'transcribe', modelId: s.asrModel, device: s.asrDevice, audio, language: s.language, prompt: s.vocabEnabled ? vocabularyPrompt(s.vocabulary) : '' },
    );
    if (!raw.trim()) throw new Error('No speech recognised');

    let text = raw.trim();
    let corrections = 0;
    if (s.vocabEnabled && s.vocabulary.length) {
      const r = applyVocabulary(text, s.vocabulary, { strictness: s.vocabStrictness });
      text = r.text;
      corrections = r.corrections.length;
      if (corrections) log(`Vocabulary: ${r.corrections.map((c) => `${c.from}→${c.to}`).join(', ')}`);
    }

    // persona
    const persona = resolvePersona(app);
    // Copy what you said right away; a persona rewrite (if any) replaces it when ready.
    if (persona && p.kind === 'windows') await p.copy(text);
    let processed = text;
    let wasProcessed = false;
    if (persona) {
      status.set('rewriting');
      p.overlay({ status: 'rewriting', persona: persona.name });
      const r = await rewrite(engine, text, persona.instruction, s.vocabEnabled ? vocabularyInstruction(s.vocabulary) : '');
      if (r.ok) {
        processed = s.vocabEnabled && s.vocabulary.length ? applyVocabulary(r.text, s.vocabulary, { strictness: s.vocabStrictness }).text : r.text;
        wasProcessed = true;
      } else {
        if (s.soundFeedbackEnabled) sounds.error();
        p.notify('Persona not applied', `${r.error} Used raw transcription.`);
      }
    }

    const rec: TranscriptionRecord = {
      id: uid(), timestamp: Date.now(), duration, rawText: text, processedText: processed,
      personaId: wasProcessed ? persona?.id : undefined, personaName: wasProcessed ? persona?.name : undefined,
      appId: app?.appId, appName: app?.appName, wordCount: wordCount(processed), wasProcessed, model: s.asrModel, corrections,
    };
    await history.add(rec);
    lastResult.set(rec);
    await recovery.clear();

    // Only auto-paste when dictation started in another app; from inside Flowstay just copy.
    const armed = pendingCopy;
    pendingCopy = null;
    const how = armed && (await armed.resolve(processed)) ? 'copied' : await p.deliver(processed, { autoPaste: s.autoPasteEnabled && !!app, autoCopy: s.autoCopyEnabled || p.kind === 'windows', keepOnClipboard: s.keepOnClipboard });
    if (how === 'none' && s.autoCopyEnabled) p.notify('Not copied', 'Your browser blocked the clipboard. Tap the copy button next to the text.');
    p.overlay({ status: 'done', text: how === 'pasted' ? 'Pasted' : how === 'copied' ? 'Copied' : 'Done' });
    setTimeout(() => status.get() === 'idle' && p.overlay({ status: 'hidden' }), 900);
    status.set('idle');
    dropLock();
    return rec;
  } catch (e: any) {
    fail(String(e?.message ?? e));
    return null;
  }
}

export async function recoverPending(): Promise<TranscriptionRecord | null> {
  const audio = await recovery.load();
  if (!audio) return null;
  log('Recovering unfinished recording');
  return process(audio, audio.length / 16000, null);
}
export const hasPendingRecovery = async () => !!(await recovery.load());

function resolvePersona(app: FrontApp | null) {
  const s = settings.get();
  if (!s.personasEnabled) return null;
  const list = allPersonas(s);
  if (s.useSmartAppDetection && app) {
    const rule = s.appRules.find((r) => r.appId.toLowerCase() === app.appId.toLowerCase());
    if (rule) return list.find((p) => p.id === rule.personaId) ?? null;
  }
  return list.find((p) => p.id === s.selectedPersonaId) ?? null;
}

function rememberApp(app: FrontApp) {
  const s = settings.get();
  if (s.knownApps.some((a) => a.appId.toLowerCase() === app.appId.toLowerCase())) return;
  settings.set({ knownApps: [app, ...s.knownApps].slice(0, 30) });
}

function fail(msg: string) {
  clearInterval(tick);
  pendingCopy?.cancel();
  pendingCopy = null;
  dropLock();
  log(`Error: ${msg}`);
  lastError.set(msg);
  status.set('idle');
  if (settings.get().soundFeedbackEnabled) sounds.error();
  platform().overlay({ status: 'error', text: msg.slice(0, 80) });
  setTimeout(() => platform().overlay({ status: 'hidden' }), 2500);
}
