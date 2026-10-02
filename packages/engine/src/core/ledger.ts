import { EngineBug, type Account, type MoveReason } from './types';
import type { Money } from './money';

export interface ChipsMovedEvent {
  e: 'ChipsMoved';
  from: Account;
  to: Account;
  amount: Money;
  reason: MoveReason;
  /** Balances after the move (for mechanical view reduction). */
  fromBal: Money;
  toBal: Money;
}

export interface LedgerOps<S> {
  get(s: S, a: Account): Money;
  set(s: S, a: Account, v: Money): void;
}

/** Accounts allowed to go negative (the house bankroll and the cashier that issues buy-ins). */
const MAY_GO_NEGATIVE = new Set(['house', 'cashier']);

/** The ONLY way chips change place. Throws EngineBug on non-integer, non-positive or overdraft moves. */
export function move<S>(
  ops: LedgerOps<S>,
  s: S,
  from: Account,
  to: Account,
  amount: Money,
  reason: MoveReason,
  emit: (ev: ChipsMovedEvent) => void,
): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new EngineBug(`move amount ${amount}`);
  const fb = ops.get(s, from) - amount;
  if (fb < 0 && !MAY_GO_NEGATIVE.has(from.k)) throw new EngineBug(`overdraft ${JSON.stringify(from)} by ${-fb}`);
  ops.set(s, from, fb);
  const tb = ops.get(s, to) + amount;
  ops.set(s, to, tb);
  emit({ e: 'ChipsMoved', from, to, amount, reason, fromBal: fb, toBal: tb });
}
