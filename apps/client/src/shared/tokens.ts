/**
 * Design tokens: the one palette shared by CSS (as custom properties) and the Three.js materials.
 * Strict casino look — felt green, burgundy, black lacquer, brass and ivory.
 */
export const COLORS = {
  felt950: '#04170f',
  felt900: '#062a1c',
  felt800: '#0a3524',
  felt700: '#0b3d2a',
  felt600: '#0f4d35',
  felt500: '#145c3f',
  burgundy950: '#1f050a',
  burgundy900: '#3a0a12',
  burgundy800: '#4c0e19',
  burgundy700: '#5e1220',
  burgundy500: '#8a1c2e',
  lacquer950: '#0b0908',
  lacquer900: '#141110',
  lacquer800: '#1e1916',
  lacquer700: '#2a231e',
  gold800: '#6b5020',
  gold700: '#8a6a2a',
  gold600: '#a8843a',
  gold500: '#c9a24a',
  gold400: '#d9b660',
  gold300: '#e6c878',
  gold200: '#f3dfa2',
  ivory: '#f4ecd8',
  ivoryDim: '#cfc3a6',
  ivoryMute: '#9d927a',
  leather: '#3b2414',
  leatherDark: '#24150b',
  wood: '#6b3a1e',
  woodDark: '#43230f',
  danger: '#d2493a',
  win: '#e6c878',
  push: '#f4ecd8',
  info: '#7fb3d5',
  navy: '#14213d',
} as const;

export type ColorName = keyof typeof COLORS;

export const FONTS = {
  display: "'Cinzel Variable', 'Cinzel', Georgia, 'Times New Roman', serif",
  ui: "'Montserrat Variable', 'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

export function applyTokens(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(COLORS)) {
    root.style.setProperty(`--c-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, v);
  }
  root.style.setProperty('--font-display', FONTS.display);
  root.style.setProperty('--font-ui', FONTS.ui);
}
