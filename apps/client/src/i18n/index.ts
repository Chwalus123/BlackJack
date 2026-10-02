import { signal, computed } from '@preact/signals';
import { pl, type MessageKey, type Msg } from './locales/pl';
import { en } from './locales/en';
import { loadJSON, saveJSON } from '../store/persist';

export type Locale = 'pl' | 'en';
export type { MessageKey };

const catalogs = { pl, en } as const;

function initialLocale(): Locale {
  const saved = loadJSON<Locale | null>('locale', null);
  if (saved === 'pl' || saved === 'en') return saved;
  return 'pl';
}

export const locale = signal<Locale>(initialLocale());

export function setLocale(l: Locale): void {
  locale.value = l;
  saveJSON('locale', l);
  document.documentElement.lang = l;
}

const pluralRules = computed(() => new Intl.PluralRules(locale.value));

export type Params = Record<string, string | number>;

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function translate(l: Locale, key: MessageKey, params?: Params): string {
  const m: Msg = catalogs[l][key] ?? pl[key] ?? key;
  if (typeof m === 'string') return interpolate(m, params);
  const n = Number(params?.count ?? 0);
  const cat = new Intl.PluralRules(l).select(n) as 'one' | 'few' | 'many' | 'other';
  return interpolate(m[cat] ?? m.other, params);
}

/** Reactive translation: components that call t() re-render when the locale changes. */
export function t(key: MessageKey, params?: Params): string {
  const l = locale.value;
  void pluralRules.value;
  return translate(l, key, params);
}

/** Money in minor units (100 = 1 chip): grouped, with 2 decimals only when needed. */
export function formatMoney(minor: number, l: Locale = locale.value): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(l === 'pl' ? 'pl-PL' : 'en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
    useGrouping: 'always',
  } as unknown as Intl.NumberFormatOptions).format(minor / 100);
}

export function formatSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export { pl, en };
