import * as THREE from 'three';
import { ARM_REACH, choosePosture, clamp, COMFORT, DIM, planDelivery, reachFor, shoulderPosition, type ReachRequest, type Vec3 } from './ik';
import { type HandName, sideOf } from './model';
import {
  CONTACT,
  DECK_HOLD,
  deckCentreLocal,
  fingerPose,
  gripForDeck,
  gripFromContact,
  GRIP,
  handQuat,
  neutralHand,
  NEUTRAL_BODY,
  type FingerPoseName,
} from './poses';
import { ArrTrack, PosTrack, QuatTrack, StepTrack, type Ease, type PosKey, type QuatKey, type ArrKey, type Vel } from './tracks';

/**
 * Gesture choreography. Each builder runs when its gesture starts (so it can blend from wherever the hands
 * are) and returns keyframed IK targets for both hands, the torso posture, the head's look target, the held
 * card proxy and the timed callbacks. Times are seconds on the gesture clock (speed-scaled).
 */

export interface HandSnap {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  fingers: Float32Array;
}

export interface BuildCtx {
  /** Gesture duration in seconds at speed 1. */
  D: number;
  L: HandSnap;
  R: HandSnap;
  body: { pos: THREE.Vector3; vel: THREE.Vector3 };
  decks: Float32Array;
  reduced: boolean;
  deckInHand: boolean;
  toLocal(world: THREE.Vector3): THREE.Vector3;
  shoe: THREE.Vector3;
  discard: THREE.Vector3;
  muck: THREE.Vector3;
  rack: THREE.Vector3;
  setShoe(local: THREE.Vector3): void;
  /** World position of a rig-local point, for callbacks. */
  gripWorld(h: HandName): THREE.Vector3;
}

export interface HandTrack {
  pos: PosTrack;
  rot: QuatTrack;
  fingers: ArrTrack;
}

export interface GestureEvent {
  t: number;
  fire: () => void;
}

export interface Built {
  duration: number;
  /** Earliest time a queued successor may take over (≥ the last event). */
  handoff: number;
  L: HandTrack;
  R: HandTrack;
  body: PosTrack;
  look?: StepTrack<THREE.Vector3 | null>;
  card?: StepTrack<HandName | null>;
  decks?: ArrTrack;
  events: GestureEvent[];
}

export type Builder = (ctx: BuildCtx) => Built;

// ───────────────────────── small helpers ─────────────────────────

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const toV = (p: Vec3) => v(p.x, p.y, p.z);
const flat = (a: THREE.Vector3) => v(a.x, 0, a.z);
const headingTo = (from: THREE.Vector3, to: THREE.Vector3, fallback = v(0, 0, 1)) => {
  const d = flat(to.clone().sub(from));
  return d.lengthSq() > 1e-8 ? d.normalize() : fallback.clone();
};
const safe = (p: THREE.Vector3, fallback: THREE.Vector3) => (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : fallback.clone());
const wristOf = (grip: THREE.Vector3, q: THREE.Quaternion) => grip.clone().sub(GRIP.clone().applyQuaternion(q));

class HandKeys {
  readonly pos: PosKey[];
  readonly rot: QuatKey[];
  readonly fin: ArrKey[];
  constructor(
    readonly h: HandName,
    snap: HandSnap,
  ) {
    this.pos = [{ t: 0, p: snap.pos.clone(), v: snap.vel.clone() }];
    this.rot = [{ t: 0, q: snap.rot.clone() }];
    this.fin = [{ t: 0, a: snap.fingers.slice() }];
  }
  p(t: number, p: THREE.Vector3, vel: Vel = 'stop'): this {
    this.pos.push({ t, p: p.clone(), v: vel });
    return this;
  }
  q(t: number, q: THREE.Quaternion, ease?: Ease): this {
    this.rot.push({ t, q: q.clone(), ease });
    return this;
  }
  f(t: number, pose: FingerPoseName | Float32Array, ease?: Ease): this {
    this.fin.push({ t, a: typeof pose === 'string' ? fingerPose(pose) : pose, ease });
    return this;
  }
  /** Position, orientation and fingers together. */
  key(t: number, p: THREE.Vector3, q: THREE.Quaternion, fingers?: FingerPoseName, vel: Vel = 'stop', ease?: Ease): this {
    this.p(t, p, vel).q(t, q, ease);
    if (fingers) this.f(t, fingers);
    return this;
  }
  lastPos(): THREE.Vector3 {
    return this.pos[this.pos.length - 1]!.p;
  }
  track(): HandTrack {
    return { pos: new PosTrack(this.pos), rot: new QuatTrack(this.rot), fingers: new ArrTrack(this.fin, 15) };
  }
}

class BodyKeys {
  readonly keys: PosKey[];
  constructor(snap: { pos: THREE.Vector3; vel: THREE.Vector3 }) {
    this.keys = [{ t: 0, p: snap.pos.clone(), v: snap.vel.clone() }];
  }
  at(t: number, posture: THREE.Vector3, vel: Vel = 'auto'): this {
    this.keys.push({ t, p: posture.clone(), v: vel });
    return this;
  }
  track(): PosTrack {
    const ks = this.keys;
    if (ks.length > 1) ks[ks.length - 1]!.v = 'stop';
    return new PosTrack(ks, 4);
  }
}

interface Req {
  h: HandName;
  grip: THREE.Vector3;
  q: THREE.Quaternion;
  weight?: number;
}

/** Posture (lean, side, twist) that lets every listed hand reach its grip target, with a little extra lean for far work. */
function postureFor(reqs: Req[], maxLean: number = DIM.maxPlaceLean, reduced = false): THREE.Vector3 {
  const rr: ReachRequest[] = reqs.map((r) => {
    const w = wristOf(r.grip, r.q);
    return { side: sideOf(r.h), wrist: { x: w.x, y: w.y, z: w.z }, weight: r.weight };
  });
  const c = choosePosture(rr, maxLean, NEUTRAL_BODY.x);
  const k = reduced ? 0.6 : 1;
  return v(c.posture.lean, c.posture.side * k, c.posture.twist * k);
}

/** Pull a grip target back inside comfortable reach (with up to `maxLean`), keeping it above the felt. */
function clampReach(h: HandName, grip: THREE.Vector3, q: THREE.Quaternion, maxLean: number = DIM.maxPlaceLean): THREE.Vector3 {
  const s = sideOf(h);
  const w = wristOf(grip, q);
  const c = choosePosture([{ side: s, wrist: { x: w.x, y: w.y, z: w.z } }], maxLean, NEUTRAL_BODY.x);
  if (c.shortfall <= 0) return grip.clone();
  const sh = toV(shoulderPosition(s, c.posture, { x: w.x, y: w.y, z: w.z }));
  const d = w.clone().sub(sh);
  const len = d.length();
  const max = ARM_REACH * COMFORT;
  if (len <= max || len < 1e-6) return grip.clone();
  const nw = sh.add(d.multiplyScalar(max / len));
  const out = nw.add(GRIP.clone().applyQuaternion(q));
  out.y = Math.max(out.y, 0.012);
  return out;
}

function look(keys: [number, THREE.Vector3 | null][]): StepTrack<THREE.Vector3 | null> {
  return new StepTrack(keys.map(([t, p]) => ({ t, v: p ? p.clone() : null })));
}

/** Relax a hand to its neutral stance between t0 and t1 (with a soft lift so it never drags across the rack). */
function relax(k: HandKeys, ctx: BuildCtx, t0: number, t1: number, lift = 0.03): void {
  const n = neutralHand(k.h, ctx.deckInHand);
  const from = k.lastPos();
  if (from.distanceTo(n.pos) > 0.08 && t1 - t0 > 0.05) {
    const mid = from.clone().lerp(n.pos, 0.5);
    mid.y = Math.max(mid.y, Math.max(from.y, n.pos.y) + lift * (ctx.reduced ? 0.4 : 1));
    k.p(t0 + (t1 - t0) * 0.5, mid, 'auto');
  }
  k.key(t1, n.pos, n.rot, undefined, 'stop');
  k.f(t1, n.fingers);
}

function finish(ctx: BuildCtx, L: HandKeys, R: HandKeys, body: BodyKeys, rest: Partial<Built> & { handoff: number }): Built {
  return {
    duration: ctx.D,
    handoff: clamp(rest.handoff, 0, ctx.D),
    L: L.track(),
    R: R.track(),
    body: body.track(),
    look: rest.look,
    card: rest.card,
    decks: rest.decks,
    events: (rest.events ?? []).sort((a, b) => a.t - b.t),
  };
}

const safeCall = <A extends unknown[]>(fn: ((...a: A) => void) | undefined, ...args: A) => {
  if (!fn) return;
  try {
    fn(...args);
  } catch (err) {
    console.error('[dealer] gesture callback failed', err);
  }
};

/** Point where the left hand passes a drawn card to the right: as close to the shoe as the right hand comfortably reaches. */
function handoffPoint(M: THREE.Vector3): THREE.Vector3 {
  const y = 0.1;
  const z = clamp(M.z, 0.26, 0.34);
  for (let x = Math.min(M.x - 0.1, 0.34); x > -0.1; x -= 0.02) {
    const e = reachFor(-1, { x: x - 0.026, y, z }, { x: 0.8, y: 0, z: 1 }, 0.42, [0.5]);
    if (e.choice.shortfall <= 0) return v(x, y, z);
  }
  return v(0.12, y, z);
}

// ───────────────────────── gestures ─────────────────────────

export interface DealOpts {
  onRelease?: (p: THREE.Vector3) => void;
}

/** Blackjack: left hand draws from the shoe and passes the card; right hand delivers (place or pitch). */
export function buildDealFromShoe(shoeW: THREE.Vector3, targetW: THREE.Vector3, o: DealOpts, mode: 'deal' | 'burn' = 'deal'): Builder {
  return (ctx) => {
    const D = ctx.D;
    const M = safe(ctx.toLocal(shoeW), ctx.shoe);
    ctx.setShoe(M);
    const T = safe(ctx.toLocal(targetW), v(0, 0, 0.6));
    const red = ctx.reduced;
    const L = new HandKeys('L', ctx.L);
    const R = new HandKeys('R', ctx.R);
    const body = new BodyKeys(ctx.body);

    const H = handoffPoint(M);
    const LH = H.clone().add(v(0.03, 0.002, -0.006));
    const RH = H.clone().add(v(-0.028, 0.006, 0.006));
    // Left hand on the card in the shoe's mouth, fingers along the reach.
    const shL = toV(shoulderPosition(1, { lean: 0.2, side: 0.08, twist: 0 }));
    const headingM = headingTo(shL, M);
    const pressQ = handQuat('L', headingM, 0.85, 0.05);
    const Mpress = clampReach('L', M.clone().add(v(0, 0.012, 0)), pressQ, 0.42);
    const Mwait = clampReach('L', M.clone().add(v(-0.03, 0.045, -0.015)), pressQ, 0.42);
    const drawQ = handQuat('L', headingTo(shL, LH).lerp(v(-0.4, 0, 1).normalize(), 0.4).normalize(), 0.55, 0.15);

    const tPress = 0.06 * D;
    const tH = 0.3 * D;
    const tGrab = 0.31 * D;
    const tRel = 0.6 * D;
    // Left: press, draw out and across, pass, go back to wait over the shoe, press on the next card.
    L.key(tPress, Mpress, pressQ, 'press');
    const drawMid = Mpress.clone().lerp(LH, 0.5);
    drawMid.y += red ? 0.008 : 0.022;
    L.p(0.18 * D, drawMid, 'auto').q(0.18 * D, drawQ);
    L.key(tH, LH, drawQ, 'grip');
    L.f(0.42 * D, 'rest');
    const backMid = LH.clone().lerp(Mwait, 0.5);
    backMid.y += red ? 0.01 : 0.03;
    L.p(0.44 * D, backMid, 'auto');
    L.key(0.58 * D, Mwait, pressQ, undefined);
    if (mode === 'deal') L.key(D, Mpress, pressQ, 'press');
    else L.key(D, Mwait, pressQ, 'rest');

    // Right: meet the card, take it, carry it out and let it go.
    const takeQ = handQuat('R', v(0.85, 0, 1), 0.5, 0.05);
    if (ctx.R.pos.distanceTo(RH) > 0.12) {
      const mid = ctx.R.pos.clone().lerp(RH, 0.55);
      mid.y = Math.max(mid.y, RH.y) + (red ? 0.01 : 0.035);
      R.p(0.15 * D, mid, 'auto');
    }
    R.key(tH, RH, takeQ, 'pinch');
    R.f(tGrab + 0.04 * D, 'grip');
    const isBurn = mode === 'burn';
    const budget = Math.max(0.14, 2.6 * (tRel - tGrab));
    const plan = planDelivery({ x: T.x, y: T.y, z: T.z }, -1, {
      from: { x: RH.x, y: RH.y, z: RH.z },
      maxTravel: isBurn ? undefined : budget,
      hover: isBurn ? 0.04 : 0.028,
      placeY: isBurn ? 0.035 : 0.006,
      maxPitchLean: 0.36,
      maxPlaceLean: DIM.maxPlaceLean,
    });
    const P = toV(plan.release);
    const relQ = handQuat('R', toV(plan.heading), plan.pitchDown, 0.05);
    const carryMid = RH.clone().lerp(P, 0.5);
    carryMid.y = Math.max(RH.y, P.y) + (red ? 0.01 : 0.03 + 0.05 * Math.min(1, RH.distanceTo(P)));
    R.p(0.45 * D, carryMid, 'auto').q(0.45 * D, takeQ.clone().slerp(relQ, 0.5));
    const Rwait = clampReach('R', RH.clone().add(v(-0.07, 0.035, -0.035)), takeQ);
    if (plan.mode === 'pitch') {
      R.key(tRel, P, relQ, undefined, 'auto');
      R.f(tRel, 'open');
      const follow = P.clone().addScaledVector(toV(plan.heading), red ? 0.015 : 0.05).add(v(0, red ? 0.004 : 0.014, 0));
      const flick = handQuat('R', toV(plan.heading), plan.pitchDown + (red ? 0.08 : 0.3), 0.12);
      R.p(0.7 * D, follow, 'auto').q(0.7 * D, flick, 'out');
    } else {
      R.key(tRel, P, relQ, undefined, 'stop');
      R.f(tRel + 0.04 * D, 'open');
      R.p(0.74 * D, P.clone().add(v(0, red ? 0.02 : 0.04, -0.02)), 'auto');
    }
    R.key(D, Rwait, takeQ, 'rest');

    // Torso: turn toward the shoe while drawing, lean out for the delivery, settle between.
    const pDraw = postureFor([
      { h: 'L', grip: Mpress, q: pressQ, weight: 1 },
      { h: 'R', grip: RH, q: takeQ, weight: 0.6 },
    ], 0.42, red);
    const pTake = postureFor([
      { h: 'L', grip: LH, q: drawQ, weight: 0.5 },
      { h: 'R', grip: RH, q: takeQ },
    ], 0.42, red);
    const pRel = v(plan.posture.lean, plan.posture.side * (red ? 0.6 : 1), plan.posture.twist * (red ? 0.6 : 1));
    const pWait = postureFor([
      { h: 'L', grip: Mwait, q: pressQ },
      { h: 'R', grip: Rwait, q: takeQ },
    ], 0.42, red);
    body.at(0.12 * D, pDraw).at(tH, pTake).at(tRel, pRel).at(D, pWait);

    const events = [
      {
        t: tRel,
        fire: () => safeCall(o.onRelease, ctx.gripWorld('R')),
      },
    ];
    return finish(ctx, L, R, body, {
      handoff: 0.88 * D,
      look: look([
        [0, M],
        [0.24 * D, T],
        [0.8 * D, mode === 'deal' ? M : null],
      ]),
      card: new StepTrack<HandName | null>([
        { t: tPress, v: 'L' },
        { t: tGrab, v: 'R' },
        { t: tRel, v: null },
      ]),
      events,
    });
  };
}

/** Deck block centre (rig space) for the left hand in its current state. */
function deckCentreFrom(snap: HandSnap): THREE.Vector3 {
  const local = deckCentreLocal(1).sub(GRIP);
  return local.applyQuaternion(snap.rot).add(snap.pos);
}

/** Hold'em: deck in the left hand, thumb pushes the top card, right hand takes it and pitches it. */
export function buildDealFromHand(targetW: THREE.Vector3 | null, o: DealOpts, mode: 'deal' | 'burn' = 'deal'): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const L = new HandKeys('L', ctx.L);
    const R = new HandKeys('R', ctx.R);
    const body = new BodyKeys(ctx.body);
    const T = targetW ? safe(ctx.toLocal(targetW), v(0, 0, 0.6)) : ctx.muck.clone();

    // Left presents the deck, tilting it a touch toward the target, and thumbs the top card over.
    const nL = neutralHand('L', true);
    const aim = clamp(Math.atan2(T.x - DECK_HOLD.x, T.z - DECK_HOLD.z) * 0.12, -0.12, 0.12);
    const holdQ = handQuat('L', v(-0.5, 0, 1).applyAxisAngle(v(0, 1, 0), aim), 0.22, 1.2);
    const holdPos = gripForDeck('L', DECK_HOLD, holdQ);
    const pushQ = handQuat('L', v(-0.5, 0, 1).applyAxisAngle(v(0, 1, 0), aim), 0.2, 1.05);
    L.key(0.1 * D, holdPos, holdQ, 'deck');
    L.f(0.18 * D, 'push').f(0.36 * D, 'deck');
    L.q(0.22 * D, pushQ).q(0.5 * D, holdQ);
    L.key(D, nL.pos, nL.rot, 'deck');

    // Top card position: deck top face, slid ~3 cm toward the right hand.
    const deckC = DECK_HOLD.clone();
    const deckUp = new THREE.Vector3(0, 0, -1).applyQuaternion(pushQ); // palm side of the left hand = top of the deck
    const top = deckC.clone().addScaledVector(deckUp, 0.0095).add(v(-0.032, 0.002, 0.004));
    const takeQ = handQuat('R', v(0.75, 0, 1), 0.38, 0.0);
    const Rt = gripFromContact(top, takeQ, CONTACT.grip);
    if (ctx.R.pos.distanceTo(Rt) > 0.1) {
      const mid = ctx.R.pos.clone().lerp(Rt, 0.5);
      mid.y = Math.max(mid.y, Rt.y) + (red ? 0.008 : 0.025);
      R.p(0.14 * D, mid, 'auto');
    }
    const tTake = 0.3 * D;
    const tRel = (mode === 'burn' ? 0.66 : 0.62) * D;
    R.key(tTake, Rt, takeQ, 'pinch');
    R.f(tTake + 0.05 * D, 'grip');
    const plan = planDelivery({ x: T.x, y: T.y, z: T.z }, -1, {
      from: { x: Rt.x, y: Rt.y, z: Rt.z },
      pitchOnly: mode === 'deal',
      maxTravel: mode === 'deal' ? Math.min(0.24, Math.max(0.1, 2.6 * (tRel - tTake))) : undefined,
      hover: 0.045,
      placeY: 0.008,
      maxPitchLean: 0.24,
    });
    const P = toV(plan.release);
    const relQ = handQuat('R', toV(plan.heading), plan.pitchDown, 0.1);
    // A short wind-up (wrist cocks back) then the flick out.
    const wind = Rt.clone().add(v(-0.012, 0.012, -0.01));
    R.p(tTake + 0.08 * D, wind, 'auto').q(tTake + 0.08 * D, handQuat('R', toV(plan.heading), plan.pitchDown - (red ? 0.05 : 0.25), 0.1));
    R.key(tRel, P, relQ, undefined, plan.mode === 'pitch' ? 'auto' : 'stop');
    R.f(tRel, 'open');
    if (plan.mode === 'pitch') {
      const follow = P.clone().addScaledVector(toV(plan.heading), red ? 0.012 : 0.04).add(v(0, red ? 0.002 : 0.008, 0));
      R.p(0.72 * D, follow, 'auto').q(0.72 * D, handQuat('R', toV(plan.heading), plan.pitchDown + (red ? 0.06 : 0.32), 0.15), 'out');
    } else R.p(0.78 * D, P.clone().add(v(0, 0.035, -0.015)), 'auto');
    const nR = neutralHand('R', true);
    R.key(D, nR.pos.clone().lerp(Rt, 0.35), nR.rot, 'rest');

    const pTake = postureFor([
      { h: 'L', grip: holdPos, q: holdQ, weight: 0.5 },
      { h: 'R', grip: Rt, q: takeQ },
    ], 0.3, red);
    const pRel = v(plan.posture.lean, plan.posture.side * (red ? 0.6 : 1), plan.posture.twist * (red ? 0.6 : 1));
    body.at(tTake, pTake).at(tRel, pRel).at(D, postureFor([{ h: 'L', grip: nL.pos, q: nL.rot }], 0.3, red));

    return finish(ctx, L, R, body, {
      handoff: 0.8 * D,
      look: look([
        [0, deckC],
        [0.2 * D, T],
        [0.85 * D, null],
      ]),
      card: new StepTrack<HandName | null>([
        { t: tTake, v: 'R' },
        { t: tRel, v: null },
      ]),
      decks: new ArrTrack([
        { t: 0, a: ctx.decks },
        { t: 0.1 * D, a: [1, 0] },
      ], 2),
      events: [{ t: tRel, fire: () => safeCall(o.onRelease, ctx.gripWorld('R')) }],
    });
  };
}

/** Which hand works a spot: the left only for things clearly on its side. */
const handFor = (p: THREE.Vector3, bias = 0.26): HandName => (p.x > bias ? 'L' : 'R');

/** Turn a card over on the felt: pinch the near edge, lift and roll it over away from the dealer, pat it down. */
export function buildFlip(atW: THREE.Vector3, o: { onFlip?: () => void }): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const A = safe(ctx.toLocal(atW), v(0, 0, 0.46));
    const h = handFor(A);
    const s = sideOf(h);
    const keys = { L: new HandKeys('L', ctx.L), R: new HandKeys('R', ctx.R) };
    const k = keys[h];
    const other = keys[h === 'L' ? 'R' : 'L'];
    const body = new BodyKeys(ctx.body);
    const dir = headingTo(v(s * 0.12, 0, 0.1), A);
    const qDown = handQuat(h, dir, 0.75, 0.1);
    const edge = A.clone().addScaledVector(dir, -0.04);
    edge.y = Math.max(0, A.y) + 0.004;
    const E = clampReach(h, gripFromContact(edge, qDown, CONTACT.pads), qDown);
    const lift = red ? 0.035 : 0.065;
    const up = E.clone().addScaledVector(dir, 0.03).add(v(0, lift, 0));
    const qUp = handQuat(h, dir, -0.35, red ? 0.35 : 0.7);
    const over = clampReach(h, gripFromContact(A.clone().addScaledVector(dir, 0.015).add(v(0, 0.012, 0)), qDown, CONTACT.palm), qDown);
    k.p(0.2 * D, E.clone().add(v(0, 0.05, 0)), 'auto').q(0.2 * D, qDown).f(0.2 * D, 'cup');
    k.key(0.34 * D, E, qDown, 'pinch');
    k.key(0.52 * D, up, qUp, undefined, 'auto');
    k.f(0.58 * D, 'flat');
    k.key(0.7 * D, over, qDown, undefined, 'auto');
    k.p(0.78 * D, over.clone().add(v(0, -0.004, 0)), 'stop');
    relax(k, ctx, 0.78 * D, D);
    relax(other, ctx, 0, 0.7 * D, 0.01);
    body.at(0.34 * D, postureFor([{ h, grip: E, q: qDown }], DIM.maxPlaceLean, red)).at(0.6 * D, postureFor([{ h, grip: up, q: qUp }], DIM.maxPlaceLean, red)).at(D, NEUTRAL_BODY);
    return finish(ctx, keys.L, keys.R, body, {
      handoff: 0.9 * D,
      look: look([
        [0, A],
        [0.85 * D, null],
      ]),
      events: [{ t: 0.52 * D, fire: () => safeCall(o.onFlip) }],
    });
  };
}

/** Peek at the hole card: fingers on the card, lift the near corner, a look, lower it. */
export function buildPeek(atW: THREE.Vector3): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const A = safe(ctx.toLocal(atW), v(0.035, 0, 0.46));
    const h = handFor(A, 0.3);
    const s = sideOf(h);
    const keys = { L: new HandKeys('L', ctx.L), R: new HandKeys('R', ctx.R) };
    const k = keys[h];
    const other = keys[h === 'L' ? 'R' : 'L'];
    const body = new BodyKeys(ctx.body);
    const dir = headingTo(v(s * 0.12, 0, 0.1), A);
    const corner = A.clone().addScaledVector(dir, -0.032).add(v(-s * 0.018, Math.max(0, A.y) + 0.004, 0));
    const qPress = handQuat(h, dir, 0.9, 0.12);
    const qLift = handQuat(h, dir, red ? 0.7 : 0.45, 0.3);
    const C = clampReach(h, gripFromContact(corner, qPress, CONTACT.pads), qPress);
    const Cl = C.clone().add(v(0, red ? 0.006 : 0.014, 0));
    k.p(0.2 * D, C.clone().add(v(0, 0.045, 0)), 'auto').q(0.2 * D, qPress).f(0.2 * D, 'press');
    k.key(0.32 * D, C, qPress, 'press');
    k.key(0.44 * D, Cl, qLift, 'pinch');
    k.key(0.68 * D, Cl.clone().add(v(0, 0.002, 0)), qLift);
    k.key(0.8 * D, C, qPress, 'press');
    relax(k, ctx, 0.8 * D, D);
    relax(other, ctx, 0, 0.6 * D, 0.01);
    const pp = postureFor([{ h, grip: C, q: qPress }], DIM.maxPlaceLean, red);
    const ppLook = pp.clone().add(v(red ? 0.02 : 0.05, 0, 0));
    body.at(0.32 * D, pp).at(0.5 * D, ppLook).at(0.68 * D, ppLook).at(D, NEUTRAL_BODY);
    return finish(ctx, keys.L, keys.R, body, {
      handoff: 0.92 * D,
      look: look([
        [0, A],
        [0.88 * D, null],
      ]),
      events: [],
    });
  };
}

/** Collect cards: one continuous sweeping pass over the spots, then into the discard tray. */
export function buildSweep(fromW: THREE.Vector3[], toW: THREE.Vector3, o: { onGrab?: (i: number) => void }): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const L = new HandKeys('L', ctx.L);
    const R = new HandKeys('R', ctx.R);
    const body = new BodyKeys(ctx.body);
    const to = safe(ctx.toLocal(toW), ctx.discard);
    // Group nearby cards into waypoints; keep the caller's order.
    const pts = fromW.map((p) => safe(ctx.toLocal(p), v(0, 0, 0.5)));
    const way: { p: THREE.Vector3; idx: number[] }[] = [];
    pts.forEach((p, i) => {
      const w = way.find((x) => x.p.distanceTo(p) < 0.09);
      if (w) w.idx.push(i);
      else way.push({ p: p.clone(), idx: [i] });
    });
    const events: { t: number; fire: () => void }[] = [];
    const N = way.length;
    const t0 = 0.16 * D;
    const t1 = 0.62 * D;
    const looks: [number, THREE.Vector3 | null][] = [[0, way[0]?.p ?? to]];
    let prevQ = ctx.R.rot.clone();
    way.forEach((w, i) => {
      const t = N <= 1 ? 0.34 * D : t0 + ((t1 - t0) * i) / (N - 1);
      const dir = headingTo(v(-0.08, 0, 0.1), w.p);
      const q = handQuat('R', dir, 0.75, 0.15);
      const contact = w.p.clone();
      contact.y = Math.max(0, contact.y) + 0.008;
      const C = clampReach('R', gripFromContact(contact, q, CONTACT.pads), q);
      if (i === 0) {
        R.p(t - 0.08 * D, C.clone().add(v(0, red ? 0.02 : 0.05, 0)), 'auto').q(t - 0.08 * D, q).f(t - 0.08 * D, 'cup');
      }
      R.key(t, C, q, 'cup', 'auto');
      prevQ = q;
      for (const idx of w.idx) events.push({ t, fire: () => safeCall(o.onGrab, idx) });
      looks.push([Math.max(0, t - 0.1 * D), w.p]);
      body.at(t, postureFor([{ h: 'R', grip: C, q }], DIM.maxPlaceLean, red));
    });
    // to the tray
    const trayQ = handQuat('R', headingTo(v(-0.1, 0, 0.1), to), 0.6, 0.1);
    const drop = clampReach('R', to.clone().add(v(0, 0.045, 0)), trayQ);
    const aboveTray = drop.clone().add(v(0, red ? 0.02 : 0.05, 0));
    R.p(0.76 * D, aboveTray, 'auto').q(0.76 * D, prevQ.clone().slerp(trayQ, 0.6)).f(0.76 * D, 'grip');
    R.key(0.84 * D, drop, trayQ, 'open');
    relax(R, ctx, 0.84 * D, D);
    relax(L, ctx, 0, 0.5 * D, 0.01);
    body.at(0.84 * D, postureFor([{ h: 'R', grip: drop, q: trayQ }], DIM.maxPlaceLean, red)).at(D, NEUTRAL_BODY);
    looks.push([0.68 * D, to], [0.92 * D, null]);
    return finish(ctx, L, R, body, { handoff: 0.92 * D, look: look(looks), events });
  };
}

/** Pay / push a pot: scoop chips at the rack, slide them out toward `to`, let them go. */
export function buildPushChips(toW: THREE.Vector3, o: { onRelease?: () => void }): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const T = safe(ctx.toLocal(toW), v(0, 0, 0.7));
    const h = handFor(T, 0.3);
    const s = sideOf(h);
    const keys = { L: new HandKeys('L', ctx.L), R: new HandKeys('R', ctx.R) };
    const k = keys[h];
    const other = keys[h === 'L' ? 'R' : 'L'];
    const body = new BodyKeys(ctx.body);
    const rackX = clamp(T.x * 0.35, -0.17, 0.17);
    const rackTop = v(rackX, ctx.rack.y + 0.05, ctx.rack.z + 0.01);
    const dirOut = headingTo(v(rackX, 0, ctx.rack.z), T);
    const qScoop = handQuat(h, dirOut, 0.85, 0.1);
    const qPush = handQuat(h, dirOut, 0.55, 0.05);
    const grab = clampReach(h, gripFromContact(rackTop, qScoop, CONTACT.pads), qScoop);
    const front = v(rackX, 0.022, ctx.rack.z + 0.09);
    const start = clampReach(h, gripFromContact(front, qPush, CONTACT.pads), qPush);
    const plan = planDelivery({ x: T.x, y: 0, z: T.z }, s, {
      from: { x: start.x, y: start.y, z: start.z },
      pitchOnly: true,
      maxTravel: red ? 0.16 : 0.32,
      hover: Math.max(0.02, start.y),
      maxPitchLean: 0.36,
      pitchDown: 0.55,
    });
    const P = clampReach(h, toV(plan.release), qPush, 0.4);
    k.p(0.12 * D, grab.clone().add(v(0, 0.04, 0)), 'auto').q(0.12 * D, qScoop).f(0.12 * D, 'cup');
    k.key(0.24 * D, grab, qScoop, 'cup');
    k.p(0.32 * D, grab.clone().lerp(start, 0.5).add(v(0, 0.035, 0)), 'auto');
    k.key(0.42 * D, start, qPush, 'cup');
    k.key(0.7 * D, P, qPush, 'flat', 'auto');
    k.p(0.78 * D, P.clone().addScaledVector(dirOut, red ? 0.008 : 0.025).add(v(0, 0.01, 0)), 'auto');
    relax(k, ctx, 0.78 * D, D);
    relax(other, ctx, 0, 0.6 * D, 0.01);
    body.at(0.24 * D, postureFor([{ h, grip: grab, q: qScoop }], 0.4, red)).at(0.7 * D, postureFor([{ h, grip: P, q: qPush }], 0.4, red)).at(D, NEUTRAL_BODY);
    return finish(ctx, keys.L, keys.R, body, {
      handoff: 0.9 * D,
      look: look([
        [0, T],
        [0.9 * D, null],
      ]),
      events: [{ t: 0.7 * D, fire: () => safeCall(o.onRelease) }],
    });
  };
}

/** Collect a losing bet: reach behind the chips, rake them back to the rack. */
export function buildTakeChips(fromW: THREE.Vector3, o: { onGrab?: () => void }): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const F = safe(ctx.toLocal(fromW), v(0, 0, 0.7));
    const h = handFor(F, 0.3);
    const s = sideOf(h);
    const keys = { L: new HandKeys('L', ctx.L), R: new HandKeys('R', ctx.R) };
    const k = keys[h];
    const other = keys[h === 'L' ? 'R' : 'L'];
    const body = new BodyKeys(ctx.body);
    const dir = headingTo(v(s * 0.1, 0, 0.1), F);
    const qRake = handQuat(h, dir, 1.0, 0.1);
    const far = F.clone().addScaledVector(dir, 0.035);
    far.y = Math.max(0, F.y) + 0.012;
    const C = clampReach(h, gripFromContact(far, qRake, CONTACT.tips), qRake, 0.42);
    const rackX = clamp(F.x * 0.35, -0.17, 0.17);
    const back = clampReach(h, gripFromContact(v(rackX, 0.02, ctx.rack.z + 0.09), qRake, CONTACT.tips), qRake);
    k.p(0.26 * D, C.clone().add(v(0, red ? 0.025 : 0.055, 0)), 'auto').q(0.26 * D, qRake).f(0.26 * D, 'cup');
    k.key(0.4 * D, C, qRake, 'cup');
    k.key(0.72 * D, back, qRake, 'cup', 'auto');
    k.p(0.82 * D, back.clone().add(v(0, 0.045, -0.02)), 'auto');
    relax(k, ctx, 0.82 * D, D);
    relax(other, ctx, 0, 0.6 * D, 0.01);
    body.at(0.4 * D, postureFor([{ h, grip: C, q: qRake }], 0.42, red)).at(0.72 * D, postureFor([{ h, grip: back, q: qRake }], 0.42, red)).at(D, NEUTRAL_BODY);
    return finish(ctx, keys.L, keys.R, body, {
      handoff: 0.9 * D,
      look: look([
        [0, F],
        [0.85 * D, null],
      ]),
      events: [{ t: 0.4 * D, fire: () => safeCall(o.onGrab) }],
    });
  };
}

/** "Your turn": an open palm offered toward the player. */
export function buildPoint(atW: THREE.Vector3): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const A = safe(ctx.toLocal(atW), v(0, 0, 1));
    const h = handFor(A, 0.18);
    const s = sideOf(h);
    const keys = { L: new HandKeys('L', ctx.L), R: new HandKeys('R', ctx.R) };
    const k = keys[h];
    const other = keys[h === 'L' ? 'R' : 'L'];
    const body = new BodyKeys(ctx.body);
    const base = v(s * 0.14, 0.15, 0.2);
    const dir = headingTo(base, A);
    const q = handQuat(h, dir, -0.02, 1.4);
    const P = clampReach(h, base.clone().addScaledVector(dir, red ? 0.18 : 0.26), q, 0.25);
    k.key(0.36 * D, P, q, 'open');
    k.key(0.7 * D, P.clone().addScaledVector(dir, red ? 0.004 : 0.014).add(v(0, 0.004, 0)), q, 'open');
    relax(k, ctx, 0.7 * D, D);
    relax(other, ctx, 0, 0.5 * D, 0.01);
    const pp = postureFor([{ h, grip: P, q }], 0.25, red);
    body.at(0.36 * D, pp).at(0.7 * D, pp).at(D, NEUTRAL_BODY);
    return finish(ctx, keys.L, keys.R, body, {
      handoff: 0.92 * D,
      look: look([
        [0, A.clone().setY(Math.max(A.y, 0.3))],
        [0.95 * D, null],
      ]),
      events: [],
    });
  };
}

/** Knock twice on the felt with loose knuckles. */
export function buildTap(atW: THREE.Vector3): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const A = safe(ctx.toLocal(atW), v(0, 0, 0.45));
    const h = handFor(A);
    const s = sideOf(h);
    const keys = { L: new HandKeys('L', ctx.L), R: new HandKeys('R', ctx.R) };
    const k = keys[h];
    const other = keys[h === 'L' ? 'R' : 'L'];
    const body = new BodyKeys(ctx.body);
    const dir = headingTo(v(s * 0.12, 0, 0.1), A);
    const q = handQuat(h, dir, 0.3, 0.15);
    const touch = A.clone();
    touch.y = Math.max(0, A.y) + 0.004;
    const C = clampReach(h, gripFromContact(touch, q, CONTACT.knuckles), q);
    const hop = red ? 0.012 : 0.03;
    k.p(0.24 * D, C.clone().add(v(0, 0.06, 0)), 'auto').q(0.24 * D, q).f(0.24 * D, 'tap');
    k.p(0.38 * D, C, 'stop');
    k.p(0.47 * D, C.clone().add(v(0, hop, 0)), 'stop');
    k.p(0.56 * D, C, 'stop');
    k.p(0.68 * D, C.clone().add(v(0, hop * 1.4, -0.01)), 'auto');
    relax(k, ctx, 0.68 * D, D);
    relax(other, ctx, 0, 0.5 * D, 0.01);
    const pp = postureFor([{ h, grip: C, q }], DIM.maxPlaceLean, red);
    body.at(0.38 * D, pp).at(0.56 * D, pp).at(D, NEUTRAL_BODY);
    return finish(ctx, keys.L, keys.R, body, {
      handoff: 0.88 * D,
      look: look([
        [0, A],
        [0.8 * D, null],
      ]),
      events: [],
    });
  };
}

/** Reshuffle flourish: split, riffle, square — twice — then load the shoe (or keep the deck in hand). */
export function buildShuffle(): Builder {
  return (ctx) => {
    const D = ctx.D;
    const red = ctx.reduced;
    const L = new HandKeys('L', ctx.L);
    const R = new HandKeys('R', ctx.R);
    const body = new BodyKeys(ctx.body);
    const C = v(0.0, 0.032, 0.34);
    const qL = (sup: number, pitch = 0.45) => handQuat('L', v(-0.35, 0, 1), pitch, sup);
    const qR = (sup: number, pitch = 0.45) => handQuat('R', v(0.35, 0, 1), pitch, sup);
    // Packets sit under the palms; hands hold them by the ends.
    const at = (h: 'L' | 'R', x: number, y: number, q: THREE.Quaternion) => clampReach(h, gripForDeck(h, v(x, C.y + y, C.z), q), q);
    const wide = red ? 0.085 : 0.11;
    const near = 0.056;
    const decks: ArrKey[] = [{ t: 0, a: ctx.decks }];
    const riffle = (t0: number, t1: number) => {
      const qa = qL(red ? 0.25 : 0.55, 0.3);
      const qb = qR(red ? 0.25 : 0.55, 0.3);
      L.key(t0, at('L', wide, 0.01, qa), qa, 'riffle');
      R.key(t0, at('R', -wide, 0.01, qb), qb, 'riffle');
      const n = red ? 1 : 3;
      for (let i = 1; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / (n + 1);
        const x = wide + (near - wide) * (i / (n + 1));
        const bounce = i % 2 ? 0.012 : 0.004;
        L.p(t, at('L', x, bounce, qa), 'auto');
        R.p(t, at('R', -x, bounce, qb), 'auto');
      }
      const qa2 = qL(0.05, 0.5);
      const qb2 = qR(0.05, 0.5);
      L.key(t1, at('L', near * 0.62, 0, qa2), qa2, 'grip');
      R.key(t1, at('R', -near * 0.62, 0.006, qb2), qb2, 'grip');
      decks.push({ t: t0, a: [0.5, 0.5] }, { t: t1 - 0.02 * D, a: [0.5, 0.5] }, { t: t1 + 0.02 * D, a: [1, 0] });
    };
    const square = (t0: number, t1: number) => {
      const q = qL(0.05, 0.5);
      const base = at('L', 0.012, 0, q);
      const qTop = qR(0, 0.7);
      const top = gripFromContact(v(-0.01, C.y + 0.035, C.z), qTop, CONTACT.pads);
      L.key(t0, base, q, 'grip');
      R.key(t0, top, qTop, 'flat');
      R.p((t0 + t1) / 2, top.clone().add(v(0, red ? 0.004 : 0.012, 0)), 'auto');
      R.p(t1, top, 'stop');
    };
    const split = (t0: number, t1: number) => {
      const qa = qL(0.15, 0.4);
      const qb = qR(0.15, 0.4);
      L.key(t1, at('L', wide, 0.01, qa), qa, 'grip');
      R.key(t1, at('R', -wide, 0.01, qb), qb, 'grip');
      decks.push({ t: t0, a: [1, 0] }, { t: t0 + (t1 - t0) * 0.5, a: [0.5, 0.5] });
    };
    // gather: hands meet with the packets
    const q0L = qL(0.15, 0.4);
    const q0R = qR(0.15, 0.4);
    L.key(0.1 * D, at('L', 0.07, 0.015, q0L), q0L, 'grip');
    R.key(0.1 * D, at('R', -0.07, 0.015, q0R), q0R, 'grip');
    decks.push({ t: 0.04 * D, a: [0, 0] }, { t: 0.12 * D, a: [0.5, 0.5] });
    split(0.12 * D, 0.2 * D);
    riffle(0.2 * D, 0.44 * D);
    square(0.47 * D, 0.56 * D);
    split(0.56 * D, 0.62 * D);
    riffle(0.62 * D, 0.8 * D);
    square(0.82 * D, 0.87 * D);
    if (ctx.deckInHand) {
      relax(L, ctx, 0.87 * D, D);
      relax(R, ctx, 0.87 * D, D);
      decks.push({ t: D, a: [1, 0] });
    } else {
      // Load the shoe with the left hand.
      const M = ctx.shoe.clone();
      const qLoad = handQuat('L', headingTo(v(0.19, 0, 0), M), 0.6, 0.2);
      const load = clampReach('L', gripForDeck('L', M.clone().add(v(0.01, 0.05, -0.05)), qLoad), qLoad, 0.42);
      const mid = L.lastPos().clone().lerp(load, 0.5).add(v(0, red ? 0.02 : 0.06, 0));
      L.p(0.91 * D, mid, 'auto').q(0.91 * D, qLoad);
      L.key(0.96 * D, load, qLoad, 'grip');
      decks.push({ t: 0.955 * D, a: [1, 0] }, { t: 0.975 * D, a: [0, 0] });
      relax(R, ctx, 0.87 * D, D);
      L.key(D, load.clone().add(v(-0.03, 0.04, -0.02)), qLoad, 'rest');
    }
    const pC = postureFor([
      { h: 'L', grip: at('L', near, 0, qL(0.4)), q: qL(0.4) },
      { h: 'R', grip: at('R', -near, 0, qR(0.4)), q: qR(0.4) },
    ], 0.4, red);
    body.at(0.12 * D, pC).at(0.8 * D, pC);
    if (!ctx.deckInHand) body.at(0.95 * D, postureFor([{ h: 'L', grip: L.lastPos(), q: qL(0.2) }], 0.42, red));
    body.at(D, NEUTRAL_BODY);
    return finish(ctx, L, R, body, {
      handoff: 0.96 * D,
      look: look([
        [0, C],
        [0.86 * D, ctx.deckInHand ? null : ctx.shoe],
        [0.97 * D, null],
      ]),
      decks: new ArrTrack(decks, 2),
      events: [],
    });
  };
}

/** Return both hands to the resting stance (used internally when idle). */
export function buildSettle(): Builder {
  return (ctx) => {
    const L = new HandKeys('L', ctx.L);
    const R = new HandKeys('R', ctx.R);
    const body = new BodyKeys(ctx.body);
    relax(L, ctx, 0, ctx.D, 0.02);
    relax(R, ctx, 0, ctx.D, 0.02);
    body.at(ctx.D, NEUTRAL_BODY);
    return finish(ctx, L, R, body, {
      handoff: 0,
      decks: new ArrTrack(
        [
          { t: 0, a: ctx.decks },
          { t: ctx.D * 0.6, a: [ctx.deckInHand ? 1 : 0, 0] },
        ],
        2,
      ),
      events: [],
    });
  };
}
