/** Test helpers: rigged shoes/decks and invariant checkers. Not used by production code. */
import { fullDeck, parseCards, type Card } from './core/cards';
import { createRng } from './core/chacha';
import { shuffle } from './core/shuffle';
import type { BJState } from './blackjack/types';

export const TEST_SEED = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Put `top` (e.g. "As Kd 9c") on top of the shoe so they are drawn in that order. The rest of the
 * shoe keeps the exact multiset (card conservation still holds) and no reshuffle is pending.
 */
export function rigShoe(st: BJState, top: string, decks = st.rules.decks): BJState {
  const rigged = parseCards(top);
  const all: Card[] = [];
  for (let d = 0; d < decks; d++) all.push(...fullDeck());
  for (const c of rigged) {
    const i = all.indexOf(c);
    if (i < 0) throw new Error(`rigShoe: not enough copies of ${c}`);
    all.splice(i, 1);
  }
  shuffle(all, createRng([9, 9, 9, 9, 9, 9, 9, 9]));
  st.shoe = {
    cards: [...all, ...rigged.slice().reverse()],
    discards: [],
    decks,
    cutRemaining: 0,
    needsShuffle: false,
    shuffles: 1,
  };
  return st;
}

export function bjMoneySum(st: BJState): number {
  let sum = st.house + st.cashier;
  for (const s of st.seats) {
    sum += s.stack + s.insurance;
    for (const h of s.hands) sum += h.bet;
  }
  return sum;
}

export function bjCardCount(st: BJState): Map<number, number> {
  const m = new Map<number, number>();
  const add = (c: number) => m.set(c, (m.get(c) ?? 0) + 1);
  st.shoe.cards.forEach(add);
  st.shoe.discards.forEach(add);
  st.dealer.cards.forEach((c) => add(c.card));
  for (const s of st.seats) for (const h of s.hands) for (const c of h.cards) add(c.card);
  return m;
}

/** Throws if chips or cards are not conserved. */
export function checkBlackjackInvariants(st: BJState): void {
  const sum = bjMoneySum(st);
  if (sum !== 0) throw new Error(`money not conserved: Σ = ${sum}`);
  const counts = bjCardCount(st);
  for (let c = 0; c < 52 && st.shoe.shuffles > 0; c++) {
    if ((counts.get(c) ?? 0) !== st.shoe.decks) throw new Error(`card ${c} count ${counts.get(c)} ≠ ${st.shoe.decks} decks`);
  }
  for (const s of st.seats) {
    if (!Number.isSafeInteger(s.stack) || s.stack < 0) throw new Error(`bad stack ${s.stack}`);
    for (const h of s.hands) if (!Number.isSafeInteger(h.bet) || h.bet < 0) throw new Error(`bad bet ${h.bet}`);
  }
}

/** A virtual clock scheduler for host tests. */
export class FakeScheduler {
  t = 0;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now(): number {
    return this.t;
  }
  at(t: number, fn: () => void): number {
    const id = ++this.seq;
    this.q.push({ at: t, fn, id });
    return id;
  }
  cancel(h: unknown): void {
    this.q = this.q.filter((x) => x.id !== h);
  }
  /** Advance the clock, firing due callbacks in time order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
  pending(): number {
    return this.q.length;
  }
}
