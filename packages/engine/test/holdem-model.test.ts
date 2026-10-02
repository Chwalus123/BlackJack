import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CHIP, clone, he, Holdem, type Viewer } from '../src/index';
import { checkHoldemInvariants } from '../src/holdem/testing';

const { applyHoldem, createHoldem, legalHoldem, viewHoldem, reduceHoldemView, applyHoldemReveal, holdemMultiplayer, holdemSinglePlayer } = he;
type S = he.HState;
type A = he.HAction;

export function diff(p: string, x: any, y: any): string[] {
  if (JSON.stringify(x) === JSON.stringify(y)) return [];
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => diff(`${p}.${k}`, x[k], y[k]));
  }
  return [`${p}: reduced=${JSON.stringify(x)} expected=${JSON.stringify(y)}`];
}

interface PlayOpts {
  seed: number;
  steps: number;
  mode: 'sp' | 'mp';
  maxSeats: number;
}

/**
 * Random driver: joins, leaves, sit-outs, rebuys, away flags, pauses, timeouts and random legal (and
 * some illegal) betting. Checks invariants, view reduction and that every hand terminates.
 */
export function randomHoldem({ seed, steps, mode, maxSeats }: PlayOpts) {
  const rules =
    mode === 'sp'
      ? holdemSinglePlayer({ sb: CHIP, bb: 2 * CHIP, buyIn: 100 * CHIP })
      : holdemMultiplayer({ sb: CHIP, bb: 2 * CHIP, buyInBB: 30 + (seed % 3) * 35, decisionMs: 20000, rebuy: { mode: seed % 2 ? 'whenBroke' : 'never', max: seed % 4 === 1 ? 1 : null }, maxSeats });
  let st = createHoldem(rules, [seed, 7, 7, 7], 0);
  let x = seed >>> 0 || 1;
  const rnd = (n: number) => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x % n;
  };
  const watch = rnd(maxSeats);
  const viewers: Viewer[] = [{ kind: 'spectator' }, { kind: 'seat', seat: watch }];
  const views = viewers.map((vw) => clone(viewHoldem(st, vw)));
  let joined = 0;
  let handSteps = 0;
  let lastHand = 0;
  let hands = 0;
  for (let i = 0; i < steps; i++) {
    const at = st.lastAt + 1 + rnd(400);
    const cands: A[] = [];
    const seated = st.seats.filter((s): s is he.HSeat => s != null);
    if (seated.length < maxSeats && rnd(seated.length < 2 ? 2 : 12) === 0) {
      joined++;
      cands.push({ type: 'JOIN', at, player: `p${joined}`, name: `P${joined}`, waitForBB: rnd(3) === 0, seat: rnd(2) ? rnd(maxSeats) : undefined, buyIn: mode === 'sp' && rnd(2) ? (20 + rnd(200)) * CHIP : undefined } as A);
    }
    for (const s of seated) {
      const l = legalHoldem(st, s.id);
      if (l?.kind === 'act') {
        const w = rnd(10);
        if (l.fold && w < 2) cands.push({ type: 'FOLD', at, seat: s.id, dId: l.dId });
        if (l.check) cands.push({ type: 'CHECK', at, seat: s.id, dId: l.dId });
        if (l.call != null) cands.push({ type: 'CALL', at, seat: s.id, dId: l.dId }, { type: 'CALL', at, seat: s.id });
        const range = l.bet ?? l.raise;
        if (range && w > 6) {
          const steps = Math.floor((range.max - range.min) / l.unit);
          const to = rnd(3) === 0 ? range.max : range.min + l.unit * rnd(Math.max(1, Math.min(steps, 20)));
          cands.push({ type: l.bet ? 'BET' : 'RAISE', at, seat: s.id, to: Math.min(to, range.max) } as A);
        }
        if (l.allIn != null && rnd(8) === 0) cands.push({ type: 'ALL_IN', at, seat: s.id });
        // a few illegal ones
        if (rnd(10) === 0) cands.push({ type: 'RAISE', at, seat: s.id, to: (l.raise?.min ?? 0) - 1 } as A);
        if (rnd(10) === 0) cands.push({ type: 'FOLD', at, seat: s.id, dId: l.dId + 1 });
      } else if (l?.kind === 'rebuy' && rnd(3) === 0) cands.push({ type: 'REBUY', at, seat: s.id });
      else if (l?.kind === 'sitIn' && rnd(4) === 0) cands.push({ type: 'SIT_IN', at, seat: s.id });
      if (rnd(60) === 0) cands.push({ type: 'LEAVE', at, seat: s.id });
      if (rnd(80) === 0) cands.push({ type: 'SIT_OUT', at, seat: s.id });
      if (mode === 'mp' && rnd(60) === 0) cands.push({ type: 'SET_AWAY', at, seat: s.id, away: !s.away });
      if (mode === 'mp' && rnd(80) === 0) cands.push({ type: 'SET_WAIT_BB', at, seat: s.id, value: !s.waitForBB });
      if (st.phase === 'results' && s.hole.length && rnd(10) === 0) cands.push({ type: rnd(2) ? 'SHOW' : 'MUCK', at, seat: s.id } as A);
      if (rnd(200) === 0) cands.push({ type: 'RELEASE', at, seat: s.id });
    }
    if (rnd(150) === 0) cands.push({ type: 'PAUSE', at, value: !st.paused });
    if (rnd(600) === 0) cands.push({ type: 'ABORT', at });
    if (st.paused && rnd(5) === 0) cands.push({ type: 'PAUSE', at, value: false });
    const d = Holdem.nextDeadline(st);
    if (d != null) cands.push({ type: 'TIMEOUT', at: Math.max(at, d), entropy: [rnd(1000), i] }, { type: 'TIMEOUT', at: Math.max(at, d) });
    if (cands.length === 0) continue;
    const a = cands[rnd(cands.length)]!;
    const before = JSON.stringify(st);
    const r = applyHoldem(st, a);
    if (!r.ok) {
      expect(JSON.stringify(st)).toBe(before);
      continue;
    }
    st = r.state;
    checkHoldemInvariants(st);
    if (st.hand !== lastHand) {
      lastHand = st.hand;
      handSteps = 0;
      hands++;
    } else if (st.phase !== 'waiting' && ++handSteps > 3000) throw new Error('hand does not terminate');
    for (const ev of r.pub) {
      if (ev.e === 'CardDealt' && ev.to.t === 'hole' && ev.card != null) throw new Error('hole card in public event');
      if (ev.e === 'CardDealt' && ev.to.t === 'burn' && ev.card != null) throw new Error('burn card in public event');
    }
    for (let k = 0; k < viewers.length; k++) {
      const v = views[k]!;
      for (const ev of r.pub) reduceHoldemView(v, ev);
      const vw = viewers[k]!;
      if (vw.kind === 'seat') for (const rv of r.priv) if (rv.seat === vw.seat) applyHoldemReveal(v, rv);
      const expected = viewHoldem(st, vw);
      v.you = expected.you;
      if (JSON.stringify(v) !== JSON.stringify(expected)) {
        throw new Error(`view mismatch (viewer ${k}) after ${a.type}: events=${r.pub.map((e) => e.e).join(',')}\n${diff('v', v, expected).slice(0, 10).join('\n')}`);
      }
    }
    // spectators never see an unshown hole card
    for (const s of viewHoldem(st, { kind: 'spectator' }).seats) {
      if (s && !s.shown && s.hole.some((c) => c.card != null)) throw new Error('spectator sees a hole card');
    }
  }
  return { st, hands };
}

describe('model-based random play', () => {
  it('single-player tables conserve chips and cards; views fold from events', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 }), (seed) => {
        randomHoldem({ seed, steps: 400, mode: 'sp', maxSeats: 5 });
      }),
      { numRuns: 20 },
    );
  });

  it('multiplayer tables of 2–22 seats conserve chips and cards; views fold from events', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 }), fc.integer({ min: 2, max: 22 }), (seed, maxSeats) => {
        randomHoldem({ seed, steps: 500, mode: 'mp', maxSeats });
      }),
      { numRuns: 30 },
    );
  });

  it('plays many hands', () => {
    const { hands } = randomHoldem({ seed: 99, steps: 4000, mode: 'sp', maxSeats: 5 });
    expect(hands).toBeGreaterThan(20);
  });

  it('is deterministic for the same seed and actions', () => {
    const a = randomHoldem({ seed: 4321, steps: 600, mode: 'mp', maxSeats: 9 });
    const b = randomHoldem({ seed: 4321, steps: 600, mode: 'mp', maxSeats: 9 });
    expect(a.st).toEqual(b.st);
    expect(a.hands).toBeGreaterThan(0);
  });
});
