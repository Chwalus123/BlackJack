import type { AnnounceKey } from '../core/announce';
import type { Card } from '../core/cards';
import type { RngState } from '../core/chacha';
import type { ChipsMovedEvent } from '../core/ledger';
import type { Money } from '../core/money';
import type { ShuffleEvent } from '../core/shoe';
import type { Envelope, PlayerId, SeatId, VCard } from '../core/types';
import type { HoldemRules } from './rules';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HPhase = 'waiting' | Street | 'showdown' | 'results';
/** active: dealt in when eligible · sittingOut · busted: no chips, may rebuy · leaving: removed after this hand. */
export type HSeatStatus = 'active' | 'sittingOut' | 'busted' | 'leaving';
export type HActKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface DealtCard {
  cid: number;
  card: Card;
}

export interface HPot {
  amount: Money;
  /** Non-folded seats that can win this pot, ascending. */
  eligible: SeatId[];
}

export interface HSeat {
  id: SeatId;
  player: PlayerId;
  name: string;
  bot: string | null;
  status: HSeatStatus;
  away: boolean;
  /** Player preference (postOrWait): wait for the BB instead of posting. */
  waitForBB: boolean;
  /** Owes a big blind before being dealt in (newcomer, or the BB passed while sitting out). */
  needBB: boolean;
  stack: Money;
  /** Ledger 'street': chips in front of the seat this betting round. */
  street: Money;
  /** This seat's share of the ledger 'pot' (all earlier streets of this hand). */
  committed: Money;
  inHand: boolean;
  /** Hole cards while held; emptied on fold or muck (the cards go to the muck). */
  hole: DealtCard[];
  folded: boolean;
  allIn: boolean;
  shown: boolean;
  /** Acted this street (posting a blind is not acting). */
  acted: boolean;
  /** currentBet right after this seat's last action this street (TDA reopen rule). */
  matched: Money;
  lastAction: HActKind | null;
  deadline: number | null;
  rebuyDeadline: number | null;
  timeouts: number;
  /** Timed out while away this hand: later turns check/fold at once. */
  awayTimedOut: boolean;
  rebuys: number;
  dId: number;
}

export interface HState {
  v: 1;
  game: 'holdem';
  rules: HoldemRules;
  phase: HPhase;
  paused: boolean;
  hand: number;
  cidSeq: number;
  lastAt: number;
  seats: (HSeat | null)[];
  /** Positions (seat indexes) of the current/last hand; they may point at empty seats (dead button / SB). */
  buttonPos: number | null;
  sbPos: number | null;
  bbPos: number | null;
  /** Next hand uses the first-hand rule (random button, everyone dealt in). */
  freshPositions: boolean;
  /** Draw = pop(). A full 52-card deck present before a hand starts is used as is (test rigging). */
  deck: Card[];
  burns: DealtCard[];
  board: DealtCard[];
  muck: Card[];
  /** Ledger 'pot'. */
  pot: Money;
  /** Side-pot breakdown as of the last gather; awarded pots are removed. */
  pots: HPot[];
  currentBet: Money;
  lastRaise: Money;
  riverAggressor: SeatId | null;
  toAct: SeatId | null;
  rng: RngState;
  cashier: Money;
  phaseDeadline: number | null;
}

export type HTarget = { t: 'hole'; seat: SeatId; slot: number } | { t: 'board'; slot: number } | { t: 'burn' };

export type HAction = Envelope &
  (
    | { type: 'JOIN'; player: PlayerId; name: string; buyIn?: Money; bot?: string; seat?: SeatId; waitForBB?: boolean }
    | { type: 'LEAVE' | 'SIT_OUT' | 'SIT_IN' | 'REBUY' | 'FOLD' | 'CHECK' | 'CALL' | 'ALL_IN' | 'SHOW' | 'MUCK'; seat: SeatId }
    | { type: 'BET' | 'RAISE'; seat: SeatId; to: Money }
    | { type: 'SET_WAIT_BB'; seat: SeatId; value: boolean }
    | { type: 'SET_AWAY'; seat: SeatId; away: boolean }
    | { type: 'RELEASE'; seat: SeatId }
    | { type: 'PAUSE'; value: boolean }
    | { type: 'ABORT' }
    | { type: 'TIMEOUT' }
  );

/** Actions a client may originate (everything else is host-only). */
export const HE_CLIENT_ACTIONS = [
  'LEAVE', 'SIT_OUT', 'SIT_IN', 'REBUY', 'SET_WAIT_BB', 'FOLD', 'CHECK', 'CALL', 'ALL_IN', 'BET', 'RAISE', 'SHOW', 'MUCK',
] as const;

export interface HSeatView {
  id: SeatId;
  player: PlayerId;
  name: string;
  bot: string | null;
  status: HSeatStatus;
  away: boolean;
  waitForBB: boolean;
  needBB: boolean;
  stack: Money;
  street: Money;
  committed: Money;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  hasCards: boolean;
  /** card is null unless it is the viewer's own card or the hand was shown. */
  hole: VCard[];
  shown: boolean;
  lastAction: HActKind | null;
  deadline: number | null;
  rebuyDeadline: number | null;
}

export interface HRulesView {
  sb: Money;
  bb: Money;
  unit: Money;
  maxSeats: number;
  buyIn: Money;
  minBuyIn: Money;
  maxBuyIn: Money;
  decisionMs: number | null;
  rebuy: HoldemRules['rebuy'];
  entry: HoldemRules['entry'];
}

export interface HView {
  game: 'holdem';
  phase: HPhase;
  paused: boolean;
  hand: number;
  rules: HRulesView;
  seats: (HSeatView | null)[];
  board: VCard[];
  /** Chips gathered from earlier streets (ledger 'pot'). */
  pot: Money;
  /** Side pots as of the last gather. */
  pots: HPot[];
  /** pot + every seat's current street bet. */
  totalPot: Money;
  currentBet: Money;
  toAct: SeatId | null;
  button: number | null;
  sb: number | null;
  bb: number | null;
  phaseDeadline: number | null;
  you: SeatId | null;
}

export type HLegal =
  | {
      kind: 'act';
      dId: number;
      fold: boolean;
      check: boolean;
      /** Chips added by calling (min(toCall, stack)); null when there is nothing to call. */
      call: Money | null;
      callIsAllIn: boolean;
      /** "to" amounts (street totals). Any multiple of `unit` in range, or exactly max (all-in). */
      bet: { min: Money; max: Money } | null;
      raise: { min: Money; max: Money } | null;
      /** "to" amount of going all-in; null when all-in is not legal (action not reopened, or no live opponent). */
      allIn: Money | null;
      unit: Money;
      toCall: Money;
      /** pot + all street bets. */
      pot: Money;
    }
  | { kind: 'rebuy'; dId: number; amount: Money }
  | { kind: 'sitIn'; dId: number };

export type HEvent =
  | ChipsMovedEvent
  | ShuffleEvent
  | { e: 'HandStarted'; hand: number; seats: SeatId[] }
  | { e: 'Phase'; phase: HPhase; deadline: number | null; paused: boolean }
  | { e: 'Paused'; paused: boolean }
  | { e: 'SeatJoined'; seat: HSeatView }
  | { e: 'SeatLeft'; seat: SeatId }
  | {
      e: 'SeatStatus';
      seat: SeatId;
      status: HSeatStatus;
      away: boolean;
      waitForBB: boolean;
      needBB: boolean;
      rebuyDeadline: number | null;
    }
  | { e: 'ButtonMoved'; button: number | null; sb: number | null; bb: number | null }
  /** kind 'post': a newcomer's live big blind (postOrWait). currentBet is the resulting table bet. */
  | { e: 'BlindPosted'; seat: SeatId; kind: 'sb' | 'bb' | 'post'; amount: Money; allIn: boolean; currentBet: Money }
  | { e: 'CardDealt'; cid: number; to: HTarget; card: Card | null; faceUp: boolean }
  | { e: 'TurnStarted'; seats: SeatId[]; deadline: number | null }
  | {
      e: 'Acted';
      seat: SeatId;
      action: HActKind;
      /** Resulting street total (call/bet/raise). */
      to?: Money;
      /** Chips added. */
      amount?: Money;
      allIn: boolean;
      currentBet: Money;
      /** Taken by the dealer (timeout or leaving). */
      auto?: boolean;
    }
  | { e: 'UncalledReturned'; seat: SeatId; amount: Money; allIn: boolean }
  | { e: 'BetsGathered'; pots: HPot[] }
  | { e: 'StreetDealt'; street: Exclude<Street, 'preflop'> }
  | { e: 'HandsRevealed'; hands: { seat: SeatId; cards: VCard[] }[] }
  | { e: 'Shown'; seat: SeatId; cards: VCard[]; value: number | null; best5: number[] | null }
  | { e: 'Mucked'; seat: SeatId }
  /** `pot` is the index in `pots`; it is removed from the view's pots. value/best5 only for shown hands. */
  | {
      e: 'PotAwarded';
      pot: number;
      amount: Money;
      winners: { seat: SeatId; amount: Money }[];
      value: number | null;
      best5: number[] | null;
    }
  | { e: 'CardsCollected' }
  | { e: 'Announce'; key: AnnounceKey; params?: Record<string, string | number> };
