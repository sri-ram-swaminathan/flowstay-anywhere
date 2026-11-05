import { useEffect, useState } from 'preact/hooks';
import * as c from '../controller';
import { platform } from '../platform';
import { useSettings } from '../store';
import { Lamp, Screws, VuMeter, Vents } from './equipment';
import { pretty, Transcriptions } from './Home';
import { Onboarding } from './Onboarding';
import { Personas } from './Personas';
import { Settings } from './Settings';
import { toast, toasts } from './toast';
import { Vocabulary } from './Vocabulary';

const SECTIONS = [
  ['transcriptions', 'Transcriptions'],
  ['dictionary', 'Dictionary'],
  ['personas', 'Personas'],
  ['settings', 'Settings'],
] as const;

function useFace(pref: 'system' | 'silver' | 'black') {
  const q = '(prefers-color-scheme: light)';
  const [light, setLight] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setLight(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return pref === 'system' ? (light ? 'silver' : 'black') : pref;
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function App() {
  const s = useSettings();
  const face = useFace(s.face);
  const [tab, setTab] = useState<string>('transcriptions');
  const ts = toasts.use();
  const ms = c.modelState.use();
  const status = c.status.use();
  const lvl = c.level.use();
  const el = c.elapsed.use();
  const last = c.lastResult.use();
  const latency = c.lastLatency.use();
  const models = c.models.use();
  const model = models.find((m) => m.id === s.model);

  useEffect(() => { document.body.className = `face-${face}`; }, [face]);

  const rec = status === 'recording';
  const busy = status === 'transcribing' || status === 'rewriting';
  const shortName = model ? model.name.replace(/\s*\(.*\)/, '').toUpperCase() : '—';
  const hint = s.toggleShortcut ? <>Press {pretty(s.toggleShortcut).map((k) => <span class="kbd" key={k}>{k}</span>)} to start, press again to stop.</> : 'Press Record to start.';

  return (
    <div class={`unit face-${face}`}>
      <header class="front brushed">
        <Screws />
        <div class="group">
          <span class="silk">Transport</span>
          <div class="inline" style="gap:10px">
            <button class={`key record ${rec ? 'engaged' : ''}`} disabled={busy} onClick={() => c.toggle()}>{rec ? 'Stop' : busy ? 'Working' : 'Record'}</button>
            <Lamp lit={rec} blink={rec} />
            <span class="silk">Rec</span>
          </div>
        </div>
        <div class="group">
          <span class="silk">Level</span>
          <VuMeter level={lvl} active={rec} />
        </div>
        <div class="group">
          <span class="silk">Counter</span>
          <div class="deck counter">{mmss(rec ? el : 0)}</div>
        </div>
        <div class="group grow">
          <span class="silk">Model</span>
          <div class="deck model-readout">
            <Lamp lit={ms.state === 'ready'} blink={ms.state === 'loading' || ms.state === 'downloading'} color="var(--ink-deck)" />
            <span>{ms.state === 'downloading' ? `DOWNLOADING ${Math.round(ms.progress * 100)}%` : ms.state === 'none' ? 'NO MODEL' : shortName}</span>
            {latency !== null && <span class="dim">· {(latency / 1000).toFixed(2)} S</span>}
          </div>
        </div>
        <Vents />
      </header>

      <section class="deck readout">
        <span class="silk">{rec ? 'Rec' : busy ? 'Proc' : 'Last'}</span>
        <div class="readout-text">
          {rec ? <span class="placeholder">Recording… press {pretty(s.toggleShortcut || 'Record').map((k, i) => <span key={k}>{i ? '+' : ''}{k}</span>)} again to stop, Esc to cancel.<span class="caret" /></span>
            : busy ? <span class="placeholder">Transcribing…</span>
            : last ? last.processedText
            : <span class="placeholder">{hint}</span>}
        </div>
        {!rec && !busy && last && <button class="key" style="height:26px;padding:0 10px;font-size:9px" onClick={async () => toast((await platform().copy(last.processedText)) ? 'Copied' : 'Copy failed')}>Copy</button>}
      </section>

      <nav class="keys">
        {SECTIONS.map(([id, label]) => (
          <button key={id} class={`key ${tab === id ? 'engaged' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <main class="well">
        {tab === 'transcriptions' && <Transcriptions go={setTab} />}
        {tab === 'dictionary' && <Vocabulary />}
        {tab === 'personas' && <Personas />}
        {tab === 'settings' && <Settings />}
      </main>

      {!s.hasCompletedOnboarding && <Onboarding />}
      <div class="toasts">{ts.map((t) => <div class="toast" key={t.id}>{t.msg}</div>)}</div>
    </div>
  );
}
