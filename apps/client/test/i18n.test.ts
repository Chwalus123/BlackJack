import { describe, expect, it } from 'vitest';
import { ANNOUNCE_KEYS } from '@casino/engine';
import { pl } from '../src/i18n/locales/pl';
import { en } from '../src/i18n/locales/en';
import { translate, formatMoney } from '../src/i18n/index';
import { RULES } from '../src/i18n/rules';

const placeholders = (s: unknown): string[] => {
  const str = typeof s === 'string' ? s : Object.values(s as object).join(' ');
  return [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
};

describe('i18n', () => {
  it('English covers every Polish key with the same placeholders', () => {
    for (const k of Object.keys(pl) as (keyof typeof pl)[]) {
      expect(en[k], k).toBeDefined();
      expect([...new Set(placeholders(en[k]))], k).toEqual([...new Set(placeholders(pl[k]))]);
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
  });

  it('every dealer announcement has a translation', () => {
    for (const k of ANNOUNCE_KEYS) {
      expect(pl).toHaveProperty(`announce.${k}`);
      expect(en).toHaveProperty(`announce.${k}`);
    }
  });

  it('Polish plurals (1 gracz, 2 gracze, 5 graczy, 22 gracze, 25 graczy)', () => {
    const f = (n: number) => translate('pl', 'mp.players', { count: n });
    expect(f(1)).toBe('1 gracz');
    expect(f(2)).toBe('2 gracze');
    expect(f(4)).toBe('4 gracze');
    expect(f(5)).toBe('5 graczy');
    expect(f(12)).toBe('12 graczy');
    expect(f(22)).toBe('22 gracze');
    expect(f(25)).toBe('25 graczy');
    expect(f(0)).toBe('0 graczy');
    expect(translate('en', 'mp.players', { count: 1 })).toBe('1 player');
    expect(translate('en', 'mp.players', { count: 3 })).toBe('3 players');
  });

  it('formats chips in minor units', () => {
    expect(formatMoney(750, 'en')).toBe('7.50');
    expect(formatMoney(750, 'pl')).toBe('7,50');
    expect(formatMoney(425000, 'en')).toBe('4,250');
    expect(formatMoney(425000, 'pl').replace(/\s/g, ' ')).toBe('4 250');
  });

  it('rules pages exist in both languages with matching structure', () => {
    for (const g of ['blackjack', 'holdem'] as const) {
      expect(RULES.pl[g].sections.length).toBe(RULES.en[g].sections.length);
      expect(RULES.pl[g].sections.length).toBeGreaterThan(5);
    }
  });
});
