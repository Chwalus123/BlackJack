import { nextInt, type RngState } from '../core/chacha';
import { nextIndex } from '../core/seats';
import type { SeatId } from '../core/types';
import type { HSeat, HState } from './types';

export interface Positions {
  button: number;
  sb: number;
  bb: number;
  /** Seats dealt into the hand, ascending. */
  dealt: SeatId[];
  /** Entrants posting a live big blind out of position (postOrWait). */
  posts: SeatId[];
  /** Seats the big blind just passed while they could not play: they now owe a BB. */
  missed: SeatId[];
}

/** Can be dealt in at all (an entrant may still have to wait). */
export const isCandidate = (s: HSeat): boolean => s.status === 'active' && s.stack > 0 && !s.away;

/** Position `x` lies on the clockwise arc from `from` to `to`, both ends included. */
function onArc(n: number, x: number, from: number, to: number): boolean {
  return (x - from + n) % n <= (to - from + n) % n;
}

function firstHand(st: HState, rng: RngState, cands: HSeat[]): Positions {
  const dealt = cands.map((s) => s.id);
  const button = dealt[nextInt(rng, dealt.length)]!;
  const isDealt = (_: HSeat, i: number) => dealt.includes(i);
  if (dealt.length === 2) {
    const bb = dealt.find((id) => id !== button)!;
    return { button, sb: button, bb, dealt, posts: [], missed: [] };
  }
  const sb = nextIndex(st.seats, button, isDealt)!;
  const bb = nextIndex(st.seats, sb, isDealt)!;
  return { button, sb, bb, dealt, posts: [], missed: [] };
}

/**
 * TDA "big blind always advances": the BB moves to the next candidate after the previous BB; the SB
 * position is the previous BB position and the button the previous SB position, even when those seats
 * are empty now (dead SB / dead button). Heads-up the button posts the SB. Returns null when fewer
 * than two players can be dealt in.
 */
export function computePositions(st: HState, rng: RngState): Positions | null {
  const n = st.seats.length;
  const cands = st.seats.filter((s): s is HSeat => s != null && isCandidate(s));
  if (cands.length < 2) return null;
  if (st.freshPositions || st.bbPos == null || st.sbPos == null) return firstHand(st, rng, cands);

  const prevBb = st.bbPos;
  const bb = nextIndex(st.seats, prevBb, isCandidate)!;
  const postOrWait = st.rules.entry === 'postOrWait';
  const missed: SeatId[] = [];
  if (postOrWait) {
    for (let i = (prevBb + 1) % n; i !== bb; i = (i + 1) % n) {
      const s = st.seats[i];
      if (s && !isCandidate(s) && !s.needBB && s.status !== 'leaving') missed.push(i);
    }
  }
  let button = st.sbPos;
  const sb = prevBb;
  const dealt = new Set<SeatId>([bb]);
  const posts: SeatId[] = [];
  for (const s of cands) {
    if (s.id === bb) continue;
    if (!s.needBB || !postOrWait) dealt.add(s.id);
    else if (!s.waitForBB && !onArc(n, s.id, button, sb)) {
      dealt.add(s.id);
      posts.push(s.id);
    }
  }
  if (dealt.size < 2) return firstHand(st, rng, cands);
  const ids = [...dealt].sort((a, b) => a - b);
  if (ids.length === 2) {
    const other = ids.find((id) => id !== bb)!;
    return { button: other, sb: other, bb, dealt: ids, posts: posts.filter((p) => p !== other), missed };
  }
  if (button === bb) {
    // Only possible when a newcomer sits between the old SB and BB (immediate entry): the seat just
    // before the SB position takes the button.
    for (let k = 1; k < n; k++) {
      const i = (sb - k + n) % n;
      if (i !== bb && dealt.has(i)) {
        button = i;
        break;
      }
    }
  }
  return { button, sb, bb, dealt: ids, posts, missed };
}
