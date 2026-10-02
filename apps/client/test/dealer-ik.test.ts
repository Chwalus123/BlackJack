import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ARM_REACH,
  armPole,
  chestFrame,
  DIM,
  dist,
  dot,
  length,
  normalize,
  perp,
  planDelivery,
  shoulderPosition,
  solveTwoBone,
  sub,
  vec,
  type Side,
  type Vec3,
} from '../src/three/dealer/ik';

const L1 = DIM.upperArm;
const L2 = DIM.forearm;
const finiteV = (v: Vec3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const DEG = Math.PI / 180;

const vArb = (r: number) => fc.record({ x: fc.double({ min: -r, max: r, noNaN: true }), y: fc.double({ min: -r, max: r, noNaN: true }), z: fc.double({ min: -r, max: r, noNaN: true }) });

describe('two-bone IK', () => {
  const root = vec(0.19, 0.64, 0);
  const pole = vec(0.8, -0.2, -0.3);

  it('reaches reachable targets within 1 mm, with exact bone lengths', () => {
    const dMin = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(DIM.elbowMaxBend));
    fc.assert(
      fc.property(vArb(1), fc.double({ min: 0, max: 1, noNaN: true }), (d, k) => {
        const dir = normalize(d, vec(0, -1, 0));
        const r = dMin + 1e-3 + k * (L1 + L2 - dMin - 2e-3);
        const target = vec(root.x + dir.x * r, root.y + dir.y * r, root.z + dir.z * r);
        const s = solveTwoBone(root, target, pole, L1, L2);
        expect(dist(s.end, target)).toBeLessThan(1e-3);
        expect(s.reached).toBe(true);
        expect(Math.abs(dist(root, s.elbow) - L1)).toBeLessThan(1e-6);
        expect(Math.abs(dist(s.elbow, s.end) - L2)).toBeLessThan(1e-6);
      }),
      { numRuns: 400 },
    );
  });

  it('clamps unreachable targets to max reach along shoulder → target', () => {
    const targets = [vec(2, 0, 0), vec(0.19, -3, 0.2), vec(-1, 0.64, 4), vec(0.19, 0.64, 0.9)];
    for (const t of targets) {
      const s = solveTwoBone(root, t, pole, L1, L2);
      expect(s.reached).toBe(false);
      expect(dist(root, s.end)).toBeCloseTo(L1 + L2, 6);
      const want = normalize(sub(t, root));
      const got = normalize(sub(s.end, root));
      expect(dot(want, got)).toBeGreaterThan(1 - 1e-9);
      expect(finiteV(s.elbow)).toBe(true);
    }
  });

  it('keeps the elbow bend within 0–150°', () => {
    fc.assert(
      fc.property(vArb(1.5), (t) => {
        const s = solveTwoBone(root, t, pole, L1, L2);
        expect(s.bend).toBeGreaterThanOrEqual(-1e-9);
        expect(s.bend).toBeLessThanOrEqual(150 * DEG + 1e-9);
        // geometric check of the interior angle as well
        const a = normalize(sub(root, s.elbow));
        const b = normalize(sub(s.end, s.elbow));
        const interior = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
        expect(Math.PI - interior).toBeLessThanOrEqual(150 * DEG + 1e-6);
      }),
      { numRuns: 400 },
    );
  });

  it('never produces NaN for degenerate input', () => {
    const cases: [Vec3, Vec3, Vec3][] = [
      [root, root, pole], // zero-length target
      [root, vec(0.19, 0.2, 0), vec(0.19, -1, 0)], // pole collinear with the target
      [root, vec(0.19, 0.2, 0), root], // pole on the root
      [root, root, root], // everything coincident
      [root, vec(NaN, 0, 0), pole],
      [root, vec(Infinity, -Infinity, 0), pole],
      [root, vec(0.3, 0.3, 0.3), vec(NaN, NaN, NaN)],
    ];
    for (const [r, t, p] of cases) {
      const s = solveTwoBone(r, t, p, L1, L2);
      expect(finiteV(s.elbow)).toBe(true);
      expect(finiteV(s.end)).toBe(true);
      expect(Number.isFinite(s.bend)).toBe(true);
      expect(Math.abs(dist(r, s.elbow) - L1)).toBeLessThan(1e-6);
    }
    // zero-length bones are tolerated too
    const z = solveTwoBone(root, vec(0, 0, 0), pole, 0, 0);
    expect(finiteV(z.elbow) && finiteV(z.end)).toBe(true);
  });

  it('respects the pole: the elbow lies on the pole side of the shoulder → wrist line', () => {
    fc.assert(
      fc.property(vArb(0.5), vArb(1), (d, p) => {
        const t = vec(root.x + d.x, root.y + d.y, root.z + d.z);
        const poleP = vec(root.x + p.x, root.y + p.y, root.z + p.z);
        const s = solveTwoBone(root, t, poleP, L1, L2);
        const axis = normalize(sub(s.end, root));
        const poleSide = perp(sub(poleP, root), axis);
        if (length(poleSide) < 1e-3 || s.bend < 1e-3) return; // collinear pole or straight arm: no side to pick
        const elbowSide = perp(sub(s.elbow, root), axis);
        expect(dot(elbowSide, poleSide)).toBeGreaterThan(0);
      }),
      { numRuns: 400 },
    );
  });

  it("bends the dealer's elbows outward and down for table targets", () => {
    for (const side of [1, -1] as Side[]) {
      const sh = shoulderPosition(side, { lean: 0.2, side: 0, twist: 0 });
      for (const t of [vec(side * 0.25, 0.1, 0.35), vec(0, 0.08, 0.3), vec(side * 0.1, 0.2, 0.25), vec(-side * 0.1, 0.12, 0.32)]) {
        const s = solveTwoBone(sh, t, armPole(side, sh, chestFrame({ lean: 0.2, side: 0, twist: 0 }).rot), L1, L2);
        // offset of the elbow from the shoulder → wrist line
        const axis = normalize(sub(s.end, sh));
        const off = perp(sub(s.elbow, sh), axis);
        expect(off.y).toBeLessThan(0); // down
        expect(off.x * side).toBeGreaterThan(-1e-9); // never tucked inward across the body
        expect(dot(off, vec(side, -1, 0))).toBeGreaterThan(0); // out-and-down
        const mid = vec((sh.x + s.end.x) / 2, (sh.y + s.end.y) / 2, (sh.z + s.end.z) / 2);
        expect(s.elbow.y).toBeLessThan(mid.y);
      }
    }
  });
});

// ───────────────────────── reach planning over the real table targets ─────────────────────────

const DEALER_Z = -0.6;
const local = (x: number, y: number, z: number) => vec(x, y, z - DEALER_Z);
const bj = [-60, -40, -20, 0, 20, 40, 60].map((deg) => {
  const a = deg * DEG;
  const r = 0.78 - 0.12; // cards land 0.12 m in front of the betting spot
  return { name: `bj ${deg}°`, p: local(r * Math.sin(a), 0, -0.35 + r * Math.cos(a)) };
});
const holdem = Array.from({ length: 10 }, (_, i) => {
  const a = (-150 + (300 * i) / 9) * DEG;
  return { name: `holdem seat ${i}`, p: local(0.95 * Math.sin(a), 0, 0.05 + 0.48 * Math.cos(a)) };
});
const board = [-0.26, -0.13, 0, 0.13, 0.26].map((x) => ({ name: `board ${x}`, p: local(x, 0, -0.02) }));
const fixed = [
  { name: 'shoe', p: local(0.6, 0.06, -0.3) },
  { name: 'discard', p: local(-0.6, 0.04, -0.3) },
  { name: 'rack', p: local(0, 0.03, -0.4) },
  { name: 'pot', p: local(0, 0, 0.12) },
  ...[-0.1, 0.05, 0.2].map((x) => ({ name: `dealer card ${x}`, p: local(x, 0, -0.12) })),
];
const TARGETS = [...bj, ...holdem, ...board, ...fixed];

describe('reach planner', () => {
  for (const { name, p } of TARGETS) {
    for (const side of [1, -1] as Side[]) {
      it(`${name} (${side > 0 ? 'left' : 'right'} hand): places it or pitches from a sane release point`, () => {
        const plan = planDelivery(p, side);
        expect(finiteV(plan.release) && finiteV(plan.wrist) && finiteV(plan.shoulder)).toBe(true);
        // the wrist is within arm reach of the shoulder for the chosen posture, and IK confirms it
        expect(dist(plan.wrist, plan.shoulder)).toBeLessThanOrEqual(ARM_REACH + 1e-6);
        const ik = solveTwoBone(plan.shoulder, plan.wrist, armPole(side, plan.shoulder), L1, L2);
        expect(dist(ik.end, plan.wrist)).toBeLessThan(1e-3);
        expect(plan.posture.lean).toBeLessThanOrEqual(DIM.maxPlaceLean + 1e-9);
        if (plan.mode === 'place') {
          expect(Math.hypot(plan.release.x - p.x, plan.release.z - p.z)).toBeLessThan(1e-3);
          expect(plan.release.y).toBeGreaterThan(p.y);
        } else {
          expect(plan.release.z).toBeGreaterThan(0.12); // in front of the dealer's chest
          expect(plan.release.y).toBeGreaterThan(0); // above the felt
          expect(plan.slide).toBeGreaterThan(0);
          // the card is released heading toward the target
          const toTarget = normalize(vec(p.x - plan.release.x, 0, p.z - plan.release.z));
          expect(dot(toTarget, plan.heading)).toBeGreaterThan(0.5);
        }
      });
    }
  }

  it('reaches the shoe with the left hand and the discard tray with the right', () => {
    expect(planDelivery(local(0.6, 0.06, -0.3), 1).mode).toBe('place');
    expect(planDelivery(local(-0.6, 0.04, -0.3), -1).mode).toBe('place');
  });

  it('pitches far spots instead of over-reaching', () => {
    const far = planDelivery(bj[3]!.p, -1);
    expect(far.mode).toBe('pitch');
    expect(far.posture.lean).toBeLessThanOrEqual(DIM.maxPitchLean + 1e-9);
  });

  it('never throws for targets behind the dealer, off the table or invalid', () => {
    for (const t of [vec(0, 0, -0.5), vec(3, 0, 0), vec(0, 2, 0.3), vec(NaN, 0, 0), vec(0, -1, 0.4)]) {
      for (const side of [1, -1] as Side[]) {
        const plan = planDelivery(t, side);
        expect(finiteV(plan.release)).toBe(true);
        expect(plan.release.y).toBeGreaterThan(0);
        expect(plan.release.z).toBeGreaterThan(0.12);
        expect(dist(plan.wrist, plan.shoulder)).toBeLessThanOrEqual(ARM_REACH + 1e-6);
      }
    }
  });
});
