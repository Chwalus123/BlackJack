import { computed, effect, signal } from '@preact/signals';
import { loadJSON, saveJSON } from './persist';

export type Speed = 0.5 | 1 | 1.5 | 2 | 'inf';
export const SPEEDS: Speed[] = [0.5, 1, 1.5, 2, 'inf'];

export interface Settings {
  sound: boolean;
  speed: Speed;
  reducedMotion: 'system' | 'on' | 'off';
}

const DEFAULTS: Settings = { sound: true, speed: 1, reducedMotion: 'system' };

export const settings = signal<Settings>({ ...DEFAULTS, ...loadJSON<Partial<Settings>>('settings', {}) });

effect(() => saveJSON('settings', settings.value));

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

const systemReduced = signal(
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false,
);
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => (systemReduced.value = e.matches));
}

export const reducedMotion = computed(() =>
  settings.value.reducedMotion === 'system' ? systemReduced.value : settings.value.reducedMotion === 'on',
);

/** Animation speed multiplier (Infinity = instant). */
export const speedMult = computed(() => (settings.value.speed === 'inf' ? Infinity : settings.value.speed));
