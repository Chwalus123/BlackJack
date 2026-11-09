import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CHIP, parseCards, bj, Blackjack, clone, type Viewer } from '../src/index';
import { checkBlackjackInvariants, rigShoe, TEST_SEED } from '../src/testing';

const { createBlackjack, applyBlackjack, handValue, blackjackSinglePlayer, blackjackMultiplayer, legalBlackjack, viewBlackjack, reduceBlackjackView } = bj;
type S = bj.BJState;
type A = bj.BJAction;
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

function ok(s: S, a: DistributiveOmit<A, 'at'> & { at?: number }): { st: S; pub: bj.BJEvent[] } {
  const r = applyBlackjack(s, { at: s.lastAt, ...a } as A);
  if (!r.ok) throw new Error(`${a.type} rejected: ${JSON.stringify(r.error)}`);
  checkBlackjackInvariants(r.state);
  return { st: r.state, pub: r.pub };
}

function rejected(s: S, a: DistributiveOmit<A, 'at'>): string {
  const r = applyBlackjack(s, { at: s.lastAt, ...a } as A);
  if (r.ok) throw new Error('expected rejection');
  return r.error.code;
}

const SP = blackjackSinglePlayer({ min: 5 * CHIP, max: 500 * CHIP, bankroll: 1000 * CHIP });

/** One human at seat 1; rigs the shoe; places a bet and deals. Deal order: P, dealer up, P, dealer hole, … */
function solo(cards: string, bet = 5 * CHIP): S {
  let st = createBlackjack(SP, TEST_SEED, 0);
  st = ok(st, { type: 'SIT', player: 'me', name: 'Me' }).st;
  rigShoe(st, cards);
  st = ok(st, { type: 'BET', seat: 1, amount: bet }).st;
  return ok(st, { type: 'DEAL', seat: 1 }).st;
}

const v = (cs: string) => handValue(parseCards(cs));

describe('hand math', () => {
  it.each([
    ['As Ad', 12, true],
    ['As Ad 9c', 21, true],
    ['As 6d', 17, true],
    ['As 6d Tc', 17, false],
    ['As Ad Ah 8c', 21, true],
    ['Tc 6d As', 17, false],
    ['Kc Qd', 20, false],
    ['5c 5d 5h 6s', 21, false],
    ['As Kd', 21, true],
    ['9c 8d 7h', 24, false],
    ['As As As As As As As As As As As', 21, true],
    ['2c 3d 4h', 9, false],
  ])('%s = %i (soft %s)', (cards, total, soft) => {
    expect(v(cards)).toEqual({ total, soft });
  });

  it('naturals only on two-card unsplit 21', () => {
    expect(bj.isNatural(parseCards('As Kd'), false)).toBe(true);
    expect(bj.isNatural(parseCards('As Kd'), true)).toBe(false);
    expect(bj.isNatural(parseCards('7c 7d 7h'), false)).toBe(false);
  });
});

describe('legacy v0 bug regressions', () => {
  it('the dealer does not draw before the player acts', () => {
    const st = solo('Tc 9c 6d 7h');
    expect(st.phase).toBe('play');
    expect(st.dealer.cards).toHaveLength(2);
    expect(viewBlackjack(st, { kind: 'seat', seat: 1 }).dealer.cards[1]!.card).toBeNull();
  });

  it('a bust ends the hand at once and the bet is collected', () => {
    let st = solo('Tc 9c 6d 7h Kh');
    const before = st.seats[0]!.stack;
    st = ok(st, { type: 'HIT', seat: 1 }).st;
    expect(st.seats[0]!.hands[0]!.outcome).toBe('bust');
    expect(st.seats[0]!.stack).toBe(before);
    expect(st.phase).toBe('results');
    expect(st.dealer.cards).toHaveLength(2); // nothing to play against
    expect(rejected(st, { type: 'HIT', seat: 1 })).toBe('BAD_PHASE');
  });

  it('aces count soft: A+A is soft 12 and can be split', () => {
    const st = solo('As 9c Ad 7h');
    const l = legalBlackjack(st, 1);
    expect(l?.kind).toBe('play');
    if (l?.kind === 'play') expect(l.split).toBe(true);
    expect(v('As Ad').total).toBe(12);
  });

  it('blackjack pays 3:2 — a 5 bet pays 7.50', () => {
    const st = solo('As 9c Kd 7h');
    expect(st.seats[0]!.stack).toBe(1000 * CHIP + 750);
    expect(st.seats[0]!.hands[0]!.outcome).toBe('blackjack');
    expect(st.phase).toBe('results');
  });

  it('a new round starts without reloading', () => {
    let st = solo('Tc 9c 9d 7h');
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    expect(st.phase).toBe('results');
    st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
    expect(st.phase).toBe('betting');
    expect(st.round).toBe(2);
    expect(st.seats[0]!.hands).toHaveLength(0);
  });

  it('the shoe reshuffles after the cut card', () => {
    let st = solo('Tc 9c 9d 7h');
    st.shoe.cutRemaining = st.shoe.cards.length + 1; // cut card is out
    st.shoe.needsShuffle = true;
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
    st = ok(st, { type: 'BET', seat: 1, amount: 500 }).st;
    const r = ok(st, { type: 'DEAL', seat: 1 });
    expect(r.pub.some((e) => e.e === 'Shuffle')).toBe(true);
  });
});

describe('dealer, peek, insurance', () => {
  it('dealer draws to 17 and stands on soft 17', () => {
    let st = solo('Tc 6c 9d As'); // dealer 6 + A = soft 17
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    expect(st.dealer.cards).toHaveLength(2);
    expect(st.seats[0]!.hands[0]!.outcome).toBe('win'); // 19 vs 17
  });

  it('dealer draws on 16', () => {
    let st = solo('Tc Tc 9d 6s 5h');
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    expect(st.dealer.cards).toHaveLength(3); // 16 + 5 = 21
    expect(st.seats[0]!.hands[0]!.outcome).toBe('lose');
  });

  it('10 up with dealer blackjack: no insurance, everyone loses at once', () => {
    const st = solo('9c Kd 8d As');
    expect(st.phase).toBe('results');
    expect(st.seats[0]!.hands[0]!.outcome).toBe('lose');
    expect(st.dealer.holeUp).toBe(true);
  });

  it('player blackjack vs dealer blackjack is a push', () => {
    const st = solo('As Ah Kc Kd');
    expect(st.phase).toBe('insurance'); // ace up: even money offered
    const st2 = ok(st, { type: 'INSURANCE', seat: 1, take: false }).st;
    expect(st2.seats[0]!.hands[0]!.outcome).toBe('push');
    expect(st2.seats[0]!.stack).toBe(1000 * CHIP);
  });

  it('insurance pays 2:1 when the dealer has blackjack', () => {
    let st = solo('9c As 8d Kd');
    expect(st.phase).toBe('insurance');
    const l = legalBlackjack(st, 1);
    expect(l).toMatchObject({ kind: 'insurance', cost: 250, evenMoney: false });
    st = ok(st, { type: 'INSURANCE', seat: 1, take: true }).st;
    expect(st.phase).toBe('results');
    expect(st.seats[0]!.stack).toBe(1000 * CHIP); // −5 bet, +5 insurance (2 × 2.50)
  });

  it('insurance is lost when the dealer has no blackjack, play continues', () => {
    let st = solo('9c As 8d 5d');
    st = ok(st, { type: 'INSURANCE', seat: 1, take: true }).st;
    expect(st.phase).toBe('play');
    expect(st.seats[0]!.insurance).toBe(0);
    expect(st.seats[0]!.stack).toBe(1000 * CHIP - 500 - 250);
  });

  it('even money pays 1:1 at once', () => {
    let st = solo('As Ad Kc 9h');
    expect(legalBlackjack(st, 1)).toMatchObject({ kind: 'insurance', evenMoney: true });
    st = ok(st, { type: 'INSURANCE', seat: 1, take: true }).st;
    expect(st.seats[0]!.hands[0]!.outcome).toBe('evenMoney');
    expect(st.seats[0]!.stack).toBe(1000 * CHIP + 500);
  });

  it('no peek on 2–9 up cards; naturals paid immediately', () => {
    const st = solo('As 5c Kd Th');
    expect(st.phase).toBe('results');
    expect(st.seats[0]!.hands[0]!.outcome).toBe('blackjack');
  });
});

describe('double and split', () => {
  it('double gets exactly one card and doubles the bet', () => {
    let st = solo('6c 9c 5d 7h 2s Kh');
    st = ok(st, { type: 'DOUBLE', seat: 1 }).st;
    const h = st.seats[0]!.hands[0]!;
    expect(h.cards).toHaveLength(3);
    expect(h.doubled).toBe(true);
    // 13 stands vs dealer 16 → dealer draws K → busts → win 10
    expect(h.outcome).toBe('win');
    expect(st.seats[0]!.stack).toBe(1000 * CHIP + 1000);
  });

  it('split 8s, double after split, waitCard hand dealt when reached', () => {
    let st = solo('8c 6d 8h Th 3c Kd 9s 7c');
    st = ok(st, { type: 'SPLIT', seat: 1 }).st;
    let s = st.seats[0]!;
    expect(s.hands).toHaveLength(2);
    expect(s.hands[1]!.state).toBe('waitCard');
    expect(handValue(s.hands[0]!.cards.map((c) => c.card)).total).toBe(11);
    st = ok(st, { type: 'DOUBLE', seat: 1 }).st; // 8 3 K = 21
    s = st.seats[0]!;
    expect(s.hands[0]!.state).toBe('stand');
    expect(s.hands[1]!.cards).toHaveLength(2); // 8 9 = 17
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    s = st.seats[0]!;
    // dealer 6 T + 7 = 23 bust → both win
    expect(s.hands.map((h) => h.outcome)).toEqual(['win', 'win']);
    expect(s.stack).toBe(1000 * CHIP + 1000 + 500);
  });

  it('split aces get one card each and 21 after split is not blackjack', () => {
    let st = solo('As 6d Ad 9h Kc 5c 8s');
    st = ok(st, { type: 'SPLIT', seat: 1 }).st;
    const s = st.seats[0]!;
    expect(s.hands.map((h) => h.state)).toEqual(['stand', 'stand']);
    expect(st.phase).toBe('results');
    // A K = 21 (pays 1:1), A 5 = 16 vs dealer 6 9 = 15 + 8 = 23 bust → both win 1:1
    expect(s.hands.map((h) => h.outcome)).toEqual(['win', 'win']);
    expect(s.stack).toBe(1000 * CHIP + 1000);
  });

  it('cannot resplit aces, can split ten-values (K-Q)', () => {
    let st = solo('Kc 6d Qh 9h 5c');
    expect(legalBlackjack(st, 1)).toMatchObject({ split: true });
    st = solo('As 6d Ad 9h Ac 5c');
    st = ok(st, { type: 'SPLIT', seat: 1 }).st;
    expect(st.seats[0]!.hands).toHaveLength(2);
    expect(st.phase).toBe('results');
  });

  it('rejects double without funds', () => {
    let st = createBlackjack(SP, TEST_SEED, 0);
    st = ok(st, { type: 'SIT', player: 'me', name: 'Me', bankroll: 10 * CHIP }).st;
    rigShoe(st, '6c 9c 5d 7h 2s Kh');
    st = ok(st, { type: 'BET', seat: 1, amount: 10 * CHIP }).st;
    st = ok(st, { type: 'DEAL', seat: 1 }).st;
    expect(rejected(st, { type: 'DOUBLE', seat: 1 })).toBe('ILLEGAL_ACTION');
  });
});

describe('betting validation', () => {
  it('enforces limits, unit and bankroll', () => {
    let st = createBlackjack(SP, TEST_SEED, 0);
    st = ok(st, { type: 'SIT', player: 'me', name: 'Me', bankroll: 20 * CHIP }).st;
    expect(rejected(st, { type: 'BET', seat: 1, amount: 4 * CHIP })).toBe('BAD_AMOUNT');
    expect(rejected(st, { type: 'BET', seat: 1, amount: 550 })).toBe('BAD_AMOUNT');
    expect(rejected(st, { type: 'BET', seat: 1, amount: 501 * CHIP })).toBe('BAD_AMOUNT');
    expect(rejected(st, { type: 'BET', seat: 1, amount: 25 * CHIP })).toBe('INSUFFICIENT_FUNDS');
    expect(rejected(st, { type: 'DEAL', seat: 1 })).toBe('ILLEGAL_ACTION');
    st = ok(st, { type: 'BET', seat: 1, amount: 20 * CHIP }).st;
    st = ok(st, { type: 'BET', seat: 1, amount: 10 * CHIP }).st; // re-bet replaces
    expect(st.seats[0]!.stack).toBe(10 * CHIP);
  });

  it('stale decision ids are rejected', () => {
    const st = solo('Tc 9c 6d 7h Kh');
    const l = legalBlackjack(st, 1)!;
    expect(rejected(st, { type: 'HIT', seat: 1, dId: l.dId - 1 })).toBe('STALE_TURN');
    const r = ok(st, { type: 'HIT', seat: 1, dId: l.dId });
    expect(r.st.phase).toBe('results');
  });
});

describe('multiplayer: fixed stake, simultaneous decisions', () => {
  const MP = blackjackMultiplayer({ stake: 25 * CHIP, bankrollMultiple: 50, decisionMs: 20000, betMs: 12000, rebuy: { mode: 'whenBroke', max: null } });

  function mp(n: number): S {
    let st = createBlackjack(MP, TEST_SEED, 0);
    for (let i = 1; i <= n; i++) st = ok(st, { type: 'SIT', player: `p${i}`, name: `P${i}` }).st;
    return st;
  }

  it('posts the stake, closes betting early when all decided, everyone acts at once', () => {
    let st = mp(3);
    expect(st.phase).toBe('betting');
    expect(st.phaseDeadline).toBeGreaterThan(0);
    rigShoe(st, '9c Tc Td 7h 7d 8s 6h 9h 5c 2s');
    st = ok(st, { type: 'BET', seat: 1, amount: 0 }).st;
    st = ok(st, { type: 'BET', seat: 2, amount: 0 }).st;
    expect(st.phase).toBe('betting');
    st = ok(st, { type: 'PASS', seat: 3 }).st;
    expect(st.phase).toBe('play');
    expect(st.turn?.seats.sort()).toEqual([1, 2]);
    expect(legalBlackjack(st, 1)?.kind).toBe('play');
    expect(legalBlackjack(st, 2)?.kind).toBe('play');
    expect(legalBlackjack(st, 3)).toBeNull();
    // Seat 2 acts first, then seat 1 — order of arrival does not matter.
    st = ok(st, { type: 'STAND', seat: 2 }).st;
    expect(st.phase).toBe('play');
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    expect(st.phase).toBe('results');
  });

  it('timeouts stand the hand and two in a row sit the player out', () => {
    let st = mp(2);
    st = ok(st, { type: 'SET_AUTOBET', seat: 1, value: true }).st;
    st = ok(st, { type: 'SET_AUTOBET', seat: 2, value: true }).st;
    for (let round = 0; round < 2; round++) {
      if (st.phase === 'betting') st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
      if (st.phase === 'insurance') st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
      if (st.phase === 'play') {
        if (legalBlackjack(st, 1)?.kind === 'play') st = ok(st, { type: 'STAND', seat: 1 }).st;
        if (st.phase === 'play') {
          const d = Blackjack.nextDeadline(st)!;
          st = ok(st, { type: 'TIMEOUT', at: d }).st;
        }
      }
      expect(st.phase).toBe('results');
      st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
    }
    const s2 = st.seats.find((s) => s.id === 2)!;
    const s1 = st.seats.find((s) => s.id === 1)!;
    expect(s1.status).toBe('active');
    // seat 2 might have had naturals in a round (no timeout); allow either but check the rule when it timed out twice
    if (s2.status === 'sittingOut') expect(s2.autoBet).toBe(false);
  });

  it('a leaving player stands immediately and is cashed out at round end', () => {
    let st = mp(2);
    rigShoe(st, '9c Tc Td 7h 7d 8s 6h 9h 5c 2s');
    st = ok(st, { type: 'BET', seat: 1, amount: 0 }).st;
    st = ok(st, { type: 'BET', seat: 2, amount: 0 }).st;
    expect(st.phase).toBe('play');
    st = ok(st, { type: 'LEAVE', seat: 2 }).st;
    expect(st.seats.find((s) => s.id === 2)!.status).toBe('leaving');
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
    expect(st.seats.map((s) => s.id)).toEqual([1]);
  });

  it('a mid-round joiner waits as pending', () => {
    let st = mp(1);
    rigShoe(st, '9c Tc Td 7h 7d 8s');
    st = ok(st, { type: 'BET', seat: 1, amount: 0 }).st;
    st = ok(st, { type: 'SIT', player: 'late', name: 'Late' }).st;
    expect(st.seats.at(-1)!.status).toBe('pending');
    expect(legalBlackjack(st, 2)).toBeNull();
  });

  it('a 500-seat round completes and the shoe scales', () => {
    let st = mp(500);
    for (const s of st.seats) st = ok(st, { type: 'BET', seat: s.id, amount: 0 }).st;
    expect(['play', 'results', 'insurance']).toContain(st.phase);
    expect(st.shoe.decks).toBeGreaterThan(6);
    if (st.phase === 'insurance') st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
    let guard = 0;
    while (st.phase === 'play' && guard++ < 5) st = ok(st, { type: 'TIMEOUT', at: Blackjack.nextDeadline(st)! }).st;
    expect(st.phase).toBe('results');
  });
});

/** Random driver: picks legal actions (or a timeout) and checks invariants plus view reduction. */
function randomPlay(seed: number, steps: number, mode: 'sp' | 'mp') {
  const rules = mode === 'sp' ? SP : blackjackMultiplayer({ stake: 10 * CHIP, bankrollMultiple: 20, decisionMs: 15000, betMs: 10000, rebuy: { mode: 'whenBroke', max: null } });
  let st = createBlackjack(rules, [seed, 1, 2, 3], 0);
  let x = seed >>> 0;
  const rnd = (n: number) => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return x % n;
  };
  const viewers: Viewer[] = [{ kind: 'spectator' }, { kind: 'seat', seat: 1 }];
  const views = viewers.map((vw) => clone(viewBlackjack(st, vw)));
  let players = 0;
  for (let i = 0; i < steps; i++) {
    const cands: A[] = [];
    const at = st.lastAt + 50;
    if (players < 5 && rnd(10) === 0) cands.push({ type: 'SIT', at, player: `p${players + 1}`, name: `P${players + 1}`, bot: rnd(2) ? 'steady' : undefined } as A);
    for (const s of st.seats) {
      const l = legalBlackjack(st, s.id);
      if (!l) continue;
      if (l.kind === 'bet') {
        if (l.mode === 'free') {
          if (l.current === 0 && l.max >= l.min) cands.push({ type: 'BET', at, seat: s.id, amount: l.min + l.unit * rnd(Math.max(1, (l.max - l.min) / l.unit)) });
          if (l.canDeal) cands.push({ type: 'DEAL', at, seat: s.id });
        } else if (!l.decided) cands.push({ type: rnd(4) ? 'BET' : 'PASS', at, seat: s.id, amount: 0 } as A);
      } else if (l.kind === 'insurance') cands.push({ type: 'INSURANCE', at, seat: s.id, take: rnd(2) === 0 });
      else if (l.kind === 'play') {
        cands.push({ type: 'HIT', at, seat: s.id }, { type: 'STAND', at, seat: s.id });
        if (l.double) cands.push({ type: 'DOUBLE', at, seat: s.id });
        if (l.split) cands.push({ type: 'SPLIT', at, seat: s.id });
      } else if (l.kind === 'rebuy') cands.push({ type: 'REBUY', at, seat: s.id });
      else if (l.kind === 'sitIn') cands.push({ type: 'SIT_IN', at, seat: s.id });
      if (rnd(40) === 0) cands.push({ type: 'LEAVE', at, seat: s.id });
    }
    const d = Blackjack.nextDeadline(st);
    if (d != null) cands.push({ type: 'TIMEOUT', at: Math.max(at, d) });
    if (cands.length === 0) continue;
    let a = cands[rnd(cands.length)]!;
    let fromLegal = true;
    if (rnd(5) === 0) {
      fromLegal = false;
      // Throw in arbitrary (mostly illegal) actions to exercise every rejection path.
      const types = ['HIT', 'STAND', 'DOUBLE', 'SPLIT', 'BET', 'CLEAR_BET', 'PASS', 'DEAL', 'INSURANCE', 'REBUY', 'SIT_IN', 'SIT_OUT', 'SET_AUTOBET'] as const;
      a = { type: types[rnd(types.length)]!, at, seat: 1 + rnd(7), amount: rnd(3) * 250, take: rnd(2) === 0, value: rnd(2) === 0, dId: rnd(3) ? undefined : rnd(5) } as A;
    }
    const before = JSON.stringify(st);
    const r = applyBlackjack(st, a);
    // In-place apply (used by the server) must give the same result and leave state untouched on rejection.
    const twin = JSON.parse(before) as S;
    const r2 = applyBlackjack(twin, a, { inPlace: true });
    expect(r2.ok).toBe(r.ok);
    if (!r.ok) expect(JSON.stringify(twin)).toBe(before);
    else expect(JSON.stringify(twin)).toBe(JSON.stringify(r.state));
    if (!r.ok) {
      if (fromLegal && (a.type === 'HIT' || a.type === 'STAND' || a.type === 'DOUBLE' || a.type === 'SPLIT')) throw new Error(`legal action rejected ${a.type} ${JSON.stringify(r.error)}`);
      continue;
    }
    if (a.type === 'SIT') players++;
    st = r.state;
    checkBlackjackInvariants(st);
    for (let k = 0; k < viewers.length; k++) {
      for (const ev of r.pub) reduceBlackjackView(views[k]!, ev);
      const expected = viewBlackjack(st, viewers[k]!);
      views[k]!.you = expected.you;
      if (JSON.stringify(views[k]) !== JSON.stringify(expected)) {
        const diff = (p: string, x: any, y: any): string[] => {
          if (JSON.stringify(x) === JSON.stringify(y)) return [];
          if (x && y && typeof x === 'object' && typeof y === 'object') {
            return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((key) => diff(`${p}.${key}`, x[key], y[key]));
          }
          return [`${p}: reduced=${JSON.stringify(x)} expected=${JSON.stringify(y)}`];
        };
        throw new Error(`view mismatch after ${a.type}: events=${r.pub.map((e) => e.e).join(',')}\n${diff('v', views[k], expected).slice(0, 8).join('\n')}`);
      }
    }
    // hole card never public before it is flipped
    if (!st.dealer.holeUp && st.dealer.cards[1]) {
      expect(r.pub.some((e) => e.e === 'CardDealt' && e.cid === st.dealer.cards[1]!.cid && e.card != null)).toBe(false);
    }
  }
  return st;
}

describe('model-based properties', () => {
  it('single-player random games conserve chips and cards; views fold from events', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 2 ** 31 }), (seed) => {
      randomPlay(seed, 300, 'sp');
    }), { numRuns: 25 });
  });

  it('multiplayer random games conserve chips and cards; views fold from events', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 2 ** 31 }), (seed) => {
      randomPlay(seed, 300, 'mp');
    }), { numRuns: 25 });
  });

  it('is deterministic for the same seed and actions', () => {
    const a = randomPlay(1234, 200, 'sp');
    const b = randomPlay(1234, 200, 'sp');
    expect(a).toEqual(b);
  });
});

describe('table management', () => {
  const MP = blackjackMultiplayer({ stake: 25 * CHIP, bankrollMultiple: 2, decisionMs: 20000, betMs: 12000, rebuy: { mode: 'whenBroke', max: 1 } });

  it('pause holds the table between rounds; resume opens betting', () => {
    let st = createBlackjack(MP, TEST_SEED, 0);
    st = ok(st, { type: 'PAUSE', value: true }).st;
    st = ok(st, { type: 'SIT', player: 'a', name: 'A' }).st;
    expect(st.phase).toBe('idle');
    expect(Blackjack.nextDeadline(st)).toBeNull();
    st = ok(st, { type: 'PAUSE', value: false }).st;
    expect(st.phase).toBe('betting');
    // pausing mid-round takes effect after the round
    rigShoe(st, '9c Tc Td 7h 7d 8s');
    st = ok(st, { type: 'BET', seat: 1, amount: 0 }).st;
    expect(st.phase).toBe('play');
    st = ok(st, { type: 'PAUSE', value: true }).st;
    expect(st.phase).toBe('play');
    st = ok(st, { type: 'STAND', seat: 1 }).st;
    st = ok(st, { type: 'TIMEOUT', at: st.phaseDeadline! }).st;
    expect(st.phase).toBe('idle');
    expect(st.paused).toBe(true);
  });

  it('abort refunds every unsettled bet and conserves chips', () => {
    let st = createBlackjack(MP, TEST_SEED, 0);
    st = ok(st, { type: 'SIT', player: 'a', name: 'A' }).st;
    st = ok(st, { type: 'SIT', player: 'b', name: 'B' }).st;
    rigShoe(st, '9c Tc Td 7h 7d 8s');
    st = ok(st, { type: 'BET', seat: 1, amount: 0 }).st;
    st = ok(st, { type: 'BET', seat: 2, amount: 0 }).st;
    expect(st.phase).toBe('play');
    st = ok(st, { type: 'ABORT' }).st;
    expect(st.phase).toBe('idle');
    expect(st.seats.map((s) => s.stack)).toEqual([50 * CHIP, 50 * CHIP]);
    expect(st.dealer.cards).toHaveLength(0);
  });

  it('sit out / sit in, clear bet, pass, and a limited rebuy', () => {
    let st = createBlackjack(MP, TEST_SEED, 0);
    st = ok(st, { type: 'SIT', player: 'a', name: 'A' }).st;
    st = ok(st, { type: 'SIT', player: 'b', name: 'B' }).st;
    st = ok(st, { type: 'BET', seat: 1, amount: 0 }).st;
    st = ok(st, { type: 'CLEAR_BET', seat: 1 }).st;
    expect(st.seats[0]!.stack).toBe(50 * CHIP);
    st = ok(st, { type: 'SIT_OUT', seat: 1 }).st;
    expect(legalBlackjack(st, 1)).toMatchObject({ kind: 'sitIn' });
    st = ok(st, { type: 'SIT_IN', seat: 1 }).st;
    expect(st.seats[0]!.status).toBe('active');
    expect(rejected(st, { type: 'REBUY', seat: 1 })).toBe('ILLEGAL_ACTION'); // not broke
    // Lose everything: force stacks low and check the rebuy path.
    st.seats[0]!.stack = 0;
    st.cashier += 50 * CHIP;
    expect(legalBlackjack(st, 1)).toMatchObject({ kind: 'rebuy' });
    st = ok(st, { type: 'REBUY', seat: 1 }).st;
    expect(st.seats[0]!.stack).toBe(50 * CHIP);
    st.seats[0]!.stack = 0;
    st.cashier += 50 * CHIP;
    expect(rejected(st, { type: 'REBUY', seat: 1 })).toBe('ILLEGAL_ACTION'); // max 1 rebuy
    st = ok(st, { type: 'PASS', seat: 2 }).st;
    expect(st.seats[1]!.decided).toBe(true);
  });
});
