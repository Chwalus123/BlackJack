import { DENOMINATIONS, type Money } from '@casino/engine';

/** Casino chip colours by denomination (minor units). Shared by the HUD SVG chips and the 3D chip atlas. */
export interface ChipStyle {
  base: string;
  stripe: string;
  inlay: string;
  text: string;
  label: string;
}

export const CHIP_STYLES: Record<number, ChipStyle> = {
  50: { base: '#e9a3b5', stripe: '#ffffff', inlay: '#f7d9e1', text: '#5a1a2a', label: '½' },
  100: { base: '#f2efe6', stripe: '#1d4e89', inlay: '#ffffff', text: '#1d4e89', label: '1' },
  250: { base: '#e58fb0', stripe: '#3a0a12', inlay: '#f8dbe6', text: '#3a0a12', label: '2½' },
  500: { base: '#b3202d', stripe: '#f4ecd8', inlay: '#e9d5c1', text: '#6b0e17', label: '5' },
  2500: { base: '#1f7a43', stripe: '#f4ecd8', inlay: '#d8ead9', text: '#0d3b20', label: '25' },
  10000: { base: '#16130f', stripe: '#e6c878', inlay: '#2b2620', text: '#e6c878', label: '100' },
  50000: { base: '#5b2a86', stripe: '#f3dfa2', inlay: '#e5d4f1', text: '#3b145c', label: '500' },
  100000: { base: '#e3b81f', stripe: '#3a0a12', inlay: '#fbeaa8', text: '#3a0a12', label: '1K' },
  500000: { base: '#7a4a24', stripe: '#f3dfa2', inlay: '#e9d3bb', text: '#3d220d', label: '5K' },
  2500000: { base: '#c45a1b', stripe: '#141110', inlay: '#f6d6bd', text: '#3d1a05', label: '25K' },
};

/** Chips offered in the betting tray (whole chips only: 1, 5, 25, 100, 500, 1K, 5K). */
export const TRAY: Money[] = [100, 500, 2500, 10000, 50000, 100000, 500000];

export function styleFor(d: Money): ChipStyle {
  return CHIP_STYLES[d] ?? CHIP_STYLES[100]!;
}

export { DENOMINATIONS };
