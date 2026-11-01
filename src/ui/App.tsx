import { useState } from 'preact/hooks';
import icon from '../assets/icon-64.png';
import { useSettings } from '../store';
import { History } from './History';
import { Home } from './Home';
import { Onboarding } from './Onboarding';
import { Personas } from './Personas';
import { Settings } from './Settings';
import { toasts } from './toast';
import { Vocabulary } from './Vocabulary';

const TABS = [
  ['home', '🎙️', 'Dictate'],
  ['personas', '✨', 'Personas'],
  ['vocabulary', '📖', 'Vocabulary'],
  ['history', '🕘', 'History'],
  ['settings', '⚙️', 'Settings'],
] as const;

export function App() {
  const s = useSettings();
  const [tab, setTab] = useState<string>('home');
  const ts = toasts.use();

  return (
    <div class="layout">
      <nav class="sidebar">
        <div class="brand"><img src={icon} alt="" />Flowstay</div>
        {TABS.map(([id, ico, label]) => (
          <button key={id} class={`nav ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <span class="ico">{ico}</span>{label}
          </button>
        ))}
      </nav>
      <main class="main">
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'personas' && <Personas />}
        {tab === 'vocabulary' && <Vocabulary />}
        {tab === 'history' && <History />}
        {tab === 'settings' && <Settings />}
      </main>
      {!s.hasCompletedOnboarding && <Onboarding />}
      <div class="toasts">{ts.map((t) => <div class="toast" key={t.id}>{t.msg}</div>)}</div>
    </div>
  );
}
