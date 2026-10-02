import type { ApplyResult, SeatId, Viewer } from './types';
import type { Seed } from './chacha';

/** The contract every game implements. Pure: no clocks, no ambient randomness, JSON state. */
export interface GameModule<R, S, A, V, E, L> {
  id: 'blackjack' | 'holdem';
  validateRules(r: R): string[];
  create(rules: R, seed: Seed, at: number): S;
  apply(s: S, a: A, opts?: { inPlace?: boolean }): ApplyResult<S, E>;
  /** Redacted snapshot for one viewer (public part + that seat's private information). */
  view(s: S, v: Viewer): V;
  legal(s: S, seat: SeatId): L | null;
  /** Earliest absolute deadline the host must fire TIMEOUT for, or null. */
  nextDeadline(s: S): number | null;
  /** Seats whose input is awaited right now (the host routes bots). */
  pendingDecisions(s: S): SeatId[];
  /** Mechanical view reduction: applies the resulting fields an event carries. No rules logic. */
  reduceView(v: V, e: E): V;
}
