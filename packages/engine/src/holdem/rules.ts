import { CHIP, type Money } from '../core/money';

export type HoldemEntry = 'immediate' | 'postOrWait';

export interface HoldemRules {
  sb: Money;
  /** Always 2 × sb. */
  bb: Money;
  /** 2..22: 2n hole cards + 5 board + 3 burns ≤ 52. Seat ids are positions 0..maxSeats-1. */
  maxSeats: number;
  /** Default buy-in, the rebuy amount, and the fixed buy-in in multiplayer. */
  buyIn: Money;
  minBuyIn: Money;
  maxBuyIn: Money;
  /**
   * immediate: a newcomer is dealt in at the next hand (single-player).
   * postOrWait: a newcomer (or a player who missed the BB) posts a live BB next hand, waits while their
   * seat is between the button and the SB, or waits for the BB when `waitForBB` is set.
   */
  entry: HoldemEntry;
  /** Per-turn clock; null = no clock. */
  decisionMs: number | null;
  /** Delay between enough players being seated and the first hand. */
  startDelayMs: number;
  resultsMs: number;
  /** How long a busted seat may rebuy before it is released; null = until it rebuys or leaves. */
  rebuyWindowMs: number | null;
  /** Consecutive timeouts before a seat is sat out at the end of the hand (0 = never). */
  autoSitOutAfterTimeouts: number;
  rebuy: { mode: 'never' | 'whenBroke'; max: number | null };
  /** Bots that bust rebuy automatically (single-player). */
  botsAutoRebuy: boolean;
  /** Multiplier on animation budgets inside deadlines (1 = normal speed). */
  animScale: number;
}

export const HOLDEM_MAX_SEATS = 22;

export function holdemSinglePlayer(opts: { sb: Money; bb: Money; buyIn: Money; animScale?: number }): HoldemRules {
  return {
    sb: opts.sb,
    bb: opts.bb,
    maxSeats: 5,
    buyIn: opts.buyIn,
    minBuyIn: opts.bb,
    maxBuyIn: Math.max(opts.buyIn, 1000 * opts.bb),
    entry: 'immediate',
    decisionMs: null,
    startDelayMs: 1000,
    resultsMs: 3000,
    rebuyWindowMs: null,
    autoSitOutAfterTimeouts: 0,
    rebuy: { mode: 'whenBroke', max: null },
    botsAutoRebuy: true,
    animScale: opts.animScale ?? 1,
  };
}

export function holdemMultiplayer(opts: {
  sb: Money;
  bb: Money;
  buyInBB: number;
  decisionMs: number;
  rebuy: { mode: 'never' | 'whenBroke'; max: number | null };
  maxSeats?: number;
}): HoldemRules {
  const buyIn = opts.buyInBB * opts.bb;
  return {
    sb: opts.sb,
    bb: opts.bb,
    maxSeats: opts.maxSeats ?? HOLDEM_MAX_SEATS,
    buyIn,
    minBuyIn: buyIn,
    maxBuyIn: buyIn,
    entry: 'postOrWait',
    decisionMs: opts.decisionMs,
    startDelayMs: 3000,
    resultsMs: 5000,
    rebuyWindowMs: 15000,
    autoSitOutAfterTimeouts: 2,
    rebuy: opts.rebuy,
    botsAutoRebuy: false,
    animScale: 1,
  };
}

/** Smallest betting increment: every bet or raise is a multiple of it, except an all-in. */
export const unitOf = (r: HoldemRules): Money => r.sb;

const nonNegInt = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function validateHoldemRules(r: HoldemRules): string[] {
  const errs: string[] = [];
  if (!(Number.isSafeInteger(r.sb) && r.sb > 0 && r.sb % CHIP === 0)) errs.push('small blind must be whole chips');
  if (r.bb !== 2 * r.sb) errs.push('big blind must be twice the small blind');
  if (!(Number.isInteger(r.maxSeats) && r.maxSeats >= 2 && r.maxSeats <= HOLDEM_MAX_SEATS)) errs.push(`maxSeats must be 2..${HOLDEM_MAX_SEATS}`);
  for (const [k, v] of [['buyIn', r.buyIn], ['minBuyIn', r.minBuyIn], ['maxBuyIn', r.maxBuyIn]] as const) {
    if (!(Number.isSafeInteger(v) && v > 0 && v % CHIP === 0)) errs.push(`${k} must be whole chips`);
  }
  if (!(r.minBuyIn <= r.buyIn && r.buyIn <= r.maxBuyIn)) errs.push('buyIn must lie within [minBuyIn, maxBuyIn]');
  if (r.decisionMs != null && !(r.decisionMs > 0)) errs.push('decisionMs must be positive or null');
  if (!nonNegInt(r.startDelayMs) || !nonNegInt(r.resultsMs)) errs.push('bad timers');
  if (r.rebuyWindowMs != null && !nonNegInt(r.rebuyWindowMs)) errs.push('bad rebuy window');
  if (!nonNegInt(r.autoSitOutAfterTimeouts)) errs.push('bad autoSitOutAfterTimeouts');
  if (r.rebuy.max != null && !nonNegInt(r.rebuy.max)) errs.push('bad rebuy max');
  if (!(r.animScale > 0)) errs.push('animScale must be positive');
  return errs;
}
