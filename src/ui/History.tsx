import { useEffect, useMemo, useState } from 'preact/hooks';
import { exportHistory, history, onHistoryChange, type TranscriptionRecord } from '../history';
import { platform } from '../platform';
import { settings, uid, useSettings } from '../store';
import { toast } from './toast';
import { confirmAsk, download, fmtDur, Row } from './widgets';

export function History() {
  const s = useSettings();
  const [rows, setRows] = useState<TranscriptionRecord[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const load = () => history.all().then(setRows);
    load();
    return onHistoryChange(load);
  }, []);

  const shown = useMemo(() => rows.filter((r) => !q || `${r.processedText} ${r.rawText} ${r.appName ?? ''} ${r.personaName ?? ''}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const groups = useMemo(() => {
    const g = new Map<string, TranscriptionRecord[]>();
    for (const r of shown) {
      const d = new Date(r.timestamp);
      const key = d.toDateString() === new Date().toDateString() ? 'Today' : d.toDateString() === new Date(Date.now() - 864e5).toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      g.set(key, [...(g.get(key) ?? []), r]);
    }
    return [...g];
  }, [shown]);
  const words = rows.reduce((n, r) => n + r.wordCount, 0);
  const secs = rows.reduce((n, r) => n + r.duration, 0);

  return (
    <div class="page">
      <h1>History</h1>
      <p class="sub">{rows.length} transcriptions · {words.toLocaleString()} words · {fmtDur(secs)} spoken</p>

      <div class="card">
        <Row label="Keep history for">
          <select value={s.historyRetentionDays} onChange={(e) => { const d = +(e.target as HTMLSelectElement).value; settings.set({ historyRetentionDays: d }); history.prune(d); }}>
            {[[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'Forever']].map(([v, l]) => <option value={v} key={v}>{l}</option>)}
          </select>
        </Row>
        <Row label="Export">
          <span class="inline">
            {(['txt', 'md', 'json'] as const).map((f) => <button key={f} class="btn" disabled={!rows.length} onClick={() => download(exportHistory(shown, f), `flowstay-history.${f}`)}>.{f}</button>)}
            <button class="btn danger" disabled={!rows.length} onClick={() => confirmAsk('Delete all history?') && history.clear()}>Clear all</button>
          </span>
        </Row>
      </div>

      <input style="width:100%;margin:6px 0 4px" placeholder="Search history…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />

      {groups.map(([day, list]) => (
        <div key={day}>
          <h3>{day}</h3>
          <div class="card">
            {list.map((r) => (
              <div class="list-item" key={r.id} style="flex-direction:column;gap:6px">
                <div class="inline" style="justify-content:space-between;width:100%">
                  <span class="meta">
                    {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {fmtDur(r.duration)} · {r.wordCount} words
                    {r.appName && <> · {r.appName}</>}
                  </span>
                  <span class="inline">
                    {r.personaName && <span class="pill blue">{r.personaName}</span>}
                    <button class="icon-btn" title="Copy" onClick={async () => toast((await platform().copy(r.processedText)) ? 'Copied' : 'Copy failed')}>⧉</button>
                    <button class="icon-btn" title="Details" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '▴' : '▾'}</button>
                  </span>
                </div>
                <div class="result-text" style="font-size:15px">{r.processedText}</div>
                {open === r.id && (
                  <div class="stack" style="width:100%">
                    {r.wasProcessed && <div class="original"><b>Original:</b> {r.rawText}</div>}
                    <div class="inline">
                      {r.wasProcessed && <button class="btn" onClick={() => platform().copy(r.rawText).then(() => toast('Original copied'))}>Copy original</button>}
                      <AddWord />
                      <button class="btn danger" onClick={() => history.remove(r.id)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {!rows.length && <div class="card meta">Nothing yet.</div>}
    </div>
  );
}

/** Quick way to teach a word the model got wrong. */
function AddWord() {
  const [v, setV] = useState('');
  return (
    <span class="inline">
      <input placeholder="Add correct spelling to vocabulary" value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
      <button class="btn" disabled={!v.trim()} onClick={() => {
        const s = settings.get();
        if (!s.vocabulary.some((x) => x.term.toLowerCase() === v.trim().toLowerCase())) settings.set({ vocabulary: [{ id: uid(), term: v.trim(), soundsLike: [], enabled: true }, ...s.vocabulary] });
        toast(`Added “${v.trim()}”`);
        setV('');
      }}>Add</button>
    </span>
  );
}
