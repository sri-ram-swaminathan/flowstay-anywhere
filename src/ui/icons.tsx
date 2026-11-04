// Minimal line icons (Lucide-style paths, ISC licensed).
const P: Record<string, string> = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z|M19 10v2a7 7 0 0 1-14 0v-2|M12 19v3',
  stop: 'M7 7h10v10H7z',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z|M19 3v4|M21 5h-4',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z|M20 17v4H6.5A2.5 2.5 0 0 1 4 19.5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z|M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  copy: 'M9 9h11v11H9z|M5 15H4V4h11v1',
  trash: 'M3 6h18|M8 6V4h8v2|M19 6l-1 14H6L5 6',
  check: 'M20 6 9 17l-5-5',
  download: 'M12 3v12|M7 10l5 5 5-5|M5 21h14',
  keyboard: 'M3 6h18v12H3z|M7 10h.01|M11 10h.01|M15 10h.01|M7 14h10',
  x: 'M18 6 6 18|M6 6l12 12',
  plus: 'M12 5v14|M5 12h14',
  edit: 'M12 20h9|M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  clipboard: 'M9 4h6v3H9z|M15 5h3v16H6V5h3',
  chevron: 'M9 18l6-6-6-6',
  undo: 'M3 7v6h6|M21 17a9 9 0 0 0-15-6.7L3 13',
};

export function Icon({ name, size }: { name: keyof typeof P | string; size?: 'sm' }) {
  return (
    <svg class={`i ${size ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
      {(P[name] ?? '').split('|').map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
