import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CHIP, createRng, parseCards, he, Holdem } from '../src/index';
import { checkHoldemInvariants, presetButton, rigHand } from '../src/holdem/testing';

const { applyHoldem, createHoldem, legalHoldem, viewHoldem, holdemSinglePlayer, holdemMultiplayer, validateHoldemRules, buildPots, splitPot } = he;
type S = he.HState;
type A = he.HAction;
type E = he.HEvent;
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type Act = DistributiveOmit<A, 'at'> & { at?: number };

const $ = (chips: number) => chips * CHIP;

let events: E[] = [];
function ok(st: S, a: Act): S {
  const r = applyHoldem(st, { at: st.lastAt, ...a } as A);
  if (!r.ok) throw new Error(`${a.type} rejected: ${JSON.stringify(r.error)}`);
  checkHoldemInvariants(r.state);
  events = r.pub;
  return r.state;
}

function rejected(st: S, a: Act): string {
  const before = JSON.stringify(st);
  const r = applyHoldem(st, { at: st.lastAt, ...a } as A);
  if (r.ok) throw new Error(`expected ${a.type} to be rejected`);
  expect(JSON.stringify(st)).toBe(before);
  return r.error.code;
}

/** Immediate entry, blinds 1/2 chips, up to 9 seats, any whole-chip buy-in. */
const T: he.HoldemRules = { ...holdemSinglePlayer({ sb: $(1), bb: $(2), buyIn: $(100) }), maxSeats: 9, minBuyIn: $(1) };
const MP: he.HoldemRules = {
  ...holdemMultiplayer({ sb: $(1), bb: $(2), buyInBB: 50, decisionMs: 20000, rebuy: { mode: 'whenBroke', max: null }, maxSeats: 9 }),
  minBuyIn: $(1),
  maxBuyIn: $(1000),
};

/** Seats a player (stack in chips) at every non-null index. */
function table(stacks: (number | null)[], rules: he.HoldemRules = T, seed = 1): S {
  let st = createHoldem({ ...rules, maxSeats: Math.max(rules.maxSeats, stacks.length) }, [seed, 2, 3, 4], 0);
  stacks.forEach((chips, i) => {
    if (chips != null) st = ok(st, { type: 'JOIN', player: `p${i}`, name: `P${i}`, seat: i, buyIn: $(chips) });
  });
  return st;
}

/** Starts the next hand (from waiting or results) with `button` and rigged cards. */
function deal(st: S, button: number, holes: Record<number, string> = {}, board?: string): S {
  rigHand(st, { button, holes, board });
  return next(st);
}

const next = (st: S): S => ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! });

/** Script of moves: "0 call", "1 raise 6", "2 bet 10", "3 allin", "1 check", "0 fold" (amounts in chips). */
function play(st: S, ...moves: string[]): S {
  for (const m of moves) {
    const [seat, verb, amt] = m.split(' ');
    const s = Number(seat);
    expect(st.toAct, `toAct before "${m}"`).toBe(s);
    const type = verb === 'allin' ? 'ALL_IN' : verb!.toUpperCase();
    st = ok(st, (amt ? { type, seat: s, to: $(Number(amt)) } : { type, seat: s }) as Act);
  }
  return st;
}

/** Folds (or checks) everyone until the hand ends. */
function finish(st: S): S {
  while (he.legalHoldem(st, st.toAct ?? -1)?.kind === 'act') {
    const l = legalHoldem(st, st.toAct!)!;
    st = ok(st, { type: l.kind === 'act' && l.fold ? 'FOLD' : 'CHECK', seat: st.toAct! });
  }
  expect(st.phase).toBe('results');
  return st;
}

const act = (st: S, seat: number) => {
  const l = legalHoldem(st, seat);
  if (l?.kind !== 'act') throw new Error(`seat ${seat} cannot act`);
  return l;
};
const pos = (st: S) => [st.buttonPos, st.sbPos, st.bbPos];
const blinds = (es: E[]) => es.flatMap((e) => (e.e === 'BlindPosted' ? [`${e.kind}:${e.seat}:${e.amount / CHIP}`] : []));
const stack = (st: S, seat: number) => st.seats[seat]!.stack / CHIP;

describe('rules', () => {
  it('validates blinds, whole chips and the seat count', () => {
    expect(validateHoldemRules(holdemMultiplayer({ sb: $(5), bb: $(10), buyInBB: 100, decisionMs: 20000, rebuy: { mode: 'never', max: null } }))).toEqual([]);
    expect(validateHoldemRules(holdemSinglePlayer({ sb: $(1), bb: $(2), buyIn: $(100) }))).toEqual([]);
    expect(validateHoldemRules({ ...T, bb: $(3) })).not.toEqual([]);
    expect(validateHoldemRules({ ...T, sb: 50, bb: 100 })).not.toEqual([]);
    expect(validateHoldemRules({ ...T, maxSeats: 22 })).toEqual([]);
    expect(validateHoldemRules({ ...T, maxSeats: 23 })).not.toEqual([]);
    expect(validateHoldemRules({ ...T, maxSeats: 1 })).not.toEqual([]);
    expect(() => createHoldem({ ...T, maxSeats: 23 }, [1], 0)).toThrow();
    expect(holdemMultiplayer({ sb: $(1), bb: $(2), buyInBB: 100, decisionMs: 25000, rebuy: { mode: 'never', max: null } })).toMatchObject({
      maxSeats: 22, entry: 'postOrWait', buyIn: $(200), minBuyIn: $(200), maxBuyIn: $(200), autoSitOutAfterTimeouts: 2, rebuyWindowMs: 15000,
    });
    expect(holdemSinglePlayer({ sb: $(1), bb: $(2), buyIn: $(100) })).toMatchObject({ maxSeats: 5, entry: 'immediate', decisionMs: null, botsAutoRebuy: true, rebuy: { mode: 'whenBroke', max: null } });
  });
});

describe('positions and blinds', () => {
  it('the first button is drawn from the RNG and every seat can get it', () => {
    const counts = [0, 0, 0];
    for (let seed = 1; seed <= 150; seed++) counts[next(table([100, 100, 100], T, seed)).buttonPos!]! += 1;
    for (const c of counts) expect(c).toBeGreaterThan(25);
  });

  it('rotates one seat per hand and every player posts the BB once per orbit', () => {
    for (let n = 2; n <= 9; n++) {
      let st = next(table(new Array(n).fill(100)));
      const bbs: number[] = [];
      for (let h = 0; h < n; h++) {
        bbs.push(st.bbPos!);
        if (n > 2) expect(st.sbPos).toBe((st.bbPos! + n - 1) % n);
        st = next(finish(st));
      }
      expect(new Set(bbs).size).toBe(n);
    }
  });

  it('heads-up: the button posts the SB, acts first preflop and last postflop', () => {
    let st = deal(table([100, 100]), 0);
    expect(pos(st)).toEqual([0, 0, 1]);
    expect(blinds(events)).toEqual(['sb:0:1', 'bb:1:2']);
    expect(st.toAct).toBe(0);
    st = play(st, '0 call');
    expect(act(st, 1)).toMatchObject({ check: true, fold: false, raise: { min: $(4) } });
    st = play(st, '1 check');
    expect(st.phase).toBe('flop');
    expect(st.toAct).toBe(1);
    st = play(st, '1 check', '0 check');
    expect(st.phase).toBe('turn');
  });

  it('the first card goes to the seat left of the button', () => {
    deal(table([100, 100, 100, 100]), 2);
    const holes = events.flatMap((e) => (e.e === 'CardDealt' && e.to.t === 'hole' ? [e.to.seat] : []));
    expect(holes).toEqual([3, 0, 1, 2, 3, 0, 1, 2]);
  });

  it('dead small blind when the big blind leaves', () => {
    let st = finish(deal(table([100, 100, 100, 100]), 0));
    expect(pos(st)).toEqual([0, 1, 2]);
    st = ok(st, { type: 'LEAVE', seat: 2 });
    st = next(st);
    expect(pos(st)).toEqual([1, 2, 3]);
    expect(blinds(events)).toEqual(['bb:3:2']);
    expect(st.toAct).toBe(0);
    st = play(st, '0 call', '1 call', '3 check');
    expect(st.toAct).toBe(3); // the BB acts first after the flop
  });

  it('dead button when the small blind leaves, then normal rotation', () => {
    let st = finish(deal(table([100, 100, 100, 100]), 0));
    st = ok(st, { type: 'LEAVE', seat: 1 });
    st = next(st);
    expect(pos(st)).toEqual([1, 2, 3]);
    expect(st.seats[1]).toBeNull();
    expect(blinds(events)).toEqual(['sb:2:1', 'bb:3:2']);
    st = next(finish(st));
    expect(pos(st)).toEqual([2, 3, 0]);
  });

  it('a short big blind busts: next hand has a dead small blind', () => {
    let st = deal(table([100, 100, 1, 100]), 0, { 2: '7c 2d', 3: 'As Ad' }, 'Kh 9s 4c 3h 8d');
    expect(blinds(events)).toEqual(['sb:1:1', 'bb:2:1']);
    expect(st.seats[2]!.allIn).toBe(true);
    expect(st.currentBet).toBe($(2)); // nominal BB
    st = play(st, '3 call', '0 fold', '1 fold');
    expect(st.phase).toBe('results');
    expect(st.seats[2]!.stack).toBe(0);
    st = next(st);
    expect(st.seats[2]!.status).toBe('busted');
    expect(pos(st)).toEqual([1, 2, 3]);
    expect(blinds(events)).toEqual(['bb:3:2']);
  });

  it.each([
    ['big blind', 2, [1, 1, 0]],
    ['small blind', 1, [2, 2, 0]],
    ['button', 0, [2, 2, 1]],
  ])('3 → 2 when the %s leaves', (_, leaver, expected) => {
    let st = finish(deal(table([100, 100, 100]), 0));
    expect(pos(st)).toEqual([0, 1, 2]);
    st = next(ok(st, { type: 'LEAVE', seat: leaver as number }));
    expect(pos(st)).toEqual(expected);
    expect(st.toAct).toBe(expected[0]); // heads-up: the button acts first preflop
  });

  it('2 → 3: the newcomer posts the BB at once (immediate entry), the old BB moves to the SB', () => {
    let st = deal(table([100, 100]), 0);
    st = ok(st, { type: 'JOIN', player: 'new', name: 'New', seat: 2, buyIn: $(100) });
    expect(st.seats[2]!.inHand).toBe(false);
    st = next(finish(st));
    expect(pos(st)).toEqual([0, 1, 2]);
    expect(blinds(events)).toEqual(['sb:1:1', 'bb:2:2']);
    expect(st.seats[2]!.inHand).toBe(true);
  });

  it('nobody posts the big blind in two consecutive hands, whatever joins and leaves', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 30, maxLength: 30 }), (seed, script) => {
        let st = table([100, 100, 100, null, 100, null, 100], MP, seed);
        st = next(st);
        let prevBb = st.bbPos;
        let joined = 0;
        for (const r of script) {
          st = finish(st);
          const seat = r % 7;
          if (r < 25 && st.seats[seat]) st = ok(st, { type: 'LEAVE', seat });
          else if (r < 60 && !st.seats[seat]) st = ok(st, { type: 'JOIN', player: `n${joined++}`, name: 'N', seat, buyIn: $(100), waitForBB: r % 2 === 0 });
          const fresh = st.freshPositions;
          st = next(st);
          if (st.phase === 'waiting') {
            for (let k = 0; k < 2 && st.seats.filter(Boolean).length < 2; k++) st = ok(st, { type: 'JOIN', player: `n${joined++}`, name: 'N', buyIn: $(100) });
            st = next(st);
            prevBb = null;
            continue;
          }
          if (!fresh && prevBb != null) expect(st.bbPos).not.toBe(prevBb);
          prevBb = st.bbPos;
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('entry: post or wait (multiplayer)', () => {
  it('a newcomer posts a live big blind and keeps the option', () => {
    let st = deal(table([100, 100, 100, 100], MP), 0);
    st = ok(st, { type: 'JOIN', player: 'new', name: 'New', seat: 5, buyIn: $(100) });
    expect(st.seats[5]).toMatchObject({ needBB: true, inHand: false });
    st = next(finish(st));
    expect(pos(st)).toEqual([1, 2, 3]);
    expect(blinds(events)).toEqual(['sb:2:1', 'bb:3:2', 'post:5:2']);
    expect(st.seats[5]).toMatchObject({ needBB: false, inHand: true });
    expect(st.toAct).toBe(5);
    expect(act(st, 5)).toMatchObject({ check: true, fold: false, call: null, raise: { min: $(4) } });
    st = play(st, '5 check', '0 call', '1 fold', '2 call', '3 check');
    expect(st.phase).toBe('flop');
  });

  it('a newcomer between the button and the small blind waits until the button passes', () => {
    let st = deal(table([100, 100, null, 100, 100], MP), 0);
    expect(pos(st)).toEqual([0, 1, 3]);
    st = ok(st, { type: 'JOIN', player: 'new', name: 'New', seat: 2, buyIn: $(100) });
    st = next(finish(st));
    expect(pos(st)).toEqual([1, 3, 4]);
    expect(st.seats[2]).toMatchObject({ needBB: true, inHand: false });
    st = next(finish(st));
    expect(pos(st)).toEqual([3, 4, 0]);
    expect(blinds(events)).toEqual(['sb:4:1', 'bb:0:2', 'post:2:2']);
    expect(st.seats[2]!.inHand).toBe(true);
  });

  it('waitForBB: the newcomer is dealt in when the big blind reaches the seat', () => {
    let st = deal(table([100, 100, 100, 100], MP), 0);
    st = ok(st, { type: 'JOIN', player: 'new', name: 'New', seat: 5, buyIn: $(100), waitForBB: true });
    st = next(finish(st));
    expect(st.seats[5]!.inHand).toBe(false);
    st = next(finish(st));
    expect(st.bbPos).toBe(5);
    expect(blinds(events)).toEqual(['sb:3:1', 'bb:5:2']);
    expect(st.seats[5]).toMatchObject({ inHand: true, needBB: false });
  });

  it('a player who sat out while the big blind passed owes it when returning', () => {
    let st = deal(table([100, 100, 100, 100], MP), 0);
    st = ok(st, { type: 'SIT_OUT', seat: 3 });
    st = next(finish(st));
    expect(st.bbPos).toBe(0);
    expect(st.seats[3]).toMatchObject({ needBB: true, inHand: false });
    st = ok(st, { type: 'SIT_IN', seat: 3 });
    st = next(finish(st)); // button 2, SB 0: seat 3 sits between them and waits
    expect(pos(st)).toEqual([2, 0, 1]);
    expect(st.seats[3]!.inHand).toBe(false);
    st = next(finish(st));
    expect(pos(st)).toEqual([0, 1, 2]);
    expect(blinds(events)).toContain('post:3:2');
  });

  it('immediate entry deals a returning player in at once', () => {
    let st = deal(table([100, 100, 100, 100]), 0);
    st = ok(st, { type: 'SIT_OUT', seat: 3 });
    st = next(finish(st));
    expect(st.seats[3]!.inHand).toBe(false);
    st = ok(st, { type: 'SIT_IN', seat: 3 });
    st = next(finish(st));
    expect(st.seats[3]!.inHand).toBe(true);
    expect(st.seats[3]!.needBB).toBe(false);
  });
});

describe('betting', () => {
  it('offers the right actions preflop', () => {
    const st = deal(table([100, 100, 100]), 0);
    expect(st.toAct).toBe(0);
    expect(legalHoldem(st, 0)).toEqual({
      kind: 'act', dId: st.seats[0]!.dId, fold: true, check: false, call: $(2), callIsAllIn: false,
      bet: null, raise: { min: $(4), max: $(100) }, allIn: $(100), unit: $(1), toCall: $(2), pot: $(3),
    });
    expect(legalHoldem(st, 1)).toBeNull();
    expect(rejected(st, { type: 'CALL', seat: 1 })).toBe('NOT_YOUR_TURN');
    expect(rejected(st, { type: 'CHECK', seat: 0 })).toBe('ILLEGAL_ACTION');
    expect(rejected(st, { type: 'BET', seat: 0, to: $(4) })).toBe('ILLEGAL_ACTION');
  });

  it('the big blind has the option; folding when checking is free is rejected', () => {
    let st = deal(table([100, 100, 100]), 0);
    st = play(st, '0 call', '1 call');
    expect(act(st, 2)).toMatchObject({ check: true, fold: false, call: null, raise: { min: $(4), max: $(100) } });
    expect(rejected(st, { type: 'FOLD', seat: 2 })).toBe('ILLEGAL_ACTION');
    st = play(st, '2 raise 6', '0 call', '1 call');
    expect(st.phase).toBe('flop');
    expect(st.pot).toBe($(18));
  });

  it('min-raise chain: BB 2, raise to 6, re-raise to at least 10', () => {
    let st = deal(table([100, 100, 100]), 0);
    st = play(st, '0 raise 6');
    expect(act(st, 1).raise).toEqual({ min: $(10), max: $(100) });
    expect(rejected(st, { type: 'RAISE', seat: 1, to: $(9) })).toBe('BAD_AMOUNT');
    expect(rejected(st, { type: 'RAISE', seat: 1, to: $(101) })).toBe('INSUFFICIENT_FUNDS');
    st = play(st, '1 raise 10');
    expect(act(st, 2).raise!.min).toBe($(14));
    st = play(st, '2 raise 30');
    expect(act(st, 0).raise!.min).toBe($(50));
  });

  it('bets are multiples of the unit except an all-in', () => {
    const big: he.HoldemRules = { ...T, sb: $(5), bb: $(10) };
    let st = deal(table([300, 300, 123], big), 0);
    st = play(st, '0 call', '1 call', '2 check');
    expect(act(st, 1).bet).toEqual({ min: $(10), max: $(290) });
    expect(rejected(st, { type: 'BET', seat: 1, to: $(12) })).toBe('BAD_AMOUNT');
    expect(rejected(st, { type: 'BET', seat: 1, to: $(5) })).toBe('BAD_AMOUNT');
    st = play(st, '1 bet 15', '2 raise 113');
    expect(st.seats[2]!.allIn).toBe(true);
    expect(st.currentBet).toBe($(113));
  });

  // Flop, seats 0..3, button 3: A=0 acts first, then B=1, C=2, D=3. Everyone limped for 2.
  const flop = (stacks: number[]) => play(deal(table(stacks), 3), '2 call', '3 call', '0 call', '1 check');

  it('TDA (a): an incomplete all-in does not reopen the betting for the original bettor', () => {
    let st = flop([100, 17, 100, 100]);
    expect(st.phase).toBe('flop');
    st = play(st, '0 bet 10', '1 allin');
    expect(st.currentBet).toBe($(15));
    expect(act(st, 2).raise).toEqual({ min: $(25), max: $(98) }); // C has not acted: may raise
    st = play(st, '2 call', '3 fold');
    const l = act(st, 0);
    expect(l).toMatchObject({ call: $(5), raise: null, bet: null, allIn: null, fold: true });
    expect(rejected(st, { type: 'RAISE', seat: 0, to: $(98) })).toBe('ILLEGAL_ACTION');
    expect(rejected(st, { type: 'ALL_IN', seat: 0 })).toBe('ILLEGAL_ACTION');
    st = play(st, '0 call');
    expect(st.phase).toBe('turn');
  });

  it('TDA (b): two incomplete all-ins that add up to a full raise reopen it', () => {
    let st = flop([100, 17, 23, 100]);
    st = play(st, '0 bet 10', '1 allin');
    expect(act(st, 2).raise).toEqual({ min: $(21), max: $(21) }); // short all-in is the only raise
    st = play(st, '2 allin', '3 call');
    expect(st.currentBet).toBe($(21));
    expect(act(st, 0).raise).toEqual({ min: $(31), max: $(98) });
    st = play(st, '0 call');
    expect(st.phase).toBe('turn');
  });

  it('TDA (c): a short all-in over a full raise reopens it only for the first bettor', () => {
    let st = flop([100, 100, 100, 42]);
    st = play(st, '0 bet 10', '1 raise 30', '2 call', '3 allin');
    expect(st.currentBet).toBe($(40));
    expect(act(st, 0).raise).toEqual({ min: $(60), max: $(98) });
    st = play(st, '0 call');
    expect(act(st, 1)).toMatchObject({ raise: null, allIn: null, call: $(10) });
    expect(rejected(st, { type: 'ALL_IN', seat: 1 })).toBe('ILLEGAL_ACTION');
    expect(rejected(st, { type: 'RAISE', seat: 1, to: $(98) })).toBe('ILLEGAL_ACTION');
    st = play(st, '1 call');
    expect(act(st, 2)).toMatchObject({ raise: null, allIn: null });
    st = play(st, '2 call');
    expect(st.phase).toBe('turn');
  });

  it('an opening all-in below the big blind: players who checked may only call', () => {
    let st = flop([100, 3, 100, 100]);
    st = play(st, '0 check', '1 allin');
    expect(st.currentBet).toBe($(1));
    expect(act(st, 2).raise).toEqual({ min: $(3), max: $(98) });
    st = play(st, '2 call', '3 call');
    expect(act(st, 0)).toMatchObject({ call: $(1), raise: null, allIn: null });
    st = play(st, '0 call');
    expect(st.phase).toBe('turn');
  });

  it('an all-in call for less and the uncalled excess goes back', () => {
    let st = flop([100, 20, 100, 100]);
    st = play(st, '0 bet 50');
    expect(act(st, 1)).toMatchObject({ call: $(18), callIsAllIn: true, allIn: $(18), raise: null });
    st = play(st, '1 call', '2 fold', '3 fold');
    expect(events.some((e) => e.e === 'UncalledReturned' && e.seat === 0 && e.amount === $(32))).toBe(true);
    expect(events.find((e) => e.e === 'BetsGathered')).toEqual({ e: 'BetsGathered', pots: [{ amount: $(44), eligible: [0, 1] }] });
    expect(st.phase).toBe('results'); // one player left who can bet: dealt out
  });

  it('a short big blind posts all-in; others must still call the full blind', () => {
    let st = deal(table([100, 100, 1]), 0);
    expect(st.currentBet).toBe($(2));
    expect(act(st, 0)).toMatchObject({ call: $(2), raise: { min: $(4) } });
    st = play(st, '0 call', '1 call');
    expect(st.phase).toBe('flop');
    expect(st.pots).toEqual([{ amount: $(3), eligible: [0, 1, 2] }, { amount: $(2), eligible: [0, 1] }]);
  });

  it('short big blind all-in, folded to the small blind: nothing left to call, its excess goes back', () => {
    const r: he.HoldemRules = { ...T, sb: $(2), bb: $(4) };
    let st = deal(table([100, 100, 1], r), 0, { 1: '7c 2d', 2: 'As Ad' }, 'Kh 9s 4c 3h 8d');
    st = play(st, '0 fold');
    expect(st.phase).toBe('results');
    expect(events.find((e) => e.e === 'UncalledReturned')).toMatchObject({ seat: 1, amount: $(1) });
    expect(events.some((e) => e.e === 'HandsRevealed')).toBe(true);
    expect(stack(st, 1)).toBe(99);
    expect(stack(st, 2)).toBe(2);
  });

  it('short big blind all-in: the folded small blind’s chips above it are dead money in the side pot', () => {
    const r: he.HoldemRules = { ...T, sb: $(2), bb: $(4) };
    let st = deal(table([100, 100, 1, 100], r), 0);
    st = play(st, '3 call', '0 fold', '1 fold');
    expect(events.find((e) => e.e === 'UncalledReturned')).toMatchObject({ seat: 3, amount: $(2) });
    expect(events.find((e) => e.e === 'BetsGathered')).toEqual({ e: 'BetsGathered', pots: [{ amount: $(3), eligible: [2, 3] }, { amount: $(2), eligible: [3] }] });
  });

  it('a walk returns the big blind’s uncalled half', () => {
    let st = deal(table([100, 100, 100]), 0);
    st = play(st, '0 fold', '1 fold');
    expect(events.filter((e) => e.e === 'UncalledReturned')).toEqual([{ e: 'UncalledReturned', seat: 2, amount: $(1), allIn: false }]);
    expect(stack(st, 2)).toBe(101);
    expect(events.find((e) => e.e === 'PotAwarded')).toMatchObject({ amount: $(2), winners: [{ seat: 2, amount: $(2) }], value: null, best5: null });
    expect(events.some((e) => e.e === 'Shown' || e.e === 'HandsRevealed')).toBe(false);
  });

  it('rejects stale decision ids and actions out of phase', () => {
    let st = deal(table([100, 100, 100]), 0);
    const l = act(st, 0);
    expect(rejected(st, { type: 'CALL', seat: 0, dId: l.dId - 1 })).toBe('STALE_TURN');
    st = ok(st, { type: 'CALL', seat: 0, dId: l.dId });
    expect(rejected(st, { type: 'CALL', seat: 0, dId: l.dId })).toBe('STALE_TURN');
    st = finish(st);
    expect(rejected(st, { type: 'CHECK', seat: 0 })).toBe('BAD_PHASE');
    expect(rejected(st, { type: 'CHECK', seat: 7 })).toBe('UNKNOWN_SEAT');
    expect(rejected(st, { type: 'NOPE', seat: 0 } as unknown as Act)).toBe('ILLEGAL_ACTION');
  });
});

describe('pots', () => {
  it('builds side pots including folded money', () => {
    expect(
      buildPots([
        { seat: 0, committed: $(10), folded: false, allIn: true },
        { seat: 1, committed: $(25), folded: false, allIn: true },
        { seat: 2, committed: $(40), folded: false, allIn: false },
        { seat: 3, committed: $(40), folded: false, allIn: false },
        { seat: 4, committed: $(30), folded: true, allIn: false },
      ]),
    ).toEqual([
      { amount: $(50), eligible: [0, 1, 2, 3] },
      { amount: $(60), eligible: [1, 2, 3] },
      { amount: $(35), eligible: [2, 3] },
    ]);
    expect(buildPots([{ seat: 0, committed: $(5), folded: false, allIn: true }, { seat: 1, committed: $(5), folded: false, allIn: true }])).toEqual([{ amount: $(10), eligible: [0, 1] }]);
    expect(() => buildPots([{ seat: 0, committed: $(5), folded: false, allIn: true }, { seat: 1, committed: $(9), folded: true, allIn: false }])).toThrow(/nobody eligible/);
  });

  it('splits with the odd chip to the first winner', () => {
    expect(splitPot($(7), [2, 3, 0])).toEqual([{ seat: 2, amount: $(3) }, { seat: 3, amount: $(2) }, { seat: 0, amount: $(2) }]);
    expect(splitPot($(8), [2, 3, 0])).toEqual([{ seat: 2, amount: $(3) }, { seat: 3, amount: $(3) }, { seat: 0, amount: $(2) }]);
    expect(splitPot($(9), [1])).toEqual([{ seat: 1, amount: $(9) }]);
  });

  it('two-way all-in: the covering stack gets its excess back', () => {
    let st = deal(table([30, 50]), 0, { 0: 'As Ah', 1: 'Kd Kc' }, '2c 7d 9h Js 3c');
    st = play(st, '0 allin', '1 call');
    expect(st.phase).toBe('results');
    expect(stack(st, 0)).toBe(60);
    expect(stack(st, 1)).toBe(20);
  });

  it('three-way all-in with distinct stacks', () => {
    // A (10) has the best hand, B (20) second, C (30) worst.
    let st = deal(table([10, 20, 30]), 2, { 0: 'As Ah', 1: 'Ks Kh', 2: '7c 2d' }, 'Qc 9d 5h 4s 3c');
    st = play(st, '2 allin', '0 allin', '1 allin');
    const gathered = events.find((e) => e.e === 'BetsGathered');
    expect(gathered).toEqual({ e: 'BetsGathered', pots: [{ amount: $(30), eligible: [0, 1, 2] }, { amount: $(20), eligible: [1, 2] }] });
    expect(events.find((e) => e.e === 'UncalledReturned')).toMatchObject({ seat: 2, amount: $(10) });
    expect([stack(st, 0), stack(st, 1), stack(st, 2)]).toEqual([30, 20, 10]);
  });

  it('four-way all-in: side pots can go to a different winner than the main pot', () => {
    let st = deal(table([10, 20, 30, 40]), 3, { 0: 'As Ah', 1: '7c 2d', 2: '8c 3d', 3: 'Ks Kh' }, 'Qc 9d 5h 4s Jc');
    st = play(st, '2 allin', '3 allin', '0 allin', '1 allin');
    expect(events.find((e) => e.e === 'BetsGathered')).toEqual({
      e: 'BetsGathered',
      pots: [
        { amount: $(40), eligible: [0, 1, 2, 3] },
        { amount: $(30), eligible: [1, 2, 3] },
        { amount: $(20), eligible: [2, 3] },
      ],
    });
    const awards = events.flatMap((e) => (e.e === 'PotAwarded' ? [[e.pot, e.amount / CHIP, e.winners.map((w) => w.seat)]] : []));
    expect(awards).toEqual([[2, 20, [3]], [1, 30, [3]], [0, 40, [0]]]);
    expect([stack(st, 0), stack(st, 1), stack(st, 2), stack(st, 3)]).toEqual([40, 0, 0, 60]);
  });

  it('a three-way split gives the odd chip to the first winner left of the button', () => {
    let st = deal(table([100, 100, 100, 100]), 0, { 0: '2c 3d', 2: '2d 3h', 3: '2h 3s', 1: '4c 5d' }, 'Ts Jd Qh Kc Ac');
    st = play(st, '3 call', '0 call', '1 fold', '2 check');
    st = play(st, '2 check', '3 check', '0 check', '2 check', '3 check', '0 check', '2 check', '3 check', '0 check');
    const award = events.find((e) => e.e === 'PotAwarded');
    expect(award).toMatchObject({ amount: $(7), winners: [{ seat: 2, amount: $(3) }, { seat: 3, amount: $(2) }, { seat: 0, amount: $(2) }] });
    expect(events.some((e) => e.e === 'Announce' && e.key === 'he.splitPot')).toBe(true);
  });
});

describe('showdown', () => {
  const holes = { 0: 'Kc Kd', 1: 'Qc Qd', 2: 'Jc Td' };
  const board = 'As 9h 5s 4c 3h';

  it('the river aggressor shows first; worse hands are mucked and never revealed', () => {
    let st = deal(table([100, 100, 100]), 2, holes, board);
    st = play(st, '2 call', '0 call', '1 check');
    st = play(st, '0 check', '1 check', '2 check', '0 check', '1 check', '2 check');
    st = play(st, '0 check', '1 bet 5', '2 call', '0 call');
    const sd = events.filter((e) => e.e === 'Shown' || e.e === 'Mucked').map((e) => `${e.e}:${(e as { seat: number }).seat}`);
    expect(sd).toEqual(['Shown:1', 'Mucked:2', 'Shown:0']);
    const json = JSON.stringify(events);
    for (const c of parseCards('Jc Td')) expect(json).not.toContain(`"card":${c},`);
    expect(viewHoldem(st, { kind: 'spectator' }).seats[2]!.hole).toEqual([]);
    expect(events.find((e) => e.e === 'PotAwarded')).toMatchObject({ winners: [{ seat: 0 }], value: he.eval7(parseCards(`Kc Kd ${board}`)) });
  });

  it('on a check-down the first live seat left of the button shows first; ties show', () => {
    let st = deal(table([100, 100, 100]), 2, { 0: '7h 2h', 1: '7d 2s', 2: 'Kc Kd' }, 'As Ah Ad Ac Qs');
    st = play(st, '2 call', '0 call', '1 check');
    for (let i = 0; i < 3; i++) st = play(st, '0 check', '1 check', '2 check');
    const sd = events.filter((e) => e.e === 'Shown' || e.e === 'Mucked').map((e) => `${e.e}:${(e as { seat: number }).seat}`);
    expect(sd).toEqual(['Shown:0', 'Shown:1', 'Shown:2']);
  });

  it('an incomplete all-in raise on the river makes that player show first', () => {
    let st = deal(table([100, 17, 100]), 2, { 0: 'Kc Kd', 1: '5c 6d', 2: 'Qc Qd' }, 'As 9h 8s 4c 2h');
    st = play(st, '2 call', '0 call', '1 check');
    for (let i = 0; i < 2; i++) st = play(st, '0 check', '1 check', '2 check');
    st = play(st, '0 bet 10', '1 allin', '2 call', '0 call');
    expect(st.riverAggressor).toBe(1);
    const sd = events.filter((e) => e.e === 'Shown' || e.e === 'Mucked').map((e) => `${e.e}:${(e as { seat: number }).seat}`);
    expect(sd).toEqual(['Shown:1', 'Shown:2', 'Shown:0']);
  });

  it('per pot must-show: a hand that loses everywhere it is contested is mucked, but still takes its uncontested side pot', () => {
    // A is all-in short with the best hand; B bets the river and C calls; C is worst.
    let st = deal(table([10, 100, 100]), 2, { 0: 'As Ad', 1: 'Kc Kd', 2: 'Qc Qd' }, '2s 7h 8c 9d 3h');
    st = play(st, '2 call', '0 allin', '1 call', '2 call');
    st = play(st, '1 check', '2 check', '1 check', '2 check');
    st = play(st, '1 bet 20', '2 call');
    const sd = events.filter((e) => e.e === 'Shown' || e.e === 'Mucked').map((e) => `${e.e}:${(e as { seat: number }).seat}`);
    expect(sd).toEqual(['Shown:1', 'Mucked:2', 'Shown:0']);
    const awards = events.flatMap((e) => (e.e === 'PotAwarded' ? [[e.amount / CHIP, e.winners.map((w) => w.seat)]] : []));
    expect(awards).toEqual([[40, [1]], [30, [0]]]);
  });

  it('all-in and called: every hand is turned face up before the board is dealt', () => {
    let st = deal(table([50, 50, 100]), 2, { 0: 'As Ad', 1: 'Kc Kd' }, '2s 7h 8c 9d 3h');
    st = play(st, '2 fold', '0 allin', '1 call');
    const kinds = events.map((e) => (e.e === 'CardDealt' ? `deal:${e.to.t}` : e.e));
    const reveal = kinds.indexOf('HandsRevealed');
    expect(reveal).toBeGreaterThan(-1);
    expect(reveal).toBeLessThan(kinds.indexOf('deal:board'));
    expect(kinds.filter((k) => k === 'deal:burn')).toHaveLength(3);
    expect(viewHoldem(st, { kind: 'spectator' }).seats[0]!.hole.map((c) => c.card)).toEqual(parseCards('As Ad'));
    expect(st.phase).toBe('results');
    expect(stack(st, 0)).toBe(100);
  });

  it('the uncontested winner may show in results; mucking is also allowed', () => {
    let st = deal(table([100, 100, 100]), 0, { 2: 'As Ad' });
    st = play(st, '0 fold', '1 fold');
    expect(rejected(st, { type: 'SHOW', seat: 0 })).toBe('ILLEGAL_ACTION');
    st = ok(st, { type: 'SHOW', seat: 2 });
    expect(events[0]).toMatchObject({ e: 'Shown', seat: 2, value: null });
    expect(viewHoldem(st, { kind: 'spectator' }).seats[2]!.hole.map((c) => c.card)).toEqual(parseCards('As Ad'));
  });
});

describe('capacity', () => {
  it('22 seats to the river use exactly 52 cards', () => {
    let st = table(new Array(22).fill(100), { ...MP, maxSeats: 22 });
    st = next(st);
    expect(st.seats.filter((s) => s?.inHand)).toHaveLength(22);
    while (st.phase !== 'results') {
      const l = act(st, st.toAct!);
      st = ok(st, { type: l.check ? 'CHECK' : 'CALL', seat: st.toAct! });
    }
    expect(st.deck).toHaveLength(0);
    expect(st.burns).toHaveLength(3);
    expect(st.board).toHaveLength(5);
  });
});

describe('seating', () => {
  it('rejects a full table, a taken seat and a double seat', () => {
    let st = createHoldem(holdemSinglePlayer({ sb: $(1), bb: $(2), buyIn: $(100) }), [1], 0);
    for (let i = 0; i < 5; i++) st = ok(st, { type: 'JOIN', player: `p${i}`, name: 'P' });
    expect(he.freeSeats(st)).toEqual([]);
    expect(rejected(st, { type: 'JOIN', player: 'x', name: 'X' })).toBe('TABLE_FULL');
    st = ok(st, { type: 'LEAVE', seat: 2 });
    expect(he.freeSeats(st)).toEqual([2]);
    expect(rejected(st, { type: 'JOIN', player: 'p1', name: 'X' })).toBe('ALREADY_SEATED');
    expect(rejected(st, { type: 'JOIN', player: 'x', name: 'X', seat: 1 })).toBe('ILLEGAL_ACTION');
    expect(rejected(st, { type: 'JOIN', player: 'x', name: 'X', buyIn: 150 })).toBe('BAD_AMOUNT');
    st = ok(st, { type: 'JOIN', player: 'x', name: 'X' });
    expect(st.seats[2]!.player).toBe('x');
  });

  it('a player leaving mid-hand folds when the turn comes and is cashed out after the hand', () => {
    let st = deal(table([100, 100, 100, 100]), 0);
    const cashier = st.cashier;
    st = ok(st, { type: 'LEAVE', seat: 1 });
    expect(st.seats[1]!.status).toBe('leaving');
    expect(legalHoldem(st, 1)).toBeNull();
    st = play(st, '3 call', '0 call');
    expect(st.seats[1]!.folded).toBe(true);
    expect(st.toAct).toBe(2);
    st = finish(st);
    st = next(st);
    expect(st.seats[1]).toBeNull();
    expect(st.cashier).toBe(cashier + $(99));
  });

  it('an all-in player who leaves plays the hand out', () => {
    let st = deal(table([100, 100, 30]), 0, { 2: 'As Ad', 0: 'Kc Kd' }, '2s 7h 8c 9d 3h');
    st = play(st, '0 raise 30', '1 fold', '2 call');
    expect(st.phase).toBe('results');
    st = ok(st, { type: 'LEAVE', seat: 2 });
    expect(st.seats[2]).toBeNull();
  });

  it('timeouts check or fold, and two in a row sit the player out', () => {
    const r: he.HoldemRules = { ...MP };
    let st = deal(table([100, 100, 100], r), 0);
    expect(st.seats[0]!.deadline).toBeGreaterThan(st.lastAt + 20000);
    expect(Holdem.nextDeadline(st)).toBe(st.seats[0]!.deadline);
    st = ok(st, { type: 'TIMEOUT', at: st.seats[0]!.deadline! - 1 });
    expect(st.toAct).toBe(0);
    st = ok(st, { type: 'TIMEOUT', at: st.seats[0]!.deadline! });
    expect(events[0]).toMatchObject({ e: 'Acted', seat: 0, action: 'fold', auto: true });
    st = play(st, '1 call');
    st = ok(st, { type: 'TIMEOUT', at: st.seats[2]!.deadline! });
    expect(events[0]).toMatchObject({ e: 'Acted', seat: 2, action: 'check', auto: true });
    st = finish(st);
    st = next(st);
    expect(st.seats[0]!.timeouts).toBe(1);
    expect(pos(st)).toEqual([1, 2, 0]);
    st = play(st, '1 call', '2 call');
    st = ok(st, { type: 'TIMEOUT', at: st.seats[0]!.deadline! }); // checks the option
    st = play(st, '2 bet 4');
    st = ok(st, { type: 'TIMEOUT', at: st.seats[0]!.deadline! }); // folds
    expect(st.seats[0]!.timeouts).toBe(3);
    st = next(finish(st));
    expect(st.seats[0]!.status).toBe('sittingOut');
    expect(st.seats[0]!.inHand).toBe(false);
    expect(legalHoldem(st, 0)).toEqual({ kind: 'sitIn', dId: st.seats[0]!.dId });
  });

  it('a busted player gets a rebuy window, then the seat is released', () => {
    let st = deal(table([100, 100, 10], MP), 0, { 2: '7c 2d', 0: 'As Ad' }, 'Kh 9s 4c 3h 8d');
    st = play(st, '0 raise 10', '1 fold', '2 call');
    st = next(st);
    const s2 = st.seats[2]!;
    expect(s2.status).toBe('busted');
    expect(legalHoldem(st, 2)).toEqual({ kind: 'rebuy', dId: s2.dId, amount: $(100) });
    expect(Holdem.pendingDecisions(st)).toContain(2);
    expect(s2.rebuyDeadline).toBe(st.lastAt + 15000);
    const d = s2.rebuyDeadline!;
    st = finish(st);
    st = ok(st, { type: 'TIMEOUT', at: d });
    expect(st.seats[2]).toBeNull();
  });

  it('rebuy brings a busted player back', () => {
    let st = deal(table([100, 100, 10], MP), 0, { 2: '7c 2d', 0: 'As Ad' }, 'Kh 9s 4c 3h 8d');
    st = play(st, '0 raise 10', '1 fold', '2 call');
    st = next(st);
    st = ok(st, { type: 'REBUY', seat: 2 });
    expect(st.seats[2]).toMatchObject({ status: 'active', stack: $(100), rebuys: 1 });
    expect(rejected(st, { type: 'REBUY', seat: 2 })).toBe('ILLEGAL_ACTION');
  });

  it('with no rebuys a busted seat is released at once', () => {
    let st = deal(table([100, 100, 10], { ...MP, rebuy: { mode: 'never', max: null } }), 0, { 2: '7c 2d', 0: 'As Ad' }, 'Kh 9s 4c 3h 8d');
    st = play(st, '0 raise 10', '1 fold', '2 call');
    st = next(st);
    expect(st.seats[2]).toBeNull();
  });

  it('ABORT refunds every dealt-in seat and pauses the table', () => {
    let st = deal(table([100, 100, 100, 100]), 0);
    st = play(st, '3 raise 6', '0 call', '1 call', '2 call', '1 bet 10', '2 fold');
    st = ok(st, { type: 'ABORT' });
    expect(st.seats.flatMap((s) => (s ? [s.stack] : []))).toEqual([$(100), $(100), $(100), $(100)]);
    expect(st.phase).toBe('waiting');
    expect(st.paused).toBe(true);
    expect(Holdem.nextDeadline(st)).toBeNull();
    st = ok(st, { type: 'PAUSE', value: false });
    expect(st.phaseDeadline).not.toBeNull();
  });

  it('PAUSE lets the hand finish, then waits', () => {
    let st = deal(table([100, 100, 100]), 0);
    st = ok(st, { type: 'PAUSE', value: true });
    st = next(finish(st));
    expect(st.phase).toBe('waiting');
    expect(Holdem.nextDeadline(st)).toBeNull();
    st = ok(st, { type: 'PAUSE', value: false });
    st = next(st);
    expect(st.phase).toBe('preflop');
    expect(st.hand).toBe(2);
  });

  it('an away player times out once with the full clock, then acts at once, and is not dealt in next hand', () => {
    let st = deal(table([100, 100, 100, 100], MP), 2);
    expect(pos(st)).toEqual([2, 3, 0]);
    st = ok(st, { type: 'SET_AWAY', seat: 0, away: true });
    st = play(st, '1 call', '2 call', '3 call');
    expect(st.toAct).toBe(0);
    st = ok(st, { type: 'TIMEOUT', at: st.seats[0]!.deadline! });
    expect(events[0]).toMatchObject({ e: 'Acted', seat: 0, action: 'check', auto: true });
    st = play(st, '3 check');
    expect(events.find((e) => e.e === 'Acted' && e.seat === 0)).toMatchObject({ action: 'check', auto: true });
    expect(events.some((e) => e.e === 'TurnStarted' && e.seats.includes(0))).toBe(false);
    expect(st.toAct).toBe(1);
    st = next(finish(st));
    expect(st.seats[0]!.inHand).toBe(false);
    expect(st.seats[0]!.needBB).toBe(false); // it was the big blind when it went away
    for (let h = 0; h < 3; h++) st = next(finish(st));
    expect(st.bbPos).toBe(1);
    expect(st.seats[0]!.needBB).toBe(true); // the big blind has now passed it
    st = ok(st, { type: 'SET_AWAY', seat: 0, away: false });
    expect(st.seats[0]!.away).toBe(false);
  });

  it('leaving on your own turn folds at once', () => {
    let st = deal(table([100, 100, 100]), 0);
    st = ok(st, { type: 'LEAVE', seat: 0 });
    expect(events.find((e) => e.e === 'Acted')).toMatchObject({ seat: 0, action: 'fold', auto: true });
    expect(st.toAct).toBe(1);
  });
});

describe('views and redaction', () => {
  it('a seat sees its own hole cards; others and spectators do not', () => {
    const st = deal(table([100, 100, 100]), 0, { 0: 'As Ad', 1: 'Kc Kd' });
    const own = viewHoldem(st, { kind: 'seat', seat: 0 });
    expect(own.you).toBe(0);
    expect(own.seats[0]!.hole.map((c) => c.card)).toEqual(parseCards('As Ad'));
    expect(own.seats[1]!.hole.map((c) => c.card)).toEqual([null, null]);
    const spec = viewHoldem(st, { kind: 'spectator' });
    expect(spec.you).toBeNull();
    for (const s of spec.seats) if (s) expect(s.hole.every((c) => c.card === null)).toBe(true);
    const json = JSON.stringify(spec);
    expect(json).not.toContain('"deck"');
    expect(json).not.toContain('"rng"');
  });

  it('hole cards are private reveals; the public deal carries no card', () => {
    const st = createHoldem(T, [3], 0);
    let s = ok(st, { type: 'JOIN', player: 'a', name: 'A' });
    s = ok(s, { type: 'JOIN', player: 'b', name: 'B' });
    const r = applyHoldem(s, { type: 'TIMEOUT', at: s.phaseDeadline! });
    if (!r.ok) throw new Error();
    const holes = r.pub.filter((e) => e.e === 'CardDealt' && e.to.t === 'hole');
    expect(holes).toHaveLength(4);
    for (const e of holes) expect(e).toMatchObject({ card: null, faceUp: false });
    expect(r.priv).toHaveLength(4);
    for (const rv of r.priv) expect(r.state.seats[rv.seat]!.hole.find((c) => c.cid === rv.cid)!.card).toBe(rv.card);
  });

  it('reduceView + reveals rebuild the seat view of a dealt hand', () => {
    let st = table([100, 100, 100]);
    const v = viewHoldem(st, { kind: 'seat', seat: 1 });
    const r = applyHoldem(st, { type: 'TIMEOUT', at: st.phaseDeadline!, entropy: [5] });
    if (!r.ok) throw new Error();
    st = r.state;
    for (const ev of r.pub) he.reduceHoldemView(v, ev);
    for (const rv of r.priv) if (rv.seat === 1) he.applyHoldemReveal(v, rv);
    expect(v).toEqual(viewHoldem(st, { kind: 'seat', seat: 1 }));
  });

  it('deadlines include the animation budget scaled by animScale', () => {
    const r1 = deal(table([100, 100, 100], MP), 0);
    const slow = deal(table([100, 100, 100], { ...MP, animScale: 2 }), 0);
    const d1 = r1.seats[0]!.deadline! - r1.lastAt - 20000;
    const d2 = slow.seats[0]!.deadline! - slow.lastAt - 20000;
    expect(d1).toBeGreaterThan(1000);
    expect(d2).toBe(2 * d1);
  });

  it('pendingDecisions is the seat to act', () => {
    const st = deal(table([100, 100, 100]), 0);
    expect(Holdem.pendingDecisions(st)).toEqual([0]);
    expect(createRng([1])).toBeTruthy();
  });
});
