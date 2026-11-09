import { fullDeck } from '../core/cards';
import { createRng, rekey, type Seed } from '../core/chacha';
import { clone } from '../core/clone';
import { move, type LedgerOps } from '../core/ledger';
import { CHIP, type Money } from '../core/money';
import { animBudget } from '../core/pacing';
import { shuffle } from '../core/shuffle';
import { EngineBug, type Account, type ApplyResult, type ErrorCode, type MoveReason, type Reveal, type SeatId } from '../core/types';
import { actOptions, clockwise, contenders, inHand, isStreet, nextToAct, occupied, roundComplete } from './betting';
import { bestFive, describeHand, eval7 } from './eval';
import { computePositions, isCandidate } from './positions';
import { buildPots, splitPot } from './pots';
import { validateHoldemRules, type HoldemRules } from './rules';
import type { HAction, HActKind, HEvent, HPhase, HSeat, HState, Street } from './types';
import { canRebuy, seatView } from './view';

class Reject extends Error {
  constructor(
    public code: ErrorCode,
    public detail?: string,
  ) {
    super(code);
  }
}

interface Ctx {
  st: HState;
  at: number;
  entropy: readonly number[] | undefined;
  pub: HEvent[];
  priv: Reveal[];
}

const emit = (ctx: Ctx, ev: HEvent) => {
  ctx.pub.push(ev);
};

// ───────────────────────── ledger ─────────────────────────

function seatOf(st: HState, id: SeatId): HSeat {
  const s = st.seats[id];
  if (!s) throw new EngineBug(`no seat ${id}`);
  return s;
}

const ledger: LedgerOps<HState> = {
  get(s, a) {
    switch (a.k) {
      case 'stack': return seatOf(s, a.seat).stack;
      case 'street': return seatOf(s, a.seat).street;
      case 'pot': return s.pot;
      case 'cashier': return s.cashier;
      default: throw new EngineBug(`account ${a.k} not used in hold'em`);
    }
  },
  set(s, a, v) {
    switch (a.k) {
      case 'stack': seatOf(s, a.seat).stack = v; return;
      case 'street': seatOf(s, a.seat).street = v; return;
      case 'pot': s.pot = v; return;
      case 'cashier': s.cashier = v; return;
      default: throw new EngineBug(`account ${a.k} not used in hold'em`);
    }
  },
};

function mv(ctx: Ctx, from: Account, to: Account, amount: Money, reason: MoveReason) {
  if (amount === 0) return;
  move(ledger, ctx.st, from, to, amount, reason, (e) => emit(ctx, e));
}

const stackAcc = (seat: SeatId): Account => ({ k: 'stack', seat });
const streetAcc = (seat: SeatId): Account => ({ k: 'street', seat });
const POT: Account = { k: 'pot' };
const CASHIER: Account = { k: 'cashier' };

// ───────────────────────── helpers ─────────────────────────

function requireSeat(st: HState, id: SeatId): HSeat {
  const s = Number.isInteger(id) ? st.seats[id] : undefined;
  if (!s) throw new Reject('UNKNOWN_SEAT');
  return s;
}

function checkDid(seat: HSeat, a: { dId?: number }) {
  if (a.dId !== undefined && a.dId !== seat.dId) throw new Reject('STALE_TURN');
}

function deadlineIn(ctx: Ctx, ms: number | null): number | null {
  if (ms == null) return null;
  return ctx.at + Math.round(animBudget(ctx.pub) * ctx.st.rules.animScale) + ms;
}

function setPhase(ctx: Ctx, phase: HPhase, deadline: number | null) {
  const { st } = ctx;
  st.phase = phase;
  st.phaseDeadline = deadline;
  st.toAct = null;
  for (const s of occupied(st)) s.deadline = null;
  emit(ctx, { e: 'Phase', phase, deadline, paused: st.paused });
}

function emitStatus(ctx: Ctx, s: HSeat) {
  emit(ctx, {
    e: 'SeatStatus',
    seat: s.id,
    status: s.status,
    away: s.away,
    waitForBB: s.waitForBB,
    needBB: s.needBB,
    rebuyDeadline: s.rebuyDeadline,
  });
}

/** Seats matching `pred`, clockwise starting with the seat after position `from`. */
function clockwiseFrom(st: HState, from: number, pred: (s: HSeat) => boolean): HSeat[] {
  const n = st.seats.length;
  const out: HSeat[] = [];
  for (let k = 1; k <= n; k++) {
    const s = st.seats[(from + k) % n];
    if (s && pred(s)) out.push(s);
  }
  return out;
}

function removeSeat(ctx: Ctx, s: HSeat) {
  const { st } = ctx;
  if (s.inHand && isStreet(st.phase)) throw new EngineBug(`removing seat ${s.id} from a live hand`);
  st.muck.push(...s.hole.map((c) => c.card));
  s.hole = [];
  if (s.stack > 0) mv(ctx, stackAcc(s.id), CASHIER, s.stack, 'cashOut');
  st.seats[s.id] = null;
  emit(ctx, { e: 'SeatLeft', seat: s.id });
}

function doRebuy(ctx: Ctx, s: HSeat) {
  s.rebuys++;
  mv(ctx, CASHIER, stackAcc(s.id), ctx.st.rules.buyIn, 'rebuy');
  if (s.status === 'busted') s.status = 'active';
  s.rebuyDeadline = null;
  s.dId++;
  emitStatus(ctx, s);
}

// ───────────────────────── dealing ─────────────────────────

function drawCard(ctx: Ctx) {
  const card = ctx.st.deck.pop();
  if (card === undefined) throw new EngineBug('deck exhausted');
  return { cid: ++ctx.st.cidSeq, card };
}

function dealHole(ctx: Ctx, s: HSeat, slot: number) {
  const dc = drawCard(ctx);
  s.hole.push(dc);
  emit(ctx, { e: 'CardDealt', cid: dc.cid, to: { t: 'hole', seat: s.id, slot }, card: null, faceUp: false });
  ctx.priv.push({ seat: s.id, cid: dc.cid, card: dc.card });
}

function burn(ctx: Ctx) {
  const dc = drawCard(ctx);
  ctx.st.burns.push(dc);
  emit(ctx, { e: 'CardDealt', cid: dc.cid, to: { t: 'burn' }, card: null, faceUp: false });
}

function dealBoard(ctx: Ctx) {
  const dc = drawCard(ctx);
  ctx.st.board.push(dc);
  emit(ctx, { e: 'CardDealt', cid: dc.cid, to: { t: 'board', slot: ctx.st.board.length - 1 }, card: dc.card, faceUp: true });
}

const NEXT_STREET = { preflop: 'flop', flop: 'turn', turn: 'river' } as const;

function dealStreet(ctx: Ctx, street: Exclude<Street, 'preflop'>) {
  setPhase(ctx, street, null);
  burn(ctx);
  for (let i = street === 'flop' ? 3 : 1; i > 0; i--) dealBoard(ctx);
  emit(ctx, { e: 'StreetDealt', street });
  emit(ctx, { e: 'Announce', key: `he.${street}` });
}

// ───────────────────────── hand start ─────────────────────────

function toWaiting(ctx: Ctx) {
  ctx.st.freshPositions = true;
  setPhase(ctx, 'waiting', null);
}

function postBlind(ctx: Ctx, s: HSeat, nominal: Money, kind: 'sb' | 'bb' | 'post') {
  const amount = Math.min(nominal, s.stack);
  s.allIn = amount === s.stack;
  emit(ctx, { e: 'BlindPosted', seat: s.id, kind, amount, allIn: s.allIn, currentBet: ctx.st.currentBet });
  mv(ctx, stackAcc(s.id), streetAcc(s.id), amount, 'blind');
}

function startHand(ctx: Ctx) {
  const { st } = ctx;
  if (ctx.entropy) rekey(st.rng, ctx.entropy);
  const pos = computePositions(st, st.rng);
  if (!pos) {
    toWaiting(ctx);
    return;
  }
  st.hand++;
  const dealt = new Set(pos.dealt);
  for (const s of occupied(st)) {
    s.inHand = dealt.has(s.id);
    s.folded = false;
    s.allIn = false;
    s.shown = false;
    s.hole = [];
    s.committed = 0;
    s.acted = false;
    s.matched = 0;
    s.lastAction = null;
    s.deadline = null;
    s.awayTimedOut = false;
  }
  st.board = [];
  st.burns = [];
  st.muck = [];
  st.pots = [];
  st.currentBet = 0;
  st.lastRaise = st.rules.bb;
  st.riverAggressor = null;
  st.toAct = null;
  emit(ctx, { e: 'HandStarted', hand: st.hand, seats: pos.dealt });
  setPhase(ctx, 'preflop', null);
  for (const id of pos.missed) {
    const s = st.seats[id]!;
    s.needBB = true;
    emitStatus(ctx, s);
  }
  for (const id of pos.dealt) {
    const s = st.seats[id]!;
    if (s.needBB) {
      s.needBB = false;
      emitStatus(ctx, s);
    }
  }
  st.buttonPos = pos.button;
  st.sbPos = pos.sb;
  st.bbPos = pos.bb;
  st.freshPositions = false;
  emit(ctx, { e: 'ButtonMoved', button: pos.button, sb: pos.sb, bb: pos.bb });
  if (st.deck.length !== 52) st.deck = shuffle(fullDeck(), st.rng);
  emit(ctx, { e: 'Shuffle', decks: 1, reason: 'newHand', remaining: 52 });
  // currentBet is the nominal big blind even when the BB is short.
  st.currentBet = st.rules.bb;
  const sbSeat = st.seats[pos.sb];
  if (pos.sb !== pos.bb && sbSeat?.inHand) postBlind(ctx, sbSeat, st.rules.sb, 'sb');
  postBlind(ctx, st.seats[pos.bb]!, st.rules.bb, 'bb');
  for (const id of pos.posts) postBlind(ctx, st.seats[id]!, st.rules.bb, 'post');
  emit(ctx, { e: 'Announce', key: 'he.blinds', params: { sb: st.rules.sb, bb: st.rules.bb } });
  const order = clockwiseFrom(st, pos.button, (s) => s.inHand);
  for (let slot = 0; slot < 2; slot++) for (const s of order) dealHole(ctx, s, slot);
  advance(ctx, pos.bb);
}

// ───────────────────────── betting ─────────────────────────

type Op = { k: 'fold' } | { k: 'check' } | { k: 'call' } | { k: 'to'; to: Money };

const MOVE_REASON: Record<Exclude<HActKind, 'fold' | 'check'>, MoveReason> = { call: 'call', bet: 'bet', raise: 'raise' };

/** Applies a validated action of the seat to act. */
function perform(ctx: Ctx, s: HSeat, op: Op, auto: boolean) {
  const { st } = ctx;
  s.dId++;
  s.deadline = null;
  st.toAct = null;
  s.acted = true;
  const flag = auto ? { auto: true } : {};
  if (op.k === 'fold') {
    s.folded = true;
    st.muck.push(...s.hole.map((c) => c.card));
    s.hole = [];
    s.lastAction = 'fold';
    emit(ctx, { e: 'Acted', seat: s.id, action: 'fold', allIn: false, currentBet: st.currentBet, ...flag });
    return;
  }
  if (op.k === 'check') {
    s.matched = st.currentBet;
    s.lastAction = 'check';
    emit(ctx, { e: 'Acted', seat: s.id, action: 'check', allIn: false, currentBet: st.currentBet, ...flag });
    return;
  }
  const to = op.k === 'call' ? Math.min(st.currentBet, s.street + s.stack) : op.to;
  const add = to - s.street;
  if (add <= 0 || add > s.stack) throw new EngineBug(`bad amount ${add}`);
  let kind: Exclude<HActKind, 'fold' | 'check'> = 'call';
  if (to > st.currentBet) {
    kind = st.currentBet === 0 ? 'bet' : 'raise';
    // Only a full raise changes the minimum raise; an incomplete all-in leaves it.
    if (to - st.currentBet >= st.lastRaise) st.lastRaise = to - st.currentBet;
    st.currentBet = to;
    if (st.phase === 'river') st.riverAggressor = s.id;
  }
  s.matched = st.currentBet;
  s.allIn = add === s.stack;
  s.lastAction = kind;
  emit(ctx, { e: 'Acted', seat: s.id, action: kind, to, amount: add, allIn: s.allIn, currentBet: st.currentBet, ...flag });
  mv(ctx, stackAcc(s.id), streetAcc(s.id), add, MOVE_REASON[kind]);
  if (s.allIn) emit(ctx, { e: 'Announce', key: 'he.allIn', params: { seat: s.id } });
}

function startTurn(ctx: Ctx, s: HSeat) {
  const { st } = ctx;
  for (const o of occupied(st)) o.deadline = null;
  s.dId++;
  s.deadline = deadlineIn(ctx, st.rules.decisionMs);
  st.toAct = s.id;
  emit(ctx, { e: 'TurnStarted', seats: [s.id], deadline: s.deadline });
}

/** Moves the hand forward from position `from` until someone must decide or the hand is over. */
function advance(ctx: Ctx, from: number) {
  const { st } = ctx;
  let cursor = from;
  for (let guard = 0; guard < 4 * st.seats.length + 16; guard++) {
    const cs = contenders(st);
    if (cs.length === 1) {
      winUncontested(ctx);
      return;
    }
    if (roundComplete(st)) {
      endStreet(ctx);
      if (st.phase === 'river') {
        showdown(ctx);
        return;
      }
      if (contenders(st).filter((s) => !s.allIn).length <= 1) {
        runout(ctx);
        return;
      }
      dealStreet(ctx, NEXT_STREET[st.phase as keyof typeof NEXT_STREET]);
      cursor = st.buttonPos!;
      continue;
    }
    const id = nextToAct(st, cursor);
    if (id == null) throw new EngineBug('round incomplete but nobody to act');
    const s = st.seats[id]!;
    cursor = id;
    if (s.status === 'leaving') {
      perform(ctx, s, { k: 'fold' }, true);
      continue;
    }
    if (s.away && s.awayTimedOut) {
      s.timeouts++;
      perform(ctx, s, actOptions(st, s).check ? { k: 'check' } : { k: 'fold' }, true);
      continue;
    }
    startTurn(ctx, s);
    return;
  }
  throw new EngineBug('advance did not settle');
}

/** The bet nobody matched goes back to its owner (folded or not) before the street is gathered. */
function returnUncalled(ctx: Ctx) {
  let top = 0;
  let second = 0;
  let holder: HSeat | null = null;
  for (const s of inHand(ctx.st)) {
    if (s.street > top) {
      second = top;
      top = s.street;
      holder = s;
    } else if (s.street > second) second = s.street;
  }
  if (holder && top > second) {
    const amount = top - second;
    holder.allIn = false;
    emit(ctx, { e: 'UncalledReturned', seat: holder.id, amount, allIn: false });
    mv(ctx, streetAcc(holder.id), stackAcc(holder.id), amount, 'uncalled');
  }
}

function endStreet(ctx: Ctx) {
  const { st } = ctx;
  returnUncalled(ctx);
  for (const s of inHand(st)) {
    if (s.street === 0) continue;
    const a = s.street;
    s.committed += a;
    mv(ctx, streetAcc(s.id), POT, a, 'gather');
  }
  st.pots = buildPots(inHand(st).map((s) => ({ seat: s.id, committed: s.committed, folded: s.folded, allIn: s.allIn })));
  if (st.pots.reduce((a, p) => a + p.amount, 0) !== st.pot) throw new EngineBug('pots do not add up to the pot');
  st.currentBet = 0;
  st.lastRaise = st.rules.bb;
  st.toAct = null;
  for (const s of occupied(st)) {
    s.acted = false;
    s.matched = 0;
    s.lastAction = null;
    s.deadline = null;
  }
  emit(ctx, { e: 'BetsGathered', pots: clone(st.pots) });
}

// ───────────────────────── showdown & awards ─────────────────────────

function toResults(ctx: Ctx) {
  setPhase(ctx, 'results', deadlineIn(ctx, ctx.st.rules.resultsMs));
}

const cardsOf = (st: HState, s: HSeat) => [...s.hole.map((c) => c.card), ...st.board.map((c) => c.card)];

function best5Cids(st: HState, s: HSeat, value: number): number[] {
  const all = [...s.hole, ...st.board];
  return bestFive(all.map((c) => c.card), value).map((card) => all.find((c) => c.card === card)!.cid);
}

function show(ctx: Ctx, s: HSeat) {
  const { st } = ctx;
  s.shown = true;
  const cards = cardsOf(st, s);
  const value = cards.length >= 5 ? eval7(cards) : null;
  emit(ctx, {
    e: 'Shown',
    seat: s.id,
    cards: s.hole.map((c) => ({ cid: c.cid, card: c.card })),
    value,
    best5: value == null ? null : best5Cids(st, s, value),
  });
}

function muck(ctx: Ctx, s: HSeat) {
  ctx.st.muck.push(...s.hole.map((c) => c.card));
  s.hole = [];
  emit(ctx, { e: 'Mucked', seat: s.id });
}

/** All-in and called: every live hand is turned face up. */
function revealAll(ctx: Ctx) {
  const hidden = contenders(ctx.st).filter((s) => !s.shown);
  if (hidden.length === 0) return;
  for (const s of hidden) s.shown = true;
  emit(ctx, {
    e: 'HandsRevealed',
    hands: hidden.map((s) => ({ seat: s.id, cards: s.hole.map((c) => ({ cid: c.cid, card: c.card })) })),
  });
}

function runout(ctx: Ctx) {
  const { st } = ctx;
  revealAll(ctx);
  while (st.phase !== 'river') dealStreet(ctx, NEXT_STREET[st.phase as keyof typeof NEXT_STREET]);
  showdown(ctx);
}

/** Awards every pot, last side pot first. `values` is null for an uncontested hand (nothing shown). */
function award(ctx: Ctx, values: Map<SeatId, number> | null) {
  const { st } = ctx;
  const n = st.seats.length;
  const btn = st.buttonPos ?? 0;
  for (let i = st.pots.length - 1; i >= 0; i--) {
    const p = st.pots[i]!;
    let winners: SeatId[];
    let value: number | null = null;
    if (values == null || p.eligible.length === 1) winners = [...p.eligible];
    else {
      const live = p.eligible.filter((id) => (st.seats[id]?.hole.length ?? 0) > 0);
      if (live.length === 0) throw new EngineBug(`contested pot ${i} with no hand left`);
      value = Math.max(...live.map((id) => values.get(id)!));
      winners = live.filter((id) => values.get(id) === value);
    }
    winners.sort((a, b) => clockwise(n, btn, a) - clockwise(n, btn, b));
    const first = st.seats[winners[0]!]!;
    if (value == null && values != null && first.shown) value = values.get(first.id)!;
    const shares = splitPot(p.amount, winners);
    st.pots.splice(i, 1);
    emit(ctx, {
      e: 'PotAwarded',
      pot: i,
      amount: p.amount,
      winners: shares,
      value,
      best5: value == null ? null : best5Cids(st, first, value),
    });
    for (const sh of shares) mv(ctx, POT, stackAcc(sh.seat), sh.amount, 'award');
    if (shares.length > 1) emit(ctx, { e: 'Announce', key: 'he.splitPot', params: { count: shares.length } });
    else {
      const params: Record<string, string | number> = { seat: first.id, amount: p.amount };
      if (value != null) params.hand = describeHand(value).cat;
      emit(ctx, { e: 'Announce', key: 'he.wins', params });
    }
  }
}

function winUncontested(ctx: Ctx) {
  endStreet(ctx);
  award(ctx, null);
  toResults(ctx);
}

function showdown(ctx: Ctx) {
  const { st } = ctx;
  setPhase(ctx, 'showdown', null);
  emit(ctx, { e: 'Announce', key: 'he.showdown' });
  const cs = contenders(st);
  if (cs.filter((s) => !s.allIn).length <= 1) revealAll(ctx);
  const values = new Map(cs.map((s) => [s.id, eval7(cardsOf(st, s))]));
  const n = st.seats.length;
  const ids = cs.map((s) => s.id);
  const start =
    st.riverAggressor != null && ids.includes(st.riverAggressor)
      ? st.riverAggressor
      : clockwiseFrom(st, st.buttonPos ?? 0, (s) => ids.includes(s.id))[0]!.id;
  const order = [...cs].sort((a, b) => ((a.id - start + n) % n) - ((b.id - start + n) % n));
  // Per pot: show if nobody else in that pot has shown yet, or if this hand is at least as good as the
  // best shown there. Uncontested side pots do not force a show.
  const bestShown = st.pots.map(() => -1);
  for (const s of order) {
    const v = values.get(s.id)!;
    const contested = st.pots.flatMap((p, i) => (p.eligible.length > 1 && p.eligible.includes(s.id) ? [i] : []));
    if (!s.shown) {
      if (contested.some((i) => bestShown[i]! < 0 || v >= bestShown[i]!)) show(ctx, s);
      else muck(ctx, s);
    }
    if (s.shown) for (const i of contested) bestShown[i] = Math.max(bestShown[i]!, v);
  }
  award(ctx, values);
  toResults(ctx);
}

// ───────────────────────── between hands ─────────────────────────

function collect(ctx: Ctx) {
  const { st } = ctx;
  if (st.pot !== 0) throw new EngineBug('collecting cards with chips in the pot');
  for (const s of occupied(st)) {
    if (s.street !== 0) throw new EngineBug(`seat ${s.id} has an open bet`);
    s.inHand = false;
    s.folded = false;
    s.allIn = false;
    s.shown = false;
    s.hole = [];
    s.committed = 0;
    s.acted = false;
    s.matched = 0;
    s.lastAction = null;
    s.deadline = null;
  }
  st.deck = [];
  st.burns = [];
  st.board = [];
  st.muck = [];
  st.pots = [];
  st.currentBet = 0;
  st.riverAggressor = null;
  st.toAct = null;
  emit(ctx, { e: 'CardsCollected' });
}

/** Leaving seats go, repeated timeouts sit out, empty stacks rebuy (bots), wait for a rebuy, or go. */
function maintainSeats(ctx: Ctx) {
  const { st } = ctx;
  const r = st.rules;
  for (const s of occupied(st)) {
    if (s.status === 'leaving') {
      removeSeat(ctx, s);
      continue;
    }
    if (r.autoSitOutAfterTimeouts > 0 && s.timeouts >= r.autoSitOutAfterTimeouts && s.status === 'active') {
      s.timeouts = 0;
      s.status = 'sittingOut';
      s.dId++;
      emitStatus(ctx, s);
    }
    if (s.stack === 0 && s.status !== 'busted') {
      if (!canRebuy(st, s)) removeSeat(ctx, s);
      else if (s.bot && r.botsAutoRebuy) doRebuy(ctx, s);
      else {
        s.status = 'busted';
        s.rebuyDeadline = r.rebuyWindowMs == null ? null : ctx.at + r.rebuyWindowMs;
        s.dId++;
        emitStatus(ctx, s);
      }
    }
  }
}

function cleanup(ctx: Ctx) {
  collect(ctx);
  maintainSeats(ctx);
  if (ctx.st.paused) setPhase(ctx, 'waiting', null);
  else startHand(ctx);
}

/** Arms (or disarms) the start clock while waiting for players. */
function progress(ctx: Ctx) {
  const { st } = ctx;
  if (st.phase !== 'waiting') return;
  const ready = !st.paused && occupied(st).filter(isCandidate).length >= 2;
  if (ready && st.phaseDeadline == null) setPhase(ctx, 'waiting', deadlineIn(ctx, st.rules.startDelayMs));
  else if (!ready && st.phaseDeadline != null) setPhase(ctx, 'waiting', null);
}

// ───────────────────────── actions ─────────────────────────

function handle(ctx: Ctx, a: HAction) {
  const { st } = ctx;
  const r = st.rules;
  switch (a.type) {
    case 'JOIN': {
      if (occupied(st).some((s) => s.player === a.player)) throw new Reject('ALREADY_SEATED');
      if (!st.seats.includes(null)) throw new Reject('TABLE_FULL');
      let id = st.seats.indexOf(null);
      if (a.seat != null) {
        if (!Number.isInteger(a.seat) || a.seat < 0 || a.seat >= st.seats.length) throw new Reject('ILLEGAL_ACTION', 'no such seat');
        if (st.seats[a.seat]) throw new Reject('ILLEGAL_ACTION', 'seat taken');
        id = a.seat;
      }
      const buyIn = a.buyIn ?? r.buyIn;
      if (!Number.isSafeInteger(buyIn) || buyIn % CHIP !== 0 || buyIn < r.minBuyIn || buyIn > r.maxBuyIn) throw new Reject('BAD_AMOUNT');
      const seat: HSeat = {
        id,
        player: a.player,
        name: a.name,
        bot: a.bot ?? null,
        status: 'active',
        away: false,
        waitForBB: a.waitForBB ?? false,
        needBB: r.entry === 'postOrWait' && !st.freshPositions,
        stack: 0,
        street: 0,
        committed: 0,
        inHand: false,
        hole: [],
        folded: false,
        allIn: false,
        shown: false,
        acted: false,
        matched: 0,
        lastAction: null,
        deadline: null,
        rebuyDeadline: null,
        timeouts: 0,
        awayTimedOut: false,
        rebuys: 0,
        dId: 0,
      };
      st.seats[id] = seat;
      emit(ctx, { e: 'SeatJoined', seat: seatView(seat) });
      mv(ctx, CASHIER, stackAcc(id), buyIn, 'buyIn');
      return;
    }
    case 'LEAVE':
    case 'RELEASE': {
      const s = requireSeat(st, a.seat);
      if (s.status === 'leaving') throw new Reject('ILLEGAL_ACTION', 'already leaving');
      if (!(s.inHand && isStreet(st.phase))) {
        removeSeat(ctx, s);
        return;
      }
      // Still in a live hand: fold when the turn comes (at once if it is now); an all-in seat plays on.
      s.status = 'leaving';
      s.dId++;
      emitStatus(ctx, s);
      if (st.toAct === s.id) {
        perform(ctx, s, { k: 'fold' }, true);
        advance(ctx, s.id);
      }
      return;
    }
    case 'SIT_OUT': {
      const s = requireSeat(st, a.seat);
      checkDid(s, a);
      if (s.status !== 'active') throw new Reject('ILLEGAL_ACTION');
      s.status = 'sittingOut';
      s.dId++;
      emitStatus(ctx, s);
      return;
    }
    case 'SIT_IN': {
      const s = requireSeat(st, a.seat);
      checkDid(s, a);
      if (s.status !== 'sittingOut') throw new Reject('ILLEGAL_ACTION');
      s.status = 'active';
      s.timeouts = 0;
      s.dId++;
      emitStatus(ctx, s);
      return;
    }
    case 'REBUY': {
      const s = requireSeat(st, a.seat);
      checkDid(s, a);
      if (s.status !== 'busted' || s.stack > 0 || !canRebuy(st, s)) throw new Reject('ILLEGAL_ACTION');
      doRebuy(ctx, s);
      return;
    }
    case 'SET_WAIT_BB': {
      const s = requireSeat(st, a.seat);
      s.waitForBB = a.value;
      emitStatus(ctx, s);
      return;
    }
    case 'SET_AWAY': {
      const s = requireSeat(st, a.seat);
      s.away = a.away;
      if (!a.away) s.awayTimedOut = false;
      emitStatus(ctx, s);
      return;
    }
    case 'FOLD':
    case 'CHECK':
    case 'CALL':
    case 'ALL_IN':
    case 'BET':
    case 'RAISE': {
      const s = requireSeat(st, a.seat);
      checkDid(s, a);
      if (!isStreet(st.phase)) throw new Reject('BAD_PHASE');
      if (st.toAct !== s.id) throw new Reject('NOT_YOUR_TURN');
      const o = actOptions(st, s);
      let op: Op;
      if (a.type === 'FOLD') {
        if (!o.fold) throw new Reject('ILLEGAL_ACTION', 'check is free');
        op = { k: 'fold' };
      } else if (a.type === 'CHECK') {
        if (!o.check) throw new Reject('ILLEGAL_ACTION', 'there is a bet to call');
        op = { k: 'check' };
      } else if (a.type === 'CALL') {
        if (o.call == null) throw new Reject('ILLEGAL_ACTION', 'nothing to call');
        op = { k: 'call' };
      } else if (a.type === 'ALL_IN') {
        if (o.allIn == null) throw new Reject('ILLEGAL_ACTION', 'action is not open to a raise');
        op = { k: 'to', to: o.allIn };
      } else if (a.type === 'BET' || a.type === 'RAISE') {
        const range = a.type === 'BET' ? o.bet : o.raise;
        if (!range) throw new Reject('ILLEGAL_ACTION', `${a.type.toLowerCase()} not allowed`);
        if (!Number.isSafeInteger(a.to)) throw new Reject('BAD_AMOUNT');
        if (a.to > range.max) throw new Reject('INSUFFICIENT_FUNDS');
        if (a.to !== range.max && (a.to < range.min || a.to % o.unit !== 0)) throw new Reject('BAD_AMOUNT');
        op = { k: 'to', to: a.to };
      } else throw new EngineBug('unreachable');
      s.timeouts = 0;
      perform(ctx, s, op, false);
      advance(ctx, s.id);
      return;
    }
    case 'SHOW':
    case 'MUCK': {
      const s = requireSeat(st, a.seat);
      if (st.phase !== 'results') throw new Reject('BAD_PHASE');
      if (!s.inHand || s.hole.length === 0 || s.shown) throw new Reject('ILLEGAL_ACTION');
      if (a.type === 'SHOW') show(ctx, s);
      else muck(ctx, s);
      return;
    }
    case 'PAUSE': {
      st.paused = a.value;
      emit(ctx, { e: 'Paused', paused: a.value });
      emit(ctx, { e: 'Announce', key: a.value ? 'table.paused' : 'table.resumed' });
      if (a.value && st.phase === 'waiting' && st.phaseDeadline != null) setPhase(ctx, 'waiting', null);
      return;
    }
    case 'ABORT': {
      if (isStreet(st.phase)) {
        for (const s of inHand(st)) {
          mv(ctx, streetAcc(s.id), stackAcc(s.id), s.street, 'refund');
          const c = s.committed;
          s.committed = 0;
          mv(ctx, POT, stackAcc(s.id), c, 'refund');
        }
      }
      if (st.phase !== 'waiting') {
        collect(ctx);
        maintainSeats(ctx);
      }
      st.paused = true;
      emit(ctx, { e: 'Paused', paused: true });
      toWaiting(ctx);
      return;
    }
    case 'TIMEOUT': {
      const at = ctx.at;
      for (const s of occupied(st)) {
        if (s.status === 'busted' && s.rebuyDeadline != null && at >= s.rebuyDeadline) removeSeat(ctx, s);
      }
      if (st.phase === 'waiting') {
        if (st.phaseDeadline != null && at >= st.phaseDeadline) startHand(ctx);
      } else if (st.phase === 'results') {
        if (st.phaseDeadline != null && at >= st.phaseDeadline) cleanup(ctx);
      } else if (isStreet(st.phase) && st.toAct != null) {
        const s = st.seats[st.toAct]!;
        if (s.deadline != null && at >= s.deadline) {
          s.timeouts++;
          if (s.away) s.awayTimedOut = true;
          perform(ctx, s, actOptions(st, s).check ? { k: 'check' } : { k: 'fold' }, true);
          advance(ctx, s.id);
        }
      }
      return;
    }
    default:
      throw new Reject('ILLEGAL_ACTION', 'unknown action');
  }
}

export function createHoldem(rules: HoldemRules, seed: Seed, at: number): HState {
  const errs = validateHoldemRules(rules);
  if (errs.length) throw new Error(`Invalid Hold'em rules: ${errs.join('; ')}`);
  return {
    v: 1,
    game: 'holdem',
    rules,
    phase: 'waiting',
    paused: false,
    hand: 0,
    cidSeq: 0,
    lastAt: at,
    seats: new Array<HSeat | null>(rules.maxSeats).fill(null),
    buttonPos: null,
    sbPos: null,
    bbPos: null,
    freshPositions: true,
    deck: [],
    burns: [],
    board: [],
    muck: [],
    pot: 0,
    pots: [],
    currentBet: 0,
    lastRaise: rules.bb,
    riverAggressor: null,
    toAct: null,
    rng: createRng(seed),
    cashier: 0,
    phaseDeadline: null,
  };
}

export function applyHoldem(s: HState, a: HAction, opts?: { inPlace?: boolean }): ApplyResult<HState, HEvent> {
  const st = opts?.inPlace ? s : clone(s);
  const ctx: Ctx = { st, at: Math.max(a.at, s.lastAt), entropy: a.entropy, pub: [], priv: [] };
  try {
    handle(ctx, a);
    progress(ctx);
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.detail ? { code: e.code, detail: e.detail } : { code: e.code } };
    throw e;
  }
  st.lastAt = ctx.at;
  return { ok: true, state: st, pub: ctx.pub, priv: ctx.priv };
}
