// Equipment components after Murmur's design system: lamps, screws, vents, a VU meter.
import { useEffect, useRef } from 'preact/hooks';

export const Lamp = ({ lit, blink, color }: { lit?: boolean; blink?: boolean; color?: string }) => (
  <span class={`lamp ${lit ? 'lit' : ''} ${blink ? 'blink' : ''}`} style={color ? { '--lamp': color } : undefined} />
);

export const Screws = () => (<>{['tl', 'tr', 'bl', 'br'].map((p) => <span key={p} class={`screw ${p}`} />)}</>);

export const Vents = ({ n = 8 }: { n?: number }) => <div class="vents">{Array.from({ length: n }, (_, i) => <i key={i} />)}</div>;

/**
 * Moving-coil VU meter. The needle has inertia (fast attack, slower release, slight
 * overshoot) like a real movement; the pivot sits below the face so it sweeps across it.
 */
export function VuMeter({ level, active, width = 168, height = 54 }: { level: number; active: boolean; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ needle: 0, vel: 0, target: 0, active: false });
  st.current.target = active ? Math.min(1, Math.sqrt(level) * 3.2) : 0; // perceptual-ish scale
  st.current.active = active;

  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    let raf = 0;
    const draw = () => {
      const s = st.current;
      const rising = s.target > s.needle;
      const stiffness = 1 / (rising ? 0.3 : 0.42);
      s.vel += (s.target - s.needle) * stiffness * 0.16;
      s.vel *= 0.72;
      s.needle = Math.max(0, Math.min(1.06, s.needle + s.vel));

      g.clearRect(0, 0, width, height);
      g.fillStyle = '#d8cfb4';
      g.fillRect(0, 0, width, height);
      if (s.active) { g.fillStyle = 'rgba(232,184,96,0.16)'; g.fillRect(0, 0, width, height); }
      const px = width / 2, py = height * 1.05;
      const r = Math.min(width * 0.46, height * 0.92);
      const sweep = (96 * Math.PI) / 180;
      const polar = (a: number, d: number) => [px + Math.sin(a) * d, py - Math.cos(a) * d];
      // scale arc
      g.lineWidth = 1;
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const a = -sweep / 2 + sweep * t;
        const major = Math.round(t * 10) % 2 === 0;
        const [x1, y1] = polar(a, r * (major ? 0.78 : 0.86));
        const [x2, y2] = polar(a, r);
        g.strokeStyle = t >= 0.72 ? '#c0392b' : '#1c1a17';
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      g.strokeStyle = '#c0392b';
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(px, py, r * 1.0, -Math.PI / 2 - sweep / 2 + sweep * 0.72, -Math.PI / 2 + sweep / 2); g.stroke();
      g.fillStyle = '#1c1a17';
      g.font = '600 7px Helvetica, Arial';
      g.fillText('VU', 6, 11);
      // needle
      const a = -sweep / 2 + sweep * s.needle;
      const [nx, ny] = polar(a, r * 0.98);
      g.strokeStyle = '#1c1a17';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={ref} class="meter" style={{ width: `${width}px`, height: `${height}px` }} />;
}
