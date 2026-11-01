import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label class="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span />
    </label>
  );
}

export function Row({ label, hint, children }: { label: ComponentChildren; hint?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="row">
      <div class="label">
        {label}
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  );
}

export function Modal({ children, onClose }: { children: ComponentChildren; onClose?: () => void }) {
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div class="modal">{children}</div>
    </div>
  );
}

export function confirmAsk(msg: string): boolean {
  return window.confirm(msg);
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

export const fmtDur = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Captures a key combo in Tauri global-shortcut syntax, e.g. "Control+Shift+Space". */
export function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setListening(false);
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[];
      if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) return;
      const key = codeToKey(e.code);
      if (!key) return;
      if (!mods.length && !/^F\d+$/.test(key)) return; // require a modifier unless it's a function key
      onChange([...mods, key].join('+'));
      setListening(false);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [listening]);
  return (
    <button class={`btn shortcut-input ${listening ? 'listening' : ''}`} onClick={() => setListening(!listening)}>
      {listening ? 'Press keys… (Esc to cancel)' : value ? value.split('+').map((k) => <span class="kbd" key={k} style="margin:0 2px">{pretty(k)}</span>) : 'Click to record'}
    </button>
  );
}

const pretty = (k: string) => ({ Control: 'Ctrl', Super: 'Win', Space: 'Space' } as Record<string, string>)[k] ?? k;

function codeToKey(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (/^F\d+$/.test(code)) return code;
  const map: Record<string, string> = { Space: 'Space', Enter: 'Enter', Backquote: 'Backquote', Minus: 'Minus', Equal: 'Equal', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight', Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Pause: 'Pause', ScrollLock: 'ScrollLock' };
  return map[code] ?? null;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
