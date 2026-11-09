import { clone } from '../core/clone';
import type { Reveal, SeatId, Viewer } from '../core/types';
import { actOptions, isStreet, occupied, totalPot } from './betting';
import { unitOf } from './rules';
import type { HEvent, HLegal, HSeat, HSeatView, HState, HView } from './types';

/** Public view of a seat; `own` reveals its hole cards (the viewer's own seat). Shown hands are public. */
export function seatView(s: HSeat, own = false): HSeatView {
  return {
    id: s.id,
    player: s.player,
    name: s.name,
    bot: s.bot,
    status: s.status,
    away: s.away,
    waitForBB: s.waitForBB,
    needBB: s.needBB,
    stack: s.stack,
    street: s.street,
    committed: s.committed,
    inHand: s.inHand,
    folded: s.folded,
    allIn: s.allIn,
    hasCards: s.hole.length > 0,
    hole: s.hole.map((c) => ({ cid: c.cid, card: own || s.shown ? c.card : null })),
    shown: s.shown,
    lastAction: s.lastAction,
    deadline: s.deadline,
    rebuyDeadline: s.rebuyDeadline,
  };
}

/** Redacted snapshot: the deck, burns, muck and every unshown hole card except the viewer's own stay hidden. */
export function viewHoldem(st: HState, viewer: Viewer): HView {
  const r = st.rules;
  const me = viewer.kind === 'seat' && st.seats[viewer.seat] != null ? viewer.seat : null;
  return {
    game: 'holdem',
    phase: st.phase,
    paused: st.paused,
    hand: st.hand,
    rules: {
      sb: r.sb,
      bb: r.bb,
      unit: unitOf(r),
      maxSeats: r.maxSeats,
      buyIn: r.buyIn,
      minBuyIn: r.minBuyIn,
      maxBuyIn: r.maxBuyIn,
      decisionMs: r.decisionMs,
      rebuy: { ...r.rebuy },
      entry: r.entry,
    },
    seats: st.seats.map((s) => (s ? seatView(s, s.id === me) : null)),
    board: st.board.map((c) => ({ cid: c.cid, card: c.card })),
    pot: st.pot,
    pots: clone(st.pots),
    totalPot: totalPot(st),
    currentBet: st.currentBet,
    toAct: st.toAct,
    button: st.buttonPos,
    sb: st.sbPos,
    bb: st.bbPos,
    phaseDeadline: st.phaseDeadline,
    you: me,
  };
}

export function canRebuy(st: HState, s: HSeat): boolean {
  const r = st.rules.rebuy;
  return r.mode === 'whenBroke' && (r.max == null || s.rebuys < r.max);
}

export function legalHoldem(st: HState, seatId: SeatId): HLegal | null {
  const s = st.seats[seatId];
  if (!s || s.status === 'leaving') return null;
  if (isStreet(st.phase) && st.toAct === s.id) return { kind: 'act', dId: s.dId, ...actOptions(st, s) };
  if (s.status === 'busted' && s.stack === 0 && canRebuy(st, s)) return { kind: 'rebuy', dId: s.dId, amount: st.rules.buyIn };
  if (s.status === 'sittingOut') return { kind: 'sitIn', dId: s.dId };
  return null;
}

export function nextDeadlineHoldem(st: HState): number | null {
  let min: number | null = null;
  const take = (d: number | null) => {
    if (d != null && (min == null || d < min)) min = d;
  };
  if (st.phase === 'waiting' || st.phase === 'results') take(st.phaseDeadline);
  if (isStreet(st.phase) && st.toAct != null) take(st.seats[st.toAct]?.deadline ?? null);
  for (const s of occupied(st)) if (s.status === 'busted') take(s.rebuyDeadline);
  return min;
}

export function pendingHoldem(st: HState): SeatId[] {
  const out: SeatId[] = [];
  if (isStreet(st.phase) && st.toAct != null) out.push(st.toAct);
  for (const s of occupied(st)) if (s.status === 'busted' && s.stack === 0 && canRebuy(st, s)) out.push(s.id);
  return out;
}

/** Empty seat positions, ascending. */
export const freeSeats = (st: HState): number[] => st.seats.flatMap((s, i) => (s ? [] : [i]));

/** Merges one of the viewer's private reveals (own hole card) into its view. Mutates and returns `v`. */
export function applyHoldemReveal(v: HView, r: Reveal): HView {
  const c = v.seats[r.seat]?.hole.find((x) => x.cid === r.cid);
  if (c) c.card = r.card;
  return v;
}

function clearHand(v: HView, dealt: readonly SeatId[] = []) {
  for (const s of v.seats) {
    if (!s) continue;
    s.inHand = dealt.includes(s.id);
    s.folded = false;
    s.allIn = false;
    s.shown = false;
    s.hole = [];
    s.hasCards = false;
    s.committed = 0;
    s.lastAction = null;
    s.deadline = null;
  }
  v.board = [];
  v.pots = [];
  v.currentBet = 0;
  v.toAct = null;
}

/**
 * Mechanical reduction of a public event into a view — no rules logic, so a client can follow a table
 * from a snapshot plus the event stream. Mutates and returns `v`.
 */
export function reduceHoldemView(v: HView, ev: HEvent): HView {
  const seat = (id: SeatId) => v.seats[id] ?? null;
  switch (ev.e) {
    case 'ChipsMoved':
      for (const [acc, bal] of [[ev.from, ev.fromBal], [ev.to, ev.toBal]] as const) {
        if (acc.k === 'stack') {
          const s = seat(acc.seat);
          if (s) s.stack = bal;
        } else if (acc.k === 'street') {
          const s = seat(acc.seat);
          if (s) s.street = bal;
        } else if (acc.k === 'pot') v.pot = bal;
      }
      if (ev.from.k === 'street' && ev.to.k === 'pot') {
        const s = seat(ev.from.seat);
        if (s) s.committed += ev.amount;
      } else if (ev.from.k === 'pot' && ev.to.k === 'stack' && ev.reason === 'refund') {
        const s = seat(ev.to.seat);
        if (s) s.committed -= ev.amount;
      }
      break;
    case 'HandStarted':
      v.hand = ev.hand;
      clearHand(v, ev.seats);
      break;
    case 'Phase':
      v.phase = ev.phase;
      v.phaseDeadline = ev.deadline;
      v.paused = ev.paused;
      v.toAct = null;
      for (const s of v.seats) if (s) s.deadline = null;
      break;
    case 'Paused':
      v.paused = ev.paused;
      break;
    case 'SeatJoined':
      v.seats[ev.seat.id] = clone(ev.seat);
      break;
    case 'SeatLeft':
      v.seats[ev.seat] = null;
      if (v.you === ev.seat) v.you = null;
      break;
    case 'SeatStatus': {
      const s = seat(ev.seat);
      if (s) {
        s.status = ev.status;
        s.away = ev.away;
        s.waitForBB = ev.waitForBB;
        s.needBB = ev.needBB;
        s.rebuyDeadline = ev.rebuyDeadline;
      }
      break;
    }
    case 'ButtonMoved':
      v.button = ev.button;
      v.sb = ev.sb;
      v.bb = ev.bb;
      break;
    case 'BlindPosted': {
      const s = seat(ev.seat);
      if (s) s.allIn = ev.allIn;
      v.currentBet = ev.currentBet;
      break;
    }
    case 'CardDealt':
      if (ev.to.t === 'hole') {
        const s = seat(ev.to.seat);
        if (s) {
          s.hole.push({ cid: ev.cid, card: ev.card });
          s.hasCards = true;
        }
      } else if (ev.to.t === 'board') v.board.push({ cid: ev.cid, card: ev.card });
      break;
    case 'TurnStarted':
      v.toAct = ev.seats[0] ?? null;
      for (const s of v.seats) if (s) s.deadline = ev.seats.includes(s.id) ? ev.deadline : null;
      break;
    case 'Acted': {
      const s = seat(ev.seat);
      if (s) {
        s.lastAction = ev.action;
        s.allIn = ev.allIn;
        s.deadline = null;
        if (ev.action === 'fold') {
          s.folded = true;
          s.hole = [];
          s.hasCards = false;
        }
      }
      v.currentBet = ev.currentBet;
      v.toAct = null;
      break;
    }
    case 'UncalledReturned': {
      const s = seat(ev.seat);
      if (s) s.allIn = ev.allIn;
      break;
    }
    case 'BetsGathered':
      v.pots = clone(ev.pots);
      v.currentBet = 0;
      v.toAct = null;
      for (const s of v.seats) {
        if (!s) continue;
        s.deadline = null;
        s.lastAction = null;
      }
      break;
    case 'HandsRevealed':
      for (const h of ev.hands) {
        const s = seat(h.seat);
        if (s) {
          s.hole = clone(h.cards);
          s.shown = true;
        }
      }
      break;
    case 'Shown': {
      const s = seat(ev.seat);
      if (s) {
        s.hole = clone(ev.cards);
        s.shown = true;
      }
      break;
    }
    case 'Mucked': {
      const s = seat(ev.seat);
      if (s) {
        s.hole = [];
        s.hasCards = false;
      }
      break;
    }
    case 'PotAwarded':
      v.pots.splice(ev.pot, 1);
      break;
    case 'CardsCollected':
      clearHand(v);
      break;
    default:
      break;
  }
  v.totalPot = v.pot + v.seats.reduce((a, s) => a + (s?.street ?? 0), 0);
  return v;
}
