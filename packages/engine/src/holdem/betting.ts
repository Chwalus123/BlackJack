import type { Money } from '../core/money';
import type { SeatId } from '../core/types';
import { unitOf } from './rules';
import type { HSeat, HState } from './types';

export const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
export const isStreet = (p: HState['phase']): p is (typeof STREETS)[number] => (STREETS as readonly string[]).includes(p);

export const occupied = (st: HState): HSeat[] => st.seats.filter((s): s is HSeat => s != null);
export const inHand = (st: HState): HSeat[] => occupied(st).filter((s) => s.inHand);
export const contenders = (st: HState): HSeat[] => inHand(st).filter((s) => !s.folded);
/** In the hand, not folded, not all-in: can still put chips in. */
export const isLive = (s: HSeat): boolean => s.inHand && !s.folded && !s.allIn;

export const roundUp = (x: Money, unit: Money): Money => Math.ceil(x / unit) * unit;

/** pot + every street bet. */
export const totalPot = (st: HState): Money => st.pot + occupied(st).reduce((a, s) => a + s.street, 0);

export interface ActOptions {
  fold: boolean;
  check: boolean;
  call: Money | null;
  callIsAllIn: boolean;
  bet: { min: Money; max: Money } | null;
  raise: { min: Money; max: Money } | null;
  allIn: Money | null;
  unit: Money;
  toCall: Money;
  pot: Money;
}

/**
 * What the seat to act may do. Raising requires chips beyond the call, an action that is open to this
 * seat (it has not acted, or the bet it faces grew by at least one full raise since — TDA), and at least
 * one other opponent who can still respond.
 */
export function actOptions(st: HState, s: HSeat): ActOptions {
  const unit = unitOf(st.rules);
  const toCall = Math.max(0, st.currentBet - s.street);
  const maxTo = s.street + s.stack;
  const opponentLive = inHand(st).some((o) => o.id !== s.id && isLive(o));
  const reopened = !s.acted || st.currentBet - s.matched >= st.lastRaise;
  const canRaise = s.stack > toCall && reopened && opponentLive;
  const callIsAllIn = toCall > 0 && s.stack <= toCall;
  let bet: ActOptions['bet'] = null;
  let raise: ActOptions['raise'] = null;
  if (canRaise && st.currentBet === 0) bet = { min: Math.min(st.rules.bb, maxTo), max: maxTo };
  if (canRaise && st.currentBet > 0) raise = { min: Math.min(roundUp(st.currentBet + st.lastRaise, unit), maxTo), max: maxTo };
  return {
    fold: toCall > 0,
    check: toCall === 0,
    call: toCall > 0 ? Math.min(toCall, s.stack) : null,
    callIsAllIn,
    bet,
    raise,
    allIn: canRaise || callIsAllIn ? maxTo : null,
    unit,
    toCall,
    pot: totalPot(st),
  };
}

export const needsAction = (st: HState, s: HSeat): boolean => isLive(s) && (!s.acted || s.street < st.currentBet);

/** No live seat owes an action, or the only live seat has nothing left to match. */
export function roundComplete(st: HState): boolean {
  const live = inHand(st).filter(isLive);
  if (live.length === 0) return true;
  if (live.length === 1) {
    const me = live[0]!;
    const maxOther = contenders(st).reduce((m, o) => (o.id === me.id ? m : Math.max(m, o.street)), 0);
    if (me.street >= maxOther) return true;
  }
  return !live.some((s) => needsAction(st, s));
}

/** First seat clockwise strictly after position `from` that owes an action. */
export function nextToAct(st: HState, from: number): SeatId | null {
  const n = st.seats.length;
  for (let k = 1; k <= n; k++) {
    const s = st.seats[(from + k) % n];
    if (s && needsAction(st, s)) return s.id;
  }
  return null;
}

/** Clockwise distance from position `from` (1..n; `from` itself is n). */
export const clockwise = (n: number, from: number, to: number): number => ((to - from + n - 1) % n) + 1;
