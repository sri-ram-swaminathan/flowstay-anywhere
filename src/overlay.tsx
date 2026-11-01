// The floating "bubble" window shown at the bottom of the screen on Windows while dictating.
import { listen } from '@tauri-apps/api/event';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OverlayState } from './platform';
import './styles.css';
import { fmtDur } from './ui/widgets';

document.documentElement.classList.add('overlay-root');

function Bubble() {
  const [st, setSt] = useState<OverlayState>({ status: 'hidden' });
  const hist = useRef<number[]>(Array(14).fill(0));
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
          <div class="bars">{hist.current.map((l, i) => <i key={i} style={{ height: `${4 + Math.min(18, l * 260)}px` }} />)}</div>
          <span>Listening</span>
          <span style="opacity:.6;font-variant-numeric:tabular-nums">{fmtDur(st.elapsed ?? 0)}</span>
        </>
      )}
      {st.status === 'transcribing' && <><span class="dot-spin" />Transcribing…</>}
      {st.status === 'rewriting' && <><span class="dot-spin" />✨ {st.persona ?? 'Persona'}…</>}
      {st.status === 'done' && <>✓ {st.text}</>}
      {st.status === 'error' && <>⚠️ {st.text}</>}
    </div>
  );
}

render(<Bubble />, document.getElementById('app')!);
