import { useEffect, useRef, useState } from 'preact/hooks';
import * as c from '../controller';
import { history, HISTORY_LIMIT, onHistoryChange, type TranscriptionRecord } from '../history';
import { platform } from '../platform';
import { allPersonas, useSettings, type PttKey } from '../store';
import { Icon } from './icons';
import { toast } from './toast';
import { fmtDur, timeAgo } from './widgets';

export const KEY_LABEL: Record<PttKey, string> = { Space: 'Space', RightControl: 'Right Ctrl', RightAlt: 'Right Alt', RightShift: 'Right Shift', CapsLock: 'Caps Lock', F13: 'F13', off: '' };
export const pretty = (sc: string) => sc.replace('Control', 'Ctrl').replace('Super', 'Win').split('+');

export function Home({ go }: { go: (tab: string) => void }) {
  const s = useSettings();
  const status = c.status.use();
  const lvl = c.level.use();
  const el = c.elapsed.use();
  const err = c.lastError.use();
  const ms = c.modelState.use();
  const latency = c.lastLatency.use();
  const live = c.liveText.use();
  const [recent, setRecent] = useState<TranscriptionRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const bars = useRef<number[]>(Array(18).fill(0));
  if (status === 'recording') bars.current = [...bars.current.slice(1), lvl];

  useEffect(() => {
    const load = () => history.all().then(setRecent);
    load();
    return onHistoryChange(load);
  }, []);

  const busy = status === 'transcribing' || status === 'rewriting';
  const persona = s.personasEnabled ? allPersonas(s).find((x) => x.id === s.selectedPersonaId) : null;
  const copy = async (t: string) => toast((await platform().copy(t)) ? 'Copied to clipboard' : 'Copy failed');
  const title = status === 'recording' ? 'Listening…' : status === 'transcribing' ? 'Transcribing…' : status === 'rewriting' ? `Applying ${persona?.name ?? 'persona'}…` : 'Ready to dictate';

  return (
    <div class="page">
      {ms.state === 'none' && (
        <div class="banner warn"><Icon name="download" /><span class="grow">Download a speech model to start dictating.</span><button class="btn primary" onClick={() => go('settings')}>Choose model</button></div>
      )}
      {ms.state === 'error' && <div class="banner err"><span class="grow">Speech model error: {ms.error}</span><button class="btn" onClick={() => c.loadModel()}>Retry</button></div>}
      {err && <div class="banner err"><span class="grow">{err}</span><button class="icon-btn" onClick={() => c.lastError.set(null)}><Icon name="x" size="sm" /></button></div>}

      <div class={`hero ${status === 'recording' ? 'rec' : ''}`}>
        <div>
          <div class="hero-title">
            {status === 'recording' ? <span class="dot rec" /> : busy ? <span class="spin" /> : <span class={`dot ${ms.state === 'ready' ? 'ok' : ''}`} />}
            {title}
            {status === 'recording' && <span style="color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums">{fmtDur(el)}</span>}
          </div>
          {status === 'recording' ? (
            <div class="hero-help">
              <div class="meter">{bars.current.map((l, i) => <i key={i} style={{ height: `${4 + Math.min(22, l * 300)}px` }} />)}</div>
              <span><span class="kbd">Esc</span> cancel</span>
            </div>
          ) : null}
          {status === 'recording' || (status === 'transcribing' && live) ? (
            <div class="live-text">{live || <span style="color:var(--faint)">{s.livePreview ? 'Start talking…' : 'Live preview is off'}</span>}{status === 'recording' && <span class="caret" />}</div>
          ) : (
            <div class="hero-help">
              {s.pttKey === 'Space' && <span><span class="kbd">Space</span> hold to talk (a tap still types a space)</span>}
              {s.pttKey !== 'off' && s.pttKey !== 'Space' && <span><span class="kbd">{KEY_LABEL[s.pttKey]}</span> hold to talk, or tap to start / stop</span>}
              {s.toggleShortcut && <span>{pretty(s.toggleShortcut).map((k) => <span class="kbd" key={k}>{k}</span>)} toggle</span>}
            </div>
          )}
          <div class="stats">
            {latency !== null && <span class="pill" title="Time from stopping to text on your clipboard"><Icon name="zap" size="sm" />{(latency / 1000).toFixed(2)} s</span>}
            <span class="pill"><Icon name="clipboard" size="sm" />{s.autoPasteEnabled ? 'Copy + paste' : 'Copy to clipboard'}</span>
            <button class="pill" onClick={() => go('vocabulary')}><Icon name="book" size="sm" />{s.vocabEnabled ? `${s.vocabulary.filter((v) => v.enabled).length} terms` : 'Vocabulary off'}</button>
            <button class="pill" onClick={() => go('personas')}><Icon name="sparkles" size="sm" />{persona ? persona.name : 'No persona'}</button>
          </div>
        </div>
        <button class={`mic ${status === 'recording' ? 'rec' : busy ? 'busy' : ''}`} disabled={busy} title={status === 'recording' ? 'Stop' : 'Start dictating'} onClick={() => c.toggle()}>
          {status === 'recording' && <span class="ring" style={{ transform: `scale(${1 + Math.min(0.3, lvl * 5)})` }} />}
          {busy ? <span class="spin" /> : <Icon name={status === 'recording' ? 'stop' : 'mic'} />}
        </button>
      </div>

      <h3>
        Recent <span style="text-transform:none;letter-spacing:0;font-weight:500">last {HISTORY_LIMIT}</span>
      </h3>
      {recent.length === 0 ? (
        <div class="empty">Your last {HISTORY_LIMIT} dictations appear here. Everything you say is also copied to your clipboard.</div>
      ) : (
        <div class="recent">
          {recent.map((r) => (
            <div class="item" key={r.id}>
              <div class="text">{r.processedText}</div>
              <div class="acts">
                <button class="icon-btn" title="Copy" onClick={() => copy(r.processedText)}><Icon name="copy" size="sm" /></button>
                <button class="icon-btn danger" title="Delete" onClick={() => history.remove(r.id)}><Icon name="trash" size="sm" /></button>
              </div>
              <div class="meta">
                {timeAgo(r.timestamp)} · {fmtDur(r.duration)} · {r.wordCount} words
                {r.appName && <span class="chip">{r.appName}</span>}
                {r.personaName && <span class="chip">{r.personaName}</span>}
                {!!r.corrections && <span class="chip">{r.corrections} vocabulary fix{r.corrections > 1 ? 'es' : ''}</span>}
                {r.wasProcessed && <a href="#" onClick={(e) => { e.preventDefault(); setOpen(open === r.id ? null : r.id); }}>{open === r.id ? 'hide original' : 'original'}</a>}
              </div>
              {open === r.id && <div class="orig spread"><span>{r.rawText}</span><button class="icon-btn" onClick={() => copy(r.rawText)}><Icon name="copy" size="sm" /></button></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
