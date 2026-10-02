import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  breakdown, chachaBlock, createRng, fullDeck, nextInt, parseCard, formatCard, payout, rankOf, rekey, shuffle, suitOf,
  nextU32, DENOMINATIONS, draw, emptyShoe, preRoundCheck, decksFor, type ShoeConfig,
} from '../src/index';

describe('cards', () => {
  it('encodes rank and suit', () => {
    expect(rankOf(parseCard('As'))).toBe(14);
    expect(suitOf(parseCard('As'))).toBe(3);
    expect(rankOf(parseCard('2c'))).toBe(2);
    expect(formatCard(parseCard('10h'))).toBe('Th');
    expect(fullDeck()).toHaveLength(52);
  });
});

describe('ChaCha20', () => {
  it('matches the RFC 8439 §2.3.2 block test vector', () => {
    const key = [0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c, 0x13121110, 0x17161514, 0x1b1a1918, 0x1f1e1d1c];
    const out = chachaBlock(key, 1, [0x09000000, 0x4a000000, 0x00000000]);
    expect(out.map((w) => w.toString(16).padStart(8, '0')).join(' ')).toBe(
      'e4e7f110 15593bd1 1fdd0f50 c47120a3 c7f4d1c7 0368c033 9aaa2204 4e6cd4c3 ' +
        '466482d2 09aa9f07 05d7c214 a2028bd9 d19c12b5 b94e16de e883d0cb 4e3c50a2',
    );
  });

  it('is deterministic per seed and changes after rekey', () => {
    const a = createRng([1, 2, 3]);
    const b = createRng([1, 2, 3]);
    const xs = Array.from({ length: 40 }, () => nextU32(a));
    expect(Array.from({ length: 40 }, () => nextU32(b))).toEqual(xs);
    rekey(b, [42]);
    expect(Array.from({ length: 40 }, () => nextU32(b))).not.toEqual(Array.from({ length: 40 }, () => nextU32(a)));
  });

  it('nextInt is unbiased (chi-square)', () => {
    const rng = createRng([7]);
    for (const n of [2, 3, 7, 52]) {
      const counts = new Array(n).fill(0);
      const N = 20000 * n;
      for (let i = 0; i < N; i++) counts[nextInt(rng, n)]++;
      const exp = N / n;
      const chi = counts.reduce((acc, c) => acc + (c - exp) ** 2 / exp, 0);
      expect(chi).toBeLessThan(n - 1 + 6 * Math.sqrt(2 * (n - 1)) + 10);
    }
  });
});

function permIndex(p: number[]): number {
  return p.reduce((acc, v) => acc * 4 + v, 0);
}

function chiSquarePerms(shuffler: (a: number[]) => void, trials: number): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < trials; i++) {
    const a = [0, 1, 2, 3];
    shuffler(a);
    const k = permIndex(a);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const exp = trials / 24;
  let chi = 0;
  for (const c of counts.values()) chi += (c - exp) ** 2 / exp;
  chi += (24 - counts.size) * exp;
  return chi;
}

describe('shuffle', () => {
  it('is a permutation', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 60 }), fc.integer(), (arr, seed) => {
        const out = shuffle([...arr], createRng([seed]));
        expect([...out].sort()).toEqual([...arr].sort());
      }),
    );
  });

  it('Fisher–Yates is uniform; the legacy v0 swap-with-anyone shuffle is not', () => {
    const rng = createRng([2024]);
    const fy = chiSquarePerms((a) => shuffle(a, rng), 48000);
    // 23 degrees of freedom: p = 0.001 critical value ≈ 49.7
    expect(fy).toBeLessThan(49.7);
    const legacy = chiSquarePerms((a) => {
      for (let i = 0; i < a.length; i++) {
        const j = nextInt(rng, a.length);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
    }, 48000);
    expect(legacy).toBeGreaterThan(200);
  });
});

describe('money', () => {
  it('3:2 is exact for every whole-chip bet', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (chips) => {
        const p = payout(chips * 100, [3, 2]);
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBe(chips * 150);
      }),
    );
    expect(payout(500, [3, 2])).toBe(750); // 5 pays 7.50
  });

  it('breakdown round-trips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (n) => {
        const amount = n * 50;
        const parts = breakdown(amount);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
        for (const p of parts) expect(DENOMINATIONS).toContain(p);
      }),
    );
  });
});

describe('shoe', () => {
  const cfg: ShoeConfig = { minDecks: 6, maxDecks: 128, penetration: [0.7, 0.8], burnAfterShuffle: true };

  it('builds N decks, places the cut card in range and scales with players', () => {
    const shoe = emptyShoe();
    const rng = createRng([1]);
    const evs: unknown[] = [];
    preRoundCheck(shoe, 12, cfg, rng, (e) => evs.push(e));
    expect(shoe.decks).toBe(6);
    expect(shoe.cards.length + shoe.discards.length).toBe(312);
    expect(shoe.cutRemaining).toBeGreaterThanOrEqual(Math.floor(311 * 0.2) - 1);
    expect(shoe.cutRemaining).toBeLessThanOrEqual(Math.ceil(311 * 0.3) + 1);
    expect(decksFor(6 * 101, cfg)).toBeGreaterThan(50);
    expect(decksFor(6 * 5000, cfg)).toBe(128);
  });

  it('mid-round exhaustion reshuffles only the discards, then adds a deck', () => {
    const shoe = emptyShoe();
    const rng = createRng([3]);
    const evs: { reason: string }[] = [];
    preRoundCheck(shoe, 6, { ...cfg, minDecks: 1 }, rng, (e) => evs.push(e));
    const decks0 = shoe.decks;
    const table: number[] = [];
    while (shoe.cards.length) table.push(draw(shoe, cfg, rng, (e) => evs.push(e)));
    // The burn card is the only discard → it comes back.
    table.push(draw(shoe, cfg, rng, (e) => evs.push(e)));
    expect(evs.at(-1)!.reason).toBe('discards');
    table.push(draw(shoe, cfg, rng, (e) => evs.push(e)));
    expect(evs.at(-1)!.reason).toBe('deckAdded');
    expect(shoe.decks).toBe(decks0 + 1);
    expect(table.length + shoe.cards.length + shoe.discards.length).toBe(52 * (decks0 + 1));
  });
});
