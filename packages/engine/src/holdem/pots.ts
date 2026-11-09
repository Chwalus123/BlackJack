import { CHIP, type Money } from '../core/money';
import { EngineBug, type SeatId } from '../core/types';
import type { HPot } from './types';

export interface Contribution {
  seat: SeatId;
  committed: Money;
  folded: boolean;
  allIn: boolean;
}

/**
 * Main and side pots from each seat's total contribution. Levels are cut at the totals of non-folded
 * all-in seats; folded money counts toward every level it reaches but folded seats are never eligible.
 * Uncalled chips must already have been returned, so every pot has at least one eligible seat.
 */
export function buildPots(cs: readonly Contribution[]): HPot[] {
  const caps = [...new Set(cs.filter((c) => c.allIn && !c.folded).map((c) => c.committed))].sort((a, b) => a - b);
  caps.push(Infinity);
  const pots: HPot[] = [];
  let prev = 0;
  for (const cap of caps) {
    let amount = 0;
    for (const c of cs) amount += Math.max(0, Math.min(c.committed, cap) - Math.min(c.committed, prev));
    const eligible = cs.filter((c) => !c.folded && c.committed > prev).map((c) => c.seat).sort((a, b) => a - b);
    if (amount > 0) {
      if (eligible.length === 0) throw new EngineBug(`pot of ${amount} with nobody eligible`);
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length && last.eligible.every((x, i) => x === eligible[i])) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = cap;
  }
  return pots;
}

/**
 * Splits a pot between winners given in award order (first winner left of the button first). Everyone
 * gets the same whole-chip share; leftover chips go one at a time in that order.
 */
export function splitPot(amount: Money, winners: readonly SeatId[]): { seat: SeatId; amount: Money }[] {
  const k = winners.length;
  const share = Math.floor(amount / k / CHIP) * CHIP;
  const out = winners.map((seat) => ({ seat, amount: share }));
  let rest = amount - share * k;
  for (let i = 0; rest > 0; i = (i + 1) % k) {
    const chip = Math.min(CHIP, rest);
    out[i]!.amount += chip;
    rest -= chip;
  }
  return out;
}
