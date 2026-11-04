import { useState } from 'preact/hooks';
import icon from '../assets/icon-64.png';
import * as c from '../controller';
import { useSettings } from '../store';
import { Home } from './Home';
import { Icon } from './icons';
import { Onboarding } from './Onboarding';
import { Personas } from './Personas';
import { Settings } from './Settings';
import { toasts } from './toast';
import { Vocabulary } from './Vocabulary';

const TABS = [
  ['home', 'mic', 'Dictate'],
  ['vocabulary', 'book', 'Vocabulary'],
  ['personas', 'sparkles', 'Personas'],
  ['settings', 'settings', 'Settings'],
] as const;

export function App() {
  const s = useSettings();
  const [tab, setTab] = useState<string>('home');
  const ts = toasts.use();
  const ms = c.modelState.use();
  const status = c.status.use();
  const models = c.models.use();
  const model = models.find((m) => m.id === s.model);

  return (
    <div class="layout">
      <nav class="sidebar">
        <div class="brand"><img src={icon} alt="" />Flowstay</div>
        {TABS.map(([id, ico, label]) => (
          <button key={id} class={`nav ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <Icon name={ico} />{label}
          </button>
        ))}
        <div class="side-foot">
          <span class="inline" style="gap:7px">
            <span class={`dot ${status === 'recording' ? 'rec' : ms.state === 'ready' ? 'ok' : ms.state === 'error' ? 'err' : ms.state === 'none' ? '' : 'busy'}`} />
            {status === 'recording' ? 'Listening' : ms.state === 'ready' ? 'Ready' : ms.state === 'downloading' ? `Downloading ${Math.round(ms.progress * 100)}%` : ms.state === 'loading' ? 'Loading model…' : ms.state === 'none' ? 'No model' : 'Model error'}
          </span>
          <span style="color:var(--faint)">{model?.name ?? ''}</span>
        </div>
      </nav>
      <main class="main">
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'vocabulary' && <Vocabulary />}
        {tab === 'personas' && <Personas />}
        {tab === 'settings' && <Settings />}
      </main>
      {!s.hasCompletedOnboarding && <Onboarding />}
      <div class="toasts">{ts.map((t) => <div class="toast" key={t.id}>{t.msg}</div>)}</div>
    </div>
  );
}
