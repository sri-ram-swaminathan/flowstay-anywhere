import { useEffect, useState } from 'preact/hooks';
import * as c from '../controller';
import { findAsr } from '../engine/models';
import { history, onHistoryChange, recovery, type TranscriptionRecord } from '../history';
import { platform } from '../platform';
import { allPersonas, settings, useSettings } from '../store';
import { toast } from './toast';
import { fmtDur, timeAgo } from './widgets';

const LABEL: Record<c.Status, string> = {
  idle: 'Ready to transcribe',
  starting: 'Starting microphone…',
  recording: 'Listening…',
  transcribing: 'Transcribing…',
  rewriting: 'Applying persona…',
  error: 'Something went wrong',
};

export function Home({ go }: { go: (tab: string) => void }) {
  const s = useSettings();
  const status = c.status.use();
  const lvl = c.level.use();
  const el = c.elapsed.use();
  const err = c.lastError.use();
  const ms = c.modelState.use();
  const p = platform();
  const [recent, setRecent] = useState<TranscriptionRecord[]>([]);
  const [pending, setPending] = useState(false);
  const [showOrig, setShowOrig] = useState<string | null>(null);

  useEffect(() => {
    const load = () => history.all().then((r) => setRecent(r.slice(0, 5)));
    load();
    c.hasPendingRecovery().then(setPending);
    return onHistoryChange(load);
  }, []);

  const busy = status === 'transcribing' || status === 'rewriting' || status === 'starting';
  const model = findAsr(s.asrModel);
  const personas = allPersonas(s);
  const activePersona = s.personasEnabled ? personas.find((x) => x.id === s.selectedPersonaId) : null;

  const copy = async (t: string) => ((await p.copy(t)) ? toast('Copied') : toast('Copy failed: long-press the text to copy'));
  const share = (t: string) => (navigator as any).share?.({ text: t }).catch(() => {});

  return (
    <div class="page">
      {p.kind === 'web' && !p.isStandalone && /iPhone|iPad/.test(navigator.userAgent) && (
        <div class="banner">
          <b>Install on your iPhone:</b> tap the Share button <span class="kbd">⬆︎</span> in Safari → <b>Add to Home Screen</b>. It then opens full-screen like an app and keeps the speech model cached offline.
        </div>
      )}
      {pending && (
        <div class="banner warn inline" style="justify-content:space-between">
          <span>An unfinished recording was found from last time.</span>
          <span class="inline">
            <button class="btn primary" onClick={async () => { setPending(false); await c.recoverPending(); }}>Recover &amp; transcribe</button>
            <button class="btn ghost" onClick={() => { setPending(false); recovery.clear(); }}>Discard</button>
          </span>
        </div>
      )}

      <div class="hero">
        <div class="status-line">
          {busy ? <span class="dot-spin" /> : <span>{status === 'recording' ? '🔴' : '🎙️'}</span>}
          {LABEL[status]}
        </div>
        <button
          class={`mic ${status === 'recording' ? 'rec' : busy ? 'busy' : ''}`}
          aria-label={status === 'recording' ? 'Stop' : 'Start transcription'}
          disabled={busy}
          onClick={() => c.toggle()}
        >
          {status === 'recording' && <span class="ring" style={{ transform: `scale(${1 + Math.min(0.35, lvl * 6)})` }} />}
          {status === 'recording' ? '■' : '🎤'}
        </button>
        <div class="timer">
          {status === 'recording' ? (
            <span>
              {fmtDur(el)} · tap to stop{' '}
              <button class="btn ghost" style="padding:2px 8px" onClick={() => c.cancel()}>Cancel</button>
            </span>
          ) : p.kind === 'windows' ? (
            <span>
              or press <span class="kbd">{s.toggleShortcut.replace('Control', 'Ctrl')}</span>
              {s.hotkeyPressMode !== 'toggle' && <> · hold <span class="kbd">{s.holdShortcut.replace('Control', 'Ctrl')}</span></>}
            </span>
          ) : null}
        </div>
        <div class="inline" style="justify-content:center">
          <span class={`pill ${ms.asr === 'ready' ? 'ok' : ms.asr === 'error' ? 'err' : ms.asr === 'loading' ? 'blue' : ''}`}>
            {model.label}
            {ms.asr === 'loading' ? ` · downloading ${Math.round(ms.progress * 100)}%` : ms.asr === 'ready' ? ` · ${ms.device === 'webgpu' ? 'GPU' : 'CPU'}` : ms.asr === 'error' ? ' · failed' : ' · not loaded'}
          </span>
          <button class="pill" style="border:0;cursor:pointer" onClick={() => go('personas')}>
            {activePersona ? `${activePersona.emoji ?? '✨'} ${activePersona.name}` : 'No persona'}
          </button>
          {s.vocabEnabled && s.vocabulary.length > 0 && <button class="pill" style="border:0;cursor:pointer" onClick={() => go('vocabulary')}>📖 {s.vocabulary.filter((v) => v.enabled).length} terms</button>}
        </div>
        {ms.asr === 'error' && <div class="banner warn">Model failed to load: {ms.error} <button class="btn" onClick={() => c.loadAsr().catch(() => {})}>Retry</button></div>}
        {err && <div class="banner warn">{err}</div>}
      </div>

      <h3 class="inline" style="justify-content:space-between">
        History
        {recent.length > 0 && <button class="btn ghost" onClick={() => go('history')}>See all</button>}
      </h3>
      {recent.length === 0 && <div class="card meta">Your transcriptions will show up here.</div>}
      {recent.map((r, i) => (
        <div class="card" key={r.id}>
          <div class="inline" style="justify-content:space-between;margin-bottom:6px">
            <span class="inline">
              {r.personaName && <span class="pill blue">{personas.find((x) => x.id === r.personaId)?.emoji} {r.personaName}</span>}
              {r.appName && <span class="chip">{r.appName}</span>}
              {!!r.corrections && <span class="chip">📖 {r.corrections} fixed</span>}
            </span>
            <span class="inline">
              <button class="icon-btn" title="Copy" onClick={() => copy(r.processedText)}>⧉</button>
              {'share' in navigator && <button class="icon-btn" title="Share" onClick={() => share(r.processedText)}>⬆︎</button>}
            </span>
          </div>
          <div class="result-text" style={i ? 'font-size:15px' : ''}>{r.processedText}</div>
          <div class="meta" style="margin-top:6px">
            {timeAgo(r.timestamp)} · {fmtDur(r.duration)} · {r.wordCount} words
            {r.wasProcessed && <> · <a href="#" onClick={(e) => { e.preventDefault(); setShowOrig(showOrig === r.id ? null : r.id); }}>{showOrig === r.id ? 'hide original' : 'original'}</a></>}
          </div>
          {showOrig === r.id && (
            <div class="original inline" style="justify-content:space-between;flex-wrap:nowrap">
              <span>{r.rawText}</span>
              <button class="icon-btn" onClick={() => copy(r.rawText)}>⧉</button>
            </div>
          )}
        </div>
      ))}
      {p.kind === 'web' && <p class="hint" style="text-align:center">After each dictation the text is copied automatically{settings.get().autoCopyEnabled ? '' : ' (turned off)'}. Paste it anywhere.</p>}
    </div>
  );
}
