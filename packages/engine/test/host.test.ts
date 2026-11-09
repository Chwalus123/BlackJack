import { describe, expect, it } from 'vitest';
import { bj, Blackjack, CHIP, createRng, decideBlackjack, TableHost, basicStrategy, parseCards, parseCard } from '../src/index';
import { checkBlackjackInvariants, FakeScheduler, TEST_SEED } from '../src/testing';

describe('basic strategy', () => {
  const s = (cards: string, upCard: string, split = true) => basicStrategy(parseCards(cards), parseCard(upCard), split);
  it('hard, soft and pairs', () => {
    expect(s('Tc 6d', '7h')).toBe('H');
    expect(s('Tc 6d', '6h')).toBe('S');
    expect(s('5c 6d', '9h')).toBe('D');
    expect(s('5c 6d', 'Ah')).toBe('H');
    expect(s('Tc 2d', '4h')).toBe('S');
    expect(s('Tc 2d', '3h')).toBe('H');
    expect(s('As 7d', '9h')).toBe('H');
    expect(s('As 7d', '5h')).toBe('Ds');
    expect(s('As 7d', '7h')).toBe('S');
    expect(s('8s 8d', 'Ah')).toBe('P');
    expect(s('Ts Td', '6h')).toBe('S');
    expect(s('9s 9d', '7h')).toBe('S');
    expect(s('As Ad', 'Th')).toBe('P');
    expect(s('5s 5d', '6h')).toBe('D');
  });
});

describe('TableHost', () => {
  it('runs single-player rounds with 4 bots to completion', async () => {
    const sched = new FakeScheduler();
    const rules = bj.blackjackSinglePlayer({ min: 5 * CHIP, max: 500 * CHIP, bankroll: 1000 * CHIP });
    const rng = createRng([5]);
    let batches = 0;
    const host = new TableHost(Blackjack, Blackjack.create(rules, TEST_SEED, 0), {
      scheduler: sched,
      entropy: () => [1, 2, 3, 4, 5, 6, 7, 8],
      onBatch: (b) => {
        batches++;
        checkBlackjackInvariants(b.state as bj.BJState);
      },
      bots: {
        personaOf: (s, seat) => (s as bj.BJState).seats.find((x) => x.id === seat)?.bot ?? null,
        decide: (view, legal, seat, persona) => decideBlackjack(view, legal, seat, persona, rng),
      },
    });
    host.start();
    for (let i = 0; i < 4; i++) expect(host.dispatch({ type: 'SIT', player: `bot${i}`, name: `Bot ${i}`, bot: ['cautious', 'steady', 'highRoller', 'steady'][i] }).ok).toBe(true);
    expect(host.dispatch({ type: 'SIT', player: 'me', name: 'Me' }).ok).toBe(true);
    const me = host.state.seats.find((s: bj.BJSeat) => s.player === 'me')!.id;
    for (let round = 0; round < 20; round++) {
      // let bots bet
      for (let k = 0; k < 20 && host.state.phase === 'betting' && Blackjack.pendingDecisions(host.state).some((id) => id !== me); k++) {
        await Promise.resolve();
        sched.advance(500);
      }
      expect(host.state.phase).toBe('betting');
      expect(host.dispatch({ type: 'BET', seat: me, amount: 10 * CHIP }).ok).toBe(true);
      expect(host.dispatch({ type: 'DEAL', seat: me }).ok).toBe(true);
      for (let k = 0; k < 200 && host.state.phase !== 'betting'; k++) {
        const l = Blackjack.legal(host.state, me);
        if (l?.kind === 'play') host.dispatch({ type: 'STAND', seat: me });
        else if (l?.kind === 'insurance') host.dispatch({ type: 'INSURANCE', seat: me, take: false });
        await Promise.resolve();
        sched.advance(500);
      }
      expect(host.state.round).toBe(round + 2);
    }
    expect(batches).toBeGreaterThan(100);
    host.dispose();
  });

  it('fires timeouts at multiplayer deadlines', async () => {
    const sched = new FakeScheduler();
    const rules = bj.blackjackMultiplayer({ stake: 25 * CHIP, bankrollMultiple: 50, decisionMs: 20000, betMs: 12000, rebuy: { mode: 'never', max: null } });
    const host = new TableHost(Blackjack, Blackjack.create(rules, TEST_SEED, 0), {
      scheduler: sched,
      entropy: () => [9],
      onBatch: (b) => checkBlackjackInvariants(b.state as bj.BJState),
    });
    host.start();
    host.dispatch({ type: 'SIT', player: 'a', name: 'A' });
    host.dispatch({ type: 'SIT', player: 'b', name: 'B' });
    host.dispatch({ type: 'BET', seat: 1, amount: 0 });
    expect(host.state.phase).toBe('betting');
    sched.advance(13000);
    expect(['play', 'insurance', 'results']).toContain(host.state.phase);
    sched.advance(60000);
    expect(['betting', 'results']).toContain(host.state.phase);
    host.dispose();
  });
});
