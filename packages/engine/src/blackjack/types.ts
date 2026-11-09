import type { Card } from '../core/cards';
import type { RngState } from '../core/chacha';
import type { ChipsMovedEvent } from '../core/ledger';
import type { Money } from '../core/money';
import type { Shoe, ShuffleEvent } from '../core/shoe';
import type { AnnounceKey } from '../core/announce';
import type { Envelope, PlayerId, SeatId, VCard } from '../core/types';
import type { BlackjackRules } from './rules';

export type BJPhase = 'idle' | 'betting' | 'insurance' | 'play' | 'results';
export type HandState = 'waitCard' | 'play' | 'stand' | 'bust' | 'bj' | 'done';
export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'evenMoney';
export type SeatStatus = 'pending' | 'active' | 'sittingOut' | 'leaving';

export interface DealtCard {
  cid: number;
  card: Card;
}

export interface BJHand {
  cards: DealtCard[];
  bet: Money;
  doubled: boolean;
  split: boolean;
  splitAces: boolean;
  state: HandState;
  outcome: Outcome | null;
}

export interface BJSeat {
  id: SeatId;
  order: number;
  player: PlayerId;
  name: string;
  bot: string | null;
  status: SeatStatus;
  away: boolean;
  autoBet: boolean;
  stack: Money;
  /** Betting decision made in the current window (bet placed or passed). */
  decided: boolean;
  lastBet: Money;
  hands: BJHand[];
  cur: number;
  insurance: Money;
  insDecided: boolean;
  deadline: number | null;
  splitBonuses: number;
  timedOut: boolean;
  misses: number;
  rebuys: number;
  dId: number;
}

export interface BJState {
  v: 1;
  game: 'blackjack';
  rules: BlackjackRules;
  phase: BJPhase;
  paused: boolean;
  round: number;
  cidSeq: number;
  lastAt: number;
  seats: BJSeat[];
  nextSeatId: number;
  nextOrder: number;
  dealer: { cards: DealtCard[]; holeUp: boolean };
  shoe: Shoe;
  rng: RngState;
  house: Money;
  cashier: Money;
  phaseDeadline: number | null;
  /** Sequential mode: whose turn it is. */
  cursor: SeatId | null;
  /** Mirrors the last TurnStarted (null outside play). */
  turn: { seats: SeatId[]; hand: number | null } | null;
}

export type BJTarget = { t: 'dealer'; slot: number } | { t: 'hand'; seat: SeatId; hand: number; slot: number };

export type BJAction = Envelope &
  (
    | { type: 'SIT'; player: PlayerId; name: string; bankroll?: Money; bot?: string; autoBet?: boolean }
    | { type: 'LEAVE' | 'SIT_OUT' | 'SIT_IN' | 'CLEAR_BET' | 'PASS' | 'REBUY'; seat: SeatId }
    | { type: 'BET'; seat: SeatId; amount: Money }
    | { type: 'DEAL'; seat: SeatId }
    | { type: 'INSURANCE'; seat: SeatId; take: boolean }
    | { type: 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT'; seat: SeatId }
    | { type: 'SET_AUTOBET'; seat: SeatId; value: boolean }
    | { type: 'SET_AWAY'; seat: SeatId; away: boolean }
    | { type: 'PAUSE'; value: boolean }
    | { type: 'ABORT' }
    | { type: 'TIMEOUT' }
  );

/** Actions a client may originate (everything else is host-only). */
export const BJ_CLIENT_ACTIONS = [
  'LEAVE', 'SIT_OUT', 'SIT_IN', 'CLEAR_BET', 'PASS', 'REBUY', 'BET', 'DEAL', 'INSURANCE',
  'HIT', 'STAND', 'DOUBLE', 'SPLIT', 'SET_AUTOBET',
] as const;

export interface BJHandView {
  cards: VCard[];
  bet: Money;
  doubled: boolean;
  split: boolean;
  splitAces: boolean;
  state: HandState;
  outcome: Outcome | null;
}

export interface BJSeatView {
  id: SeatId;
  order: number;
  player: PlayerId;
  name: string;
  bot: string | null;
  status: SeatStatus;
  away: boolean;
  autoBet: boolean;
  stack: Money;
  decided: boolean;
  hands: BJHandView[];
  insurance: Money;
  insDecided: boolean;
  deadline: number | null;
}

export interface BJRulesView {
  betting: BlackjackRules['betting'];
  decisionMode: BlackjackRules['decisionMode'];
  blackjackPays: BlackjackRules['blackjackPays'];
  insurance: boolean;
  maxHands: number;
  decks: number;
  startingBankroll: Money;
  rebuy: BlackjackRules['rebuy'];
  decisionMs: number | null;
}

export interface BJView {
  game: 'blackjack';
  phase: BJPhase;
  paused: boolean;
  round: number;
  rules: BJRulesView;
  seats: BJSeatView[];
  dealer: { cards: VCard[] };
  shoe: { decks: number; remaining: number; discards: number };
  phaseDeadline: number | null;
  turn: { seats: SeatId[]; hand: number | null } | null;
  you: SeatId | null;
}

export type BJLegal =
  | { kind: 'bet'; dId: number; mode: 'free'; min: Money; max: Money; unit: Money; current: Money; canDeal: boolean }
  | { kind: 'bet'; dId: number; mode: 'fixed'; stake: Money; current: Money; decided: boolean }
  | { kind: 'insurance'; dId: number; cost: Money; evenMoney: boolean }
  | {
      kind: 'play';
      dId: number;
      hand: number;
      hit: boolean;
      stand: boolean;
      double: boolean;
      split: boolean;
      doubleCost: Money;
      splitCost: Money;
    }
  | { kind: 'rebuy'; dId: number; amount: Money }
  | { kind: 'sitIn'; dId: number };

export type BJEvent =
  | ChipsMovedEvent
  | ShuffleEvent
  | { e: 'RoundStarted'; round: number }
  | { e: 'Phase'; phase: BJPhase; deadline: number | null; paused: boolean }
  | { e: 'Paused'; paused: boolean }
  | { e: 'SeatJoined'; seat: BJSeatView }
  | { e: 'SeatLeft'; seat: SeatId }
  | { e: 'SeatStatus'; seat: SeatId; status: SeatStatus; away: boolean; autoBet: boolean }
  | { e: 'Decided'; seat: SeatId; decided: boolean }
  | { e: 'CardDealt'; cid: number; to: BJTarget; card: Card | null; faceUp: boolean }
  | { e: 'CardFlipped'; cid: number; at: BJTarget; card: Card }
  | { e: 'HandSplit'; seat: SeatId; from: number; to: number; cid: number; card: Card; splitAces: boolean }
  | { e: 'HandState'; seat: SeatId; hand: number; state: HandState; outcome: Outcome | null; doubled: boolean }
  | { e: 'TurnStarted'; seats: SeatId[]; hand: number | null; deadline: number | null }
  | { e: 'SeatDeadline'; seat: SeatId; deadline: number | null }
  | { e: 'InsuranceOffered'; deadline: number | null; seats: SeatId[] }
  | { e: 'InsuranceDecided'; seat: SeatId; take: boolean }
  | { e: 'DealerPeeked'; blackjack: boolean }
  | { e: 'DealerTotal'; total: number; soft: boolean; bust: boolean }
  | { e: 'HandResult'; seat: SeatId; hand: number; outcome: Outcome; net: Money }
  | { e: 'CardsCollected'; discards: number }
  | { e: 'Announce'; key: AnnounceKey; params?: Record<string, string | number> };
