import { createRng, rekey } from '../core/chacha';
import { clone } from '../core/clone';
import { move, type LedgerOps } from '../core/ledger';
import { payout, type Money } from '../core/money';
import { animBudget } from '../core/pacing';
import { draw, emptyShoe, preRoundCheck, type ShoeConfig, type ShuffleEvent } from '../core/shoe';
import type { Seed } from '../core/chacha';
import { EngineBug, type Account, type ApplyResult, type ErrorCode, type MoveReason, type Reveal, type SeatId } from '../core/types';
import { bjValue } from '../core/cards';
import { handValue, isAce, isNatural, isTenValue } from './hand';
import { minBet, type BlackjackRules } from './rules';
import type { BJAction, BJEvent, BJHand, BJSeat, BJState, BJTarget } from './types';
import { seatView } from './view';

class Reject extends Error {
  constructor(
    public code: ErrorCode,
    public detail?: string,
  ) {
    super(code);
  }
}

interface Ctx {
  st: BJState;
  at: number;
  entropy: readonly number[] | undefined;
  pub: BJEvent[];
  priv: Reveal[];
}

const emit = (ctx: Ctx, ev: BJEvent) => {
  ctx.pub.push(ev);
};

// ───────────────────────── ledger ─────────────────────────

function seatOf(st: BJState, id: SeatId): BJSeat {
  const s = st.seats.find((x) => x.id === id);
  if (!s) throw new EngineBug(`no seat ${id}`);
  return s;
}

const ledger: LedgerOps<BJState> = {
  get(s, a) {
    switch (a.k) {
      case 'stack': return seatOf(s, a.seat).stack;
      case 'bet': return seatOf(s, a.seat).hands[a.hand]!.bet;
      case 'ins': return seatOf(s, a.seat).insurance;
      case 'house': return s.house;
      case 'cashier': return s.cashier;
      default: throw new EngineBug(`account ${a.k} not used in blackjack`);
    }
  },
  set(s, a, v) {
    switch (a.k) {
      case 'stack': seatOf(s, a.seat).stack = v; return;
      case 'bet': seatOf(s, a.seat).hands[a.hand]!.bet = v; return;
      case 'ins': seatOf(s, a.seat).insurance = v; return;
      case 'house': s.house = v; return;
      case 'cashier': s.cashier = v; return;
      default: throw new EngineBug(`account ${a.k} not used in blackjack`);
    }
  },
};

function mv(ctx: Ctx, from: Account, to: Account, amount: Money, reason: MoveReason) {
  if (amount === 0) return;
  move(ledger, ctx.st, from, to, amount, reason, (e) => emit(ctx, e));
}

const stackAcc = (seat: SeatId): Account => ({ k: 'stack', seat });
const betAcc = (seat: SeatId, hand: number): Account => ({ k: 'bet', seat, hand });
const HOUSE: Account = { k: 'house' };
const CASHIER: Account = { k: 'cashier' };

// ───────────────────────── helpers ─────────────────────────

function shoeCfg(r: BlackjackRules): ShoeConfig {
  return { minDecks: r.decks, maxDecks: r.maxDecks, penetration: r.penetration, burnAfterShuffle: r.burnAfterShuffle };
}

function newHand(): BJHand {
  return { cards: [], bet: 0, doubled: false, split: false, splitAces: false, state: 'play', outcome: null };
}

function requireSeat(st: BJState, id: SeatId): BJSeat {
  const s = st.seats.find((x) => x.id === id);
  if (!s) throw new Reject('UNKNOWN_SEAT');
  return s;
}

function checkDid(seat: BJSeat, a: { dId?: number }) {
  if (a.dId !== undefined && a.dId !== seat.dId) throw new Reject('STALE_TURN');
}

const inRound = (s: BJSeat) => s.hands.length > 0 && s.hands[0]!.cards.length > 0;
const hasBet = (s: BJSeat) => s.hands.length > 0 && s.hands[0]!.bet > 0;
const isLive = (h: BJHand) => h.state === 'play' || h.state === 'waitCard';
const seatLive = (s: BJSeat) => s.hands.some(isLive);

function deadlineIn(ctx: Ctx, ms: number | null): number | null {
  if (ms == null) return null;
  return ctx.at + Math.round(animBudget(ctx.pub) * ctx.st.rules.animScale) + ms;
}

function onShuffle(ctx: Ctx) {
  return (e: ShuffleEvent) => emit(ctx, e);
}

function drawCard(ctx: Ctx) {
  const { st } = ctx;
  if (ctx.entropy && (st.shoe.cards.length === 0 || st.shoe.needsShuffle)) {
    // Fresh entropy before any reshuffle that draw() may trigger.
    if (st.shoe.cards.length === 0) rekey(st.rng, ctx.entropy);
  }
  const card = draw(st.shoe, shoeCfg(st.rules), st.rng, onShuffle(ctx));
  return { cid: ++st.cidSeq, card };
}

function dealTo(ctx: Ctx, seat: BJSeat, hand: number) {
  const h = seat.hands[hand]!;
  const dc = drawCard(ctx);
  h.cards.push(dc);
  const to: BJTarget = { t: 'hand', seat: seat.id, hand, slot: h.cards.length - 1 };
  emit(ctx, { e: 'CardDealt', cid: dc.cid, to, card: dc.card, faceUp: true });
}

function dealDealer(ctx: Ctx, faceUp: boolean) {
  const { st } = ctx;
  const dc = drawCard(ctx);
  st.dealer.cards.push(dc);
  const to: BJTarget = { t: 'dealer', slot: st.dealer.cards.length - 1 };
  emit(ctx, { e: 'CardDealt', cid: dc.cid, to, card: faceUp ? dc.card : null, faceUp });
}

function handEvent(ctx: Ctx, seat: BJSeat, i: number) {
  const h = seat.hands[i]!;
  emit(ctx, { e: 'HandState', seat: seat.id, hand: i, state: h.state, outcome: h.outcome, doubled: h.doubled });
}

function setPhase(ctx: Ctx, phase: BJState['phase'], deadline: number | null) {
  const { st } = ctx;
  st.phase = phase;
  st.phaseDeadline = deadline;
  if (phase !== 'play') {
    st.turn = null;
    st.cursor = null;
  }
  for (const s of st.seats) s.deadline = null;
  emit(ctx, { e: 'Phase', phase, deadline, paused: st.paused });
}

function setStatus(ctx: Ctx, seat: BJSeat, status: BJSeat['status']) {
  seat.status = status;
  emit(ctx, { e: 'SeatStatus', seat: seat.id, status, away: seat.away, autoBet: seat.autoBet });
}

function canRebuy(st: BJState, seat: BJSeat): boolean {
  const r = st.rules.rebuy;
  if (r.mode !== 'whenBroke') return false;
  if (r.max != null && seat.rebuys >= r.max) return false;
  return seat.stack < minBet(st.rules) && seat.status !== 'leaving';
}

function doRebuy(ctx: Ctx, seat: BJSeat) {
  seat.rebuys++;
  mv(ctx, CASHIER, stackAcc(seat.id), ctx.st.rules.startingBankroll, 'rebuy');
}

function removeSeat(ctx: Ctx, seat: BJSeat) {
  const { st } = ctx;
  for (let i = 0; i < seat.hands.length; i++) {
    const h = seat.hands[i]!;
    if (h.bet > 0) mv(ctx, betAcc(seat.id, i), stackAcc(seat.id), h.bet, 'refund');
  }
  if (seat.insurance > 0) mv(ctx, { k: 'ins', seat: seat.id }, stackAcc(seat.id), seat.insurance, 'refund');
  if (seat.stack > 0) mv(ctx, stackAcc(seat.id), CASHIER, seat.stack, 'cashOut');
  st.shoe.discards.push(...seat.hands.flatMap((h) => h.cards.map((c) => c.card)));
  st.seats.splice(st.seats.indexOf(seat), 1);
  if (st.cursor === seat.id) st.cursor = null;
  emit(ctx, { e: 'SeatLeft', seat: seat.id });
}

// ───────────────────────── phases ─────────────────────────

function openBetting(ctx: Ctx) {
  const { st } = ctx;
  st.round++;
  emit(ctx, { e: 'RoundStarted', round: st.round });
  for (const s of st.seats) {
    s.hands = [];
    s.cur = 0;
    s.insurance = 0;
    s.insDecided = false;
    s.decided = false;
    s.deadline = null;
    s.splitBonuses = 0;
    s.timedOut = false;
    if (s.status === 'pending') setStatus(ctx, s, 'active');
  }
  const active = st.seats.filter((s) => s.status === 'active');
  if (active.length === 0) {
    setPhase(ctx, 'idle', null);
    return;
  }
  setPhase(ctx, 'betting', deadlineIn(ctx, st.rules.timers.betMs));
  emit(ctx, { e: 'Announce', key: 'bj.placeBets' });
  if (st.rules.betting.mode === 'fixed') {
    for (const s of active) if (s.autoBet && !s.away && s.stack >= st.rules.betting.stake) placeBet(ctx, s, st.rules.betting.stake);
  }
}

function placeBet(ctx: Ctx, seat: BJSeat, amount: Money) {
  if (seat.hands.length === 0) seat.hands = [newHand()];
  mv(ctx, stackAcc(seat.id), betAcc(seat.id, 0), amount, 'bet');
  seat.lastBet = amount;
  seat.decided = true;
  seat.dId++;
  emit(ctx, { e: 'Decided', seat: seat.id, decided: true });
}

function clearBet(ctx: Ctx, seat: BJSeat) {
  const h = seat.hands[0];
  if (h && h.bet > 0) mv(ctx, betAcc(seat.id, 0), stackAcc(seat.id), h.bet, 'refund');
  seat.hands = [];
  seat.decided = false;
  seat.dId++;
  emit(ctx, { e: 'Decided', seat: seat.id, decided: false });
}

function closeBetting(ctx: Ctx) {
  const { st } = ctx;
  const players = st.seats.filter((s) => s.status !== 'pending' && hasBet(s));
  if (players.length === 0) {
    if (st.rules.timers.betMs != null) {
      for (const s of st.seats) if (s.decided) {
        s.decided = false;
        emit(ctx, { e: 'Decided', seat: s.id, decided: false });
      }
      setPhase(ctx, 'betting', deadlineIn(ctx, st.rules.timers.betMs));
    }
    return;
  }
  emit(ctx, { e: 'Announce', key: 'bj.noMoreBets' });
  deal(ctx, players);
}

function deal(ctx: Ctx, players: BJSeat[]) {
  const { st } = ctx;
  const budget = 6 * (players.length + 1);
  if (ctx.entropy) rekey(st.rng, ctx.entropy);
  preRoundCheck(st.shoe, budget, shoeCfg(st.rules), st.rng, onShuffle(ctx));
  st.dealer = { cards: [], holeUp: false };
  for (let pass = 0; pass < 2; pass++) {
    for (const s of players) dealTo(ctx, s, 0);
    dealDealer(ctx, pass === 0);
  }
  const up = st.dealer.cards[0]!.card;
  if (isAce(up) && st.rules.insurance) openInsurance(ctx, players);
  else resolvePeek(ctx);
}

function openInsurance(ctx: Ctx, players: BJSeat[]) {
  const { st } = ctx;
  const undecided: SeatId[] = [];
  for (const s of players) {
    if (s.bot || s.status === 'leaving') continue; // bots never insure
    const h = s.hands[0]!;
    const natural = isNatural(h.cards.map((c) => c.card), false);
    if (natural ? st.rules.evenMoney : s.stack >= h.bet / 2) undecided.push(s.id);
  }
  if (undecided.length === 0) {
    resolvePeek(ctx);
    return;
  }
  for (const s of st.seats) {
    s.insDecided = !undecided.includes(s.id);
    if (!s.insDecided) s.dId++;
  }
  const deadline = deadlineIn(ctx, st.rules.timers.insuranceMs);
  setPhase(ctx, 'insurance', deadline);
  emit(ctx, { e: 'InsuranceOffered', deadline, seats: undecided });
  emit(ctx, { e: 'Announce', key: 'bj.insurance' });
}

function flipHole(ctx: Ctx) {
  const { st } = ctx;
  if (st.dealer.holeUp) return;
  st.dealer.holeUp = true;
  const hole = st.dealer.cards[1]!;
  emit(ctx, { e: 'CardFlipped', cid: hole.cid, at: { t: 'dealer', slot: 1 }, card: hole.card });
}

function settleHand(ctx: Ctx, seat: BJSeat, i: number, outcome: 'win' | 'push' | 'lose') {
  const h = seat.hands[i]!;
  const stake = h.bet;
  let net = 0;
  if (outcome === 'win') {
    net = stake;
    mv(ctx, HOUSE, betAcc(seat.id, i), stake, 'win');
    mv(ctx, betAcc(seat.id, i), stackAcc(seat.id), stake * 2, 'win');
  } else if (outcome === 'push') {
    mv(ctx, betAcc(seat.id, i), stackAcc(seat.id), h.bet, 'push');
  } else {
    net = -h.bet;
    mv(ctx, betAcc(seat.id, i), HOUSE, h.bet, 'lose');
  }
  h.outcome = outcome;
  emit(ctx, { e: 'HandState', seat: seat.id, hand: i, state: h.state, outcome, doubled: h.doubled });
  emit(ctx, { e: 'HandResult', seat: seat.id, hand: i, outcome, net });
}

function resolvePeek(ctx: Ctx) {
  const { st } = ctx;
  const up = st.dealer.cards[0]!.card;
  const hole = st.dealer.cards[1]!.card;
  const players = st.seats.filter(inRound);
  if (isAce(up) || isTenValue(up)) {
    const dealerBJ = handValue([up, hole]).total === 21;
    emit(ctx, { e: 'DealerPeeked', blackjack: dealerBJ });
    if (dealerBJ) {
      flipHole(ctx);
      emit(ctx, { e: 'DealerTotal', total: 21, soft: true, bust: false });
      emit(ctx, { e: 'Announce', key: 'bj.dealerBlackjack' });
      for (const s of players) {
        if (s.insurance > 0) {
          const ins = s.insurance;
          mv(ctx, HOUSE, { k: 'ins', seat: s.id }, ins * 2, 'insurance');
          mv(ctx, { k: 'ins', seat: s.id }, stackAcc(s.id), ins * 3, 'insurance');
        }
        const h = s.hands[0]!;
        if (h.state === 'done') continue; // even money already paid
        const natural = isNatural(h.cards.map((c) => c.card), false);
        h.state = 'stand';
        settleHand(ctx, s, 0, natural ? 'push' : 'lose');
      }
      toResults(ctx);
      return;
    }
    if (isAce(up)) emit(ctx, { e: 'Announce', key: 'bj.noDealerBlackjack' });
    for (const s of players) if (s.insurance > 0) mv(ctx, { k: 'ins', seat: s.id }, HOUSE, s.insurance, 'lose');
  }
  // Naturals are paid at once.
  for (const s of players) {
    const h = s.hands[0]!;
    if (h.state !== 'play' || !isNatural(h.cards.map((c) => c.card), h.split)) continue;
    const win = payout(h.bet, st.rules.blackjackPays);
    const stake = h.bet;
    mv(ctx, HOUSE, betAcc(s.id, 0), win, 'blackjack');
    mv(ctx, betAcc(s.id, 0), stackAcc(s.id), stake + win, 'blackjack');
    h.state = 'bj';
    h.outcome = 'blackjack';
    handEvent(ctx, s, 0);
    emit(ctx, { e: 'HandResult', seat: s.id, hand: 0, outcome: 'blackjack', net: win });
  }
  startPlay(ctx);
}

function startPlay(ctx: Ctx) {
  const { st } = ctx;
  setPhase(ctx, 'play', null);
  for (const s of st.seats) s.cur = 0;
  if (st.rules.decisionMode === 'sequential') {
    nextTurn(ctx);
    return;
  }
  const live = st.seats.filter(seatLive);
  if (live.length === 0) {
    dealerPlay(ctx);
    return;
  }
  const deadline = deadlineIn(ctx, st.rules.timers.decisionMs);
  for (const s of live) {
    s.deadline = deadline;
    s.dId++;
  }
  st.turn = { seats: live.map((s) => s.id), hand: null };
  emit(ctx, { e: 'TurnStarted', seats: st.turn.seats, hand: null, deadline });
}

function startTurn(ctx: Ctx, seat: BJSeat) {
  const { st } = ctx;
  const deadline = deadlineIn(ctx, st.rules.timers.decisionMs);
  for (const s of st.seats) s.deadline = null;
  seat.deadline = deadline;
  seat.dId++;
  st.cursor = seat.id;
  st.turn = { seats: [seat.id], hand: seat.cur };
  emit(ctx, { e: 'TurnStarted', seats: [seat.id], hand: seat.cur, deadline });
}

/** Sequential mode: move the cursor to the next seat (in seat order) that still has a live hand. */
function nextTurn(ctx: Ctx) {
  const { st } = ctx;
  for (const s of st.seats) {
    if (!seatLive(s)) continue;
    const r = advanceSeat(ctx, s);
    if (r === 'live') {
      startTurn(ctx, s);
      return;
    }
  }
  st.cursor = null;
  dealerPlay(ctx);
}

/** Moves seat.cur past finished hands, dealing to split hands as they are reached. */
function advanceSeat(ctx: Ctx, seat: BJSeat): 'live' | 'done' {
  while (seat.cur < seat.hands.length) {
    const h = seat.hands[seat.cur]!;
    if (h.state === 'waitCard') {
      dealTo(ctx, seat, seat.cur);
      h.state = handValue(h.cards.map((c) => c.card)).total === 21 ? 'stand' : 'play';
      handEvent(ctx, seat, seat.cur);
    }
    if (h.state === 'play') return 'live';
    seat.cur++;
  }
  return 'done';
}

function afterSeatAction(ctx: Ctx, seat: BJSeat) {
  const { st } = ctx;
  const before = seat.cur;
  const r = advanceSeat(ctx, seat);
  if (st.rules.decisionMode === 'sequential') {
    if (r === 'live') {
      if (seat.cur !== before) startTurn(ctx, seat);
    } else nextTurn(ctx);
    return;
  }
  if (r === 'done' && seat.deadline != null) {
    seat.deadline = null;
    emit(ctx, { e: 'SeatDeadline', seat: seat.id, deadline: null });
  }
  if (!st.seats.some(seatLive)) dealerPlay(ctx);
}

function bustCheck(ctx: Ctx, seat: BJSeat, i: number, standAfter: boolean) {
  const h = seat.hands[i]!;
  const { total } = handValue(h.cards.map((c) => c.card));
  if (total > 21) {
    h.state = 'bust';
    h.outcome = 'bust';
    mv(ctx, betAcc(seat.id, i), HOUSE, h.bet, 'lose');
    handEvent(ctx, seat, i);
    emit(ctx, { e: 'HandResult', seat: seat.id, hand: i, outcome: 'bust', net: -h.bet });
  } else if (total === 21 || standAfter) {
    h.state = 'stand';
    handEvent(ctx, seat, i);
  }
}

/** Timeout or leave: every unfinished hand receives its pending card and stands. */
function standAll(ctx: Ctx, seat: BJSeat) {
  for (let i = seat.cur; i < seat.hands.length; i++) {
    const h = seat.hands[i]!;
    if (h.state === 'waitCard') {
      dealTo(ctx, seat, i);
      h.state = 'play';
    }
    if (h.state === 'play') {
      h.state = 'stand';
      handEvent(ctx, seat, i);
    }
  }
  seat.cur = seat.hands.length;
}

function dealerPlay(ctx: Ctx) {
  const { st } = ctx;
  st.cursor = null;
  st.turn = null;
  flipHole(ctx);
  const live = st.seats.some((s) => s.hands.some((h) => h.state === 'stand' && h.outcome == null));
  if (live) {
    for (;;) {
      const v = handValue(st.dealer.cards.map((c) => c.card));
      if (v.total >= 17) break; // S17: stands on all 17s
      dealDealer(ctx, true);
    }
  }
  const dv = handValue(st.dealer.cards.map((c) => c.card));
  emit(ctx, { e: 'DealerTotal', total: dv.total, soft: dv.soft, bust: dv.total > 21 });
  if (live) {
    if (dv.total > 21) emit(ctx, { e: 'Announce', key: 'bj.dealerBusts' });
    else emit(ctx, { e: 'Announce', key: 'bj.dealerHas', params: { total: dv.total } });
  }
  for (const s of st.seats) {
    for (let i = 0; i < s.hands.length; i++) {
      const h = s.hands[i]!;
      if (h.state !== 'stand' || h.outcome != null) continue;
      const pt = handValue(h.cards.map((c) => c.card)).total;
      settleHand(ctx, s, i, dv.total > 21 || pt > dv.total ? 'win' : pt === dv.total ? 'push' : 'lose');
    }
  }
  toResults(ctx);
}

function toResults(ctx: Ctx) {
  setPhase(ctx, 'results', deadlineIn(ctx, ctx.st.rules.timers.resultsMs));
}

function cleanup(ctx: Ctx) {
  const { st } = ctx;
  const cards: number[] = [];
  for (const s of st.seats) for (const h of s.hands) for (const c of h.cards) cards.push(c.card);
  for (const c of st.dealer.cards) cards.push(c.card);
  st.shoe.discards.push(...cards);
  for (const s of st.seats) s.hands = [];
  st.dealer = { cards: [], holeUp: false };
  emit(ctx, { e: 'CardsCollected', discards: st.shoe.discards.length });
  for (const s of [...st.seats]) {
    if (s.status === 'leaving') {
      removeSeat(ctx, s);
      continue;
    }
    if (s.timedOut) s.misses++;
    else if (s.decided) s.misses = 0;
    if (st.rules.autoSitOutAfterMisses > 0 && s.misses >= st.rules.autoSitOutAfterMisses) {
      s.misses = 0;
      s.autoBet = false;
      setStatus(ctx, s, 'sittingOut');
    }
    if (s.bot && st.rules.botsAutoRebuy && s.stack < minBet(st.rules)) doRebuy(ctx, s);
  }
  if (st.paused) setPhase(ctx, 'idle', null);
  else openBetting(ctx);
}

/** Drive automatic transitions after any accepted action. */
function progress(ctx: Ctx) {
  const { st } = ctx;
  for (let guard = 0; guard < 8; guard++) {
    if (st.phase === 'betting') {
      const active = st.seats.filter((s) => s.status === 'active');
      if (active.length === 0) {
        setPhase(ctx, 'idle', null);
        continue;
      }
      if (st.rules.betting.mode === 'fixed' && active.every((s) => s.decided) && active.some(hasBet)) {
        closeBetting(ctx);
        continue;
      }
    } else if (st.phase === 'insurance') {
      if (st.seats.every((s) => s.insDecided)) {
        resolvePeek(ctx);
        continue;
      }
    } else if (st.phase === 'play') {
      if (st.rules.decisionMode === 'sequential') {
        const cur = st.cursor == null ? null : st.seats.find((s) => s.id === st.cursor);
        if (!cur || !seatLive(cur)) {
          nextTurn(ctx);
          continue;
        }
      } else if (!st.seats.some(seatLive)) {
        dealerPlay(ctx);
        continue;
      }
    } else if (st.phase === 'idle' && !st.paused && st.seats.some((s) => s.status === 'active' || s.status === 'pending')) {
      openBetting(ctx);
      continue;
    }
    break;
  }
}

// ───────────────────────── actions ─────────────────────────

function isTurn(st: BJState, seat: BJSeat): boolean {
  if (st.phase !== 'play') return false;
  if (st.rules.decisionMode === 'sequential') return st.cursor === seat.id && seatLive(seat);
  return seatLive(seat) && seat.status !== 'pending';
}

function handle(ctx: Ctx, a: BJAction) {
  const { st } = ctx;
  const r = st.rules;
  switch (a.type) {
    case 'SIT': {
      if (r.maxSeats > 0 && st.seats.length >= r.maxSeats) throw new Reject('TABLE_FULL');
      if (st.seats.some((s) => s.player === a.player)) throw new Reject('ALREADY_SEATED');
      const bankroll = a.bankroll ?? r.startingBankroll;
      if (!Number.isSafeInteger(bankroll) || bankroll < 0) throw new Reject('BAD_AMOUNT');
      const seat: BJSeat = {
        id: st.nextSeatId++,
        order: st.nextOrder++,
        player: a.player,
        name: a.name,
        bot: a.bot ?? null,
        status: st.phase === 'idle' || st.phase === 'betting' ? 'active' : 'pending',
        away: false,
        autoBet: a.autoBet ?? false,
        stack: 0,
        decided: false,
        lastBet: 0,
        hands: [],
        cur: 0,
        insurance: 0,
        insDecided: false,
        deadline: null,
        splitBonuses: 0,
        timedOut: false,
        misses: 0,
        rebuys: 0,
        dId: 0,
      };
      st.seats.push(seat);
      emit(ctx, { e: 'SeatJoined', seat: seatView(seat) });
      if (bankroll > 0) mv(ctx, CASHIER, stackAcc(seat.id), bankroll, 'buyIn');
      if (st.phase === 'betting' && r.betting.mode === 'fixed' && seat.autoBet && seat.stack >= r.betting.stake) {
        placeBet(ctx, seat, r.betting.stake);
      }
      return;
    }
    case 'LEAVE': {
      const seat = requireSeat(st, a.seat);
      const playing = seat.hands.some((h) => h.cards.length > 0);
      if (!playing || st.phase === 'idle' || st.phase === 'betting') {
        removeSeat(ctx, seat);
        return;
      }
      setStatus(ctx, seat, 'leaving');
      if (st.phase === 'insurance' && !seat.insDecided) {
        seat.insDecided = true;
        emit(ctx, { e: 'InsuranceDecided', seat: seat.id, take: false });
      } else if (st.phase === 'play' && seatLive(seat)) {
        standAll(ctx, seat);
        afterSeatAction(ctx, seat);
      }
      return;
    }
    case 'SIT_OUT': {
      const seat = requireSeat(st, a.seat);
      if (seat.status === 'leaving' || seat.status === 'sittingOut') throw new Reject('ILLEGAL_ACTION');
      if (st.phase === 'betting' && seat.hands.length > 0) clearBet(ctx, seat);
      seat.autoBet = false;
      setStatus(ctx, seat, 'sittingOut');
      return;
    }
    case 'SIT_IN': {
      const seat = requireSeat(st, a.seat);
      if (seat.status !== 'sittingOut') throw new Reject('ILLEGAL_ACTION');
      seat.misses = 0;
      seat.dId++;
      setStatus(ctx, seat, st.phase === 'idle' || st.phase === 'betting' ? 'active' : 'pending');
      return;
    }
    case 'SET_AUTOBET': {
      const seat = requireSeat(st, a.seat);
      seat.autoBet = a.value;
      emit(ctx, { e: 'SeatStatus', seat: seat.id, status: seat.status, away: seat.away, autoBet: seat.autoBet });
      if (a.value && st.phase === 'betting' && r.betting.mode === 'fixed' && seat.status === 'active' && !seat.decided && seat.stack >= r.betting.stake) {
        placeBet(ctx, seat, r.betting.stake);
      }
      return;
    }
    case 'SET_AWAY': {
      const seat = requireSeat(st, a.seat);
      seat.away = a.away;
      emit(ctx, { e: 'SeatStatus', seat: seat.id, status: seat.status, away: seat.away, autoBet: seat.autoBet });
      return;
    }
    case 'REBUY': {
      const seat = requireSeat(st, a.seat);
      if (!canRebuy(st, seat) || seat.hands.some((h) => h.bet > 0 || h.cards.length > 0)) throw new Reject('ILLEGAL_ACTION');
      doRebuy(ctx, seat);
      seat.dId++;
      return;
    }
    case 'BET': {
      const seat = requireSeat(st, a.seat);
      checkDid(seat, a);
      if (st.phase !== 'betting') throw new Reject('BAD_PHASE');
      if (seat.status !== 'active') throw new Reject('ILLEGAL_ACTION', 'not active');
      const current = seat.hands[0]?.bet ?? 0;
      if (r.betting.mode === 'fixed') {
        if (seat.decided && current > 0) throw new Reject('ILLEGAL_ACTION', 'already bet');
        if (seat.stack < r.betting.stake) throw new Reject('INSUFFICIENT_FUNDS');
        placeBet(ctx, seat, r.betting.stake);
        return;
      }
      const { min, max, unit } = r.betting;
      if (!Number.isSafeInteger(a.amount) || a.amount < min || a.amount > max || a.amount % unit !== 0) throw new Reject('BAD_AMOUNT');
      if (a.amount > seat.stack + current) throw new Reject('INSUFFICIENT_FUNDS');
      if (current > 0) clearBet(ctx, seat);
      placeBet(ctx, seat, a.amount);
      return;
    }
    case 'CLEAR_BET': {
      const seat = requireSeat(st, a.seat);
      if (st.phase !== 'betting') throw new Reject('BAD_PHASE');
      if (seat.hands.length === 0 && !seat.decided) throw new Reject('ILLEGAL_ACTION');
      clearBet(ctx, seat);
      return;
    }
    case 'PASS': {
      const seat = requireSeat(st, a.seat);
      if (st.phase !== 'betting') throw new Reject('BAD_PHASE');
      if (seat.status !== 'active') throw new Reject('ILLEGAL_ACTION');
      if (seat.hands.length > 0) clearBet(ctx, seat);
      seat.decided = true;
      seat.dId++;
      emit(ctx, { e: 'Decided', seat: seat.id, decided: true });
      return;
    }
    case 'DEAL': {
      const seat = requireSeat(st, a.seat);
      if (st.phase !== 'betting') throw new Reject('BAD_PHASE');
      if (r.betting.mode === 'fixed') throw new Reject('ILLEGAL_ACTION', 'fixed-stake tables deal on the timer');
      if (seat.status !== 'active' && seat.status !== 'sittingOut') throw new Reject('ILLEGAL_ACTION');
      if (!st.seats.some(hasBet)) throw new Reject('ILLEGAL_ACTION', 'no bets on the table');
      closeBetting(ctx);
      return;
    }
    case 'INSURANCE': {
      const seat = requireSeat(st, a.seat);
      checkDid(seat, a);
      if (st.phase !== 'insurance') throw new Reject('BAD_PHASE');
      if (seat.insDecided) throw new Reject('ILLEGAL_ACTION');
      const h = seat.hands[0]!;
      const natural = isNatural(h.cards.map((c) => c.card), false);
      if (a.take) {
        if (natural) {
          const stake = h.bet;
          mv(ctx, HOUSE, betAcc(seat.id, 0), stake, 'evenMoney');
          mv(ctx, betAcc(seat.id, 0), stackAcc(seat.id), stake * 2, 'evenMoney');
          h.state = 'done';
          h.outcome = 'evenMoney';
          handEvent(ctx, seat, 0);
          emit(ctx, { e: 'HandResult', seat: seat.id, hand: 0, outcome: 'evenMoney', net: stake });
        } else {
          const cost = h.bet / 2;
          if (seat.stack < cost) throw new Reject('INSUFFICIENT_FUNDS');
          mv(ctx, stackAcc(seat.id), { k: 'ins', seat: seat.id }, cost, 'insurance');
        }
      }
      seat.insDecided = true;
      seat.dId++;
      emit(ctx, { e: 'InsuranceDecided', seat: seat.id, take: a.take });
      return;
    }
    case 'HIT':
    case 'STAND':
    case 'DOUBLE':
    case 'SPLIT': {
      const seat = requireSeat(st, a.seat);
      checkDid(seat, a);
      if (st.phase !== 'play') throw new Reject('BAD_PHASE');
      if (!isTurn(st, seat)) throw new Reject('NOT_YOUR_TURN');
      const i = seat.cur;
      const h = seat.hands[i]!;
      const cards = h.cards.map((c) => c.card);
      const total = handValue(cards).total;
      if (a.type === 'HIT') {
        if (h.splitAces || total >= 21) throw new Reject('ILLEGAL_ACTION');
        dealTo(ctx, seat, i);
        bustCheck(ctx, seat, i, false);
      } else if (a.type === 'STAND') {
        h.state = 'stand';
        handEvent(ctx, seat, i);
      } else if (a.type === 'DOUBLE') {
        if (!canDouble(r, seat, h)) throw new Reject('ILLEGAL_ACTION');
        mv(ctx, stackAcc(seat.id), betAcc(seat.id, i), h.bet, 'double');
        h.doubled = true;
        dealTo(ctx, seat, i);
        bustCheck(ctx, seat, i, true);
      } else {
        if (!canSplit(r, seat, h)) throw new Reject('ILLEGAL_ACTION');
        const moved = h.cards.pop()!;
        const aces = isAce(moved.card);
        h.split = true;
        h.splitAces = aces;
        const nh: BJHand = { cards: [moved], bet: 0, doubled: false, split: true, splitAces: aces, state: 'waitCard', outcome: null };
        seat.hands.splice(i + 1, 0, nh);
        emit(ctx, { e: 'HandSplit', seat: seat.id, from: i, to: i + 1, cid: moved.cid, card: moved.card, splitAces: aces });
        mv(ctx, stackAcc(seat.id), betAcc(seat.id, i + 1), h.bet, 'split');
        dealTo(ctx, seat, i);
        if (aces) {
          dealTo(ctx, seat, i + 1);
          h.state = 'stand';
          nh.state = 'stand';
          handEvent(ctx, seat, i);
          handEvent(ctx, seat, i + 1);
        } else if (handValue(h.cards.map((c) => c.card)).total === 21) {
          h.state = 'stand';
          handEvent(ctx, seat, i);
        }
        if (r.decisionMode === 'simultaneous' && seat.deadline != null && seat.splitBonuses < r.timers.maxSplitBonuses) {
          seat.splitBonuses++;
          seat.deadline += r.timers.splitBonusMs;
          emit(ctx, { e: 'SeatDeadline', seat: seat.id, deadline: seat.deadline });
        }
      }
      seat.dId++;
      afterSeatAction(ctx, seat);
      return;
    }
    case 'PAUSE': {
      st.paused = a.value;
      emit(ctx, { e: 'Paused', paused: a.value });
      emit(ctx, { e: 'Announce', key: a.value ? 'table.paused' : 'table.resumed' });
      if (a.value && (st.phase === 'idle' || (st.phase === 'betting' && !st.seats.some(hasBet)))) {
        for (const s of st.seats) if (s.decided) {
          s.decided = false;
          emit(ctx, { e: 'Decided', seat: s.id, decided: false });
        }
        setPhase(ctx, 'idle', null);
      } else if (!a.value && st.phase === 'idle') {
        emit(ctx, { e: 'Phase', phase: 'idle', deadline: null, paused: false });
      }
      return;
    }
    case 'ABORT': {
      for (const s of st.seats) {
        for (let i = 0; i < s.hands.length; i++) {
          const h = s.hands[i]!;
          if (h.bet > 0 && h.outcome == null) mv(ctx, betAcc(s.id, i), stackAcc(s.id), h.bet, 'refund');
        }
        if (s.insurance > 0) mv(ctx, { k: 'ins', seat: s.id }, stackAcc(s.id), s.insurance, 'refund');
      }
      const cards: number[] = [];
      for (const s of st.seats) for (const h of s.hands) for (const c of h.cards) cards.push(c.card);
      for (const c of st.dealer.cards) cards.push(c.card);
      st.shoe.discards.push(...cards);
      for (const s of st.seats) s.hands = [];
      st.dealer = { cards: [], holeUp: false };
      emit(ctx, { e: 'CardsCollected', discards: st.shoe.discards.length });
      st.paused = true;
      emit(ctx, { e: 'Paused', paused: true });
      setPhase(ctx, 'idle', null);
      return;
    }
    case 'TIMEOUT': {
      const at = ctx.at;
      if (st.phase === 'betting' && st.phaseDeadline != null && at >= st.phaseDeadline) closeBetting(ctx);
      else if (st.phase === 'insurance' && st.phaseDeadline != null && at >= st.phaseDeadline) {
        for (const s of st.seats) if (!s.insDecided) {
          s.insDecided = true;
          emit(ctx, { e: 'InsuranceDecided', seat: s.id, take: false });
        }
      } else if (st.phase === 'play') {
        const due = st.seats.filter((s) => s.deadline != null && at >= s.deadline && seatLive(s) && isTurn(st, s));
        for (const s of due) {
          s.timedOut = true;
          s.dId++;
          standAll(ctx, s);
          afterSeatAction(ctx, s);
          if (st.phase !== 'play') break;
        }
      } else if (st.phase === 'results' && st.phaseDeadline != null && at >= st.phaseDeadline) cleanup(ctx);
      return;
    }
  }
}

export function canDouble(r: BlackjackRules, seat: BJSeat, h: BJHand): boolean {
  return h.state === 'play' && h.cards.length === 2 && !h.splitAces && (!h.split || r.doubleAfterSplit) && seat.stack >= h.bet;
}

export function canSplit(r: BlackjackRules, seat: BJSeat, h: BJHand): boolean {
  if (h.state !== 'play' || h.cards.length !== 2) return false;
  const [a, b] = [h.cards[0]!.card, h.cards[1]!.card];
  if (bjValue(a) !== bjValue(b)) return false;
  if (seat.hands.length >= r.maxHands) return false;
  if (isAce(a) && h.splitAces && !r.resplitAces) return false;
  return seat.stack >= h.bet;
}

export function createBlackjack(rules: BlackjackRules, seed: Seed, at: number): BJState {
  return {
    v: 1,
    game: 'blackjack',
    rules,
    phase: 'idle',
    paused: false,
    round: 0,
    cidSeq: 0,
    lastAt: at,
    seats: [],
    nextSeatId: 1,
    nextOrder: 1,
    dealer: { cards: [], holeUp: false },
    shoe: emptyShoe(),
    rng: createRng(seed),
    house: 0,
    cashier: 0,
    phaseDeadline: null,
    cursor: null,
    turn: null,
  };
}

export function applyBlackjack(s: BJState, a: BJAction, opts?: { inPlace?: boolean }): ApplyResult<BJState, BJEvent> {
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
