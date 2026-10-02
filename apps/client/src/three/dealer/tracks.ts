import * as THREE from 'three';

/**
 * Keyframe tracks for the dealer's IK targets. Positions use cubic Hermite segments with per-key velocities
 * (zero = the hand settles there; 'auto' = it flows through, Catmull-Rom style), so a pitch can release at
 * speed and a gesture can take over from another mid-motion without a velocity jump.
 */

export const smoothstep = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const smootherstep = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const easeInCubic = (t: number): number => Math.pow(Math.min(1, Math.max(0, t)), 3);

export type Ease = 'inOut' | 'in' | 'out' | 'linear';
const EASES: Record<Ease, (t: number) => number> = {
  inOut: smoothstep,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  linear: (t) => t,
};

export type Vel = THREE.Vector3 | 'stop' | 'auto';

export interface PosKey {
  t: number;
  p: THREE.Vector3;
  v?: Vel;
}

interface ResolvedKey {
  t: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
}

/** Hermite position track (also used for 3-component scalars such as the torso posture). */
export class PosTrack {
  readonly keys: ResolvedKey[];

  constructor(keys: PosKey[], maxSpeed = 6) {
    const ks = keys
      .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.p.x) && Number.isFinite(k.p.y) && Number.isFinite(k.p.z))
      .sort((a, b) => a.t - b.t);
    // Merge keys at (almost) the same time — the later one wins.
    const merged: PosKey[] = [];
    for (const k of ks) {
      const last = merged[merged.length - 1];
      if (last && k.t - last.t < 1e-5) merged[merged.length - 1] = { ...k, t: last.t };
      else merged.push(k);
    }
    this.keys = merged.map((k, i) => {
      let v = new THREE.Vector3();
      if (k.v instanceof THREE.Vector3) v.copy(k.v);
      else if (k.v === 'auto') {
        const prev = merged[i - 1];
        const next = merged[i + 1];
        if (prev && next) {
          const d0 = k.t - prev.t;
          const d1 = next.t - k.t;
          const s0 = k.p.clone().sub(prev.p).divideScalar(d0);
          const s1 = next.p.clone().sub(k.p).divideScalar(d1);
          // time-weighted average of the neighbouring slopes
          v = s0.multiplyScalar(d1).add(s1.multiplyScalar(d0)).divideScalar(d0 + d1);
        }
      }
      if (v.length() > maxSpeed) v.setLength(maxSpeed);
      return { t: k.t, p: k.p.clone(), v };
    });
    if (this.keys.length === 0) this.keys.push({ t: 0, p: new THREE.Vector3(), v: new THREE.Vector3() });
  }

  get start(): number {
    return this.keys[0]!.t;
  }
  get end(): number {
    return this.keys[this.keys.length - 1]!.t;
  }

  /** Position (and optionally velocity, units per second) at time t. */
  sample(t: number, out: THREE.Vector3, outVel?: THREE.Vector3): THREE.Vector3 {
    const ks = this.keys;
    const first = ks[0]!;
    const last = ks[ks.length - 1]!;
    if (t <= first.t || ks.length === 1) {
      outVel?.set(0, 0, 0);
      return out.copy(first.p);
    }
    if (t >= last.t) {
      outVel?.set(0, 0, 0);
      return out.copy(last.p);
    }
    let i = 0;
    while (i < ks.length - 2 && ks[i + 1]!.t <= t) i++;
    const a = ks[i]!;
    const b = ks[i + 1]!;
    const h = b.t - a.t;
    const s = (t - a.t) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    out.set(
      h00 * a.p.x + h10 * h * a.v.x + h01 * b.p.x + h11 * h * b.v.x,
      h00 * a.p.y + h10 * h * a.v.y + h01 * b.p.y + h11 * h * b.v.y,
      h00 * a.p.z + h10 * h * a.v.z + h01 * b.p.z + h11 * h * b.v.z,
    );
    if (outVel) {
      const d00 = (6 * s2 - 6 * s) / h;
      const d10 = 3 * s2 - 4 * s + 1;
      const d01 = (-6 * s2 + 6 * s) / h;
      const d11 = 3 * s2 - 2 * s;
      outVel.set(
        d00 * a.p.x + d10 * a.v.x + d01 * b.p.x + d11 * b.v.x,
        d00 * a.p.y + d10 * a.v.y + d01 * b.p.y + d11 * b.v.y,
        d00 * a.p.z + d10 * a.v.z + d01 * b.p.z + d11 * b.v.z,
      );
    }
    return out;
  }
}

export interface QuatKey {
  t: number;
  q: THREE.Quaternion;
  ease?: Ease;
}

/** Orientation track: eased slerp between keys. */
export class QuatTrack {
  readonly keys: QuatKey[];
  constructor(keys: QuatKey[]) {
    this.keys = keys.filter((k) => Number.isFinite(k.t)).sort((a, b) => a.t - b.t);
    if (this.keys.length === 0) this.keys.push({ t: 0, q: new THREE.Quaternion() });
  }
  sample(t: number, out: THREE.Quaternion): THREE.Quaternion {
    const ks = this.keys;
    if (t <= ks[0]!.t || ks.length === 1) return out.copy(ks[0]!.q);
    const last = ks[ks.length - 1]!;
    if (t >= last.t) return out.copy(last.q);
    let i = 0;
    while (i < ks.length - 2 && ks[i + 1]!.t <= t) i++;
    const a = ks[i]!;
    const b = ks[i + 1]!;
    const u = EASES[b.ease ?? 'inOut']((t - a.t) / Math.max(1e-6, b.t - a.t));
    return out.slerpQuaternions(a.q, b.q, u);
  }
}

export interface ArrKey {
  t: number;
  a: ArrayLike<number>;
  ease?: Ease;
}

/** Fixed-length number arrays (finger angles, deck heights …) blended with easing. */
export class ArrTrack {
  readonly keys: { t: number; a: Float32Array; ease: Ease }[];
  constructor(
    keys: ArrKey[],
    readonly size: number,
  ) {
    this.keys = keys
      .filter((k) => Number.isFinite(k.t))
      .sort((a, b) => a.t - b.t)
      .map((k) => ({ t: k.t, a: Float32Array.from({ length: size }, (_, i) => k.a[i] ?? 0), ease: k.ease ?? 'inOut' }));
    if (this.keys.length === 0) this.keys.push({ t: 0, a: new Float32Array(size), ease: 'inOut' });
  }
  sample(t: number, out: Float32Array): Float32Array {
    const ks = this.keys;
    if (t <= ks[0]!.t || ks.length === 1) {
      out.set(ks[0]!.a);
      return out;
    }
    const last = ks[ks.length - 1]!;
    if (t >= last.t) {
      out.set(last.a);
      return out;
    }
    let i = 0;
    while (i < ks.length - 2 && ks[i + 1]!.t <= t) i++;
    const a = ks[i]!;
    const b = ks[i + 1]!;
    const u = EASES[b.ease]((t - a.t) / Math.max(1e-6, b.t - a.t));
    for (let j = 0; j < this.size; j++) out[j] = a.a[j]! + (b.a[j]! - a.a[j]!) * u;
    return out;
  }
}

/** Step track: the value of the last key at or before t. */
export class StepTrack<T> {
  readonly keys: { t: number; v: T }[];
  constructor(keys: { t: number; v: T }[]) {
    this.keys = keys.filter((k) => Number.isFinite(k.t)).sort((a, b) => a.t - b.t);
  }
  /** Returns the active key index (−1 before the first key). */
  index(t: number): number {
    let idx = -1;
    for (let i = 0; i < this.keys.length; i++) if (this.keys[i]!.t <= t) idx = i;
    return idx;
  }
  sample(t: number, fallback: T): T {
    const i = this.index(t);
    return i < 0 ? fallback : this.keys[i]!.v;
  }
}
