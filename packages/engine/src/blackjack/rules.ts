import type { Money, Ratio } from '../core/money';
import { CHIP } from '../core/money';

export type BetMode = { mode: 'free'; min: Money; max: Money; unit: Money } | { mode: 'fixed'; stake: Money };

export interface BlackjackRules {
  decks: number;
  maxDecks: number;
  penetration: [number, number];
  burnAfterShuffle: boolean;
  /** v1 is fixed at S17 (dealer stands on all 17s). */
  dealerHitsSoft17: false;
  blackjackPays: Ratio;
  insurance: boolean;
  evenMoney: boolean;
  doubleAfterSplit: boolean;
  maxHands: number;
  resplitAces: boolean;
  betting: BetMode;
  /** sequential = real-table order (single-player); simultaneous = everyone at once (multiplayer). */
  decisionMode: 'sequential' | 'simultaneous';
  timers: {
    betMs: number | null;
    insuranceMs: number | null;
    decisionMs: number | null;
    splitBonusMs: number;
    maxSplitBonuses: number;
    resultsMs: number;
  };
  /** Consecutive rounds with a timeout before a seat is sat out (0 = never). */
  autoSitOutAfterMisses: number;
  startingBankroll: Money;
  rebuy: { mode: 'never' | 'whenBroke'; max: number | null };
  /** Bots that go broke rebuy automatically (single-player). */
  botsAutoRebuy: boolean;
  /** 0 = unlimited. */
  maxSeats: number;
  /** Multiplier on animation budgets inside deadlines (1 = normal speed). */
  animScale: number;
}

export const BLACKJACK_DEFAULTS: BlackjackRules = {
  decks: 6,
  maxDecks: 128,
  penetration: [0.7, 0.8],
  burnAfterShuffle: true,
  dealerHitsSoft17: false,
  blackjackPays: [3, 2],
  insurance: true,
  evenMoney: true,
  doubleAfterSplit: true,
  maxHands: 4,
  resplitAces: false,
  betting: { mode: 'free', min: 5 * CHIP, max: 500 * CHIP, unit: CHIP },
  decisionMode: 'sequential',
  timers: { betMs: null, insuranceMs: null, decisionMs: null, splitBonusMs: 6000, maxSplitBonuses: 3, resultsMs: 2200 },
  autoSitOutAfterMisses: 0,
  startingBankroll: 1000 * CHIP,
  rebuy: { mode: 'whenBroke', max: null },
  botsAutoRebuy: true,
  maxSeats: 0,
  animScale: 1,
};

export function blackjackSinglePlayer(opts: { min: Money; max: Money; bankroll: Money; animScale?: number }): BlackjackRules {
  return {
    ...BLACKJACK_DEFAULTS,
    betting: { mode: 'free', min: opts.min, max: opts.max, unit: CHIP },
    startingBankroll: opts.bankroll,
    maxSeats: 5,
    animScale: opts.animScale ?? 1,
  };
}

export function blackjackMultiplayer(opts: {
  stake: Money;
  bankrollMultiple: number;
  decisionMs: number;
  betMs: number;
  rebuy: { mode: 'never' | 'whenBroke'; max: number | null };
  maxSeats?: number;
}): BlackjackRules {
  return {
    ...BLACKJACK_DEFAULTS,
    betting: { mode: 'fixed', stake: opts.stake },
    decisionMode: 'simultaneous',
    timers: {
      betMs: opts.betMs,
      insuranceMs: 8000,
      decisionMs: opts.decisionMs,
      splitBonusMs: 6000,
      maxSplitBonuses: 3,
      resultsMs: 4000,
    },
    autoSitOutAfterMisses: 2,
    startingBankroll: opts.stake * opts.bankrollMultiple,
    rebuy: opts.rebuy,
    botsAutoRebuy: false,
    maxSeats: opts.maxSeats ?? 0,
  };
}

export function minBet(r: BlackjackRules): Money {
  return r.betting.mode === 'fixed' ? r.betting.stake : r.betting.min;
}

export function validateBlackjackRules(r: BlackjackRules): string[] {
  const errs: string[] = [];
  const [n, d] = r.blackjackPays;
  if (!(100 % d === 0 && n > 0)) errs.push('blackjackPays denominator must divide 100');
  if (r.decks < 1 || r.decks > r.maxDecks) errs.push('decks out of range');
  if (r.maxHands < 1 || r.maxHands > 4) errs.push('maxHands must be 1..4');
  if (r.betting.mode === 'free') {
    const { min, max, unit } = r.betting;
    if (unit % CHIP !== 0 || unit <= 0) errs.push('unit must be whole chips');
    if (min <= 0 || min % unit !== 0 || max % unit !== 0 || max < min) errs.push('bad table limits');
  } else if (r.betting.stake <= 0 || r.betting.stake % CHIP !== 0) errs.push('stake must be whole chips');
  if (r.startingBankroll < minBet(r)) errs.push('bankroll below minimum bet');
  return errs;
}
