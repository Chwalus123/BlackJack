import type { SeatId, Viewer } from '../core/types';
import { isNatural } from './hand';
import { minBet } from './rules';
import type { BJEvent, BJHand, BJHandView, BJLegal, BJSeat, BJSeatView, BJState, BJView } from './types';
import { canDouble, canSplit } from './engine';

function handView(h: BJHand): BJHandView {
  return {
    cards: h.cards.map((c) => ({ cid: c.cid, card: c.card })),
    bet: h.bet,
    doubled: h.doubled,
    split: h.split,
    splitAces: h.splitAces,
    state: h.state,
    outcome: h.outcome,
  };
}

export function seatView(s: BJSeat): BJSeatView {
  return {
    id: s.id,
    order: s.order,
    player: s.player,
    name: s.name,
    bot: s.bot,
    status: s.status,
    away: s.away,
    autoBet: s.autoBet,
    stack: s.stack,
    decided: s.decided,
    hands: s.hands.map(handView),
    insurance: s.insurance,
    insDecided: s.insDecided,
    deadline: s.deadline,
  };
}

/** Redacted snapshot. In blackjack every player card is public; only the dealer's hole card is hidden. */
export function viewBlackjack(st: BJState, viewer: Viewer): BJView {
  const r = st.rules;
  return {
    game: 'blackjack',
    phase: st.phase,
    paused: st.paused,
    round: st.round,
    rules: {
      betting: r.betting,
      decisionMode: r.decisionMode,
      blackjackPays: r.blackjackPays,
      insurance: r.insurance,
      maxHands: r.maxHands,
      decks: r.decks,
      startingBankroll: r.startingBankroll,
      rebuy: r.rebuy,
      decisionMs: r.timers.decisionMs,
    },
    seats: st.seats.map(seatView),
    dealer: {
      cards: st.dealer.cards.map((c, i) => ({ cid: c.cid, card: i === 1 && !st.dealer.holeUp ? null : c.card })),
    },
    shoe: { decks: st.shoe.decks, remaining: st.shoe.cards.length, discards: st.shoe.discards.length },
    phaseDeadline: st.phaseDeadline,
    turn: st.turn ? { seats: [...st.turn.seats], hand: st.turn.hand } : null,
    you: viewer.kind === 'seat' && st.seats.some((s) => s.id === viewer.seat) ? viewer.seat : null,
  };
}

const live = (s: BJSeat) => s.hands.some((h) => h.state === 'play' || h.state === 'waitCard');

export function legalBlackjack(st: BJState, seatId: SeatId): BJLegal | null {
  const seat = st.seats.find((s) => s.id === seatId);
  if (!seat || seat.status === 'leaving') return null;
  const r = st.rules;
  const dId = seat.dId;
  const current = seat.hands[0]?.bet ?? 0;
  const broke = seat.stack + current < minBet(r);
  const rebuyOk = r.rebuy.mode === 'whenBroke' && (r.rebuy.max == null || seat.rebuys < r.rebuy.max);
  const between = st.phase === 'betting' || st.phase === 'idle' || st.phase === 'results';
  if (seat.status === 'sittingOut' && between) return { kind: 'sitIn', dId };
  if (st.phase === 'betting' && seat.status === 'active') {
    if (broke) return rebuyOk && current === 0 ? { kind: 'rebuy', dId, amount: r.startingBankroll } : null;
    if (r.betting.mode === 'fixed') return { kind: 'bet', dId, mode: 'fixed', stake: r.betting.stake, current, decided: seat.decided };
    return {
      kind: 'bet',
      dId,
      mode: 'free',
      min: r.betting.min,
      max: Math.min(r.betting.max, Math.floor((seat.stack + current) / r.betting.unit) * r.betting.unit),
      unit: r.betting.unit,
      current,
      canDeal: st.seats.some((s) => (s.hands[0]?.bet ?? 0) > 0),
    };
  }
  if (st.phase === 'insurance' && !seat.insDecided && seat.hands[0]) {
    const h = seat.hands[0];
    return { kind: 'insurance', dId, cost: h.bet / 2, evenMoney: isNatural(h.cards.map((c) => c.card), false) };
  }
  if (st.phase === 'play' && seat.status !== 'pending' && live(seat)) {
    const myTurn = r.decisionMode === 'sequential' ? st.cursor === seat.id : true;
    const h = seat.hands[seat.cur];
    if (!myTurn || !h || h.state !== 'play') return null;
    return {
      kind: 'play',
      dId,
      hand: seat.cur,
      hit: !h.splitAces,
      stand: true,
      double: canDouble(r, seat, h),
      split: canSplit(r, seat, h),
      doubleCost: h.bet,
      splitCost: h.bet,
    };
  }
  if ((st.phase === 'idle' || st.phase === 'results') && broke && rebuyOk && seat.hands.length === 0) {
    return { kind: 'rebuy', dId, amount: r.startingBankroll };
  }
  return null;
}

export function nextDeadlineBlackjack(st: BJState): number | null {
  if (st.phase === 'idle') return null;
  if (st.phase === 'play') {
    let min: number | null = null;
    for (const s of st.seats) if (s.deadline != null && live(s) && (min == null || s.deadline < min)) min = s.deadline;
    return min;
  }
  return st.phaseDeadline;
}

export function pendingBlackjack(st: BJState): SeatId[] {
  switch (st.phase) {
    case 'betting':
      return st.seats.filter((s) => s.status === 'active' && !s.decided).map((s) => s.id);
    case 'insurance':
      return st.seats.filter((s) => !s.insDecided).map((s) => s.id);
    case 'play':
      if (st.rules.decisionMode === 'sequential') return st.cursor != null ? [st.cursor] : [];
      return st.seats.filter((s) => s.status !== 'pending' && live(s)).map((s) => s.id);
    default:
      return [];
  }
}

function emptyHand(): BJHandView {
  return { cards: [], bet: 0, doubled: false, split: false, splitAces: false, state: 'play', outcome: null };
}

/**
 * Mechanical reduction of a public event into a view — no rules logic, so a client can follow a table
 * from a snapshot plus the event stream. Mutates and returns `v`.
 */
export function reduceBlackjackView(v: BJView, ev: BJEvent): BJView {
  const seat = (id: SeatId) => v.seats.find((s) => s.id === id);
  switch (ev.e) {
    case 'RoundStarted':
      v.round = ev.round;
      for (const s of v.seats) {
        s.hands = [];
        s.insurance = 0;
        s.insDecided = false;
        s.decided = false;
        s.deadline = null;
      }
      break;
    case 'Phase':
      v.phase = ev.phase;
      v.phaseDeadline = ev.deadline;
      v.paused = ev.paused;
      if (ev.phase !== 'play') v.turn = null;
      for (const s of v.seats) s.deadline = null;
      break;
    case 'Paused':
      v.paused = ev.paused;
      break;
    case 'SeatJoined':
      v.seats.push(structuredCloneLite(ev.seat));
      break;
    case 'SeatLeft':
      v.seats = v.seats.filter((s) => s.id !== ev.seat);
      if (v.you === ev.seat) v.you = null;
      break;
    case 'SeatStatus': {
      const s = seat(ev.seat);
      if (s) {
        s.status = ev.status;
        s.away = ev.away;
        s.autoBet = ev.autoBet;
      }
      break;
    }
    case 'Decided': {
      const s = seat(ev.seat);
      if (s) {
        s.decided = ev.decided;
        if (!ev.decided) s.hands = [];
      }
      break;
    }
    case 'ChipsMoved':
      for (const [acc, bal] of [[ev.from, ev.fromBal], [ev.to, ev.toBal]] as const) {
        if (acc.k === 'stack') {
          const s = seat(acc.seat);
          if (s) s.stack = bal;
        } else if (acc.k === 'bet') {
          const s = seat(acc.seat);
          if (s) {
            while (s.hands.length <= acc.hand) s.hands.push(emptyHand());
            s.hands[acc.hand]!.bet = bal;
          }
        } else if (acc.k === 'ins') {
          const s = seat(acc.seat);
          if (s) s.insurance = bal;
        }
      }
      break;
    case 'Shuffle':
      v.shoe.decks = ev.decks;
      v.shoe.remaining = ev.remaining;
      break;
    case 'CardDealt':
      v.shoe.remaining--;
      if (ev.to.t === 'dealer') v.dealer.cards.push({ cid: ev.cid, card: ev.card });
      else {
        const s = seat(ev.to.seat);
        if (s) {
          while (s.hands.length <= ev.to.hand) s.hands.push(emptyHand());
          s.hands[ev.to.hand]!.cards.push({ cid: ev.cid, card: ev.card });
        }
      }
      break;
    case 'CardFlipped': {
      const c = v.dealer.cards.find((x) => x.cid === ev.cid);
      if (c) c.card = ev.card;
      break;
    }
    case 'HandSplit': {
      const s = seat(ev.seat);
      if (!s) break;
      const from = s.hands[ev.from]!;
      from.cards = from.cards.filter((c) => c.cid !== ev.cid);
      from.split = true;
      from.splitAces = ev.splitAces;
      s.hands.splice(ev.to, 0, {
        cards: [{ cid: ev.cid, card: ev.card }],
        bet: 0,
        doubled: false,
        split: true,
        splitAces: ev.splitAces,
        state: 'waitCard',
        outcome: null,
      });
      break;
    }
    case 'HandState': {
      const h = seat(ev.seat)?.hands[ev.hand];
      if (h) {
        h.state = ev.state;
        h.outcome = ev.outcome;
        h.doubled = ev.doubled;
      }
      break;
    }
    case 'HandResult': {
      const h = seat(ev.seat)?.hands[ev.hand];
      if (h) h.outcome = ev.outcome;
      break;
    }
    case 'TurnStarted':
      v.turn = { seats: [...ev.seats], hand: ev.hand };
      for (const s of v.seats) s.deadline = ev.seats.includes(s.id) ? ev.deadline : null;
      break;
    case 'SeatDeadline': {
      const s = seat(ev.seat);
      if (s) s.deadline = ev.deadline;
      break;
    }
    case 'InsuranceOffered':
      for (const s of v.seats) s.insDecided = !ev.seats.includes(s.id);
      break;
    case 'InsuranceDecided': {
      const s = seat(ev.seat);
      if (s) s.insDecided = true;
      break;
    }
    case 'CardsCollected':
      for (const s of v.seats) s.hands = [];
      v.dealer.cards = [];
      break;
    default:
      break;
  }
  // Card conservation: shoe + discards + table = decks × 52.
  v.shoe.discards = v.shoe.decks * 52 - v.shoe.remaining - countTable(v);
  return v;
}

function countTable(v: BJView): number {
  let n = v.dealer.cards.length;
  for (const s of v.seats) for (const h of s.hands) n += h.cards.length;
  return n;
}

function structuredCloneLite<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
