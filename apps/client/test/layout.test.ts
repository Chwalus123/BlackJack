import { describe, expect, it } from 'vitest';
import { bjBetPos, bjCardPos, bjOutline, bjSpotCenter, BJ_TABLE, heOutline, heSpotCenter, mapSeats, HE_SPOT_ANGLES } from '../src/three/layout';

describe('table layout', () => {
  it('blackjack spots lie on the felt, first base on the players’ right', () => {
    for (let i = 0; i < 7; i++) {
      const p = bjSpotCenter(i);
      const r = Math.hypot(p.x, p.z - BJ_TABLE.arcCenterZ);
      expect(r).toBeLessThan(BJ_TABLE.arcRadius - 0.1);
      expect(p.z).toBeGreaterThan(BJ_TABLE.dealerEdgeZ);
    }
    expect(bjSpotCenter(0).x).toBeGreaterThan(0);
    expect(bjSpotCenter(6).x).toBeLessThan(0);
    expect(bjSpotCenter(3).x).toBeCloseTo(0);
  });

  it('cards sit between the betting circle and the dealer; split hands do not overlap', () => {
    const bet = bjBetPos(3, 0, 1);
    const card = bjCardPos(3, 0, 1, 0);
    expect(card.z).toBeLessThan(bet.z);
    const h0 = bjCardPos(3, 0, 2, 0);
    const h1 = bjCardPos(3, 1, 2, 0);
    expect(Math.abs(h0.x - h1.x)).toBeGreaterThan(0.07);
  });

  it('outlines are closed loops of reasonable size', () => {
    expect(bjOutline().length).toBeGreaterThan(30);
    const he = heOutline();
    const xs = he.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.1, 1);
    for (let i = 0; i < HE_SPOT_ANGLES.length; i++) expect(heSpotCenter(i).z).toBeGreaterThan(-0.5);
  });
});

describe('seat mapping for unlimited seats', () => {
  it('hero is always centre (blackjack); neighbours fill outward; overflow is unmapped', () => {
    const order = Array.from({ length: 60 }, (_, i) => i + 1);
    const m = mapSeats(order, 30, 7, 3, false);
    expect(m.get(30)).toBe(3);
    expect(m.get(29)).toBe(2);
    expect(m.get(31)).toBe(4);
    expect(m.size).toBe(7);
    expect(m.has(1)).toBe(false);
  });

  it('single seat and spectators', () => {
    expect([...mapSeats([5], 5, 7, 3, false)]).toEqual([[5, 3]]);
    const spec = mapSeats([1, 2, 3], null, 7, 3, false);
    expect(spec.size).toBe(3);
  });

  it('hold’em: hero at the bottom, next seats on the hero’s left (−X), 22 seats → 9 visible', () => {
    const order = Array.from({ length: 22 }, (_, i) => i);
    const m = mapSeats(order, 10, 9, 0, true);
    expect(m.get(10)).toBe(0);
    expect(m.size).toBe(9);
    // spot 2 is at a negative angle (left of the hero); the next seat in play order goes there
    expect(HE_SPOT_ANGLES[m.get(11)!]!).toBeLessThan(0);
    expect(HE_SPOT_ANGLES[m.get(9)!]!).toBeGreaterThan(0);
    const small = mapSeats([0, 3], 3, 9, 0, true);
    expect(small.size).toBe(2);
  });
});
