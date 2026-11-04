// The floating pill shown at the bottom of the screen while dictating.
import { listen } from '@tauri-apps/api/event';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OverlayState } from './platform';
import './styles.css';
import { Icon } from './ui/icons';
import { fmtDur } from './ui/widgets';

document.documentElement.classList.add('overlay-root');

function Bubble() {
  const [st, setSt] = useState<OverlayState>({ status: 'hidden' });
  const hist = useRef<number[]>(Array(16).fill(0));
  useEffect(() => {
    const un = listen<OverlayState>('overlay-state', (e) => {
      if (e.payload.status === 'recording') hist.current = [...hist.current.slice(1), e.payload.level ?? 0];
      setSt(e.payload);
    });
    return () => { un.then((f) => f()); };
  }, []);
  if (st.status === 'hidden') return null;
  return (
    <div class="bubble">
      {st.status === 'recording' && (
        <>
          <span class="rec-dot" />
          <div class="bars-live">{hist.current.map((l, i) => <i key={i} style={{ height: `${3 + Math.min(17, l * 240)}px` }} />)}</div>
          <span style="opacity:.6;font-variant-numeric:tabular-nums">{fmtDur(st.elapsed ?? 0)}</span>
        </>
      )}
      {st.status === 'transcribing' && <><span class="spin" />Transcribing</>}
      {st.status === 'rewriting' && <><span class="spin" />{st.persona ?? 'Persona'}</>}
      {st.status === 'done' && <><Icon name="check" size="sm" />{st.text}</>}
      {st.status === 'error' && <>{st.text}</>}
    </div>
  );
}

render(<Bubble />, document.getElementById('app')!);
