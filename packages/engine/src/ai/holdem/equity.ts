import type { Card } from '../../core/cards';
import { nextInt, type RngState } from '../../core/chacha';
import { eval7 } from '../../holdem/eval';

/**
 * Monte Carlo share of the pot won by `hole` at showdown against `opponents` (a count of random hands,
 * or explicit hands), completing the board at random. Ties count as fractional shares.
 * Cost: iterations × (opponents + 1) evaluations.
 */
export function heEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number | readonly (readonly Card[])[],
  iterations: number,
  rng: RngState,
): number {
  const known = typeof opponents === 'number' ? [] : opponents;
  const nRandom = typeof opponents === 'number' ? opponents : 0;
  const nOpp = nRandom + known.length;
  if (nOpp === 0 || iterations <= 0) return 1;
  const dead = new Set<Card>([...hole, ...board, ...known.flat()]);
  const pool: Card[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) pool.push(c);
  const need = 5 - board.length;
  const draws = need + 2 * nRandom;
  if (draws > pool.length) throw new Error('heEquity: not enough cards');
  const me = [hole[0]!, hole[1]!, ...board, ...new Array<Card>(need).fill(0)];
  const opp = known.map((h) => [h[0]!, h[1]!, ...board, ...new Array<Card>(need).fill(0)]);
  for (let i = 0; i < nRandom; i++) opp.push([0, 0, ...board, ...new Array<Card>(need).fill(0)]);
  let won = 0;
  for (let it = 0; it < iterations; it++) {
    // partial Fisher–Yates: the last `draws` slots of the pool become this iteration's cards
    for (let k = 0; k < draws; k++) {
      const top = pool.length - 1 - k;
      const j = nextInt(rng, top + 1);
      const t = pool[top]!;
      pool[top] = pool[j]!;
      pool[j] = t;
    }
    let p = pool.length - 1;
    for (let k = 0; k < need; k++) {
      const c = pool[p--]!;
      me[2 + board.length + k] = c;
      for (const o of opp) o[2 + board.length + k] = c;
    }
    for (let i = known.length; i < nOpp; i++) {
      opp[i]![0] = pool[p--]!;
      opp[i]![1] = pool[p--]!;
    }
    const mine = eval7(me);
    let ties = 0;
    let lost = false;
    for (const o of opp) {
      const v = eval7(o);
      if (v > mine) {
        lost = true;
        break;
      }
      if (v === mine) ties++;
    }
    if (!lost) won += 1 / (ties + 1);
  }
  return won / iterations;
}
