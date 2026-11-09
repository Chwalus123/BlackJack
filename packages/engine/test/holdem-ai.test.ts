import { describe, expect, it } from 'vitest';
import {
  CHIP, createRng, decideHoldem, clampToLegal, heEquity, he, Holdem, HE_PERSONAS, parseCards, preflopPercentile, TableHost, type HEBotAction,
} from '../src/index';
import { checkHoldemInvariants, rigHand } from '../src/holdem/testing';
import { FakeScheduler } from '../src/testing';

const { applyHoldem, createHoldem, legalHoldem, viewHoldem, holdemSinglePlayer, holdemMultiplayer } = he;
type S = he.HState;
const $ = (chips: number) => chips * CHIP;

function apply(st: S, a: Record<string, unknown> & { type: string }): S {
  const r = applyHoldem(st, { at: st.lastAt, ...a } as he.HAction);
  if (!r.ok) throw new Error(`${a.type} rejected: ${JSON.stringify(r.error)} ${JSON.stringify(a)}`);
  return r.state;
}

function table(n: number, stack = 200): S {
  let st = createHoldem({ ...holdemSinglePlayer({ sb: $(1), bb: $(2), buyIn: $(stack) }), maxSeats: Math.max(5, n) }, [1, 2], 0);
  for (let i = 0; i < n; i++) st = apply(st, { type: 'JOIN', player: `p${i}`, name: `P${i}`, seat: i });
  return st;
}

const decide = (st: S, persona: string, seed = 1) => {
  const seat = st.toAct!;
  return decideHoldem(viewHoldem(st, { kind: 'seat', seat }), legalHoldem(st, seat)!, seat, persona, createRng([seed]));
};

describe('equity', () => {
  it('AA vs KK preflop ≈ 0.82', () => {
    const eq = heEquity(parseCards('As Ah'), [], [parseCards('Kd Kc')], 4000, createRng([42]));
    expect(eq).toBeGreaterThan(0.79);
    expect(eq).toBeLessThan(0.85);
  });

  it('a made flush on the river wins against nothing; ties share', () => {
    expect(heEquity(parseCards('Ah Kh'), parseCards('2h 7h 9h Jc 3d'), [parseCards('Qc Qd')], 50, createRng([1]))).toBe(1);
    expect(heEquity(parseCards('2c 3d'), parseCards('Ts Jd Qh Kc Ac'), [parseCards('4c 5d')], 50, createRng([1]))).toBe(0.5);
  });

  it('equity vs random hands drops with more opponents', () => {
    const rng = createRng([3]);
    const one = heEquity(parseCards('As Ah'), [], 1, 3000, rng);
    const four = heEquity(parseCards('As Ah'), [], 4, 1000, rng);
    expect(one).toBeGreaterThan(0.82);
    expect(four).toBeLessThan(0.65);
    expect(four).toBeGreaterThan(0.45);
  });

  it('preflop percentiles rank AA first and 72o near the bottom', () => {
    expect(preflopPercentile(parseCards('As Ah'))).toBeLessThan(0.005);
    expect(preflopPercentile(parseCards('Ks Kh'))).toBeLessThan(0.01);
    expect(preflopPercentile(parseCards('As Ks'))).toBeLessThan(preflopPercentile(parseCards('As Kd')));
    expect(preflopPercentile(parseCards('7s 2d'))).toBeGreaterThan(0.95);
  });
});

describe('bot decisions', () => {
  it('raises aces preflop with every persona', () => {
    for (const p of HE_PERSONAS) {
      const st = rigHand(table(6), { button: 0, holes: { 3: 'As Ad' } });
      const s = apply(st, { type: 'TIMEOUT', at: st.phaseDeadline! });
      expect(s.toAct).toBe(3);
      expect(decide(s, p).action.type).toBe('RAISE');
    }
  });

  it('a rock folds 72o to a raise', () => {
    let st = rigHand(table(6), { button: 0, holes: { 4: '7s 2d' } });
    st = apply(st, { type: 'TIMEOUT', at: st.phaseDeadline! });
    st = apply(st, { type: 'RAISE', seat: 3, to: $(6) });
    expect(st.toAct).toBe(4);
    for (let seed = 1; seed < 20; seed++) expect(decide(st, 'rock', seed).action.type).toBe('FOLD');
  });

  it('checks rather than folds when checking is free, and calls with the nuts on the river', () => {
    let st = rigHand(table(2), { button: 0, holes: { 0: '7s 2d', 1: 'Ah Kh' }, board: '2h 7h 9h Jc 3d' });
    st = apply(st, { type: 'TIMEOUT', at: st.phaseDeadline! });
    st = apply(st, { type: 'CALL', seat: 0 });
    for (const p of HE_PERSONAS) expect(['CHECK', 'RAISE']).toContain(decide(st, p).action.type);
    st = apply(st, { type: 'CHECK', seat: 1 });
    for (let i = 0; i < 2; i++) st = apply(apply(st, { type: 'CHECK', seat: 1 }), { type: 'CHECK', seat: 0 });
    st = apply(st, { type: 'CHECK', seat: 1 });
    st = apply(st, { type: 'BET', seat: 0, to: $(50) });
    expect(st.phase).toBe('river');
    for (const p of HE_PERSONAS) expect(['CALL', 'RAISE', 'ALL_IN']).toContain(decide(st, p).action.type);
  });

  it('is deterministic for a given rng state and thinks 0.5–3 s', () => {
    const t = rigHand(table(4), { button: 0 });
    const st = apply(t, { type: 'TIMEOUT', at: t.phaseDeadline! });
    const a = decide(st, 'lag', 7);
    const b = decide(st, 'lag', 7);
    expect(a).toEqual(b);
    expect(a.thinkMs).toBeGreaterThanOrEqual(500);
    expect(a.thinkMs).toBeLessThanOrEqual(3000);
  });

  it('clampToLegal never produces an illegal amount', () => {
    let st = rigHand(table(3), { button: 0 });
    st = apply(st, { type: 'TIMEOUT', at: st.phaseDeadline! });
    const l = legalHoldem(st, 0);
    if (l?.kind !== 'act') throw new Error();
    expect(clampToLegal(l, { k: 'raise', to: 333 }, 0)).toMatchObject({ type: 'RAISE', to: $(4) });
    expect(clampToLegal(l, { k: 'raise', to: 1e9 }, 0)).toMatchObject({ type: 'RAISE', to: $(200) });
    expect(clampToLegal(l, { k: 'raise', to: 1050 }, 0)).toMatchObject({ type: 'RAISE', to: 1000 });
    expect(clampToLegal(l, { k: 'check' }, 0)).toMatchObject({ type: 'FOLD' });
  });

  it('legality fuzz: every bot action is accepted by the engine', () => {
    let decisions = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const n = 2 + (seed % 8);
      const rules = seed % 2
        ? { ...holdemSinglePlayer({ sb: $(1), bb: $(2), buyIn: $(40 + seed * 10) }), maxSeats: Math.max(5, n) }
        : holdemMultiplayer({ sb: $(5), bb: $(10), buyInBB: 20 + seed, decisionMs: 15000, rebuy: { mode: 'whenBroke', max: null }, maxSeats: n });
      let st = createHoldem(rules, [seed], 0);
      for (let i = 0; i < n; i++) st = apply(st, { type: 'JOIN', player: `b${i}`, name: 'B', bot: HE_PERSONAS[(i + seed) % 4] });
      const rng = createRng([seed, 99]);
      for (let step = 0; step < 1500; step++) {
        const pending = Holdem.pendingDecisions(st);
        if (pending.length === 0) {
          const d = Holdem.nextDeadline(st);
          if (d == null) break;
          st = apply(st, { type: 'TIMEOUT', at: Math.max(d, st.lastAt) });
          continue;
        }
        const seat = pending[0]!;
        const legal = Holdem.legal(st, seat)!;
        const view = viewHoldem(st, { kind: 'seat', seat });
        for (const s of view.seats) if (s && s.id !== seat && !s.shown) expect(s.hole.every((c) => c.card === null)).toBe(true);
        const { action } = decideHoldem(view, legal, seat, st.seats[seat]!.bot!, rng);
        const r = applyHoldem(st, { ...(action as HEBotAction), at: st.lastAt + 100 } as he.HAction);
        if (!r.ok) throw new Error(`bot action rejected: ${JSON.stringify(action)} legal=${JSON.stringify(legal)} → ${r.error.code}`);
        st = r.state;
        checkHoldemInvariants(st);
        decisions++;
      }
    }
    expect(decisions).toBeGreaterThan(5000);
  });
});

describe('TableHost with Hold’em', () => {
  it('runs 100 single-player hands with a scripted human and 4 bots, conserving chips', async () => {
    const sched = new FakeScheduler();
    const rules = holdemSinglePlayer({ sb: $(1), bb: $(2), buyIn: $(200) });
    const rng = createRng([5]);
    let batches = 0;
    let sawShowdown = false;
    const host = new TableHost(Holdem, Holdem.create(rules, [11, 22, 33], 0), {
      scheduler: sched,
      entropy: () => [1, 2, 3, 4, 5, 6, 7, 8],
      onBatch: (b) => {
        batches++;
        checkHoldemInvariants(b.state as S);
        if ((b.pub as he.HEvent[]).some((e) => e.e === 'Shown')) sawShowdown = true;
      },
      bots: {
        personaOf: (s, seat) => (s as S).seats[seat]?.bot ?? null,
        decide: (view, legal, seat, persona) => decideHoldem(view, legal, seat, persona, rng),
      },
    });
    host.start();
    expect(host.dispatch({ type: 'JOIN', player: 'me', name: 'Me', seat: 2, buyIn: $(150) }).ok).toBe(true);
    HE_PERSONAS.forEach((p, i) => expect(host.dispatch({ type: 'JOIN', player: `bot${i}`, name: `Bot ${i}`, bot: p }).ok).toBe(true));
    const me = 2;
    for (let k = 0; k < 100000 && host.state.hand <= 100; k++) {
      const l = Holdem.legal(host.state, me);
      if (l?.kind === 'act') expect(host.dispatch({ type: l.check ? 'CHECK' : 'CALL', seat: me, dId: l.dId }).ok).toBe(true);
      else if (l?.kind === 'rebuy') expect(host.dispatch({ type: 'REBUY', seat: me }).ok).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      sched.advance(250);
    }
    expect(host.state.hand).toBeGreaterThan(100);
    expect(batches).toBeGreaterThan(400);
    expect(sawShowdown).toBe(true);
    const st = host.state as S;
    expect(st.seats.filter(Boolean)).toHaveLength(5);
    // chips on the table = everything the cashier issued
    const onTable = st.seats.reduce((a, s) => a + (s ? s.stack + s.street : 0), 0) + st.pot;
    expect(onTable).toBe(-st.cashier);
    host.dispose();
  });
});
