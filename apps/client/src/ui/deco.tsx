/** Original art-deco ornaments and icons, drawn as inline SVG (no icon fonts, no emoji). */
import type { JSX } from 'preact';

export function Monogram({ size = 40, title }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="mg-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f6e3a8" />
          <stop offset="0.45" stop-color="#c9a24a" />
          <stop offset="1" stop-color="#8a6a2a" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#3a0a12" stroke="url(#mg-gold)" stroke-width="3" />
      <circle cx="32" cy="32" r="24.5" fill="none" stroke="#c9a24a" stroke-width="0.8" stroke-dasharray="2.2 2.2" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <rect x="30.6" y="3.2" width="2.8" height="4.4" rx="0.8" fill="#e6c878" transform={`rotate(${(a * 180) / Math.PI} 32 32)`} />;
      })}
      <text x="32" y="40.5" text-anchor="middle" font-family="'Cinzel Variable', Georgia, serif" font-weight="800" font-size="21" fill="url(#mg-gold)" letter-spacing="-0.5">
        JC
      </text>
    </svg>
  );
}

export function DecoDivider({ class: cls = 'deco-divider' }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 360 18" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M0 9 H140" stroke="currentColor" stroke-width="1" />
      <path d="M220 9 H360" stroke="currentColor" stroke-width="1" />
      <path d="M150 9 L180 1 L210 9 L180 17 Z" fill="none" stroke="currentColor" stroke-width="1.2" />
      <path d="M166 9 L180 5 L194 9 L180 13 Z" fill="currentColor" />
      <circle cx="146" cy="9" r="2" fill="currentColor" />
      <circle cx="214" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

export function Sunburst({ class: cls }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 200 100" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      {Array.from({ length: 19 }, (_, i) => {
        const a = Math.PI - (i * Math.PI) / 18;
        const x = 100 + Math.cos(a) * 140;
        const y = 100 - Math.sin(a) * 140;
        return <line x1="100" y1="100" x2={x} y2={y} stroke="currentColor" stroke-width={i % 2 ? 0.6 : 1.4} />;
      })}
    </svg>
  );
}

/** Suit glyphs as our own paths (Unicode suits render as emoji on some platforms). */
export const SUIT_PATHS = {
  s: 'M50 6 C58 22 92 40 92 62 C92 78 76 86 62 78 C66 88 70 92 76 96 H24 C30 92 34 88 38 78 C24 86 8 78 8 62 C8 40 42 22 50 6 Z',
  h: 'M50 94 C38 80 6 60 6 34 C6 18 18 8 31 8 C40 8 46 13 50 21 C54 13 60 8 69 8 C82 8 94 18 94 34 C94 60 62 80 50 94 Z',
  d: 'M50 4 L86 50 L50 96 L14 50 Z',
  c: 'M50 8 C62 8 70 18 70 29 C70 35 68 39 65 43 C69 41 73 40 77 40 C88 40 96 49 96 60 C96 71 87 80 76 80 C67 80 61 76 57 69 C58 80 62 88 70 96 H30 C38 88 42 80 43 69 C39 76 33 80 24 80 C13 80 4 71 4 60 C4 49 12 40 23 40 C27 40 31 41 35 43 C32 39 30 35 30 29 C30 18 38 8 50 8 Z',
} as const;

export function SuitIcon({ suit, size = 18, color }: { suit: keyof typeof SUIT_PATHS; size?: number; color?: string }) {
  const fill = color ?? (suit === 'h' || suit === 'd' ? '#c0283a' : '#141110');
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path d={SUIT_PATHS[suit]} fill={fill} />
    </svg>
  );
}

export function Icon({ name, size = 20 }: { name: 'back' | 'gear' | 'close' | 'users' | 'copy' | 'pause' | 'play' | 'chat' | 'sound' | 'mute' | 'info'; size?: number }) {
  const p: Record<string, JSX.Element> = {
    back: <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />,
    close: <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />,
    gear: (
      <g fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" stroke-linecap="round" />
      </g>
    ),
    users: (
      <g fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="9" cy="8" r="3.4" />
        <path d="M2.5 20c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6" stroke-linecap="round" />
        <circle cx="17" cy="9" r="2.6" />
        <path d="M17 14.2c2.4 0 4.2 1.6 4.6 4.4" stroke-linecap="round" />
      </g>
    ),
    copy: (
      <g fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      </g>
    ),
    pause: <path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />,
    play: <path d="M8 5 L19 12 L8 19 Z" fill="currentColor" />,
    chat: <path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />,
    sound: (
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" />
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
      </g>
    ),
    mute: (
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" />
        <path d="M16 9l5 6M21 9l-5 6" />
      </g>
    ),
    info: (
      <g fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5v.5" stroke-linecap="round" />
      </g>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {p[name]}
    </svg>
  );
}
