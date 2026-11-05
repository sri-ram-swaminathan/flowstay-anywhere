// Recording HUD: a small deck readout at the bottom of the screen. Never takes focus.
import { listen } from '@tauri-apps/api/event';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OverlayState } from './platform';
import './styles.css';
import { Lamp } from './ui/equipment';

document.documentElement.classList.add('overlay-root');

const BARS = 12;
// irrational offsets so the bars ripple instead of pumping in unison (as in Murmur's HUD)
const PHASES = Array.from({ length: BARS }, (_, i) => (i * 0.618) % 1);

function Wave({ level, active }: { level: number; active: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => { setT(performance.now() / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  const amp = Math.max(0.04, Math.min(1, Math.sqrt(level) * 3));
  return (
    <div class="wave">
      {PHASES.map((p, i) => {
        const wave = Math.sin(t * 6 + p * Math.PI * 2);
        const h = active ? 3 + Math.max(0, amp * (0.55 + 0.45 * wave)) * 21 : 3;
        return <i key={i} style={{ height: `${h}px` }} />;
      })}
    </div>
  );
}

function Hud() {
  const [st, setSt] = useState<OverlayState>({ status: 'hidden' });
  const lvl = useRef(0);
  useEffect(() => {
    const un = listen<OverlayState>('overlay-state', (e) => {
      if (e.payload.level !== undefined) lvl.current = e.payload.level;
      setSt(e.payload);
    });
    return () => { un.then((f) => f()); };
  }, []);
  if (st.status === 'hidden') return null;
  const rec = st.status === 'recording';
  const label =
    rec ? st.text || 'Listening…'
    : st.status === 'transcribing' ? st.text || 'Transcribing…'
    : st.status === 'rewriting' ? `${st.persona ?? 'Persona'}…`
    : st.text ?? '';
  return (
    <div class="hud">
      {rec ? <Lamp lit blink /> : st.status === 'transcribing' || st.status === 'rewriting' ? <span class="spin" /> : <Lamp lit={st.status === 'done'} color={st.status === 'done' ? '#d8d2c4' : undefined} />}
      {rec && <Wave level={lvl.current} active />}
      <div class="txt">{tail(label, 160)}</div>
    </div>
  );
}

const tail = (t: string, n: number) => (t.length > n ? '…' + t.slice(t.length - n).replace(/^\S*\s/, '') : t);

render(<Hud />, document.getElementById('app')!);
