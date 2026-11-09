import type { Card } from '../core/cards';

/**
 * 5–7 card poker evaluator. A hand value is one integer, bigger = better:
 *   (category << 20) | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5
 * with ranks 2..14 in significance order (unused nibbles are 0). The wheel straight has top rank 5.
 */
export type HandValue = number;

export const CAT_NAMES = [
  'highCard',
  'pair',
  'twoPair',
  'trips',
  'straight',
  'flush',
  'fullHouse',
  'quads',
  'straightFlush',
] as const;

export type HandCategory = (typeof CAT_NAMES)[number] | 'royalFlush';

const HIGH = 0, PAIR = 1, TWO_PAIR = 2, TRIPS = 3, STRAIGHT = 4, FLUSH = 5, FULL_HOUSE = 6, QUADS = 7, STRAIGHT_FLUSH = 8;

// 13-bit rank masks: bit i = rank i + 2.
const TOP_BIT = new Int8Array(8192);
const POP = new Int8Array(8192);
const STRAIGHT_TOP = new Int8Array(8192); // top rank (5..14) of the best straight in the mask, 0 if none
const TOP5 = new Int32Array(8192); // the five highest ranks packed into 20 bits

(() => {
  for (let m = 1; m < 8192; m++) {
    TOP_BIT[m] = 31 - Math.clz32(m);
    POP[m] = POP[m & (m - 1)]! + 1;
    let top = 0;
    for (let hi = 12; hi >= 4 && !top; hi--) {
      const run = 0b11111 << (hi - 4);
      if ((m & run) === run) top = hi + 2;
    }
    if (!top && (m & 0b1000000001111) === 0b1000000001111) top = 5; // A-2-3-4-5
    STRAIGHT_TOP[m] = top;
    let packed = 0;
    let rest = m;
    for (let k = 0; k < 5; k++) {
      packed <<= 4;
      if (rest) {
        const b = 31 - Math.clz32(rest);
        packed |= b + 2;
        rest &= ~(1 << b);
      }
    }
    TOP5[m] = packed;
  }
})();

const top = (m: number) => TOP_BIT[m]!;

/** Evaluates the best 5-card hand among 5–7 cards. */
export function eval7(cards: readonly Card[]): HandValue {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  let c1 = 0, c2 = 0, c3 = 0, c4 = 0; // ranks seen at least 1/2/3/4 times
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const bit = 1 << (c >> 2);
    switch (c & 3) {
      case 0: s0 |= bit; break;
      case 1: s1 |= bit; break;
      case 2: s2 |= bit; break;
      default: s3 |= bit; break;
    }
    if (c1 & bit) {
      if (c2 & bit) {
        if (c3 & bit) c4 |= bit;
        else c3 |= bit;
      } else c2 |= bit;
    } else c1 |= bit;
  }
  const fm = POP[s0]! >= 5 ? s0 : POP[s1]! >= 5 ? s1 : POP[s2]! >= 5 ? s2 : POP[s3]! >= 5 ? s3 : 0;
  if (fm) {
    const sf = STRAIGHT_TOP[fm]!;
    if (sf) return (STRAIGHT_FLUSH << 20) | (sf << 16);
  }
  if (c4) {
    const q = top(c4);
    return (QUADS << 20) | ((q + 2) << 16) | ((top(c1 & ~(1 << q)) + 2) << 12);
  }
  if (c3) {
    const t = top(c3);
    const pairs = c2 & ~(1 << t);
    if (pairs) return (FULL_HOUSE << 20) | ((t + 2) << 16) | ((top(pairs) + 2) << 12);
  }
  if (fm) return (FLUSH << 20) | TOP5[fm]!;
  const st = STRAIGHT_TOP[c1]!;
  if (st) return (STRAIGHT << 20) | (st << 16);
  if (c3) {
    const t = top(c3);
    return (TRIPS << 20) | ((t + 2) << 16) | ((TOP5[c1 & ~(1 << t)]! >> 4) & 0xff00);
  }
  if (c2) {
    const p1 = top(c2);
    const rest = c2 & ~(1 << p1);
    if (rest) {
      const p2 = top(rest);
      const k = top(c1 & ~(1 << p1) & ~(1 << p2));
      return (TWO_PAIR << 20) | ((p1 + 2) << 16) | ((p2 + 2) << 12) | ((k + 2) << 8);
    }
    return (PAIR << 20) | ((p1 + 2) << 16) | ((TOP5[c1 & ~(1 << p1)]! >> 4) & 0xfff0);
  }
  return (HIGH << 20) | TOP5[c1]!;
}

export const handCategory = (v: HandValue): number => v >> 20;

const SIGNIFICANT = [5, 4, 3, 3, 1, 5, 2, 2, 1];

/** Category and significant ranks, e.g. full house kings over sevens → { cat: 'fullHouse', ranks: [13, 7] }. */
export function describeHand(v: HandValue): { cat: HandCategory; ranks: number[] } {
  const c = v >> 20;
  const ranks: number[] = [];
  for (let i = 0; i < SIGNIFICANT[c]!; i++) ranks.push((v >> (16 - 4 * i)) & 15);
  const cat: HandCategory = c === STRAIGHT_FLUSH && ranks[0] === 14 ? 'royalFlush' : CAT_NAMES[c]!;
  return { cat, ranks };
}

/** The five cards (a subset of `cards`) that make `value`, best-ranked first within the input order. */
export function bestFive(cards: readonly Card[], value: HandValue = eval7(cards)): Card[] {
  const n = cards.length;
  if (n < 5) throw new Error('bestFive needs at least 5 cards');
  const pick: Card[] = [0, 0, 0, 0, 0];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            pick[0] = cards[a]!; pick[1] = cards[b]!; pick[2] = cards[c]!; pick[3] = cards[d]!; pick[4] = cards[e]!;
            if (eval7(pick) === value) return pick.slice();
          }
  throw new Error('bestFive: value not reachable from these cards');
}
