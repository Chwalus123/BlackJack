import { bjValue } from '../core/cards';
import { nextFloat, type RngState } from '../core/chacha';
import type { Money } from '../core/money';
import type { SeatId } from '../core/types';
import { handValue } from '../blackjack/hand';
import type { BJLegal, BJView } from '../blackjack/types';

export type BJPersona = 'cautious' | 'steady' | 'highRoller';
export const BJ_PERSONAS: readonly BJPersona[] = ['cautious', 'steady', 'highRoller'];

type Move = 'H' | 'S' | 'D' | 'Ds' | 'P';

/** Dealer up value: 2..10, 11 = ace. */
const up = (card: number) => (bjValue(card) === 1 ? 11 : bjValue(card));

/** Basic strategy for 6 decks, dealer stands on soft 17, double after split, no surrender. */
export function basicStrategy(cards: number[], dealerUp: number, canSplitHand: boolean): Move {
  const d = up(dealerUp);
  if (canSplitHand && cards.length === 2 && bjValue(cards[0]!) === bjValue(cards[1]!)) {
    const p = bjValue(cards[0]!);
    const split =
      p === 1 ||
      p === 8 ||
      ((p === 2 || p === 3 || p === 7) && d <= 7) ||
      (p === 4 && (d === 5 || d === 6)) ||
      (p === 6 && d <= 6) ||
      (p === 9 && d !== 7 && d !== 10 && d !== 11);
    if (split) return 'P';
  }
  const { total, soft } = handValue(cards);
  if (soft && total < 21) {
    if (total >= 19) return 'S';
    if (total === 18) return d >= 3 && d <= 6 ? 'Ds' : d <= 8 ? 'S' : 'H';
    if (total === 17) return d >= 3 && d <= 6 ? 'D' : 'H';
    if (total >= 15) return d >= 4 && d <= 6 ? 'D' : 'H';
    return d >= 5 && d <= 6 ? 'D' : 'H';
  }
  if (total >= 17) return 'S';
  if (total >= 13) return d <= 6 ? 'S' : 'H';
  if (total === 12) return d >= 4 && d <= 6 ? 'S' : 'H';
  if (total === 11) return d === 11 ? 'H' : 'D';
  if (total === 10) return d <= 9 ? 'D' : 'H';
  if (total === 9) return d >= 3 && d <= 6 ? 'D' : 'H';
  return 'H';
}

export type BJBotAction =
  | { type: 'BET'; seat: SeatId; amount: Money }
  | { type: 'PASS' | 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT' | 'REBUY' | 'SIT_IN'; seat: SeatId }
  | { type: 'INSURANCE'; seat: SeatId; take: boolean };

export interface BotDecision<Act> {
  action: Act & { dId: number };
  thinkMs: number;
}

function betFor(persona: BJPersona, stack: Money, l: Extract<BJLegal, { kind: 'bet'; mode: 'free' }>, rng: RngState): Money {
  const frac = persona === 'cautious' ? 0 : persona === 'steady' ? 0.025 : 0.1;
  let target = persona === 'cautious' ? l.min : stack * frac * (0.75 + nextFloat(rng) * 0.5);
  target = Math.round(target / l.unit) * l.unit;
  return Math.max(l.min, Math.min(l.max, target));
}

/** Pure decision from the bot's own redacted view. */
export function decideBlackjack(view: BJView, legal: BJLegal, seat: SeatId, persona: string, rng: RngState): BotDecision<BJBotAction> {
  const think = (base: number) => Math.round(base + nextFloat(rng) * 700);
  const me = view.seats.find((s) => s.id === seat);
  const dId = legal.dId;
  switch (legal.kind) {
    case 'bet': {
      if (legal.mode === 'fixed') return { action: { type: 'BET', seat, amount: legal.stake, dId }, thinkMs: think(400) };
      if (legal.current > 0) return { action: { type: 'PASS', seat, dId }, thinkMs: 200 };
      const amount = betFor((BJ_PERSONAS as readonly string[]).includes(persona) ? (persona as BJPersona) : 'steady', me?.stack ?? 0, legal, rng);
      return { action: { type: 'BET', seat, amount, dId }, thinkMs: think(300) };
    }
    case 'insurance':
      return { action: { type: 'INSURANCE', seat, take: false, dId }, thinkMs: think(500) };
    case 'rebuy':
      return { action: { type: 'REBUY', seat, dId }, thinkMs: think(800) };
    case 'sitIn':
      return { action: { type: 'SIT_IN', seat, dId }, thinkMs: think(800) };
    case 'play': {
      const hand = me?.hands[legal.hand];
      const upCard = view.dealer.cards[0]?.card;
      if (!hand || upCard == null) return { action: { type: 'STAND', seat, dId }, thinkMs: think(500) };
      const cards = hand.cards.map((c) => c.card!).filter((c) => c != null);
      let m = basicStrategy(cards, upCard, legal.split);
      if (m === 'P' && !legal.split) m = 'H';
      if (m === 'D') m = legal.double ? 'D' : 'H';
      if (m === 'Ds') m = legal.double ? 'D' : 'S';
      const type = m === 'P' ? 'SPLIT' : m === 'D' ? 'DOUBLE' : m === 'H' ? 'HIT' : 'STAND';
      if (type === 'HIT' && !legal.hit) return { action: { type: 'STAND', seat, dId }, thinkMs: think(600) };
      return { action: { type, seat, dId }, thinkMs: think(type === 'STAND' ? 500 : 750) };
    }
  }
}
