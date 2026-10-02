import { Blackjack, bj, CHIP, he, Holdem, type GameModule, type Money, type SeatId } from '@casino/engine';
import type { GameAction, RoomSettings } from '@casino/protocol';

/** Everything the room needs to know about a game, so rooms and tables stay game-agnostic. */
export interface GameAdapter {
  module: GameModule<any, any, any, any, any, any>;
  rules(settings: RoomSettings, maxPlayers: number): unknown;
  /** Chips a newcomer brings to the table. */
  buyIn(settings: RoomSettings): Money;
  seatOf(state: any, player: string): SeatId | null;
  playerOf(state: any, seat: SeatId): string | null;
  sitAction(player: string, name: string, chips: Money): Record<string, unknown> & { type: string };
  /** Seats still free (Infinity = unlimited). */
  freeSeats(state: any): number;
  /** Seated players (for minimum-players checks). */
  seatedCount(state: any): number;
  /** Is a round / hand currently being played (cards on the table)? */
  inHand(state: any): boolean;
  /** Map a validated client intent to an engine action for `seat`, or null when not applicable. */
  intent(a: GameAction, seat: SeatId, settings: RoomSettings): (Record<string, unknown> & { type: string }) | null;
  minPlayers: number;
}

const BJ_ACTIONS = new Set(['LEAVE', 'SIT_OUT', 'SIT_IN', 'REBUY', 'BET', 'CLEAR_BET', 'PASS', 'INSURANCE', 'HIT', 'STAND', 'DOUBLE', 'SPLIT', 'SET_AUTOBET']);

export const blackjackAdapter: GameAdapter = {
  module: Blackjack,
  minPlayers: 1,
  rules(s, maxPlayers) {
    if (s.game !== 'blackjack') throw new Error('settings/game mismatch');
    return bj.blackjackMultiplayer({
      stake: s.stake,
      bankrollMultiple: s.bankrollMultiple,
      decisionMs: s.decisionSec * 1000,
      betMs: s.betSec * 1000,
      rebuy: { mode: s.rebuy, max: null },
      maxSeats: maxPlayers,
    });
  },
  buyIn(s) {
    return s.game === 'blackjack' ? s.stake * s.bankrollMultiple : 0;
  },
  seatOf(st: bj.BJState, player) {
    return st.seats.find((s) => s.player === player)?.id ?? null;
  },
  playerOf(st: bj.BJState, seat) {
    return st.seats.find((s) => s.id === seat)?.player ?? null;
  },
  sitAction(player, name, chips) {
    return { type: 'SIT', player, name, bankroll: chips, autoBet: false };
  },
  freeSeats(st: bj.BJState) {
    return st.rules.maxSeats > 0 ? Math.max(0, st.rules.maxSeats - st.seats.length) : Infinity;
  },
  seatedCount(st: bj.BJState) {
    return st.seats.length;
  },
  inHand(st: bj.BJState) {
    return st.phase === 'insurance' || st.phase === 'play' || st.phase === 'results';
  },
  intent(a, seat) {
    if (!BJ_ACTIONS.has(a.type)) return null;
    const base: Record<string, unknown> & { type: string } = { type: a.type, seat };
    if (a.dId !== undefined) base.dId = a.dId;
    if (a.type === 'BET') base.amount = a.amount ?? 0; // fixed-stake tables ignore the amount
    if (a.type === 'INSURANCE') base.take = !!a.take;
    if (a.type === 'SET_AUTOBET') base.value = !!a.value;
    return base;
  },
};

const HE_ACTIONS = new Set(['LEAVE', 'SIT_OUT', 'SIT_IN', 'REBUY', 'SET_WAIT_BB', 'FOLD', 'CHECK', 'CALL', 'ALL_IN', 'BET', 'RAISE', 'SHOW', 'MUCK']);

export const holdemAdapter: GameAdapter = {
  module: Holdem,
  minPlayers: 2,
  rules(s) {
    if (s.game !== 'holdem') throw new Error('settings/game mismatch');
    // The buy-in is fixed, but a returning player brings back whatever they left with (room ledger).
    return {
      ...he.holdemMultiplayer({
        sb: s.sb,
        bb: s.bb,
        buyInBB: s.buyInBB,
        decisionMs: s.decisionSec * 1000,
        rebuy: { mode: s.rebuy, max: null },
        maxSeats: s.maxSeats,
      }),
      minBuyIn: s.bb,
      maxBuyIn: Number.MAX_SAFE_INTEGER - (Number.MAX_SAFE_INTEGER % s.sb),
    };
  },
  buyIn(s) {
    return s.game === 'holdem' ? s.bb * s.buyInBB : 0;
  },
  seatOf(st: he.HState, player) {
    const i = st.seats.findIndex((s) => s?.player === player);
    return i >= 0 ? i : null;
  },
  playerOf(st: he.HState, seat) {
    return st.seats[seat]?.player ?? null;
  },
  sitAction(player, name, chips) {
    return { type: 'JOIN', player, name, buyIn: chips };
  },
  freeSeats(st: he.HState) {
    return he.freeSeats(st).length;
  },
  seatedCount(st: he.HState) {
    return st.seats.filter(Boolean).length;
  },
  inHand(st: he.HState) {
    return st.phase !== 'waiting' && st.phase !== 'results';
  },
  intent(a, seat) {
    if (!HE_ACTIONS.has(a.type)) return null;
    // 'BET' means an opening bet in Hold'em; the blackjack-only amount field is ignored.
    const base: Record<string, unknown> & { type: string } = { type: a.type, seat };
    if (a.dId !== undefined) base.dId = a.dId;
    if (a.type === 'BET' || a.type === 'RAISE') {
      if (a.to === undefined) return null;
      base.to = a.to;
    }
    if (a.type === 'SET_WAIT_BB') base.value = !!a.value;
    return base;
  },
};

export const adapters: Record<RoomSettings['game'], GameAdapter> = { blackjack: blackjackAdapter, holdem: holdemAdapter };

export const CHIPS = CHIP;
