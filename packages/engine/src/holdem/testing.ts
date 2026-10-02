/** Hold'em test helpers: rigged decks, preset positions, a reference evaluator and invariant checks. */
import { fullDeck, parseCards, rankOf, suitOf, type Card } from '../core/cards';
import { createRng } from '../core/chacha';
import { shuffle } from '../core/shuffle';
import type { SeatId } from '../core/types';
import { isStreet, occupied } from './betting';
import { isCandidate } from './positions';
import type { HState } from './types';
import { legalHoldem } from './view';

/**
 * Makes the next hand use a full deck whose top cards are `top` (e.g. "As Kd 9c"), drawn in that order:
 * hole cards one at a time clockwise from the seat left of the button (two rounds), then burn, flop ×3,
 * burn, turn, burn, river. Call it before the action that starts the hand.
 */
export function rigDeck(st: HState, top: string | Card[]): HState {
  const rigged = typeof top === 'string' ? parseCards(top) : top;
  if (new Set(rigged).size !== rigged.length) throw new Error('rigDeck: duplicate cards');
  const rest = shuffle(fullDeck().filter((c) => !rigged.includes(c)), createRng([9, 9, 9, 9, 9, 9, 9, 9]));
  st.deck = [...rest, ...rigged.slice().reverse()];
  return st;
}

/**
 * Presets positions so the next hand (all candidates dealt in, no entrants) has `button` on the button:
 * the BB advances from the previous BB, so we set the "previous hand" one step back.
 */
export function presetButton(st: HState, button: SeatId): HState {
  const n = st.seats.length;
  const order: SeatId[] = [];
  for (let k = 0; k < n; k++) {
    const s = st.seats[(button + k) % n];
    if (s && isCandidate(s)) order.push(s.id);
  }
  if (order[0] !== button || order.length < 2) throw new Error('presetButton: button must be a candidate with an opponent');
  st.freshPositions = false;
  st.sbPos = button;
  st.bbPos = order.length === 2 ? button : order[1]!;
  return st;
}

/**
 * Presets the button and rigs the deck from per-seat hole cards and a board, assuming every candidate
 * is dealt in.
 */
export function rigHand(st: HState, opts: { button: SeatId; holes?: Record<number, string>; board?: string }): HState {
  presetButton(st, opts.button);
  const n = st.seats.length;
  const dealt: SeatId[] = [];
  for (let k = 1; k <= n; k++) {
    const s = st.seats[(opts.button + k) % n];
    if (s && isCandidate(s)) dealt.push(s.id);
  }
  const given = opts.holes ?? {};
  const holes = new Map(dealt.map((id) => [id, given[id] ? parseCards(given[id]!) : null]));
  const used = new Set<Card>([...[...holes.values()].flatMap((h) => h ?? []), ...(opts.board ? parseCards(opts.board) : [])]);
  const spare = shuffle(fullDeck().filter((c) => !used.has(c)), createRng([7, 7, 7, 7, 7, 7, 7, 7]));
  const take = () => spare.pop()!;
  for (const id of dealt) if (!holes.get(id)) holes.set(id, [take(), take()]);
  const seq: Card[] = [];
  for (let slot = 0; slot < 2; slot++) for (const id of dealt) seq.push(holes.get(id)![slot]!);
  const board = opts.board ? parseCards(opts.board) : [];
  while (board.length < 5) board.push(take());
  seq.push(take(), board[0]!, board[1]!, board[2]!, take(), board[3]!, take(), board[4]!);
  return rigDeck(st, seq);
}

/** Brute-force 5-card evaluator, same encoding as eval7 (tests only). */
export function refEval5(cards: readonly Card[]): number {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const uniq = [...new Set(ranks)];
  let straightTop = 0;
  if (uniq.length === 5) {
    if (ranks[0]! - ranks[4]! === 4) straightTop = ranks[0]!;
    else if (ranks.join() === '14,5,4,3,2') straightTop = 5;
  }
  const groups = uniq.map((r) => ({ r, n: ranks.filter((x) => x === r).length })).sort((a, b) => b.n - a.n || b.r - a.r);
  const pack = (cat: number, rs: number[]) => rs.reduce((v, r, i) => v | (r << (16 - 4 * i)), cat << 20);
  const g = groups.map((x) => x.r);
  if (straightTop && flush) return pack(8, [straightTop]);
  if (groups[0]!.n === 4) return pack(7, g);
  if (groups[0]!.n === 3 && groups[1]!.n === 2) return pack(6, g);
  if (flush) return pack(5, ranks);
  if (straightTop) return pack(4, [straightTop]);
  if (groups[0]!.n === 3) return pack(3, g);
  if (groups[0]!.n === 2 && groups[1]!.n === 2) return pack(2, g);
  if (groups[0]!.n === 2) return pack(1, g);
  return pack(0, ranks);
}

/** Max of refEval5 over all 5-card subsets. */
export function refEval7(cards: readonly Card[]): number {
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) best = Math.max(best, refEval5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]));
  return best;
}

export function heMoneySum(st: HState): number {
  let sum = st.cashier + st.pot;
  for (const s of occupied(st)) sum += s.stack + s.street;
  return sum;
}

/** Throws if chips or cards are not conserved or the table is in an impossible state. */
export function checkHoldemInvariants(st: HState): void {
  const sum = heMoneySum(st);
  if (sum !== 0) throw new Error(`money not conserved: Σ = ${sum}`);
  const ints = [st.pot, st.currentBet, st.lastRaise, ...st.pots.map((p) => p.amount)];
  for (const s of occupied(st)) ints.push(s.stack, s.street, s.committed);
  for (const x of ints) if (!Number.isSafeInteger(x) || x < 0) throw new Error(`bad amount ${x}`);
  if (st.seats.length !== st.rules.maxSeats) throw new Error('seat array resized');
  st.seats.forEach((s, i) => {
    if (s && s.id !== i) throw new Error(`seat ${i} has id ${s.id}`);
  });
  const players = occupied(st).map((s) => s.player);
  if (new Set(players).size !== players.length) throw new Error('player seated twice');
  if (st.phase === 'waiting') {
    if (st.deck.length && st.deck.length !== 52) throw new Error('cards left between hands');
    if (occupied(st).some((s) => s.inHand || s.hole.length || s.street || s.committed) || st.pot) throw new Error('hand state left between hands');
    return;
  }
  const cards = [...st.deck, ...st.burns.map((c) => c.card), ...st.board.map((c) => c.card), ...st.muck];
  for (const s of occupied(st)) cards.push(...s.hole.map((c) => c.card));
  if (cards.length !== 52 || new Set(cards).size !== 52 || cards.some((c) => c < 0 || c > 51)) {
    throw new Error(`card conservation: ${cards.length} cards, ${new Set(cards).size} distinct`);
  }
  if (isStreet(st.phase)) {
    const committed = occupied(st).reduce((a, s) => a + s.committed, 0);
    if (committed !== st.pot) throw new Error(`pot ${st.pot} ≠ Σ committed ${committed}`);
    if (st.pots.reduce((a, p) => a + p.amount, 0) !== st.pot) throw new Error('pots do not add up');
    if (st.pots.some((p) => p.eligible.length === 0)) throw new Error('pot with nobody eligible');
    const bb = st.bbPos == null ? null : st.seats[st.bbPos];
    if (!bb?.inHand) throw new Error('big blind not dealt in');
    if (st.toAct != null && legalHoldem(st, st.toAct)?.kind !== 'act') throw new Error('toAct has no legal action');
    for (const s of occupied(st)) {
      if (s.inHand && !s.folded && s.hole.length !== 2) throw new Error(`seat ${s.id} lost its cards`);
      if (s.allIn && s.stack !== 0) throw new Error(`seat ${s.id} all-in with chips`);
      if (!s.inHand && (s.street || s.committed || s.hole.length)) throw new Error(`seat ${s.id} has chips in without cards`);
    }
  }
}
