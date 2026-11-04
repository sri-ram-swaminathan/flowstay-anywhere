import { useMemo, useState } from 'preact/hooks';
import * as c from '../controller';
import { Icon } from './icons';
import { settings, uid, useSettings } from '../store';
import { aliasWarning, applyVocabulary, BIAS_LIMIT, parseVocabImport, type VocabEntry } from '../vocabulary';
import { toast } from './toast';
import { download, Modal, Row, Toggle } from './widgets';

export function Vocabulary() {
  const s = useSettings();
  const [term, setTerm] = useState('');
  const [alias, setAlias] = useState('');
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState<VocabEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const [test, setTest] = useState('I trained it in pie torch and pushed it to git hub');
  const ms = c.modelState.use();

  const set = (vocabulary: VocabEntry[]) => settings.set({ vocabulary });
  const add = () => {
    const t = term.trim();
    if (!t) return;
    if (s.vocabulary.some((v) => v.term.toLowerCase() === t.toLowerCase())) return toast(`“${t}” is already in your vocabulary`);
    set([{ id: uid(), term: t, soundsLike: alias.split(',').map((a) => a.trim()).filter(Boolean), enabled: true }, ...s.vocabulary]);
    setTerm('');
    setAlias('');
  };
  const shown = s.vocabulary.filter((v) => !filter || (v.term + v.soundsLike.join(' ')).toLowerCase().includes(filter.toLowerCase()));
  const preview = useMemo(() => applyVocabulary(test, s.vocabulary, { strictness: s.vocabStrictness }), [test, s.vocabulary, s.vocabStrictness]);

  return (
    <div class="page">
      <h1>Vocabulary</h1>
      <p class="sub">Names, jargon and product names you use, so they come out spelled your way.</p>

      <div class="card">
        <Row label={<b>Use my vocabulary</b>} hint={<>
          {ms.vocabulary ? `The speech model listens for your first ${BIAS_LIMIT} terms while you talk. ` : ''}
          Every transcript is then corrected: spelling, capitals, sound-alikes and your “heard as” rules. Personas keep your spellings.
        </>}>
          <Toggle checked={s.vocabEnabled} onChange={(v) => settings.set({ vocabEnabled: v })} />
        </Row>
        <Row label="Matching" hint="Relaxed catches more mishearings; strict only fixes near-identical ones.">
          <span class="inline">
            <span class="hint">Relaxed</span>
            <input type="range" min={0} max={1} step={0.05} value={s.vocabStrictness} onInput={(e) => settings.set({ vocabStrictness: +(e.target as HTMLInputElement).value })} />
            <span class="hint">Strict</span>
          </span>
        </Row>
      </div>

      <h3>Add a term</h3>
      <div class="card stack">
        <div class="inline">
          <input style="flex:2;min-width:140px" placeholder="Term, e.g. PyTorch" value={term} onInput={(e) => setTerm((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input style="flex:3;min-width:160px" placeholder="Heard as (optional), e.g. pie torch" value={alias} onInput={(e) => setAlias((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button class="btn primary" onClick={add}>Add</button>
        </div>
        {alias.split(',').map((a) => aliasWarning(a, term || 'your term')).filter(Boolean).map((w) => <div class="hint" style="color:var(--warn)" key={w}>{w}</div>)}
        <div class="hint">“Heard as” is optional: an exact rule for what the model keeps writing instead (“cloud code” → Claude Code). It also catches glued and hyphenated forms. Most terms are fixed automatically without one.</div>
      </div>

      <h3 class="inline" style="justify-content:space-between">
        {s.vocabulary.length} terms
        <span class="inline">
          <button class="btn" onClick={() => setImporting(true)}>Import</button>
          <button class="btn" disabled={!s.vocabulary.length} onClick={() => download(new Blob([s.vocabulary.map((v) => (v.soundsLike.length ? `${v.term}: ${v.soundsLike.join(', ')}` : v.term)).join('\n')], { type: 'text/plain' }), 'flowstay-vocabulary.txt')}>Export</button>
        </span>
      </h3>
      <div class="card">
        {s.vocabulary.length > 8 && <input style="width:100%;margin-bottom:10px" placeholder="Search…" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />}
        {!s.vocabulary.length && <div class="meta">No terms yet. Try adding your name, your university, tools you use, or colleagues’ names.</div>}
        {shown.map((v) => (
          <div class="list-item" key={v.id} style={v.enabled ? '' : 'opacity:.5'}>
            <div class="grow">
              <b>{v.term}</b>
              {v.soundsLike.length > 0 && <div class="chips" style="margin-top:4px">{v.soundsLike.map((a) => <span class="chip" key={a}>heard as “{a}”</span>)}</div>}
            </div>
            <Toggle checked={v.enabled} onChange={(on) => set(s.vocabulary.map((x) => (x.id === v.id ? { ...x, enabled: on } : x)))} />
            <button class="icon-btn" onClick={() => setEdit(v)}><Icon name="edit" size="sm" /></button>
            <button class="icon-btn danger" onClick={() => set(s.vocabulary.filter((x) => x.id !== v.id))}><Icon name="trash" size="sm" /></button>
          </div>
        ))}
      </div>

      <h3>Test</h3>
      <div class="card stack">
        <input value={test} onInput={(e) => setTest((e.target as HTMLInputElement).value)} placeholder="Type how the model might mishear something" />
        <div class="original" style="color:var(--text)">{preview.text}</div>
        {preview.corrections.length > 0 && <div class="chips">{preview.corrections.map((c, i) => <span class="chip" key={i}>{c.from} → {c.to}</span>)}</div>}
      </div>

      {edit && (
        <Modal onClose={() => setEdit(null)}>
          <h2>Edit term</h2>
          <div class="stack" style="margin-top:12px">
            <input value={edit.term} onInput={(e) => setEdit({ ...edit, term: (e.target as HTMLInputElement).value })} />
            <input placeholder="Heard as (comma-separated)" value={edit.soundsLike.join(', ')} onInput={(e) => setEdit({ ...edit, soundsLike: (e.target as HTMLInputElement).value.split(',').map((a) => a.trimStart()) })} />
            <div class="inline" style="justify-content:flex-end">
              <button class="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button class="btn primary" onClick={() => { set(s.vocabulary.map((x) => (x.id === edit.id ? { ...edit, soundsLike: edit.soundsLike.map((a) => a.trim()).filter(Boolean) } : x))); setEdit(null); }}>Save</button>
            </div>
          </div>
        </Modal>
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const doImport = () => {
    const s = settings.get();
    const existing = new Set(s.vocabulary.map((v) => v.term.toLowerCase()));
    const fresh = parseVocabImport(text).filter((e) => !existing.has(e.term.toLowerCase())).map((e) => ({ ...e, id: uid() }));
    settings.set({ vocabulary: [...fresh, ...s.vocabulary] });
    toast(`Imported ${fresh.length} terms`);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <h2>Import terms</h2>
      <p class="hint">One per line. Optionally add what it's heard as after a colon:<br /><code>Maastricht</code><br /><code>CBS: c b s, see bee ess</code></p>
      <textarea rows={10} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <div class="inline" style="justify-content:space-between;margin-top:10px">
        <label class="btn">Load .txt file<input type="file" accept=".txt,.csv,text/plain" hidden onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) setText(await f.text()); }} /></label>
        <span class="inline"><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn primary" onClick={doImport}>Import</button></span>
      </div>
    </Modal>
  );
}
