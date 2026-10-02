import type { Money } from './money';
import type { Card } from './cards';

export type SeatId = number;
export type PlayerId = string;

export type Viewer = { kind: 'seat'; seat: SeatId } | { kind: 'spectator' };

export type ErrorCode =
  | 'BAD_PHASE'
  | 'NOT_YOUR_TURN'
  | 'STALE_TURN'
  | 'ILLEGAL_ACTION'
  | 'BAD_AMOUNT'
  | 'INSUFFICIENT_FUNDS'
  | 'UNKNOWN_SEAT'
  | 'TABLE_FULL'
  | 'ALREADY_SEATED'
  | 'RULES_INVALID'
  | 'PAUSED';

export interface EngineError {
  code: ErrorCode;
  detail?: string;
}

/** A card the viewer may not know yet: `card` is null when it is face down / hidden from this viewer. */
export interface VCard {
  cid: number;
  card: Card | null;
}

/** Private information for one seat produced by an apply (e.g. its own hole cards). */
export interface Reveal {
  seat: SeatId;
  cid: number;
  card: Card;
}

export type ApplyResult<S, E> =
  | { ok: true; state: S; pub: E[]; priv: Reveal[] }
  | { ok: false; error: EngineError };

/** Ledger accounts. Every chip movement goes through move() and is emitted as ChipsMoved. */
export type Account =
  | { k: 'stack'; seat: SeatId }
  | { k: 'bet'; seat: SeatId; hand: number }
  | { k: 'ins'; seat: SeatId }
  | { k: 'street'; seat: SeatId }
  | { k: 'pot' }
  | { k: 'house' }
  | { k: 'cashier' };

export type MoveReason =
  | 'bet'
  | 'double'
  | 'split'
  | 'insurance'
  | 'win'
  | 'blackjack'
  | 'evenMoney'
  | 'push'
  | 'lose'
  | 'blind'
  | 'call'
  | 'raise'
  | 'uncalled'
  | 'gather'
  | 'award'
  | 'buyIn'
  | 'rebuy'
  | 'cashOut'
  | 'refund';

export class EngineBug extends Error {
  constructor(msg: string) {
    super(`EngineBug: ${msg}`);
    this.name = 'EngineBug';
  }
}

export interface Envelope {
  /** Host clock in ms, stamped by the host — never by a client. */
  at: number;
  /** Per-seat decision counter the client saw; mismatch → STALE_TURN. */
  dId?: number;
  /** Fresh 256-bit host entropy mixed into the RNG at the next shuffle. Host-stamped only. */
  entropy?: readonly number[];
}

export type { Money, Card };
