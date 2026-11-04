import { cleanTranscript } from './cleanup';
import { Engine } from './engine/protocol';
import { findLlm } from './engine/models';
import { Recorder } from './engine/recorder';
import { history, wordCount, type TranscriptionRecord } from './history';
import { platform, type EngineModel, type FrontApp } from './platform';
import { rewrite } from './providers';
import { sounds } from './sounds';
import { allPersonas, createValue, log, PTT_VK, settings, uid } from './store';
import { applyVocabulary, vocabularyInstruction, vocabularyTerms } from './vocabulary';

export type Status = 'idle' | 'recording' | 'transcribing' | 'rewriting';

export const status = createValue<Status>('idle');
export const level = createValue(0);
export const elapsed = createValue(0);
export const lastResult = createValue<TranscriptionRecord | null>(null);
export const lastError = createValue<string | null>(null);
export const lastLatency = createValue<number | null>(null); // ms from stop to text
export const models = createValue<EngineModel[]>([]);
export const modelState = createValue<{ state: 'none' | 'downloading' | 'loading' | 'ready' | 'error'; progress: number; error?: string; vocabulary?: boolean }>({ state: 'none', progress: 0 });
export const llmState = createValue<{ state: 'unknown' | 'loading' | 'ready' | 'error'; progress: number; error?: string }>({ state: 'unknown', progress: 0 });

/** Local LLM for persona rewrites (WebGPU, in a worker). */
export const llm = new Engine();
llm.onProgress = (_k, loaded, total) => llmState.set({ state: 'loading', progress: total ? loaded / total : 0 });

const recorder = new Recorder({
  onLevel: (rms) => {
    level.set(rms);
    if (settings.get().showOverlay) platform().overlay({ status: 'recording', level: rms, elapsed: recorder.elapsed });
  },
  onSilenceTimeout: () => { log('Auto-stopped after silence'); stop(); },
  onSegment: (pcm) => segments.push(transcribePcm(pcm)),
});

let segments: Promise<string>[] = [];
let target: FrontApp | null = null;
let tick: number | undefined;
let pttDownAt = 0;
let pttStarted = false; // this recording was started by the push-to-talk key
let busy = false;

// ---------------------------------------------------------------- models

export async function refreshModels() {
  models.set(await platform().models());
}

export async function downloadModel(id: string) {
  modelState.set({ state: 'downloading', progress: 0 });
  try {
    await platform().download(id, (l, t) => modelState.set({ state: 'downloading', progress: t ? l / t : 0 }));
    await refreshModels();
    log(`Downloaded ${id}`);
  } catch (e: any) {
    modelState.set({ state: 'error', progress: 0, error: String(e?.message ?? e) });
    throw e;
  }
}

/** Loads the selected model (kept warm in memory). */
export async function loadModel(): Promise<boolean> {
  const id = settings.get().model;
  modelState.set({ state: 'loading', progress: 1 });
  try {
    const r = await platform().load(id);
    modelState.set({ state: 'ready', progress: 1, vocabulary: r.vocabulary });
    log(`Model ${id} ready in ${r.loadMs} ms (vocabulary biasing: ${r.vocabulary ? 'yes' : 'no'})`);
    return true;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    modelState.set({ state: msg === 'not-downloaded' ? 'none' : 'error', progress: 0, error: msg === 'not-downloaded' ? undefined : msg });
    return false;
  }
}

export async function loadLlm(): Promise<void> {
  llmState.set({ state: 'loading', progress: 0 });
  try {
    await llm.call({ type: 'loadLlm', modelId: settings.get().localLlmModel });
    llmState.set({ state: 'ready', progress: 1 });
    log(`Local rewrite model ready: ${findLlm(settings.get().localLlmModel).label}`);
  } catch (e: any) {
    llmState.set({ state: 'error', progress: 0, error: String(e?.message ?? e) });
    throw e;
  }
}

async function transcribePcm(pcm: Float32Array): Promise<string> {
  const s = settings.get();
  const { text } = await platform().transcribe(pcm, s.vocabEnabled ? vocabularyTerms(s.vocabulary) : [], s.language);
  return text.trim();
}

// ---------------------------------------------------------------- recording

export function configureRecorder() {
  const s = settings.get();
  recorder.deviceId = s.micDeviceId;
  recorder.silenceTimeoutSec = s.silenceTimeoutSeconds;
  recorder.keepWarm = s.instantStart;
  if (s.instantStart) recorder.warm().catch(() => {});
  else if (status.get() === 'idle') recorder.close();
}

export async function start(): Promise<void> {
  if (status.get() !== 'idle' || busy) return;
  const s = settings.get();
  if (modelState.get().state !== 'ready') {
    if (!(await loadModel())) {
      fail(modelState.get().state === 'none' ? 'No speech model downloaded yet. Open Flowstay → Settings → Speech model.' : `Speech model failed to load: ${modelState.get().error}`);
      platform().showMain();
      return;
    }
  }
  busy = true;
  lastError.set(null);
  try {
    target = await platform().frontApp().catch(() => null);
    if (target) rememberApp(target);
    segments = [];
    await recorder.start();
    if (s.soundFeedbackEnabled) sounds.start();
    status.set('recording');
    elapsed.set(0);
    tick = window.setInterval(() => elapsed.set(recorder.elapsed), 200);
    platform().registerShortcut('Escape', cancel);
  } catch (e: any) {
    fail(e?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in Windows Settings → Privacy & security → Microphone.' : `Couldn't start recording: ${e?.message ?? e}`);
  } finally {
    busy = false;
  }
}

export async function stop(): Promise<void> {
  if (status.get() !== 'recording') return;
  const s = settings.get();
  const p = platform();
  clearInterval(tick);
  p.unregisterShortcut('Escape');
  const t0 = performance.now();
  const { tail, duration, total } = await recorder.stop();
  if (s.soundFeedbackEnabled) sounds.stop();
  level.set(0);
  status.set('transcribing');
  p.overlay({ status: 'transcribing' });
  try {
    const parts = await Promise.all([...segments, tail.length > 8000 ? transcribePcm(tail) : Promise.resolve('')]);
    segments = [];
    let text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) {
      status.set('idle');
      p.overlay({ status: 'error', text: total < 8000 ? 'Too short' : 'No speech detected' });
      setTimeout(() => status.get() === 'idle' && p.overlay({ status: 'hidden' }), 1000);
      return;
    }
    let corrections = 0;
    if (s.vocabEnabled && s.vocabulary.length) {
      const r = applyVocabulary(text, s.vocabulary, { strictness: s.vocabStrictness });
      text = r.text;
      corrections = r.corrections.length;
    }
    if (s.cleanupEnabled) text = cleanTranscript(text);

    // copy immediately: your words are on the clipboard before any persona rewrite
    await p.copy(text);
    const latency = Math.round(performance.now() - t0);
    lastLatency.set(latency);

    const persona = resolvePersona(target);
    let final = text;
    if (persona) {
      status.set('rewriting');
      p.overlay({ status: 'rewriting', persona: persona.name });
      const r = await rewrite(llm, text, persona.instruction, s.vocabEnabled ? vocabularyInstruction(s.vocabulary) : '');
      if (r.ok) {
        final = s.vocabEnabled && s.vocabulary.length ? applyVocabulary(r.text, s.vocabulary, { strictness: s.vocabStrictness }).text : r.text;
        await p.copy(final);
      } else {
        if (s.soundFeedbackEnabled) sounds.error();
        p.notify('Persona not applied', `${r.error} Your original words were used.`);
      }
    }

    const pasted = s.autoPasteEnabled && target ? await p.paste(final) : false;
    log(`Dictation: ${duration.toFixed(1)} s audio → text in ${latency} ms${pasted ? ', pasted' : ''}${corrections ? `, ${corrections} vocabulary fixes` : ''}`);

    const rec: TranscriptionRecord = {
      id: uid(), timestamp: Date.now(), duration, rawText: text, processedText: final,
      personaId: final !== text ? persona?.id : undefined, personaName: final !== text ? persona?.name : undefined,
      appId: target?.appId, appName: target?.appName, wordCount: wordCount(final), wasProcessed: final !== text, model: s.model, corrections,
    };
    await history.add(rec);
    lastResult.set(rec);
    p.overlay({ status: 'done', text: pasted ? 'Pasted · copied' : 'Copied' });
    setTimeout(() => status.get() === 'idle' && p.overlay({ status: 'hidden' }), 800);
  } catch (e: any) {
    fail(String(e?.message ?? e));
  } finally {
    if (status.get() !== 'idle') status.set('idle');
  }
}

export function cancel() {
  if (status.get() !== 'recording') return;
  clearInterval(tick);
  platform().unregisterShortcut('Escape');
  recorder.cancel();
  segments = [];
  status.set('idle');
  level.set(0);
  platform().overlay({ status: 'error', text: 'Cancelled' });
  setTimeout(() => status.get() === 'idle' && platform().overlay({ status: 'hidden' }), 700);
}

export const toggle = () => (status.get() === 'recording' ? stop() : start());

/** Push-to-talk key: hold to talk (release stops), or tap to start and tap again to stop. */
export function onPtt(e: 'down' | 'up' | 'combo') {
  const st = status.get();
  if (e === 'down') {
    if (st === 'idle') { pttDownAt = performance.now(); pttStarted = true; start(); }
    else if (st === 'recording') { pttStarted = false; stop(); }
  } else if (e === 'up') {
    if (st === 'recording' && pttStarted && performance.now() - pttDownAt > 350) { pttStarted = false; stop(); }
  } else if (e === 'combo') {
    // the key was used as a modifier (e.g. Ctrl+C): that wasn't a dictation
    if (st === 'recording' && pttStarted && performance.now() - pttDownAt < 1500) { pttStarted = false; cancelQuietly(); }
  }
}

function cancelQuietly() {
  clearInterval(tick);
  platform().unregisterShortcut('Escape');
  recorder.cancel();
  segments = [];
  status.set('idle');
  level.set(0);
  platform().overlay({ status: 'hidden' });
}

export async function applyShortcuts(): Promise<string | null> {
  const s = settings.get();
  const p = platform();
  await p.setPttKey(PTT_VK[s.pttKey]);
  return s.toggleShortcut ? p.registerShortcut(s.toggleShortcut, () => toggle()) : null;
}

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
  platform().unregisterShortcut('Escape');
  log(`Error: ${msg}`);
  lastError.set(msg);
  status.set('idle');
  if (settings.get().soundFeedbackEnabled) sounds.error();
  platform().overlay({ status: 'error', text: msg.slice(0, 70) });
  setTimeout(() => status.get() === 'idle' && platform().overlay({ status: 'hidden' }), 2500);
}
