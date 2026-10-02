/**
 * Pure maths for the dealer rig: two-bone IK, the torso/shoulder forward kinematics shared by the planner
 * and the runtime, and the reach planner that decides whether a hand can place a card or has to pitch it.
 *
 * No Three.js imports — everything works on plain `{x, y, z}` objects so it is unit-testable in Node.
 * Coordinates are rig-local: metres, Y up, felt at y = 0, the dealer stands at the origin facing +Z,
 * his left hand is on +X.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** +1 = the dealer's left arm (on +X), −1 = his right arm (on −X). */
export type Side = 1 | -1;

const EPS = 1e-9;
const DEG = Math.PI / 180;

// ───────────────────────── tiny vector kit ─────────────────────────

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const dist = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => vec(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const finite = (a: Vec3): boolean => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** Normalised copy, or `fallback` when the vector is (almost) zero or not finite. */
export function normalize(a: Vec3, fallback: Vec3 = vec(0, 0, 1)): Vec3 {
  const l = length(a);
  if (!(l > EPS) || !Number.isFinite(l)) return { ...fallback };
  return scale(a, 1 / l);
}

/** Component of `a` perpendicular to unit vector `n`. */
export const perp = (a: Vec3, n: Vec3): Vec3 => madd(a, n, -dot(a, n));

/** Any unit vector perpendicular to unit vector `n`, preferring the projection of `hint`. */
export function anyPerp(n: Vec3, hint: Vec3 = vec(0, -1, 0)): Vec3 {
  for (const h of [hint, vec(0, -1, 0), vec(1, 0, 0), vec(0, 0, 1)]) {
    const p = perp(h, n);
    if (length(p) > 1e-6) return normalize(p);
  }
  return vec(1, 0, 0);
}

/** Rotate `v` about unit `axis` by `angle` (Rodrigues). */
export function rotateAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot(axis, v) * (1 - c);
  const x = cross(axis, v);
  return vec(v.x * c + x.x * s + axis.x * k, v.y * c + x.y * s + axis.y * k, v.z * c + x.z * s + axis.z * k);
}

// ───────────────────────── 3×3 rotation matrices (row-major) ─────────────────────────

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const M3_ID: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function m3RotX(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
export function m3RotY(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function m3RotZ(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
export function m3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return r;
}
export function m3Apply(m: Mat3, v: Vec3): Vec3 {
  return vec(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z);
}
export function m3ApplyT(m: Mat3, v: Vec3): Vec3 {
  return vec(m[0] * v.x + m[3] * v.y + m[6] * v.z, m[1] * v.x + m[4] * v.y + m[7] * v.z, m[2] * v.x + m[5] * v.y + m[8] * v.z);
}
/** Same convention as THREE.Euler(x, y, z, 'YXZ'): R = Ry · Rx · Rz. */
export function m3EulerYXZ(x: number, y: number, z: number): Mat3 {
  return m3Mul(m3Mul(m3RotY(y), m3RotX(x)), m3RotZ(z));
}

// ───────────────────────── skeleton proportions ─────────────────────────

/**
 * Rest proportions of the dealer skeleton. The runtime rig is built from exactly these numbers, so the
 * planner's shoulder positions match what is rendered.
 */
export const DIM = {
  /** Pelvis bone (never leans; the trousers hang from it). */
  hipsY: 0.12,
  /** spine1 sits 0.10 above the pelvis (y = 0.22): the forward lean pivots here. */
  spine1: 0.1,
  spine2: 0.13,
  chest: 0.13,
  neck: vec(0, 0.2, -0.005),
  head: vec(0, 0.11, 0.012),
  /** Head centre above the head bone. */
  headCentre: 0.07,
  /** Clavicle root in chest space (x is mirrored per side). */
  clavicle: vec(0.025, 0.145, -0.008),
  /** Shoulder joint in clavicle space (x mirrored). Shoulders land at (±0.19, 0.64, 0). */
  shoulder: vec(0.165, 0.015, 0.008),
  upperArm: 0.295,
  forearm: 0.27,
  palm: 0.09,
  /** Card-grip socket in hand space (+Y along the fingers, +Z back of the hand). Where a held card's centre sits. */
  grip: vec(0, 0.158, -0.036),
  /** Lean / twist / side-bend shares of spine1, spine2, chest. */
  leanW: [0.42, 0.32, 0.26] as const,
  twistW: [0.25, 0.35, 0.4] as const,
  sideW: [0.5, 0.3, 0.2] as const,
  elbowMinBend: 0,
  elbowMaxBend: 150 * DEG,
  /** Practical forward lean limits (radians) for placing on the felt and for pitching. */
  maxPlaceLean: 32 * DEG,
  maxPitchLean: 22 * DEG,
} as const;

export const ARM_REACH = DIM.upperArm + DIM.forearm;

// ───────────────────────── two-bone IK ─────────────────────────

export interface TwoBoneOptions {
  /** Smallest elbow bend (0 = straight arm). */
  minBend?: number;
  /** Largest elbow bend (radians). */
  maxBend?: number;
}

export interface TwoBoneSolution {
  /** Elbow (middle joint) position. */
  elbow: Vec3;
  /** Where the end effector (wrist) actually ends up — equals the target when reachable. */
  end: Vec3;
  /** Elbow bend in radians (0 = straight). */
  bend: number;
  /** Whether the target was reached exactly. */
  reached: boolean;
  /** Distance root → end after clamping. */
  reach: number;
}

/**
 * Law-of-cosines two-bone IK. The elbow lies in the plane through root and target that contains the pole,
 * on the pole's side. Unreachable targets are clamped to max reach along root → target; targets closer than
 * the bend limit allows are pushed out to the minimum distance. Never returns NaN, including for zero-length
 * or pole-collinear input.
 */
export function solveTwoBone(root: Vec3, target: Vec3, pole: Vec3, l1: number, l2: number, opts: TwoBoneOptions = {}): TwoBoneSolution {
  const minBend = clamp(opts.minBend ?? DIM.elbowMinBend, 0, Math.PI);
  const maxBend = clamp(opts.maxBend ?? DIM.elbowMaxBend, minBend, Math.PI);
  l1 = Math.max(1e-6, Math.abs(l1) || 1e-6);
  l2 = Math.max(1e-6, Math.abs(l2) || 1e-6);
  const safeTarget = finite(target) ? target : root;
  const safePole = finite(pole) ? pole : add(root, vec(0, -1, 0));

  // d² = l1² + l2² + 2·l1·l2·cos(bend)
  const dMax = Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(minBend)));
  const dMin = Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(maxBend)));

  const toT = sub(safeTarget, root);
  const d = length(toT);
  const poleDir = sub(safePole, root);
  const dir = d > EPS ? scale(toT, 1 / d) : normalize(poleDir, vec(0, -1, 0));
  const dc = Math.max(clamp(d, dMin, dMax), 1e-6);

  const cosA = clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  let bendDir = perp(poleDir, dir);
  bendDir = length(bendDir) > 1e-7 ? normalize(bendDir) : anyPerp(dir);

  const elbow = add(root, add(scale(dir, cosA * l1), scale(bendDir, sinA * l1)));
  const end = add(root, scale(dir, dc));
  const cosG = clamp((l1 * l1 + l2 * l2 - dc * dc) / (2 * l1 * l2), -1, 1);
  const bend = Math.PI - Math.acos(cosG);
  return { elbow, end, bend, reached: dist(end, safeTarget) < 1e-6, reach: dc };
}

// ───────────────────────── posture & shoulders ─────────────────────────

/** Torso posture in radians: forward lean (+ toward +Z), side bend (+ toward +X) and twist (+ turns the chest toward +X). */
export interface Posture {
  lean: number;
  side: number;
  twist: number;
}

export const NEUTRAL_POSTURE: Posture = { lean: 0.06, side: 0, twist: 0 };

export interface Frame {
  pos: Vec3;
  rot: Mat3;
}

/** Local rotation of spine joint i (0 = spine1, 1 = spine2, 2 = chest) for a posture. */
export function spineJointRotation(i: 0 | 1 | 2, p: Posture): { x: number; y: number; z: number } {
  return { x: p.lean * DIM.leanW[i], y: p.twist * DIM.twistW[i], z: -p.side * DIM.sideW[i] };
}

/** Chest frame (rig-local) for a posture — same chain the rig uses (pelvis → spine1 → spine2 → chest). */
export function chestFrame(p: Posture): Frame {
  const e1 = spineJointRotation(0, p);
  const e2 = spineJointRotation(1, p);
  const e3 = spineJointRotation(2, p);
  const r1 = m3EulerYXZ(e1.x, e1.y, e1.z);
  const r12 = m3Mul(r1, m3EulerYXZ(e2.x, e2.y, e2.z));
  const spine1 = vec(0, DIM.hipsY + DIM.spine1, 0);
  const spine2 = add(spine1, m3Apply(r1, vec(0, DIM.spine2, 0)));
  const chest = add(spine2, m3Apply(r12, vec(0, DIM.chest, 0)));
  return { pos: chest, rot: m3Mul(r12, m3EulerYXZ(e3.x, e3.y, e3.z)) };
}

export interface ClavicleAngles {
  /** Forward swing of the shoulder (radians, ≥ 0). */
  protract: number;
  /** Shrug (+) or drop (−) of the shoulder (radians). */
  elevate: number;
}

/**
 * How the clavicle helps a reach: the shoulder swings forward and drops a little when the hand goes far
 * forward/down, and shrugs when it goes up. `toTarget` is the wrist target relative to the clavicle root,
 * expressed in chest space.
 */
export function clavicleAngles(side: Side, toTarget: Vec3): ClavicleAngles {
  const d = length(toTarget);
  if (!(d > 1e-6)) return { protract: 0, elevate: 0 };
  const dir = scale(toTarget, 1 / d);
  const demand = clamp((d - 0.4) / 0.26, 0, 1);
  const fwd = clamp(dir.z, 0, 1);
  const across = clamp(-dir.x * side, 0, 1);
  const protract = 0.3 * demand * (0.35 + 0.65 * fwd) + 0.14 * across * (0.4 + 0.6 * demand);
  const up = clamp((dir.y + 0.15) / 0.8, 0, 1);
  const elevate = 0.2 * up - 0.12 * demand * clamp(-dir.y, 0, 1);
  return { protract: clamp(protract, 0, 0.38), elevate: clamp(elevate, -0.14, 0.22) };
}

/** Clavicle root position (rig-local) for a side given the chest frame. */
export function clavicleRoot(side: Side, chest: Frame): Vec3 {
  return add(chest.pos, m3Apply(chest.rot, vec(DIM.clavicle.x * side, DIM.clavicle.y, DIM.clavicle.z)));
}

/** Clavicle local rotation matrix (same convention as THREE.Euler(0, −s·protract, s·elevate, 'YXZ')). */
export function clavicleRotation(side: Side, a: ClavicleAngles): Mat3 {
  return m3EulerYXZ(0, -side * a.protract, side * a.elevate);
}

/**
 * Shoulder joint position (rig-local) for a posture. When a wrist target is given, the clavicle swings
 * toward it exactly as the runtime rig does.
 */
export function shoulderPosition(side: Side, p: Posture, wristTarget?: Vec3): Vec3 {
  const chest = chestFrame(p);
  const root = clavicleRoot(side, chest);
  const angles = wristTarget ? clavicleAngles(side, m3ApplyT(chest.rot, sub(wristTarget, root))) : { protract: 0, elevate: 0 };
  const rot = m3Mul(chest.rot, clavicleRotation(side, angles));
  return add(root, m3Apply(rot, vec(DIM.shoulder.x * side, DIM.shoulder.y, DIM.shoulder.z)));
}

/** Pole for the elbow: outward, down and back relative to the chest, so elbows bend out/down like a croupier's. */
export function armPole(side: Side, shoulder: Vec3, chestRot: Mat3 = M3_ID, outward = 0.55): Vec3 {
  return add(shoulder, m3Apply(chestRot, vec(side * outward, -0.85, -0.32)));
}

// ───────────────────────── hand frames ─────────────────────────

/** Orthonormal hand basis in rig space: y = toward the fingers, z = back of the hand, x = y × z. */
export interface Basis {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/**
 * Hand basis from a heading (horizontal direction the fingers point to), a downward pitch of the fingers and a
 * supination (0 = palm down, π/2 = thumb up, π = palm up). Works for either hand.
 */
export function handBasis(side: Side, heading: Vec3, pitchDown: number, supinate = 0): Basis {
  const h = normalize(vec(heading.x, 0, heading.z), vec(0, 0, 1));
  const c = Math.cos(pitchDown);
  const s = Math.sin(pitchDown);
  const y = normalize(vec(h.x * c, -s, h.z * c));
  const z0 = normalize(vec(h.x * s, c, h.z * s));
  const z = normalize(rotateAxis(z0, y, -side * supinate));
  const x = normalize(cross(y, z));
  return { x, y, z: cross(x, y) };
}

/** Apply a basis to a local offset. */
export const basisApply = (b: Basis, v: Vec3): Vec3 => add(add(scale(b.x, v.x), scale(b.y, v.y)), scale(b.z, v.z));

/** Wrist position that puts the hand's grip socket on `grip` for a given hand basis. */
export const wristForGrip = (grip: Vec3, b: Basis, socket: Vec3 = DIM.grip): Vec3 => sub(grip, basisApply(b, socket));

// ───────────────────────── posture choice & reach planning ─────────────────────────

export interface ReachRequest {
  side: Side;
  /** Wrist target (rig-local). */
  wrist: Vec3;
  /** Weight for the twist/side-bend centroid (default 1). */
  weight?: number;
}

export interface PostureChoice {
  posture: Posture;
  /** Largest remaining shortfall (m) over all requests; ≤ 0 when every wrist is comfortably reachable. */
  shortfall: number;
}

/** Fraction of full arm length treated as comfortably reachable. */
export const COMFORT = 0.975;

function shortfallFor(reqs: readonly ReachRequest[], p: Posture): number {
  const chest = chestFrame(p);
  let worst = -Infinity;
  for (const r of reqs) {
    const root = clavicleRoot(r.side, chest);
    const angles = clavicleAngles(r.side, m3ApplyT(chest.rot, sub(r.wrist, root)));
    const rot = m3Mul(chest.rot, clavicleRotation(r.side, angles));
    const sh = add(root, m3Apply(rot, vec(DIM.shoulder.x * r.side, DIM.shoulder.y, DIM.shoulder.z)));
    worst = Math.max(worst, dist(sh, r.wrist) - ARM_REACH * COMFORT);
  }
  return worst;
}

/**
 * Picks the torso posture for a set of simultaneous hand targets: twist and side bend lean toward the work
 * area, and the forward lean is the smallest (≤ maxLean) that makes every wrist reachable — or, if none
 * does, the one that gets closest.
 */
export function choosePosture(reqs: readonly ReachRequest[], maxLean: number = DIM.maxPlaceLean, baseLean = NEUTRAL_POSTURE.lean): PostureChoice {
  const valid = reqs.filter((r) => finite(r.wrist));
  if (valid.length === 0) return { posture: { ...NEUTRAL_POSTURE }, shortfall: -Infinity };
  let wx = 0;
  let wz = 0;
  let w = 0;
  for (const r of valid) {
    const k = r.weight ?? 1;
    wx += r.wrist.x * k;
    wz += r.wrist.z * k;
    w += k;
  }
  const cx = w > 0 ? wx / w : 0;
  const cz = w > 0 ? wz / w : 0.3;
  const twist = clamp(0.28 * Math.atan2(cx, Math.max(0.12, cz)), -0.2, 0.2);
  const side = clamp(0.2 * cx, -0.11, 0.11);
  maxLean = Math.max(baseLean, maxLean);
  const at = (lean: number): PostureChoice => {
    const posture = { lean, side, twist };
    return { posture, shortfall: shortfallFor(valid, posture) };
  };
  const lo0 = at(baseLean);
  if (lo0.shortfall <= 0) return lo0;
  const hi0 = at(maxLean);
  if (hi0.shortfall > 0) {
    // Out of reach even fully leaned: take whichever end gets closer (leaning rarely hurts, but can for targets behind).
    return hi0.shortfall <= lo0.shortfall ? hi0 : lo0;
  }
  let lo = baseLean;
  let hi = maxLean;
  let best = hi0;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    const c = at(mid);
    if (c.shortfall <= 0) {
      best = c;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

export interface DeliveryPlan {
  /** 'place' = the hand sets the card down on the target; 'pitch' = it lets go early and the card slides. */
  mode: 'place' | 'pitch';
  /** Grip (card centre) position at release, rig-local. */
  release: Vec3;
  /** Wrist position at release. */
  wrist: Vec3;
  /** Hand basis at release. */
  hand: Basis;
  /** Finger pitch (down) used at release. */
  pitchDown: number;
  posture: Posture;
  /** Shoulder position at release for that posture. */
  shoulder: Vec3;
  /** Horizontal distance the card still has to slide after release. */
  slide: number;
  /** Horizontal unit direction from release toward the target. */
  heading: Vec3;
}

export interface DeliveryOptions {
  /** Where the carry starts (rig-local); the pitch line runs from here toward the target. */
  from?: Vec3;
  /** Release height for pitches (card centre above the felt). */
  hover?: number;
  /** Height above the target for placements. */
  placeY?: number;
  /** Longest hand travel from `from` (m) — e.g. what the time budget allows. */
  maxTravel?: number;
  /** Forward lean limits. */
  maxPlaceLean?: number;
  maxPitchLean?: number;
  /** Finger pitch (down) at a pitch release. */
  pitchDown?: number;
  /** Disallow placing (always pitch, e.g. Hold'em). */
  pitchOnly?: boolean;
  /** Closest a release may be to the dealer (rig z). */
  minFrontZ?: number;
}

interface ReachEval {
  hand: Basis;
  pitchDown: number;
  wrist: Vec3;
  choice: PostureChoice;
  shoulder: Vec3;
}

/** Best hand pitch/posture to put the grip socket on `grip` (tries a few finger pitches, keeps the least lean). */
export function reachFor(side: Side, grip: Vec3, heading: Vec3, maxLean: number, pitches?: readonly number[]): ReachEval {
  let best: ReachEval | null = null;
  const rest = shoulderPosition(side, NEUTRAL_POSTURE);
  const down = sub(grip, rest);
  const aligned = clamp(Math.atan2(-down.y, Math.hypot(down.x, down.z)), 0.25, 1.1);
  for (const pd of pitches ?? [aligned, aligned - 0.3, aligned + 0.25]) {
    const hand = handBasis(side, heading, pd);
    const wrist = wristForGrip(grip, hand);
    const choice = choosePosture([{ side, wrist }], maxLean);
    const better =
      !best ||
      (choice.shortfall <= 0 && (best.choice.shortfall > 0 || choice.posture.lean < best.choice.posture.lean - 1e-6)) ||
      (best.choice.shortfall > 0 && choice.shortfall < best.choice.shortfall);
    if (better) best = { hand, pitchDown: pd, wrist, choice, shoulder: shoulderPosition(side, choice.posture, wrist) };
  }
  return best!;
}

/**
 * Plans how a hand delivers a card to `target`: place it if the target is comfortably reachable with a
 * forward lean, otherwise pitch — move toward the target as far as comfortable (and as the time budget
 * allows) at hover height, release there, and let the card slide the rest of the way. Never throws; the
 * release point is always in front of the dealer, above the felt and within arm reach.
 */
const planCache = new Map<string, DeliveryPlan>();
const r4 = (n: number | undefined) => (n == null ? '-' : Math.round(n * 1e4));

export function planDelivery(target: Vec3, side: Side, opts: DeliveryOptions = {}): DeliveryPlan {
  const key = [target.x, target.y, target.z, side, opts.from?.x, opts.from?.y, opts.from?.z, opts.hover, opts.placeY, opts.maxTravel, opts.maxPlaceLean, opts.maxPitchLean, opts.pitchDown, opts.pitchOnly ? 1 : 0, opts.minFrontZ]
    .map((n) => r4(n as number | undefined))
    .join(',');
  const hit = planCache.get(key);
  if (hit) return hit;
  const plan = planDeliveryUncached(target, side, opts);
  if (planCache.size > 256) planCache.delete(planCache.keys().next().value!);
  planCache.set(key, plan);
  return plan;
}

function planDeliveryUncached(target: Vec3, side: Side, opts: DeliveryOptions): DeliveryPlan {
  const hover = Math.max(0.012, opts.hover ?? 0.03);
  const placeY = opts.placeY ?? 0.006;
  const minFrontZ = opts.minFrontZ ?? 0.16;
  const from = opts.from && finite(opts.from) ? opts.from : vec(side * 0.16, hover, 0.14);
  const T = finite(target) ? target : vec(0, 0, 0.5);
  const heading = normalize(vec(T.x - from.x, 0, T.z - from.z), vec(0, 0, 1));
  const travel = Math.hypot(T.x - from.x, T.z - from.z);

  // 1. Place, if reachable (and the time budget allows the trip).
  if (!opts.pitchOnly && (opts.maxTravel == null || travel <= opts.maxTravel + 1e-6)) {
    const grip = vec(T.x, Math.max(T.y, 0) + placeY, Math.max(T.z, minFrontZ - 0.04));
    const e = reachFor(side, grip, heading, opts.maxPlaceLean ?? DIM.maxPlaceLean);
    if (e.choice.shortfall <= 0 && dist(grip, T) < Math.max(placeY, 0) + 0.05) {
      return { mode: 'place', release: grip, wrist: e.wrist, hand: e.hand, pitchDown: e.pitchDown, posture: e.choice.posture, shoulder: e.shoulder, slide: 0, heading };
    }
  }

  // 2. Pitch: farthest reachable point along from → target at hover height.
  const maxU = Math.max(0, Math.min(travel - 0.02, opts.maxTravel ?? Infinity));
  const maxLean = opts.maxPitchLean ?? DIM.maxPitchLean;
  const pitches = opts.pitchDown != null ? [opts.pitchDown] : [0.3, 0.55];
  const pointAt = (u: number, y: number) => {
    const p = vec(from.x + heading.x * u, y, from.z + heading.z * u);
    if (p.z < minFrontZ) p.z = minFrontZ;
    return p;
  };
  const ok = (e: ReachEval) => e.choice.shortfall <= 0;
  // For a few release heights find the farthest reachable point on the line; prefer distance, but every
  // centimetre of extra height costs a little so the card is let go low over the felt.
  let bestU = -1;
  let bestE: ReachEval | null = null;
  let y = hover;
  let bestScore = -Infinity;
  for (let k = 0; k < 6; k++) {
    const yk = hover + 0.025 * k;
    const N = 10;
    let found = -1;
    let fe: ReachEval | null = null;
    for (let i = N; i >= 0; i--) {
      const u = (maxU * i) / N;
      const e = reachFor(side, pointAt(u, yk), heading, maxLean, pitches);
      if (ok(e)) {
        found = u;
        fe = e;
        if (i < N) {
          let lo = u;
          let hi = (maxU * (i + 1)) / N;
          for (let r = 0; r < 9; r++) {
            const mid = (lo + hi) / 2;
            const em = reachFor(side, pointAt(mid, yk), heading, maxLean, pitches);
            if (ok(em)) {
              lo = mid;
              fe = em;
            } else hi = mid;
          }
          found = lo;
        }
        break;
      }
    }
    if (found < 0) continue;
    const score = found - 2.5 * (yk - hover);
    if (score > bestScore) {
      bestScore = score;
      bestU = found;
      bestE = fe;
      y = yk;
    }
    if (found >= maxU - 1e-6) break; // cannot do better by going higher
  }
  let release: Vec3;
  let e: ReachEval;
  if (bestE && bestU >= 0) {
    release = pointAt(bestU, y);
    e = bestE;
  } else {
    // Degenerate input: clamp to what the arm can actually reach from the start point.
    release = pointAt(0, y);
    e = reachFor(side, release, heading, maxLean, pitches);
    const sol = solveTwoBone(e.shoulder, e.wrist, armPole(side, e.shoulder), DIM.upperArm, DIM.forearm);
    const delta = sub(sol.end, e.wrist);
    e = { ...e, wrist: sol.end };
    release = vec(release.x + delta.x, Math.max(0.012, release.y + delta.y), Math.max(minFrontZ, release.z + delta.z));
  }
  return {
    mode: 'pitch',
    release,
    wrist: e.wrist,
    hand: e.hand,
    pitchDown: e.pitchDown,
    posture: e.choice.posture,
    shoulder: e.shoulder,
    slide: Math.hypot(T.x - release.x, T.z - release.z),
    heading,
  };
}
