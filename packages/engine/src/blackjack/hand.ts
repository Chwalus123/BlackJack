import { bjValue, type Card } from '../core/cards';

export interface HandTotal {
  total: number;
  soft: boolean;
}

/** Aces count 1 or 11: the hand is soft when one ace can count 11 without busting. */
export function handValue(cards: readonly (Card | null)[]): HandTotal {
  let hard = 0;
  let aces = 0;
  for (const c of cards) {
    if (c == null) continue;
    const v = bjValue(c);
    hard += v;
    if (v === 1) aces++;
  }
  const soft = aces > 0 && hard + 10 <= 21;
  return { total: soft ? hard + 10 : hard, soft };
}

/** A natural: two cards totalling 21 on a hand that did not come from a split. */
export function isNatural(cards: readonly Card[], fromSplit: boolean): boolean {
  return !fromSplit && cards.length === 2 && handValue(cards).total === 21;
}

export const isTenValue = (c: Card): boolean => bjValue(c) === 10;
export const isAce = (c: Card): boolean => bjValue(c) === 1;
