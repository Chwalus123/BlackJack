import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { he, parseCards } from '../src/index';
import { refEval5, refEval7 } from '../src/holdem/testing';

const { eval7, bestFive, describeHand } = he;
const ev = (s: string) => eval7(parseCards(s));
const desc = (s: string) => describeHand(ev(s));

describe('hand evaluator fixtures', () => {
  it.each([
    ['Ah 2c 3d 4s 5h 9c Kd', 'straight', [5]],
    ['Ah 2h 3h 4h 5h Kc Kd', 'straightFlush', [5]],
    ['Ts Jd Qh Kc Ac 2d 3s', 'straight', [14]],
    ['Ts Js Qs Ks As 2d 3s', 'royalFlush', [14]],
    ['9s Ts Js Qs Ks As 2d', 'royalFlush', [14]],
    ['Ks Kd Kh 7c 7d 7s 2c', 'fullHouse', [13, 7]],
    ['Ks Kd 7h 7c 4d 4s 9c', 'twoPair', [13, 7, 9]],
    ['Ks Kd 7h 7c 4d 4s 2c', 'twoPair', [13, 7, 4]],
    ['9s 9d 9h 9c Ad Ks 2c', 'quads', [9, 14]],
    ['9s 9d 9h 9c 2d 2s 2c', 'quads', [9, 2]],
    ['2s 7d 9h Jc Kd 3s 4c', 'highCard', [13, 11, 9, 7, 4]],
    ['As Ad 7h Jc Kd 3s 4c', 'pair', [14, 13, 11, 7]],
    ['7s 7d 7h Jc Kd 3s 4c', 'trips', [7, 13, 11]],
    ['2h 7h 9h Jh Kh Qh 4c', 'flush', [13, 12, 11, 9, 7]],
  ])('%s → %s %j', (cards, cat, ranks) => {
    expect(desc(cards)).toEqual({ cat, ranks });
  });

  it('orders hands correctly', () => {
    expect(ev('2h 7h 9h Jh Kh 3c 4d')).toBeGreaterThan(ev('5c 6d 7h 8s 9c Kd Kh'));
    expect(ev('Ks Kd Kh 7c 7d 7s 2c')).toBeGreaterThan(ev('As Ad Ah 2c 3d 9s Th'));
    expect(ev('6h 2c 3d 4s 5h 9c Kd')).toBeGreaterThan(ev('Ah 2c 3d 4s 5h 9c Kd')); // six-high beats the wheel
    expect(ev('Ah 2h 3h 4h 5h 9c Kd')).toBeLessThan(ev('2h 3h 4h 5h 6h 9c Kd'));
    // board plays: both players hold under-cards to a board straight → tie
    const board = 'Ts Jd Qh Kc Ac';
    expect(ev(`2c 3d ${board}`)).toBe(ev(`4c 5d ${board}`));
    // kicker decides, and the fifth card is the last kicker
    expect(ev('As Kd 9h 9c 5d 4s 2c')).toBeGreaterThan(ev('As Qd 9h 9c 5d 4s 2c'));
    expect(ev('Ah Ad Kc Qd 8s 3c 2h')).toBe(ev('As Ac Kd Qh 8c 4d 2s')); // only five cards count
    expect(ev('Ah Ad Kc Qd 9s 3c 2h')).toBeGreaterThan(ev('As Ac Kd Qh 8c 4d 2s'));
  });

  it('category counts over all 2,598,960 five-card hands and 7,462 distinct values', () => {
    const counts: Record<string, number> = {};
    const values = new Set<number>();
    const h = [0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              h[0] = a; h[1] = b; h[2] = c; h[3] = d; h[4] = e;
              const v = eval7(h);
              values.add(v);
              const cat = describeHand(v).cat;
              counts[cat] = (counts[cat] ?? 0) + 1;
            }
    expect(counts).toEqual({
      royalFlush: 4,
      straightFlush: 36,
      quads: 624,
      fullHouse: 3744,
      flush: 5108,
      straight: 10200,
      trips: 54912,
      twoPair: 123552,
      pair: 1098240,
      highCard: 1302540,
    });
    expect(values.size).toBe(7462);
  });

  it('agrees with the reference evaluator on random 5-, 6- and 7-card hands', () => {
    const hand = (n: number) => fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: n, maxLength: n });
    fc.assert(fc.property(hand(5), (cs) => eval7(cs) === refEval5(cs)), { numRuns: 20000 });
    fc.assert(fc.property(hand(6), (cs) => eval7(cs) === refEval7(cs)), { numRuns: 5000 });
    fc.assert(fc.property(hand(7), (cs) => eval7(cs) === refEval7(cs)), { numRuns: 20000 });
  });

  it('bestFive is a subset that evaluates to the same value', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 7, maxLength: 7 }), (cs) => {
        const v = eval7(cs);
        const b = bestFive(cs, v);
        expect(b).toHaveLength(5);
        expect(new Set(b).size).toBe(5);
        for (const c of b) expect(cs).toContain(c);
        expect(eval7(b)).toBe(v);
      }),
      { numRuns: 3000 },
    );
    expect(bestFive(parseCards('Ah 2c 3d 4s 5h 9c Kd')).sort((a, b) => a - b)).toEqual(parseCards('2c 3d 4s 5h Ah').sort((a, b) => a - b));
  });
});
