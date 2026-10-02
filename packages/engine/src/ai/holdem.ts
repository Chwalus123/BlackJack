import type { Card } from '../core/cards';
import { nextFloat, type RngState } from '../core/chacha';
import type { Money } from '../core/money';
import type { SeatId } from '../core/types';
import type { HLegal, HView } from '../holdem/types';
import { heEquity } from './holdem/equity';
import { preflopPercentile } from './holdem/preflop';

export { heEquity } from './holdem/equity';
export { preflopEquity, preflopPercentile } from './holdem/preflop';

export type HEPersona = 'rock' | 'tag' | 'station' | 'lag';
export const HE_PERSONAS: readonly HEPersona[] = ['rock', 'tag', 'station', 'lag'];

interface PersonaCfg {
  /** Share of hands played / raised preflop (fractions of all starting hands). */
  vpip: number;
  pfr: number;
  /** 0..1: how readily it bets and raises for value. */
  aggr: number;
  /** Chance to bet or raise without a hand. */
  bluff: number;
  /** Equity it gives up against the pot odds when calling. */
  loose: number;
  /** Bet size as a fraction of the pot (min, max). */
  sizing: readonly [number, number];
  think: number;
}

const PERSONAS: Record<HEPersona, PersonaCfg> = {
  rock: { vpip: 0.14, pfr: 0.08, aggr: 0.25, bluff: 0.02, loose: 0, sizing: [0.5, 0.66], think: 1000 },
  tag: { vpip: 0.22, pfr: 0.17, aggr: 0.7, bluff: 0.08, loose: 0.02, sizing: [0.6, 0.8], think: 850 },
  station: { vpip: 0.45, pfr: 0.08, aggr: 0.15, bluff: 0.03, loose: 0.12, sizing: [0.4, 0.6], think: 700 },
  lag: { vpip: 0.34, pfr: 0.26, aggr: 0.85, bluff: 0.15, loose: 0.05, sizing: [0.7, 1], think: 700 },
};

/** Total showdown evaluations a postflop decision may spend. */
const EVAL_BUDGET = 1500;

export type HEBotAction =
  | { type: 'FOLD' | 'CHECK' | 'CALL' | 'ALL_IN' | 'REBUY' | 'SIT_IN'; seat: SeatId; dId: number }
  | { type: 'BET' | 'RAISE'; seat: SeatId; to: Money; dId: number };

export type HEIntent = { k: 'fold' } | { k: 'check' } | { k: 'call' } | { k: 'raise'; to: Money } | { k: 'allIn' };

type ActLegal = Extract<HLegal, { kind: 'act' }>;

/** Maps an intent onto an action the engine will accept for this legal set. */
export function clampToLegal(l: ActLegal, intent: HEIntent, seat: SeatId): HEBotAction {
  const base = { seat, dId: l.dId };
  const passive = (): HEBotAction => ({ type: l.call != null ? 'CALL' : 'CHECK', ...base });
  switch (intent.k) {
    case 'fold':
      return { type: l.fold ? 'FOLD' : 'CHECK', ...base };
    case 'check':
      return { type: l.check ? 'CHECK' : 'FOLD', ...base };
    case 'call':
      return passive();
    case 'allIn':
      return l.allIn != null ? { type: 'ALL_IN', ...base } : passive();
    case 'raise': {
      const r = l.bet ?? l.raise;
      if (!r) return passive();
      const type = l.bet ? 'BET' : 'RAISE';
      const to = Math.max(r.min, Math.floor(intent.to / l.unit) * l.unit);
      return { type, to: to >= r.max ? r.max : to, ...base };
    }
  }
}

/** Seats dealt in, in preflop acting order (first seat after the big blind). */
function preflopOrder(v: HView): SeatId[] {
  const n = v.seats.length;
  const out: SeatId[] = [];
  const from = v.bb ?? 0;
  for (let k = 1; k <= n; k++) {
    const s = v.seats[(from + k) % n];
    if (s?.inHand) out.push(s.id);
  }
  return out;
}

function preflop(v: HView, l: ActLegal, seat: SeatId, cfg: PersonaCfg, hole: Card[], rng: RngState): HEIntent {
  const me = v.seats[seat]!;
  const bb = v.rules.bb;
  const pct = preflopPercentile(hole);
  const order = preflopOrder(v);
  const blind = seat === v.bb || (seat === v.sb && v.sb !== v.button);
  const rel = order.indexOf(seat) / Math.max(1, order.length - 1);
  // Position factor; tables shorter than 6 play looser.
  const short = order.length <= 3 ? 1.6 : order.length <= 5 ? 1.25 : 1;
  const f = (blind ? 1 : rel < 0.34 ? 0.7 : rel < 0.67 ? 1 : 1.3) * short;
  const stackBB = (me.stack + me.street) / bb;
  if (stackBB <= 12) {
    const shove = Math.min(0.6, (cfg.vpip * 0.8 + 0.08) * f);
    if (pct <= shove || (l.callIsAllIn && pct <= shove * 1.5)) return { k: 'allIn' };
    return { k: l.check ? 'check' : 'fold' };
  }
  const level = v.currentBet / bb;
  if (level <= 1) {
    const limpers = order.filter((id) => id !== v.bb && id !== seat && (v.seats[id]?.street ?? 0) >= bb).length;
    if (pct <= cfg.pfr * f) return { k: 'raise', to: Math.round(bb * (2.5 + nextFloat(rng) * 0.5 + limpers)) };
    if (pct <= cfg.vpip * f) return { k: l.check ? 'check' : 'call' };
    return { k: l.check ? 'check' : 'fold' };
  }
  const price = l.toCall / (me.stack + me.street);
  if (level <= 4.5) {
    if (pct <= 0.3 * cfg.pfr * f) return { k: 'raise', to: Math.round(v.currentBet * (2.8 + nextFloat(rng) * 0.6)) };
    const defend = blind && seat === v.bb ? 1.3 : 1;
    if (pct <= 0.5 * cfg.vpip * f * defend && price < 0.25) return { k: 'call' };
    return { k: l.check ? 'check' : 'fold' };
  }
  if (pct <= 0.02 + 0.015 * cfg.aggr) return { k: 'raise', to: Math.round(v.currentBet * 2.5) };
  if (pct <= 0.05 + 0.1 * cfg.loose && price < 0.5) return { k: 'call' };
  return { k: l.check ? 'check' : 'fold' };
}

function postflop(v: HView, l: ActLegal, seat: SeatId, cfg: PersonaCfg, hole: Card[], board: Card[], rng: RngState): HEIntent {
  const me = v.seats[seat]!;
  const nOpp = v.seats.filter((s) => s && s.id !== seat && s.inHand && !s.folded).length;
  const iters = Math.max(40, Math.floor(EVAL_BUDGET / (nOpp + 1)));
  const eq = heEquity(hole, board, nOpp, iters, rng);
  const fair = 1 / (nOpp + 1);
  const strength = (eq - fair) / (1 - fair); // 0 = an average hand, 1 = the nuts
  const pot = l.pot;
  const size = () => Math.round(pot * (cfg.sizing[0] + nextFloat(rng) * (cfg.sizing[1] - cfg.sizing[0])));
  const roll = nextFloat(rng);
  if (l.toCall === 0) {
    if (strength > 0.45 - 0.15 * cfg.aggr) return { k: 'raise', to: Math.max(v.rules.bb, size()) };
    if (roll < cfg.bluff * (nOpp === 1 ? 1.5 : 0.5)) return { k: 'raise', to: Math.max(v.rules.bb, size()) };
    return { k: 'check' };
  }
  const call = l.call ?? 0;
  const potOdds = call / (pot + call);
  if (l.callIsAllIn || call >= me.stack * 0.6) return eq >= potOdds + 0.03 - cfg.loose ? { k: 'call' } : { k: 'fold' };
  if (strength > 0.7 - 0.15 * cfg.aggr && (l.raise || l.bet)) return { k: 'raise', to: v.currentBet + size() + call };
  if (eq >= potOdds - cfg.loose) return { k: 'call' };
  if (v.phase !== 'river' && eq > 0.3 && roll < cfg.bluff) return { k: 'raise', to: v.currentBet + size() + call };
  return { k: 'fold' };
}

/**
 * Pure bot decision from the bot's own redacted view. Deterministic for a given `rng` state; every
 * action is clamped to `legal`.
 */
export function decideHoldem(view: HView, legal: HLegal, seat: SeatId, persona: string, rng: RngState): { action: HEBotAction; thinkMs: number } {
  const cfg = PERSONAS[(HE_PERSONAS as readonly string[]).includes(persona) ? (persona as HEPersona) : 'tag'];
  const think = (extra = 0) => Math.min(3000, Math.max(500, Math.round(cfg.think + extra + nextFloat(rng) * 700)));
  if (legal.kind === 'rebuy') return { action: { type: 'REBUY', seat, dId: legal.dId }, thinkMs: think(300) };
  if (legal.kind === 'sitIn') return { action: { type: 'SIT_IN', seat, dId: legal.dId }, thinkMs: think(300) };
  const me = view.seats[seat];
  const hole = (me?.hole ?? []).flatMap((c) => (c.card == null ? [] : [c.card]));
  const board = view.board.flatMap((c) => (c.card == null ? [] : [c.card]));
  let intent: HEIntent;
  if (!me || hole.length !== 2) intent = { k: legal.check ? 'check' : 'fold' };
  else if (board.length === 0) intent = preflop(view, legal, seat, cfg, hole, rng);
  else intent = postflop(view, legal, seat, cfg, hole, board, rng);
  const action = clampToLegal(legal, intent, seat);
  const hard = action.type === 'BET' || action.type === 'RAISE' || action.type === 'ALL_IN' || (action.type === 'CALL' && legal.toCall > view.rules.bb * 4);
  return { action, thinkMs: think(hard ? 400 : board.length ? 200 : 0) };
}
