import { describe, expect, it } from 'vitest';
import { he, parseCard } from '@casino/engine';
import { winningCids } from '../src/three/heWinners';

const vc = (cid: number, s: string) => ({ cid, card: parseCard(s) });

/** A view with the hands that matter; seats not listed are empty. */
function view(seats: Record<number, [string, string]>, board: string[]): he.HView {
  const out: (he.HSeatView | null)[] = [null, null, null];
  for (const [seat, [a, b]] of Object.entries(seats)) {
    const id = Number(seat);
    out[id] = { id, hole: [vc(id * 2 + 1, a), vc(id * 2 + 2, b)] } as unknown as he.HSeatView;
  }
  return { seats: out, board: board.map((c, i) => vc(100 + i, c)) } as unknown as he.HView;
}

describe("Hold'em winning cards", () => {
  it('lights every split-pot winner’s five, not only the first winner’s', () => {
    // Both make a broadway straight with different hole cards; the engine names only seat 1's five.
    const v = view({ 1: ['Ac', 'Td'], 2: ['Ad', 'Tc'] }, ['Ks', 'Qd', 'Jc', '2h', '7d']);
    const value = he.eval7([parseCard('Ac'), parseCard('Td'), ...v.board.map((c) => c.card!)]);
    const ev = { e: 'PotAwarded', pot: 0, amount: 4, winners: [{ seat: 1, amount: 2 }, { seat: 2, amount: 2 }], value, best5: [3, 4, 100, 101, 102] } as const;
    const lit = new Set(winningCids(v, ev as unknown as Parameters<typeof winningCids>[1]));
    for (const cid of [3, 4, 5, 6, 100, 101, 102]) expect(lit.has(cid)).toBe(true);
    for (const cid of [103, 104]) expect(lit.has(cid)).toBe(false);
  });

  it('keeps the engine’s five when the hands were not shown', () => {
    const v = view({}, ['Ks', 'Qd', 'Jc', '2h', '7d']);
    const ev = { e: 'PotAwarded', pot: 0, amount: 4, winners: [{ seat: 1, amount: 4 }], value: null, best5: null } as const;
    expect(winningCids(v, ev as unknown as Parameters<typeof winningCids>[1])).toEqual([]);
  });
});
