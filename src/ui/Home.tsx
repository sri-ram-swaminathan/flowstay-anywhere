import { useEffect, useState } from 'preact/hooks';
import * as c from '../controller';
import { history, HISTORY_LIMIT, onHistoryChange, type TranscriptionRecord } from '../history';
import { platform } from '../platform';
import { useSettings, type PttKey } from '../store';
import { toast } from './toast';
import { fmtDur } from './widgets';

export const KEY_LABEL: Record<PttKey, string> = { Space: 'Space', RightControl: 'Right Ctrl', RightAlt: 'Right Alt', RightShift: 'Right Shift', CapsLock: 'Caps Lock', F13: 'F13', off: '' };
export const pretty = (sc: string) => sc.replace('Control', 'Ctrl').replace('Super', 'Win').split('+');

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The last few dictations, as a tape log. */
export function Transcriptions({ go }: { go: (tab: string) => void }) {
  const s = useSettings();
  const ms = c.modelState.use();
  const err = c.lastError.use();
  const [rows, setRows] = useState<TranscriptionRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const load = () => history.all().then(setRows);
    load();
    return onHistoryChange(load);
  }, []);

  const copy = async (id: string, t: string) => {
    if (await platform().copy(t)) { setCopied(id); setTimeout(() => setCopied(null), 1200); } else toast('Copy failed');
  };

  return (
    <div class="page">
      {ms.state === 'none' && <div class="banner"><span class="grow">Speech model not installed: Flowstay can't transcribe yet.</span><button class="btn primary" onClick={() => go('settings')}>Install</button></div>}
      {ms.state === 'error' && <div class="banner err"><span class="grow">Speech model error: {ms.error}</span><button class="btn" onClick={() => c.loadModel()}>Retry</button></div>}
      {err && <div class="banner err"><span class="grow">{err}</span><button class="btn ghost" onClick={() => c.lastError.set(null)}>Dismiss</button></div>}

      <div class="legend">
        <span><span class="kbd">Esc</span> cancel</span>
        <span>Copied to clipboard{s.autoPasteEnabled ? ' and pasted' : ''}</span>
        <span>Last {HISTORY_LIMIT} kept</span>
      </div>

      <div class="tape">
        {rows.length === 0 ? (
          <div class="empty"><div class="silk">No recordings</div><p>Your last {HISTORY_LIMIT} dictations land here.</p></div>
        ) : rows.map((r) => (
          <div class="tape-row" key={r.id}>
            <div class="meta">
              <span>{clock(r.timestamp)}</span>
              <span>{fmtDur(r.duration)}</span>
              <span>{r.wordCount} W</span>
              {r.appName && <span class="tag">{r.appName.toUpperCase()}</span>}
              {r.personaName && <span class="tag">{r.personaName.toUpperCase()}</span>}
              {!!r.corrections && <span class="tag">CORRECTED</span>}
            </div>
            <div class="acts">
              {r.wasProcessed && <button class="key" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Orig'}</button>}
              <button class={`key ${copied === r.id ? 'engaged' : ''}`} onClick={() => copy(r.id, r.processedText)}>{copied === r.id ? 'Copied' : 'Copy'}</button>
              <button class="key" onClick={() => history.remove(r.id)}>Del</button>
            </div>
            <div class="text" style="grid-column:1/-1">{r.processedText}</div>
            {open === r.id && <div class="orig">{r.rawText}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
