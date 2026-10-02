import * as THREE from 'three';
import type { CreateDealerOptions, DealerHand, DealerRig, GestureHandle, GestureOpts } from './index';
import {
  buildDealFromHand,
  buildDealFromShoe,
  buildFlip,
  buildPeek,
  buildPoint,
  buildPushChips,
  buildSettle,
  buildShuffle,
  buildSweep,
  buildTakeChips,
  buildTap,
  type BuildCtx,
  type Builder,
  type Built,
  type GestureEvent,
} from './gestures';
import { clavicleAngles, DIM, solveTwoBone, spineJointRotation } from './ik';
import { buildDealerModel, type DealerModel, type HandName, type Quality } from './model';
import { GRIP, neutralHand, NEUTRAL_BODY } from './poses';
import { smoothstep } from './tracks';

interface HandState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  fingers: Float32Array;
}

interface Job {
  name: string;
  builder: Builder;
  durationMs: number;
  internal: boolean;
  enqueuedAt: number;
  start: number;
  built: Built | null;
  nextEvent: number;
  settled: boolean;
  resolve: () => void;
  /** Callbacks to fire if the builder itself fails (so callers are never left waiting). */
  fallback?: (ctx: BuildCtx) => GestureEvent[];
}

const DEG = Math.PI / 180;
const WRIST_MAX = 68 * DEG;
const UP = new THREE.Vector3(0, 1, 0);
const LOCAL_DEFAULTS = {
  shoe: new THREE.Vector3(0.6, 0.06, 0.3),
  discard: new THREE.Vector3(-0.6, 0.04, 0.3),
  muck: new THREE.Vector3(-0.3, 0.004, 0.3),
  rack: new THREE.Vector3(0, 0.03, 0.225),
};

/** Small seeded PRNG so idle behaviour is deterministic per rig. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// scratch objects
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

function basisQuat(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}

function perpTo(a: THREE.Vector3, n: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(a).addScaledVector(n, -a.dot(n));
}

export class DealerRuntime implements DealerRig {
  readonly root: THREE.Group;
  private readonly model: DealerModel;
  private readonly hands: Record<HandName, HandState>;
  private readonly body = { pos: NEUTRAL_BODY.clone(), vel: new THREE.Vector3() };
  private readonly decks = new Float32Array(2);
  private card: { who: HandName | null; prev: HandName | null; blend: number } = { who: null, prev: null, blend: 1 };
  private gestureLook: THREE.Vector3 | null = null;
  private userLook: THREE.Vector3 | null = null;
  private readonly head = { yaw: 0, pitch: -0.1, vy: 0, vp: 0, tyaw: 0, tpitch: 0, rawPitch: 0, rawYaw: 0 };
  private queue: Job[] = [];
  private active: Job | null = null;
  private clock = 0;
  private time = 0;
  private lastEnd = 0;
  private speed = 1;
  private instant = false;
  private reduced = false;
  private deckInHand = false;
  private quality: Quality;
  private disposed = false;
  /** Set once any gesture has been queued. */
  private started = false;
  private flushing = 0;
  private readonly showHeldCards: boolean;
  private readonly rand = mulberry32(0x5eed1e);
  private blink = { next: 2.2, t: -1 };
  private glance: { next: number; until: number; target: THREE.Vector3 | null } = { next: 5, until: 0, target: null };
  private readonly local = {
    shoe: LOCAL_DEFAULTS.shoe.clone(),
    discard: LOCAL_DEFAULTS.discard.clone(),
    muck: LOCAL_DEFAULTS.muck.clone(),
    rack: LOCAL_DEFAULTS.rack.clone(),
  };
  /** Rig-local wrist positions and hand orientations from the last applied pose. */
  private readonly wrist: Record<HandName, THREE.Vector3> = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  private readonly handQ: Record<HandName, THREE.Quaternion> = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  private readonly prevZu: Record<HandName, THREE.Vector3> = { L: new THREE.Vector3(0, 0, -1), R: new THREE.Vector3(0, 0, -1) };

  constructor(opts: CreateDealerOptions = {}) {
    this.quality = opts.quality ?? 'high';
    this.showHeldCards = opts.showHeldCards ?? true;
    this.model = buildDealerModel(this.quality, opts.locale ?? 'pl');
    this.root = this.model.root;
    const nl = neutralHand('L', false);
    const nr = neutralHand('R', false);
    this.hands = {
      L: { pos: nl.pos.clone(), vel: new THREE.Vector3(), rot: nl.rot.clone(), fingers: nl.fingers.slice() },
      R: { pos: nr.pos.clone(), vel: new THREE.Vector3(), rot: nr.rot.clone(), fingers: nr.fingers.slice() },
    };
    this.applyPose(0);
  }

  // ───────────────────────── public API ─────────────────────────

  get busy(): boolean {
    return !this.disposed && (this.queue.some((j) => !j.internal) || (!!this.active && !this.active.internal));
  }

  update(dt: number): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    this.time += dt;
    if (!this.instant) this.clock += dt * this.speed;
    this.advance();
    if (this.disposed) return; // a callback may have disposed the rig
    this.idle(dt);
    this.applyPose(dt);
  }

  setSpeed(mult: number): void {
    if (mult === Infinity) {
      this.instant = true;
      this.flush();
      return;
    }
    this.instant = false;
    this.speed = Number.isFinite(mult) && mult > 0 ? mult : mult === 0 ? 0 : 1;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = !!on;
  }

  setLocale(l: 'pl' | 'en'): void {
    if (!this.disposed) this.model.setLocale(l === 'en' ? 'en' : 'pl');
  }

  setQuality(q: 'low' | 'high'): void {
    if (this.disposed || q === this.quality) return;
    this.quality = q;
    this.model.rebuild(q);
  }

  lookAt(worldTarget: THREE.Vector3 | null): void {
    this.userLook = worldTarget && Number.isFinite(worldTarget.x + worldTarget.y + worldTarget.z) ? worldTarget.clone() : null;
  }

  handWorldPosition(hand: DealerHand, out: THREE.Vector3): THREE.Vector3 {
    const h: HandName = hand === 'left' ? 'L' : 'R';
    this.gripLocal(h, out);
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(out);
  }

  setDeckInHand(visible: boolean): void {
    if (this.deckInHand === !!visible) return;
    this.deckInHand = !!visible;
    if (!this.started && !this.active && this.queue.length === 0) {
      // Fresh rig (e.g. right after the table is built): take the stance at once instead of animating into it.
      for (const h of ['L', 'R'] as HandName[]) {
        const n = neutralHand(h, this.deckInHand);
        this.hands[h].pos.copy(n.pos);
        this.hands[h].rot.copy(n.rot);
        this.hands[h].fingers.set(n.fingers);
      }
      this.decks[0] = this.deckInHand ? 1 : 0;
      this.applyPose(0);
      return;
    }
    this.lastEnd = Math.min(this.lastEnd, this.clock - 1); // let the settle start right away
  }

  dealFromShoe(shoe: THREE.Vector3, target: THREE.Vector3, o: GestureOpts & { onRelease?: (releasePos: THREE.Vector3) => void }): GestureHandle {
    return this.enqueue('dealFromShoe', buildDealFromShoe(shoe.clone(), target.clone(), o), o.durationMs, 380, (ctx) => [
      { t: ctx.D * 0.6, fire: () => o.onRelease?.(ctx.gripWorld('R')) },
    ]);
  }

  dealFromHand(target: THREE.Vector3, o: GestureOpts & { onRelease?: (releasePos: THREE.Vector3) => void }): GestureHandle {
    return this.enqueue('dealFromHand', buildDealFromHand(target.clone(), o), o.durationMs, 260, (ctx) => [
      { t: ctx.D * 0.62, fire: () => o.onRelease?.(ctx.gripWorld('R')) },
    ]);
  }

  flip(at: THREE.Vector3, o: GestureOpts & { onFlip?: () => void }): GestureHandle {
    return this.enqueue('flip', buildFlip(at.clone(), o), o.durationMs, 450, (ctx) => [{ t: ctx.D * 0.5, fire: () => o.onFlip?.() }]);
  }

  peek(at: THREE.Vector3, o: GestureOpts): GestureHandle {
    return this.enqueue('peek', buildPeek(at.clone()), o.durationMs, 900);
  }

  burn(o: GestureOpts & { onRelease?: (p: THREE.Vector3) => void }): GestureHandle {
    const builder: Builder = (ctx) =>
      ctx.deckInHand
        ? buildDealFromHand(null, o, 'burn')(ctx)
        : buildDealFromShoe(this.toWorld(ctx.shoe), this.toWorld(ctx.discard), o, 'burn')(ctx);
    return this.enqueue('burn', builder, o.durationMs, 300, (ctx) => [{ t: ctx.D * 0.6, fire: () => o.onRelease?.(ctx.gripWorld('R')) }]);
  }

  sweep(from: THREE.Vector3[], to: THREE.Vector3, o: GestureOpts & { onGrab?: (i: number) => void }): GestureHandle {
    const pts = (from ?? []).map((p) => p.clone());
    return this.enqueue('sweep', buildSweep(pts, to.clone(), o), o.durationMs, 900, (ctx) =>
      pts.map((_, i) => ({ t: ctx.D * (0.2 + (0.4 * i) / Math.max(1, pts.length)), fire: () => o.onGrab?.(i) })),
    );
  }

  pushChips(to: THREE.Vector3, o: GestureOpts & { onRelease?: () => void }): GestureHandle {
    return this.enqueue('pushChips', buildPushChips(to.clone(), o), o.durationMs, 600, (ctx) => [{ t: ctx.D * 0.7, fire: () => o.onRelease?.() }]);
  }

  takeChips(from: THREE.Vector3, o: GestureOpts & { onGrab?: () => void }): GestureHandle {
    return this.enqueue('takeChips', buildTakeChips(from.clone(), o), o.durationMs, 500, (ctx) => [{ t: ctx.D * 0.4, fire: () => o.onGrab?.() }]);
  }

  point(at: THREE.Vector3, o: GestureOpts): GestureHandle {
    return this.enqueue('point', buildPoint(at.clone()), o.durationMs, 700);
  }

  tap(at: THREE.Vector3, o: GestureOpts): GestureHandle {
    return this.enqueue('tap', buildTap(at.clone()), o.durationMs, 500);
  }

  shuffle(o: GestureOpts): GestureHandle {
    return this.enqueue('shuffle', buildShuffle(), o.durationMs, 2000);
  }

  flush(): void {
    if (this.disposed) return;
    this.flushing++;
    try {
      this.queue = this.queue.filter((j) => !j.internal);
      if (this.active?.internal) this.finishJob(this.active, this.active.built?.duration ?? 0);
      let guard = 0;
      while ((this.active || this.queue.length) && guard++ < 5000) {
        if (!this.active) this.startJob(this.queue.shift()!, this.clock);
        const j = this.active!;
        this.runEvents(j, Infinity);
        if (this.active !== j) continue; // a callback flushed re-entrantly
        this.finishJob(j, j.built!.duration);
        this.lastEnd = this.clock;
      }
      this.applyPose(0);
    } finally {
      this.flushing--;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = [...(this.active ? [this.active] : []), ...this.queue];
    this.active = null;
    this.queue = [];
    for (const j of pending) {
      j.settled = true;
      j.resolve();
    }
    this.model.dispose();
  }

  // ───────────────────────── diagnostics (used by tests / sandbox) ─────────────────────────

  /** Triangle count and draw calls of the generated model. */
  stats(): { triangles: number; drawCalls: number; bones: number } {
    return { triangles: this.model.triangles(), drawCalls: this.model.drawCalls(), bones: this.model.skeleton.bones.length };
  }

  // ───────────────────────── queue ─────────────────────────

  private enqueue(name: string, builder: Builder, durationMs: number, fallbackMs: number, fallback?: (ctx: BuildCtx) => GestureEvent[], internal = false): GestureHandle {
    if (this.disposed) return { done: Promise.resolve() };
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const ms = Number.isFinite(durationMs) && durationMs > 0 ? Math.max(40, durationMs) : fallbackMs;
    const job: Job = { name, builder, durationMs: ms, internal, enqueuedAt: this.clock, start: 0, built: null, nextEvent: 0, settled: false, resolve, fallback };
    if (!internal) {
      this.queue = this.queue.filter((j) => !j.internal);
      this.started = true;
    }
    this.queue.push(job);
    if (this.instant && !internal) this.flush();
    return { done };
  }

  private makeCtx(job: Job): BuildCtx {
    const snap = (h: HandName) => {
      const s = this.hands[h];
      return { pos: s.pos.clone(), vel: s.vel.clone(), rot: s.rot.clone(), fingers: s.fingers.slice() };
    };
    this.root.updateWorldMatrix(true, false);
    const inv = this.root.matrixWorld.clone().invert();
    return {
      D: job.durationMs / 1000,
      L: snap('L'),
      R: snap('R'),
      body: { pos: this.body.pos.clone(), vel: this.body.vel.clone() },
      decks: this.decks.slice(),
      reduced: this.reduced,
      deckInHand: this.deckInHand,
      toLocal: (w) => w.clone().applyMatrix4(inv),
      shoe: this.local.shoe.clone(),
      discard: this.local.discard.clone(),
      muck: this.local.muck.clone(),
      rack: this.local.rack.clone(),
      setShoe: (p) => {
        if (Number.isFinite(p.x + p.y + p.z)) this.local.shoe.copy(p);
      },
      gripWorld: (h) => this.handWorldPosition(h === 'L' ? 'left' : 'right', new THREE.Vector3()),
    };
  }

  private toWorld(local: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(local.clone());
  }

  private startJob(job: Job, at: number): void {
    job.start = at;
    const ctx = this.makeCtx(job);
    let built: Built | null = null;
    try {
      built = job.builder(ctx);
    } catch (err) {
      console.error(`[dealer] ${job.name} failed to build`, err);
    }
    if (!built || !(built.duration > 0)) built = this.holdStill(ctx, job.fallback?.(ctx) ?? []);
    const lastEvent = built.events.reduce((m, e) => Math.max(m, e.t), 0);
    built.handoff = Math.min(built.duration, Math.max(built.handoff, lastEvent));
    job.built = built;
    this.active = job;
  }

  private holdStill(ctx: BuildCtx, events: GestureEvent[]): Built {
    // Minimal track set that keeps the current pose (used only if a builder throws).
    const settle = buildSettle()(ctx);
    return { ...settle, handoff: ctx.D, events: events.sort((a, b) => a.t - b.t) };
  }

  private finishJob(job: Job, at: number): void {
    if (job.settled) return;
    if (job.built) this.evaluate(job, at);
    job.settled = true;
    if (this.active === job) this.active = null;
    job.resolve();
  }

  /** Fire events of `job` up to local time `upTo`, posing the rig at each event's moment first. */
  private runEvents(job: Job, upTo: number): void {
    const ev = job.built!.events;
    while (job.nextEvent < ev.length && ev[job.nextEvent]!.t <= upTo) {
      const e = ev[job.nextEvent++]!;
      this.evaluate(job, e.t);
      this.applyPose(0);
      try {
        e.fire();
      } catch (err) {
        // A caller's callback must never stall the dealer's queue.
        console.error(`[dealer] ${job.name} callback failed`, err);
      }
      if (job.settled || this.disposed) return;
    }
  }

  private advance(): void {
    // In instant mode nothing advances the clock: snap the idle settle straight to its end.
    if (this.instant && this.active?.internal) this.finishJob(this.active, this.active.built?.duration ?? 0);
    for (let guard = 0; guard < 256; guard++) {
      if (this.instant && !this.active && this.queue[0]?.internal) {
        const settle = this.queue.shift()!;
        this.startJob(settle, this.clock);
        this.finishJob(settle, settle.built!.duration);
        continue;
      }
      if (!this.active) {
        const next = this.queue.shift();
        if (!next) break;
        this.startJob(next, Math.min(this.clock, Math.max(next.enqueuedAt, this.lastEnd)));
      }
      const j = this.active!;
      const b = j.built!;
      const local = this.clock - j.start;
      this.runEvents(j, Math.min(local, b.duration));
      if (this.active !== j) continue;
      if (local >= b.duration) {
        this.finishJob(j, b.duration);
        this.lastEnd = j.start + b.duration;
        continue;
      }
      const next = this.queue[0];
      if (next && local >= b.handoff) {
        const at = Math.min(this.clock, Math.max(j.start + b.handoff, next.enqueuedAt));
        this.finishJob(j, at - j.start);
        this.lastEnd = at;
        continue;
      }
      break;
    }
    if (this.active) this.evaluate(this.active, this.clock - this.active.start);
    else {
      this.hands.L.vel.set(0, 0, 0);
      this.hands.R.vel.set(0, 0, 0);
      this.body.vel.set(0, 0, 0);
      this.gestureLook = null;
      this.card = { who: null, prev: null, blend: 1 };
    }
  }

  private evaluate(job: Job, t: number): void {
    const b = job.built;
    if (!b) return;
    for (const h of ['L', 'R'] as HandName[]) {
      const tr = b[h];
      const s = this.hands[h];
      tr.pos.sample(t, s.pos, s.vel);
      tr.rot.sample(t, s.rot);
      tr.fingers.sample(t, s.fingers);
    }
    b.body.sample(t, this.body.pos, this.body.vel);
    this.gestureLook = b.look ? b.look.sample(t, null) : null;
    if (b.decks) b.decks.sample(t, this.decks);
    if (b.card) {
      const i = b.card.index(t);
      const k = i >= 0 ? b.card.keys[i]! : null;
      const prev = i >= 1 ? b.card.keys[i - 1]!.v : null;
      this.card = { who: k ? k.v : null, prev, blend: k ? Math.min(1, (t - k.t) / 0.05) : 1 };
    } else this.card = { who: null, prev: null, blend: 1 };
  }

  // ───────────────────────── idle layer ─────────────────────────

  private idle(dt: number): void {
    // settle back to the resting stance when nothing is going on
    const idleFor = this.clock - this.lastEnd;
    if (!this.active && this.queue.length === 0 && idleFor > 0.35 && !this.atNeutral()) {
      this.enqueue('settle', buildSettle(), 900, 900, undefined, true);
    }
    // deck in hand when no gesture drives it
    if (!this.active?.built?.decks) {
      const k = 1 - Math.exp(-dt * 10);
      this.decks[0] = this.decks[0]! + ((this.deckInHand ? 1 : 0) - this.decks[0]!) * k;
      this.decks[1] = this.decks[1]! + (0 - this.decks[1]!) * k;
    }
    // blinks
    if (this.blink.t >= 0) {
      this.blink.t += dt;
      if (this.blink.t > 0.16) this.blink.t = -1;
    } else if (this.time >= this.blink.next) {
      this.blink.t = 0;
      this.blink.next = this.time + 2.2 + this.rand() * 3.8 + (this.rand() < 0.15 ? -1.9 : 0); // occasional double blink
    }
    // idle glances around the table
    if (this.reduced || this.active) {
      this.glance.target = null;
      this.glance.next = Math.max(this.glance.next, this.time + 2);
    } else if (this.glance.target && this.time > this.glance.until) {
      this.glance.target = null;
      this.glance.next = this.time + 4 + this.rand() * 5;
    } else if (!this.glance.target && this.time > this.glance.next) {
      const a = (this.rand() * 2 - 1) * 1.05;
      this.glance.target = new THREE.Vector3(0.78 * Math.sin(a), 0.25, 0.25 + 0.78 * Math.cos(a));
      this.glance.until = this.time + 0.7 + this.rand() * 0.7;
    }
  }

  private atNeutral(): boolean {
    for (const h of ['L', 'R'] as HandName[]) {
      const n = neutralHand(h, this.deckInHand);
      if (this.hands[h].pos.distanceTo(n.pos) > 0.012) return false;
      if (this.hands[h].rot.angleTo(n.rot) > 0.05) return false;
    }
    return this.body.pos.distanceTo(NEUTRAL_BODY) < 0.01 && Math.abs(this.decks[0]! - (this.deckInHand ? 1 : 0)) < 0.02;
  }

  // ───────────────────────── pose ─────────────────────────

  private gripLocal(h: HandName, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(GRIP).applyQuaternion(this.handQ[h]).add(this.wrist[h]);
  }

  private applyPose(dt: number): void {
    const m = this.model;
    const amp = this.reduced ? 0 : 1;
    const t = this.time;
    const breath = Math.sin(2 * Math.PI * 0.2 * t);
    const sway = (Math.sin(2 * Math.PI * 0.13 * t + 1.3) * 0.6 + Math.sin(2 * Math.PI * 0.31 * t) * 0.4) * amp;
    const shift = Math.sin(2 * Math.PI * 0.055 * t + 0.4) * amp;

    // pelvis + spine (posture + breathing / sway)
    m.hips.quaternion.setFromEuler(_e.set(0, 0.012 * sway, 0.01 * shift, 'YXZ'));
    const p = this.body.pos;
    const posture = { lean: p.x, side: p.y, twist: p.z };
    const bones = [m.spine1, m.spine2, m.chest] as const;
    ([0, 1, 2] as const).forEach((i) => {
      const e = spineJointRotation(i, posture);
      const extra = i === 1 ? 0.005 * breath * amp : i === 2 ? -0.008 * breath * amp : 0.004 * sway;
      const yaw = i === 0 ? 0.006 * sway : 0;
      const roll = i === 0 ? -0.006 * shift : 0;
      bones[i].quaternion.setFromEuler(_e.set(e.x + extra, e.y + yaw, e.z + roll, 'YXZ'));
    });
    // rig-local chest frame
    const qc = new THREE.Quaternion().copy(m.hips.quaternion);
    const pc = m.hips.position.clone();
    for (const b of bones) {
      pc.add(_v1.copy(b.position).applyQuaternion(qc));
      qc.multiply(b.quaternion);
    }

    this.solveArm('L', pc, qc, breath * amp);
    this.solveArm('R', pc, qc, breath * amp);
    this.poseHead(pc, qc, dt, amp);
    this.poseProps();
    this.root.updateMatrixWorld(true);
  }

  private solveArm(h: HandName, pc: THREE.Vector3, qc: THREE.Quaternion, breath: number): void {
    const A = this.model.arms[h];
    const s = A.side;
    const st = this.hands[h];
    const q = _q1.copy(st.rot);
    if (!Number.isFinite(q.x + q.y + q.z + q.w) || q.lengthSq() < 0.5) q.identity();
    else q.normalize();
    const target = Number.isFinite(st.pos.x + st.pos.y + st.pos.z) ? st.pos : neutralHand(h, this.deckInHand).pos;
    const clavRoot = _v1.copy(A.clavicle.position).applyQuaternion(qc).add(pc);
    const qcInv = _q2.copy(qc).invert();
    const clavLocal = new THREE.Quaternion();
    const qClav = new THREE.Quaternion();
    const shoulder = new THREE.Vector3();
    let sol = solveTwoBone(clavRoot, clavRoot, clavRoot, DIM.upperArm, DIM.forearm);
    for (let pass = 0; pass < 2; pass++) {
      const wristT = _v2.copy(GRIP).applyQuaternion(q).negate().add(target);
      const toT = _v3.copy(wristT).sub(clavRoot).applyQuaternion(qcInv);
      const ang = clavicleAngles(s, toT);
      clavLocal.setFromEuler(_e.set(0, -s * ang.protract, s * (ang.elevate + 0.012 * breath), 'YXZ'));
      qClav.copy(qc).multiply(clavLocal);
      shoulder.copy(A.upper.position).applyQuaternion(qClav).add(clavRoot);
      const pole = new THREE.Vector3(s * 0.55, -0.85, -0.32).applyQuaternion(qc).add(shoulder);
      sol = solveTwoBone(shoulder, wristT, pole, DIM.upperArm, DIM.forearm);
      // wrist limit: keep the hand within a cone around the forearm
      const fore = new THREE.Vector3(sol.end.x - sol.elbow.x, sol.end.y - sol.elbow.y, sol.end.z - sol.elbow.z).normalize();
      const hy = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const angle = hy.angleTo(fore);
      if (pass === 0 && angle > WRIST_MAX) {
        const axis = hy.clone().cross(fore);
        if (axis.lengthSq() > 1e-10) {
          q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle - WRIST_MAX));
          continue;
        }
      }
      break;
    }
    const elbow = new THREE.Vector3(sol.elbow.x, sol.elbow.y, sol.elbow.z);
    const wrist = new THREE.Vector3(sol.end.x, sol.end.y, sol.end.z);
    // upper arm frame: y along the bone, z toward the elbow point (posterior)
    const yu = elbow.clone().sub(shoulder).normalize();
    const yf = wrist.clone().sub(elbow).normalize();
    const pf = perpTo(yf, yu, new THREE.Vector3());
    const poleDir = perpTo(new THREE.Vector3(s * 0.55, -0.85, -0.32).applyQuaternion(qc), yu, new THREE.Vector3()).normalize();
    const w = smoothstep((pf.length() - 0.03) / 0.15);
    const zu = pf.lengthSq() > 1e-10 ? pf.normalize().negate().multiplyScalar(w).addScaledVector(poleDir, 1 - w) : poleDir.clone();
    if (zu.lengthSq() < 1e-8) zu.copy(this.prevZu[h]);
    perpTo(zu, yu, zu).normalize();
    this.prevZu[h].copy(zu);
    const xu = new THREE.Vector3().crossVectors(yu, zu).normalize();
    const qUpper = basisQuat(xu, yu, new THREE.Vector3().crossVectors(xu, yu), new THREE.Quaternion());
    // forearm frame: rolls with the hand (pronation lives in the forearm)
    const hz = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const zf = perpTo(hz, yf, new THREE.Vector3());
    if (zf.lengthSq() < 0.01) perpTo(zu, yf, zf);
    zf.normalize();
    const xf = new THREE.Vector3().crossVectors(yf, zf).normalize();
    const qFore = basisQuat(xf, yf, new THREE.Vector3().crossVectors(xf, yf), new THREE.Quaternion());

    A.clavicle.quaternion.copy(clavLocal);
    A.upper.quaternion.copy(qClav).invert().multiply(qUpper);
    A.fore.quaternion.copy(qUpper).invert().multiply(qFore);
    A.hand.quaternion.copy(qFore).invert().multiply(q);
    this.wrist[h].copy(wrist);
    this.handQ[h].copy(q);

    // fingers
    const f = st.fingers;
    for (let i = 0; i < 4; i++) {
      const [pb, db] = A.fingers[i]!;
      pb.quaternion.setFromEuler(_e.set(-f[i * 3]! * DEG, 0, -s * f[i * 3 + 2]! * DEG, 'ZXY'));
      db.quaternion.setFromEuler(_e.set(-f[i * 3 + 1]! * DEG, 0, 0, 'XYZ'));
    }
    A.thumb[0].quaternion.copy(A.thumbRest).multiply(_q2.setFromEuler(_e.set(-f[12]! * DEG, 0, s * f[13]! * DEG, 'ZXY')));
    A.thumb[1].quaternion.setFromEuler(_e.set(-f[14]! * DEG, 0, 0, 'XYZ'));
  }

  private poseHead(pc: THREE.Vector3, qc: THREE.Quaternion, dt: number, amp: number): void {
    const m = this.model;
    const hd = this.head;
    let target: THREE.Vector3 | null = this.gestureLook ?? this.glance.target;
    if (!target && this.userLook) {
      this.root.updateWorldMatrix(true, false);
      target = this.root.worldToLocal(this.userLook.clone());
    }
    if (!target) target = new THREE.Vector3(0, 0.32, 1.5);
    const headPos = _v1.set(0, DIM.neck.y + DIM.head.y + DIM.headCentre, DIM.neck.z + DIM.head.z).applyQuaternion(qc).add(pc);
    const dir = _v2.copy(target).sub(headPos).applyQuaternion(_q2.copy(qc).invert());
    if (dir.lengthSq() > 1e-8) {
      hd.rawYaw = Math.atan2(dir.x, dir.z);
      hd.rawPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
      hd.tyaw = Math.max(-1.05, Math.min(1.05, hd.rawYaw));
      // the head only tips so far; the eyes do the rest when looking down at the felt
      hd.tpitch = Math.max(-0.36, Math.min(0.3, hd.rawPitch * 0.75));
    }
    // critically damped spring, sub-stepped for stability
    const w = this.reduced ? 13 : 8.5;
    let rem = dt;
    while (rem > 1e-6) {
      const h = Math.min(rem, 1 / 120);
      rem -= h;
      hd.vy += (w * w * (hd.tyaw - hd.yaw) - 2 * w * hd.vy) * h;
      hd.vp += (w * w * (hd.tpitch - hd.pitch) - 2 * w * hd.vp) * h;
      hd.yaw += hd.vy * h;
      hd.pitch += hd.vp * h;
    }
    if (dt === 0 && this.flushing > 0) {
      hd.yaw = hd.tyaw;
      hd.pitch = hd.tpitch;
    }
    const t = this.time;
    const nod = (Math.sin(t * 0.9) * 0.012 + Math.sin(t * 2.3 + 1) * 0.005) * amp;
    const tilt = Math.sin(t * 0.47 + 0.7) * 0.02 * amp;
    m.neck.quaternion.setFromEuler(_e.set(-hd.pitch * 0.28, hd.yaw * 0.3, 0, 'YXZ'));
    m.head.quaternion.setFromEuler(_e.set(-hd.pitch * 0.72 + nod, hd.yaw * 0.7, tilt, 'YXZ'));
    // eyes lead the head a little, and blink
    const ey = Math.max(-0.0032, Math.min(0.0032, (hd.rawYaw - hd.yaw) * 0.012));
    const ep = Math.max(-0.0026, Math.min(0.0016, (hd.rawPitch - hd.pitch) * 0.012));
    let lid = 1;
    if (this.blink.t >= 0) lid = 1 - 0.9 * Math.sin(Math.PI * Math.min(1, this.blink.t / 0.16));
    m.eyeL.position.copy(m.eyeRest.L).add(_v3.set(ey, ep, 0));
    m.eyeR.position.copy(m.eyeRest.R).add(_v3.set(ey, ep, 0));
    m.eyeL.scale.set(1, lid, 1);
    m.eyeR.scale.set(1, lid, 1);
  }

  private poseProps(): void {
    const m = this.model;
    // held card proxy follows the holding hand, kept roughly flat like a real carry
    const c = this.card;
    const cardBone = m.card;
    if (this.showHeldCards && c.who) {
      const pa = this.cardPose(c.who, new THREE.Vector3(), new THREE.Quaternion());
      if (c.prev && c.prev !== c.who && c.blend < 1) {
        const pb = this.cardPose(c.prev, new THREE.Vector3(), new THREE.Quaternion());
        const k = smoothstep(c.blend);
        pa.pos.lerpVectors(pb.pos, pa.pos, k);
        pa.rot.slerpQuaternions(pb.rot, pa.rot, k);
      }
      cardBone.position.copy(pa.pos);
      cardBone.quaternion.copy(pa.rot);
      cardBone.scale.set(1, 1, 1);
    } else cardBone.scale.setScalar(1e-5);
    // deck blocks
    for (const [i, h] of [
      [0, 'L'],
      [1, 'R'],
    ] as [number, HandName][]) {
      const d = this.decks[i]!;
      const bone = m.arms[h].deck;
      if (d > 0.01) bone.scale.set(1, 1, Math.min(1.2, d));
      else bone.scale.setScalar(1e-5);
    }
  }

  private cardPose(h: HandName, pos: THREE.Vector3, rot: THREE.Quaternion): { pos: THREE.Vector3; rot: THREE.Quaternion } {
    const q = this.handQ[h];
    this.gripLocal(h, pos);
    const hy = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const hz = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const fy = new THREE.Vector3(hy.x, 0, hy.z);
    if (fy.lengthSq() < 1e-6) fy.copy(hy);
    fy.normalize().lerp(hy, 0.18).normalize();
    const z = UP.clone().multiplyScalar(0.8).addScaledVector(hz, 0.2);
    perpTo(z, fy, z).normalize();
    const x = new THREE.Vector3().crossVectors(fy, z).normalize();
    basisQuat(x, fy, new THREE.Vector3().crossVectors(x, fy), rot);
    return { pos, rot };
  }
}
