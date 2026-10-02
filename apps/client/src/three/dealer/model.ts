import * as THREE from 'three';
import { COLORS } from '../../shared/tokens';
import { createBadge, type Badge } from './badge';
import { DIM, type Side } from './ik';

/**
 * The dealer's body, generated entirely from code: a bone hierarchy plus a handful of faceted, vertex-coloured
 * skinned meshes (one per material, rigid or lightly blended weights). No external models, images or
 * textures — the badge plate is the only canvas texture.
 */

export type Quality = 'low' | 'high';
export type HandName = 'L' | 'R';
export const sideOf = (h: HandName): Side => (h === 'L' ? 1 : -1);

// ───────────────────────── palette ─────────────────────────

const PAL = {
  shirt: '#d2ccc0',
  shirtShade: '#c2bbad',
  cuff: '#dcd7cc',
  vest: '#131215',
  trousers: '#0d0c0e',
  bow: '#3e0a14',
  bowKnot: '#2c070e',
  garter: '#0f0e10',
  skin: '#8a5f47',
  skinShade: '#7a523d',
  lips: '#6e4437',
  hair: '#140d09',
  brow: '#2a1c14',
  eye: '#140f0d',
  onyx: '#101012',
  cardFace: COLORS.ivory,
  cardBack: '#7a1426',
  deckEdge: '#e9e1cd',
  gold: COLORS.gold500,
} as const;

// ───────────────────────── finger layout (hand space: +Y fingers, +Z back of hand, thumb on +s·X) ─────────────────────────

export interface FingerDef {
  x: number;
  y: number;
  z: number;
  l1: number;
  l2: number;
  r: number;
}
export const FINGER_DEFS: readonly FingerDef[] = [
  { x: 0.026, y: 0.088, z: 0.001, l1: 0.042, l2: 0.037, r: 0.0079 }, // index
  { x: 0.0085, y: 0.092, z: 0.002, l1: 0.045, l2: 0.039, r: 0.0082 }, // middle
  { x: -0.0085, y: 0.089, z: 0.001, l1: 0.042, l2: 0.037, r: 0.0077 }, // ring
  { x: -0.025, y: 0.082, z: -0.001, l1: 0.033, l2: 0.03, r: 0.0068 }, // pinky
];
export const THUMB_DEF = { x: 0.023, y: 0.02, z: -0.012, l1: 0.045, l2: 0.033, r: 0.0102 } as const;
/** Deck block socket (bottom face on the palm) in hand space; x mirrored per side. */
export const DECK_SOCKET = new THREE.Vector3(-0.003, 0.07, -0.0165);
export const CARD_W = 0.0635;
export const CARD_H = 0.0889;
export const DECK_T = 0.016;

/** Thumb rest frame in hand space: y along the thumb, z = nail side. */
export function thumbRestQuat(s: Side): THREE.Quaternion {
  const y = new THREE.Vector3(0.62 * s, 0.72, -0.3).normalize();
  const nail = new THREE.Vector3(0.75 * s, 0, 0.66);
  const z = nail.sub(y.clone().multiplyScalar(nail.dot(y))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// ───────────────────────── rig ─────────────────────────

export interface ArmRig {
  side: Side;
  clavicle: THREE.Bone;
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  /** index, middle, ring, pinky — [proximal, distal]. */
  fingers: [THREE.Bone, THREE.Bone][];
  thumb: [THREE.Bone, THREE.Bone];
  thumbRest: THREE.Quaternion;
  deck: THREE.Bone;
  /** Card grip socket (a plain node, exported with the rig). */
  grip: THREE.Object3D;
}

export interface DealerModel {
  readonly root: THREE.Group;
  readonly hips: THREE.Bone;
  readonly spine1: THREE.Bone;
  readonly spine2: THREE.Bone;
  readonly chest: THREE.Bone;
  readonly neck: THREE.Bone;
  readonly head: THREE.Bone;
  readonly eyeL: THREE.Bone;
  readonly eyeR: THREE.Bone;
  /** Free-floating held-card proxy (child of root, posed in rig space each frame). */
  readonly card: THREE.Bone;
  readonly arms: { L: ArmRig; R: ArmRig };
  readonly skeleton: THREE.Skeleton;
  readonly eyeRest: { L: THREE.Vector3; R: THREE.Vector3 };
  readonly meshes: THREE.Mesh[];
  rebuild(q: Quality): void;
  setLocale(l: 'pl' | 'en'): void;
  triangles(): number;
  drawCalls(): number;
  dispose(): void;
}

function bone(name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

// ───────────────────────── geometry helpers ─────────────────────────

type Skin = [number, number][];

interface Ring {
  y: number;
  rx: number;
  rzF: number;
  rzB?: number;
  cx?: number;
  cz?: number;
}

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

function ringPoint(r: Ring, a: number, exp: number): THREE.Vector3 {
  const s = Math.sin(a);
  const c = Math.cos(a);
  const p = 2 / exp;
  const rz = c >= 0 ? r.rzF : (r.rzB ?? r.rzF);
  return new THREE.Vector3((r.cx ?? 0) + r.rx * sgnPow(s, p), r.y, (r.cz ?? 0) + rz * sgnPow(c, p));
}

/** Triangles from a grid of rows (bottom → top), each row a polyline of points (same count). Faces outward for a → +X order. */
function gridGeo(rows: THREE.Vector3[][], capBottom = false, capTop = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < rows.length - 1; i++) {
    const r0 = rows[i]!;
    const r1 = rows[i + 1]!;
    for (let j = 0; j < r0.length - 1; j++) {
      const a = r0[j]!;
      const b = r0[j + 1]!;
      const c = r1[j]!;
      const d = r1[j + 1]!;
      if (a.distanceToSquared(b) > 1e-12) tri(a, b, c);
      if (c.distanceToSquared(d) > 1e-12) tri(b, d, c);
    }
  }
  const cap = (row: THREE.Vector3[], top: boolean) => {
    const c = row.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(row.length);
    for (let j = 0; j < row.length - 1; j++) {
      if (top) tri(c, row[j]!, row[j + 1]!);
      else tri(c, row[j + 1]!, row[j]!);
    }
  };
  if (capBottom) cap(rows[0]!, false);
  if (capTop) cap(rows[rows.length - 1]!, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

interface LoftOpts {
  exp?: number;
  range?: (r: Ring) => [number, number];
  capBottom?: boolean;
  capTop?: boolean;
  /** Per-vertex tweak (ring index, angle, point). */
  tweak?: (ri: number, a: number, p: THREE.Vector3) => void;
}

function loft(rings: Ring[], segs: number, o: LoftOpts = {}): THREE.BufferGeometry {
  const exp = o.exp ?? 2;
  const rows = rings.map((r, ri) => {
    const [a0, a1] = o.range ? o.range(r) : [-Math.PI, Math.PI];
    const row: THREE.Vector3[] = [];
    for (let j = 0; j <= segs; j++) {
      const a = a0 + ((a1 - a0) * j) / segs;
      const p = ringPoint(r, a, exp);
      o.tweak?.(ri, a, p);
      row.push(p);
    }
    return row;
  });
  return gridGeo(rows, o.capBottom, o.capTop);
}

/** Round tube along +Y through (y, radius) stations; rz = radius × flat. */
function tube(stations: [number, number][], segs: number, flat = 1, capBottom = true, capTop = true, cz = 0): THREE.BufferGeometry {
  return loft(
    stations.map(([y, r]) => ({ y, rx: r, rzF: r * flat, cz })),
    segs,
    { capBottom, capTop },
  );
}

function trisGeo(points: [number, number, number][], faces: [number, number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const f of faces) for (const i of f) pos.push(...points[i]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
function place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, 'YXZ')), S.set(sx, sy, sz));
}

type MatKey = 'matte' | 'satin' | 'gold' | 'hair';
const MAT_KEYS: MatKey[] = ['matte', 'satin', 'gold', 'hair'];

class Accumulator {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];

  add(geo: THREE.BufferGeometry, color: THREE.Color | ((tri: number, centroid: THREE.Vector3) => THREE.Color), skin: Skin | ((p: THREE.Vector3) => Skin), m: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(m).clone());
    for (let t = 0; t + 2 < pts.length; t += 3) {
      const a = pts[t]!;
      const b = pts[t + 1]!;
      const c = pts[t + 2]!;
      const cen = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
      const colr = typeof color === 'function' ? color(t / 3, cen) : color;
      for (const q of [a, b, c]) {
        this.pos.push(q.x, q.y, q.z);
        this.col.push(colr.r, colr.g, colr.b);
        const w = typeof skin === 'function' ? skin(q) : skin;
        let total = 0;
        for (let k = 0; k < 4; k++) total += w[k]?.[1] ?? 0;
        for (let k = 0; k < 4; k++) {
          this.si.push(w[k]?.[0] ?? 0);
          this.sw.push(total > 0 ? (w[k]?.[1] ?? 0) / total : k === 0 ? 1 : 0);
        }
      }
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.computeVertexNormals(); // non-indexed → per-face (faceted) normals
    return g;
  }
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ───────────────────────── body shapes ─────────────────────────

/** Torso cross-sections (rig space, rest pose). Superellipse exponent gives a tailored, slightly boxy cut. */
const TORSO: Ring[] = [
  { y: -0.16, rx: 0.146, rzF: 0.086, rzB: 0.098, cz: -0.012 },
  { y: 0.02, rx: 0.151, rzF: 0.088, rzB: 0.1, cz: -0.012 },
  { y: 0.112, rx: 0.15, rzF: 0.09, rzB: 0.099, cz: -0.01 },
  { y: 0.2, rx: 0.145, rzF: 0.093, rzB: 0.094, cz: -0.006 },
  { y: 0.29, rx: 0.15, rzF: 0.1, rzB: 0.093, cz: -0.003 },
  { y: 0.38, rx: 0.161, rzF: 0.107, rzB: 0.096 },
  { y: 0.46, rx: 0.171, rzF: 0.112, rzB: 0.098 },
  { y: 0.535, rx: 0.179, rzF: 0.11, rzB: 0.098 },
  { y: 0.59, rx: 0.186, rzF: 0.1, rzB: 0.095, cz: -0.004 },
  { y: 0.635, rx: 0.192, rzF: 0.088, rzB: 0.088, cz: -0.006 },
  { y: 0.666, rx: 0.176, rzF: 0.073, rzB: 0.077, cz: -0.008 },
  { y: 0.685, rx: 0.118, rzF: 0.06, rzB: 0.066, cz: -0.008 },
  { y: 0.697, rx: 0.055, rzF: 0.048, rzB: 0.054, cz: -0.008 },
];
const TORSO_EXP = 2.5;

function torsoAt(y: number, grow = 0): Ring {
  let i = 0;
  while (i < TORSO.length - 2 && TORSO[i + 1]!.y < y) i++;
  const a = TORSO[i]!;
  const b = TORSO[i + 1]!;
  const t = Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y)));
  const l = (p: number, q: number) => p + (q - p) * t;
  return {
    y,
    rx: l(a.rx, b.rx) + grow,
    rzF: l(a.rzF, b.rzF) + grow,
    rzB: l(a.rzB ?? a.rzF, b.rzB ?? b.rzF) + grow,
    cz: l(a.cz ?? 0, b.cz ?? 0),
  };
}

/** Front surface z of the torso at (x, y) — for placing buttons, studs and the badge. */
function torsoFront(y: number, x: number, grow = 0): { z: number; normal: THREE.Vector3 } {
  const r = torsoAt(y, grow);
  const s = Math.min(0.999, Math.abs(x) / r.rx);
  const a = Math.asin(Math.pow(s, TORSO_EXP / 2)) * Math.sign(x);
  const p = ringPoint(r, a, TORSO_EXP);
  const p2 = ringPoint(r, a + 0.01, TORSO_EXP);
  const tangent = p2.sub(p);
  const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  if (normal.z < 0) normal.negate();
  return { z: p.z, normal };
}

/** Head profile rings relative to the head centre: [y, rx, rzFront, rzBack, cz]. */
const HEAD_RINGS: [number, number, number, number, number][] = [
  [-0.109, 0.028, 0.016, 0.012, 0.052],
  [-0.093, 0.048, 0.031, 0.03, 0.04],
  [-0.069, 0.063, 0.053, 0.048, 0.021],
  [-0.041, 0.071, 0.074, 0.068, 0.009],
  [-0.008, 0.075, 0.086, 0.083, 0.003],
  [0.028, 0.076, 0.089, 0.09, 0],
  [0.062, 0.072, 0.083, 0.091, -0.004],
  [0.092, 0.059, 0.065, 0.078, -0.008],
  [0.114, 0.035, 0.037, 0.05, -0.01],
];
const HEAD_TOP = 0.126;
const HEAD_EXP = 2.3;

function headRing(i: number): Ring {
  const [y, rx, rzF, rzB, cz] = HEAD_RINGS[i]!;
  return { y, rx, rzF, rzB, cz };
}

function headRingAt(y: number, grow = 0): Ring {
  let i = 0;
  while (i < HEAD_RINGS.length - 2 && HEAD_RINGS[i + 1]![0] < y) i++;
  const a = headRing(i);
  const b = headRing(i + 1);
  const t = Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y)));
  const l = (p: number, q: number) => p + (q - p) * t;
  return { y, rx: l(a.rx, b.rx) + grow, rzF: l(a.rzF, b.rzF) + grow, rzB: l(a.rzB!, b.rzB!) + grow, cz: l(a.cz!, b.cz!) };
}

/** Brow ridge: the brow ring pushes forward over the eyes. */
function headTweak(y: number, a: number, p: THREE.Vector3): void {
  const front = Math.max(0, Math.cos(a));
  if (Math.abs(y - 0.028) < 1e-6) p.z += 0.0028 * Math.pow(front, 6);
  if (Math.abs(y + 0.008) < 1e-6) p.z -= 0.002 * Math.pow(front, 4);
}

/** z of the faceted face surface at (y, x) relative to the head centre (front side). */
function faceZ(y: number, x: number, segs: number): number {
  // interpolate within the actual facets: two bracketing rings, polyline around the front
  let i = 0;
  while (i < HEAD_RINGS.length - 2 && HEAD_RINGS[i + 1]![0] < y) i++;
  const rowZ = (ri: number) => {
    const r = headRing(ri);
    let prev: THREE.Vector3 | null = null;
    for (let j = 0; j <= segs; j++) {
      const a = -Math.PI / 2 + (Math.PI * j) / segs;
      const p = ringPoint(r, a, HEAD_EXP);
      headTweak(r.y, a, p);
      if (prev && x >= prev.x && x <= p.x) {
        const t = (x - prev.x) / Math.max(1e-6, p.x - prev.x);
        return prev.z + (p.z - prev.z) * t;
      }
      prev = p;
    }
    return r.cz! + r.rzF;
  };
  const y0 = HEAD_RINGS[i]![0];
  const y1 = HEAD_RINGS[i + 1]![0];
  const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  return rowZ(i) + (rowZ(i + 1) - rowZ(i)) * t;
}

// ───────────────────────── model ─────────────────────────

export function buildDealerModel(quality: Quality, locale: 'pl' | 'en'): DealerModel {
  const root = new THREE.Group();
  root.name = 'JacbosDealer';

  const hips = bone('hips', root, 0, DIM.hipsY, 0);
  const spine1 = bone('spine1', hips, 0, DIM.spine1, 0);
  const spine2 = bone('spine2', spine1, 0, DIM.spine2, 0);
  const chest = bone('chest', spine2, 0, DIM.chest, 0);
  const neck = bone('neck', chest, DIM.neck.x, DIM.neck.y, DIM.neck.z);
  const head = bone('head', neck, DIM.head.x, DIM.head.y, DIM.head.z);
  const EYE_X = 0.03;
  const EYE_Y = 0.006;
  const eyeZ = (x: number) => faceZ(EYE_Y, x, 14) + 0.0011;
  const eyeYaw = (x: number) => {
    const dz = faceZ(EYE_Y, x + 0.004, 14) - faceZ(EYE_Y, x - 0.004, 14);
    return Math.atan2(-dz, 0.008);
  };
  const eyeL = bone('eyeL', head, EYE_X, DIM.headCentre + EYE_Y, eyeZ(EYE_X));
  const eyeR = bone('eyeR', head, -EYE_X, DIM.headCentre + EYE_Y, eyeZ(-EYE_X));
  eyeL.rotation.set(0, eyeYaw(EYE_X), 0);
  eyeR.rotation.set(0, eyeYaw(-EYE_X), 0);

  const makeArm = (h: HandName): ArmRig => {
    const s = sideOf(h);
    const clavicle = bone(`clavicle${h}`, chest, DIM.clavicle.x * s, DIM.clavicle.y, DIM.clavicle.z);
    const upper = bone(`upperArm${h}`, clavicle, DIM.shoulder.x * s, DIM.shoulder.y, DIM.shoulder.z);
    upper.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI); // arms hang down, palms forward
    const fore = bone(`forearm${h}`, upper, 0, DIM.upperArm, 0);
    const hand = bone(`hand${h}`, fore, 0, DIM.forearm, 0);
    const names = ['index', 'middle', 'ring', 'pinky'];
    const fingers = FINGER_DEFS.map((f, i) => {
      const p = bone(`${names[i]}1${h}`, hand, f.x * s, f.y, f.z);
      const d = bone(`${names[i]}2${h}`, p, 0, f.l1, 0);
      return [p, d] as [THREE.Bone, THREE.Bone];
    });
    const t1 = bone(`thumb1${h}`, hand, THUMB_DEF.x * s, THUMB_DEF.y, THUMB_DEF.z);
    const thumbRest = thumbRestQuat(s);
    t1.quaternion.copy(thumbRest);
    const t2 = bone(`thumb2${h}`, t1, 0, THUMB_DEF.l1, 0);
    const deck = bone(`deck${h}`, hand, DECK_SOCKET.x * s, DECK_SOCKET.y, DECK_SOCKET.z);
    const grip = new THREE.Object3D();
    grip.name = `grip${h}`;
    grip.position.set(DIM.grip.x, DIM.grip.y, DIM.grip.z);
    hand.add(grip);
    return { side: s, clavicle, upper, fore, hand, fingers, thumb: [t1, t2], thumbRest, deck, grip };
  };
  const arms = { L: makeArm('L'), R: makeArm('R') };
  const card = bone('heldCard', root, 0, 0.1, 0.3);

  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const index = new Map(bones.map((b, i) => [b, i]));
  const rest = bones.map((b) => b.matrixWorld.clone());
  const inverses = rest.map((m) => m.clone().invert());
  const skeleton = new THREE.Skeleton(bones, inverses);
  const eyeRest = { L: eyeL.position.clone(), R: eyeR.position.clone() };

  const color = (hex: string) => new THREE.Color(hex);
  const rigid = (b: THREE.Bone): Skin => [[index.get(b)!, 1]];
  const at = (b: THREE.Bone, local: THREE.Matrix4 = new THREE.Matrix4()) => rest[index.get(b)!]!.clone().multiply(local);

  // Torso skin weights: spine joints blend smoothly, the outer shoulder follows the clavicle.
  const torsoSkin = (p: THREE.Vector3): Skin => {
    const y = p.y;
    const w: Skin = [];
    const h = index.get(hips)!;
    const s1 = index.get(spine1)!;
    const s2 = index.get(spine2)!;
    const c = index.get(chest)!;
    let pair: [number, number, number];
    if (y < 0.27) pair = [h, s1, smooth(0.16, 0.27, y)];
    else if (y < 0.39) pair = [s1, s2, smooth(0.29, 0.39, y)];
    else pair = [s2, c, smooth(0.43, 0.51, y)];
    let wc = 0;
    const clav = p.x >= 0 ? index.get(arms.L.clavicle)! : index.get(arms.R.clavicle)!;
    if (pair[1] === c) wc = 0.85 * smooth(0.1, 0.17, Math.abs(p.x)) * smooth(0.52, 0.61, y);
    w.push([pair[0], (1 - pair[2]) * (1 - wc)], [pair[1], pair[2] * (1 - wc)]);
    if (wc > 0) w.push([clav, wc]);
    return w;
  };

  const meshes: THREE.Mesh[] = [];
  const materials = {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0, flatShading: true, shadowSide: THREE.BackSide }),
    satin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.05, flatShading: true, shadowSide: THREE.BackSide }),
    gold: new THREE.MeshStandardMaterial({ color: PAL.gold, roughness: 0.3, metalness: 0.85, emissive: '#2e2008', flatShading: true }),
    // Slicked dark hair: a soft sheen from the lights but little environment reflection (keeps it from greying).
    hair: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0, envMapIntensity: 0.18, flatShading: true, shadowSide: THREE.BackSide }),
  };
  materials.matte.name = 'dealer-matte';
  materials.satin.name = 'dealer-satin';
  materials.gold.name = 'dealer-gold';
  materials.hair.name = 'dealer-hair';

  const skinned: Record<MatKey, THREE.SkinnedMesh> = {} as Record<MatKey, THREE.SkinnedMesh>;
  for (const k of MAT_KEYS) {
    const m = new THREE.SkinnedMesh(new THREE.BufferGeometry(), materials[k]);
    m.name = `dealer-${k}`;
    m.castShadow = true;
    m.receiveShadow = true;
    // Generous fixed bounds covering every reachable pose (skinned bounds are not recomputed per frame).
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.42, 0.3), 1.2);
    root.add(m);
    m.bind(skeleton, new THREE.Matrix4());
    skinned[k] = m;
    meshes.push(m);
  }

  // Badge plate: textured plane on the chest; its brass frame is part of the gold mesh.
  const badge: Badge = createBadge(locale);
  const badgeMat = new THREE.MeshStandardMaterial({
    color: badge.texture ? '#ffffff' : PAL.gold,
    map: badge.texture,
    emissiveMap: badge.texture,
    emissive: badge.texture ? '#ffffff' : '#000000',
    emissiveIntensity: 0.14,
    roughness: 0.42,
    metalness: 0.35,
  });
  badgeMat.name = 'dealer-badge';
  const BADGE = { x: 0.106, y: 0.497, w: 0.068, h: 0.0185 };
  const badgeFront = torsoFront(BADGE.y, BADGE.x, 0.007);
  const badgeYaw = Math.atan2(badgeFront.normal.x, badgeFront.normal.z);
  const badgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(BADGE.w, BADGE.h), badgeMat);
  badgeMesh.name = 'dealer-badge';
  badgeMesh.castShadow = false;
  {
    const chestRest = rest[index.get(chest)!]!;
    const pos = new THREE.Vector3(BADGE.x, BADGE.y, badgeFront.z).addScaledVector(badgeFront.normal, 0.0042);
    pos.applyMatrix4(chestRest.clone().invert());
    badgeMesh.position.copy(pos);
    badgeMesh.rotation.set(-0.06, badgeYaw, 0, 'YXZ');
  }
  chest.add(badgeMesh);
  meshes.push(badgeMesh);

  function buildGeometry(q: Quality): void {
    const hi = q === 'high';
    const acc: Record<MatKey, Accumulator> = { matte: new Accumulator(), satin: new Accumulator(), gold: new Accumulator(), hair: new Accumulator() };
    const ID = new THREE.Matrix4();

    // ── torso: shirt above the belt line, trousers below ──
    const torsoSegs = hi ? 18 : 12;
    acc.matte.add(
      loft(TORSO, torsoSegs, { exp: TORSO_EXP, capBottom: true }),
      (_t, c) => color(c.y < 0.112 ? PAL.trousers : PAL.shirt),
      torsoSkin,
      ID,
    );
    // belt
    acc.satin.add(
      loft([torsoAt(0.085, 0.004), torsoAt(0.112, 0.004)], torsoSegs, { exp: TORSO_EXP }),
      color('#0a0a0b'),
      torsoSkin,
      ID,
    );
    // shirt placket down the V
    {
      const y0 = 0.395;
      const y1 = 0.645;
      const f0 = torsoFront(y0, 0).z;
      const f1 = torsoFront(y1, 0).z;
      const g = new THREE.BoxGeometry(0.024, y1 - y0, 0.003);
      const tilt = Math.atan2(f0 - f1, y1 - y0);
      acc.matte.add(g, color(PAL.shirtShade), torsoSkin, place(0, (y0 + y1) / 2, (f0 + f1) / 2 + 0.0035, tilt));
    }

    // ── vest: two front panels with a V neck, a back panel; armholes; gold piping on the V ──
    const vRings = [0.085, 0.13, 0.2, 0.28, 0.35, 0.4, 0.445, 0.49, 0.535, 0.575, 0.612];
    const VTIP = 0.4;
    const VTOP = 0.612;
    const alpha = (y: number) => (y <= VTIP ? 0 : 0.6 * Math.pow((y - VTIP) / (VTOP - VTIP), 0.95));
    const arm = (y: number) => 0.78 * smooth(0.44, 0.62, y);
    const frontSegs = hi ? 6 : 4;
    const backSegs = hi ? 10 : 6;
    const vestBottom = (a: number) => 0.112 - 0.06 * Math.pow(Math.max(0, Math.cos(a)), 6);
    const vestTweak = (ri: number, a: number, p: THREE.Vector3) => {
      if (ri === 0) {
        const r = torsoAt(vestBottom(a), 0.0075);
        const q = ringPoint(r, a, TORSO_EXP);
        p.copy(q);
      }
    };
    const vestColor = color(PAL.vest);
    for (const s of [1, -1]) {
      const rings = vRings.map((y) => torsoAt(y, 0.0075));
      acc.satin.add(
        loft(rings, frontSegs, {
          exp: TORSO_EXP,
          range: (r) => {
            const a0 = alpha(r.y);
            const a1 = Math.PI / 2 - arm(r.y);
            return s > 0 ? [a0, a1] : [-a1, -a0];
          },
          tweak: vestTweak,
        }),
        vestColor,
        torsoSkin,
        ID,
      );
      // piping strip along the V edge
      const edge: THREE.Vector3[][] = [[], []];
      for (const y of vRings.filter((y) => y >= VTIP)) {
        const r = torsoAt(y, 0.0088);
        const a = alpha(y) * s;
        edge[0]!.push(ringPoint(r, a, TORSO_EXP));
        edge[1]!.push(ringPoint(r, a + 0.03 * s, TORSO_EXP));
      }
      const rows = s > 0 ? [edge[0]!, edge[1]!] : [edge[1]!, edge[0]!];
      // rows are along y; build quads between the two edge lines
      const pos: number[] = [];
      for (let i = 0; i < rows[0]!.length - 1; i++) {
        const a = rows[0]![i]!;
        const b = rows[1]![i]!;
        const c = rows[0]![i + 1]!;
        const d = rows[1]![i + 1]!;
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      acc.gold.add(pg, color(PAL.gold), torsoSkin, ID);
    }
    {
      const rings = [...vRings, 0.64].map((y) => torsoAt(y, 0.0075));
      acc.satin.add(
        loft(rings, backSegs, {
          exp: TORSO_EXP,
          range: (r) => [Math.PI / 2 + arm(Math.min(r.y, VTOP)), (3 * Math.PI) / 2 - arm(Math.min(r.y, VTOP))],
          tweak: vestTweak,
        }),
        vestColor,
        torsoSkin,
        ID,
      );
    }
    // three gold buttons below the V
    for (const y of [0.362, 0.297, 0.232]) {
      const f = torsoFront(y, 0, 0.0075);
      const g = new THREE.CylinderGeometry(0.0074, 0.0074, 0.0034, hi ? 8 : 6);
      acc.gold.add(g, color(PAL.gold), torsoSkin, place(0, y, f.z + 0.0016, Math.PI / 2));
      const g2 = new THREE.CylinderGeometry(0.0042, 0.0058, 0.0016, hi ? 8 : 6);
      acc.gold.add(g2, color(PAL.gold), torsoSkin, place(0, y, f.z + 0.0038, Math.PI / 2));
    }
    // onyx shirt studs in the V
    for (const y of [0.455, 0.513, 0.57]) {
      const f = torsoFront(y, 0).z + 0.0062;
      acc.satin.add(new THREE.OctahedronGeometry(0.0034, 0), color(PAL.onyx), torsoSkin, place(0, y, f, 0, 0, 0, 1, 1, 0.55));
    }
    // badge frame
    {
      const chestRest = rest[index.get(chest)!]!;
      const g = new THREE.BoxGeometry(BADGE.w + 0.004, BADGE.h + 0.004, 0.0022);
      const local = new THREE.Matrix4().compose(badgeMesh.position, badgeMesh.quaternion, new THREE.Vector3(1, 1, 1));
      const m = chestRest.clone().multiply(local).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.0012));
      acc.gold.add(g, color(PAL.gold), rigid(chest), m);
    }

    // ── neck, collar & bow tie ──
    acc.matte.add(
      loft(
        [
          { y: -0.035, rx: 0.051, rzF: 0.053 },
          { y: 0.03, rx: 0.049, rzF: 0.051 },
          { y: 0.09, rx: 0.047, rzF: 0.049 },
          { y: 0.135, rx: 0.044, rzF: 0.046 },
        ],
        hi ? 10 : 8,
        { capTop: true },
      ),
      color(PAL.skin),
      rigid(neck),
      at(neck),
    );
    {
      const segs = hi ? 14 : 10;
      const gap = 0.3;
      const collar = loft(
        [
          { y: 0.652, rx: 0.058, rzF: 0.06, rzB: 0.058, cz: -0.007 },
          { y: 0.68, rx: 0.057, rzF: 0.059, rzB: 0.057, cz: -0.007 },
          { y: 0.707, rx: 0.055, rzF: 0.057, rzB: 0.055, cz: -0.007 },
        ],
        segs,
        { range: () => [gap, 2 * Math.PI - gap] },
      );
      acc.matte.add(collar, color(PAL.shirt), rigid(chest), ID);
      // wing tips folded down in front
      for (const s of [1, -1]) {
        const x0 = 0.058 * Math.sin(gap) * s;
        const z0 = -0.007 + 0.06 * Math.cos(gap);
        const pts: [number, number, number][] = [
          [x0, 0.706, z0],
          [x0 + 0.02 * s, 0.683, z0 - 0.002],
          [x0 - 0.002 * s, 0.684, z0 + 0.007],
          [x0, 0.706, z0 - 0.003],
          [x0 + 0.02 * s, 0.683, z0 - 0.005],
          [x0 - 0.002 * s, 0.684, z0 + 0.004],
        ];
        const faces: [number, number, number][] = s > 0 ? [[0, 2, 1], [3, 4, 5], [0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4], [2, 0, 3], [2, 3, 5]] : [[0, 1, 2], [3, 5, 4], [0, 4, 1], [0, 3, 4], [1, 5, 2], [1, 4, 5], [2, 3, 0], [2, 5, 3]];
        acc.matte.add(trisGeo(pts, faces), color(PAL.shirt), rigid(chest), ID);
      }
      // bow tie: two faceted wings and a knot
      const bowY = 0.679;
      const bowZ = 0.06;
      for (const s of [1, -1]) {
        const shape = new THREE.Shape();
        shape.moveTo(0.005 * s, 0.0068);
        shape.lineTo(0.05 * s, 0.0205);
        shape.lineTo(0.0435 * s, 0);
        shape.lineTo(0.05 * s, -0.0205);
        shape.lineTo(0.005 * s, -0.0068);
        shape.closePath();
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.009, bevelEnabled: true, bevelThickness: 0.0018, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 1 });
        acc.satin.add(g, color(PAL.bow), rigid(chest), place(0, bowY, bowZ - 0.006, 0, -0.16 * s, 0));
      }
      acc.satin.add(new THREE.BoxGeometry(0.0135, 0.016, 0.0125), color(PAL.bowKnot), rigid(chest), place(0, bowY, bowZ + 0.0005));
    }

    // ── head ──
    {
      const segs = hi ? 14 : 10;
      const rings = HEAD_RINGS.map((_, i) => headRing(i));
      const headGeo = loft(rings, segs, {
        exp: HEAD_EXP,
        tweak: (ri, a, p) => headTweak(rings[ri]!.y, a, p),
        capBottom: true,
      });
      // close the crown with a point
      const top = loft([rings[rings.length - 1]!, { y: HEAD_TOP, rx: 0.0005, rzF: 0.0005, cz: -0.01 }], segs, { exp: HEAD_EXP });
      const hm = at(head, place(0, DIM.headCentre, 0));
      acc.matte.add(headGeo, color(PAL.skin), rigid(head), hm);
      acc.matte.add(top, color(PAL.skin), rigid(head), hm);

      // nose: faceted wedge
      const zf = (y: number, x: number) => faceZ(y, x, 14);
      const np: [number, number, number][] = [
        [0, 0.02, zf(0.02, 0) - 0.001],
        [0, -0.028, zf(-0.028, 0) + 0.0165],
        [-0.0105, -0.038, zf(-0.038, -0.0105) + 0.0035],
        [0.0105, -0.038, zf(-0.038, 0.0105) + 0.0035],
        [-0.0075, -0.004, zf(-0.004, -0.0075) - 0.0004],
        [0.0075, -0.004, zf(-0.004, 0.0075) - 0.0004],
      ];
      const nf: [number, number, number][] = [
        [0, 1, 5],
        [0, 4, 1],
        [5, 1, 3],
        [4, 2, 1],
        [2, 3, 1],
      ];
      acc.matte.add(trisGeo(np, nf), color(PAL.skin), rigid(head), hm);
      // ears
      for (const s of [1, -1]) {
        acc.matte.add(new THREE.IcosahedronGeometry(1, 0), color(PAL.skinShade), rigid(head), at(head, place(0.0742 * s, DIM.headCentre - 0.004, -0.007, -0.08, 0.32 * s, 0.1 * s, 0.009, 0.029, 0.019)));
      }
      // brows (hair-coloured planes) and a quiet mouth line
      for (const s of [1, -1]) {
        const x = 0.031 * s;
        acc.hair.add(new THREE.BoxGeometry(0.024, 0.0034, 0.004), color(PAL.brow), rigid(head), hm.clone().multiply(place(x, 0.0298, zf(0.0298, x) + 0.0012, 0.15, 0.38 * s, -0.05 * s)));
      }
      acc.matte.add(new THREE.BoxGeometry(0.024, 0.0022, 0.002), color(PAL.lips), rigid(head), hm.clone().multiply(place(0, -0.058, zf(-0.058, 0) + 0.0003)));
      // sideburns
      for (const s of [1, -1]) {
        acc.hair.add(new THREE.BoxGeometry(0.006, 0.026, 0.013), color(PAL.hair), rigid(head), hm.clone().multiply(place(0.0712 * s, 0.012, 0.024, 0, 0.3 * s, 0)));
      }
      // eyes: small dark almonds on their own bones (they blink)
      for (const [eb, s] of [
        [eyeL, 1],
        [eyeR, -1],
      ] as [THREE.Bone, number][]) {
        const n = hi ? 8 : 6;
        const pts: [number, number, number][] = [[0, 0, 0.0012]];
        for (let j = 0; j < n; j++) {
          const th = (2 * Math.PI * j) / n;
          const c = Math.cos(th);
          // almond: slightly pointed toward the outer corner, lid line a touch flatter on top
          pts.push([0.0084 * c, 0.0043 * Math.sin(th) * (1 - 0.18 * c * s), 0]);
        }
        const faces: [number, number, number][] = [];
        for (let j = 0; j < n; j++) faces.push([0, 1 + j, 1 + ((j + 1) % n)]);
        acc.satin.add(trisGeo(pts, faces), color(PAL.eye), rigid(eb), at(eb));
      }
      // hair: a conformal faceted cap with a slicked-back volume and a crisp hairline
      const hs = hi ? 16 : 12;
      const rowsN = hi ? 6 : 4;
      const hairline = (a: number) => {
        const k = Math.abs(a);
        const table: [number, number][] = [
          [0, 0.083],
          [0.39, 0.075],
          [0.79, 0.051],
          [1.18, 0.031],
          [1.57, 0.02],
          [1.96, 0.004],
          [2.36, -0.026],
          [2.75, -0.046],
          [Math.PI, -0.054],
        ];
        for (let i = 0; i < table.length - 1; i++) {
          const [a0, y0] = table[i]!;
          const [a1, y1] = table[i + 1]!;
          if (k <= a1) return y0 + ((y1 - y0) * (k - a0)) / (a1 - a0);
        }
        return -0.054;
      };
      const thick = (a: number, y: number) => {
        const front = Math.max(0, Math.cos(a));
        return 0.0045 + 0.0045 * front * smooth(0.06, 0.11, y) + 0.003 * smooth(0.02, 0.1, y) + (a > 0.2 && a < 1.2 ? 0.0012 : 0);
      };
      const rows: THREE.Vector3[][] = [];
      const surf = (a: number, y: number, t: number) => {
        const p = ringPoint(headRingAt(y, t), a, HEAD_EXP);
        p.y = y + t * 0.6 * smooth(0.05, 0.11, y);
        return p;
      };
      // inner lip row (on the skin), side rows up the skull, then a flat crown ring and cap (no polar star)
      const lip: THREE.Vector3[] = [];
      for (let j = 0; j <= hs; j++) {
        const a = -Math.PI + (2 * Math.PI * j) / hs;
        lip.push(surf(a, hairline(a) - 0.0015, -0.0015));
      }
      rows.push(lip);
      const SIDE_TOP = 0.108;
      for (let r = 0; r < rowsN; r++) {
        const row: THREE.Vector3[] = [];
        for (let j = 0; j <= hs; j++) {
          const a = -Math.PI + (2 * Math.PI * j) / hs;
          const y0 = hairline(a);
          const u = Math.pow(r / (rowsN - 1), 0.9);
          const y = y0 + (SIDE_TOP - y0) * u;
          // thin at the hairline, fuller above it — no visible "helmet" rim
          row.push(surf(a, y, thick(a, y) * (0.2 + 0.8 * smooth(0, 0.035, y - y0))));
        }
        rows.push(row);
      }
      for (const [k, dy] of [
        [0.66, 0.006],
        [0.34, 0.0105],
      ] as const) {
        const crown: THREE.Vector3[] = [];
        for (let j = 0; j <= hs; j++) {
          const a = -Math.PI + (2 * Math.PI * j) / hs;
          const r = headRingAt(0.114, thick(a, 0.114));
          const p = ringPoint(r, a, HEAD_EXP);
          crown.push(new THREE.Vector3(p.x * k, HEAD_TOP + dy, r.cz! + (p.z - r.cz!) * k - 0.002));
        }
        rows.push(crown);
      }
      acc.hair.add(gridGeo(rows, false, true), color(PAL.hair), rigid(head), hm);
    }

    // ── arms & hands ──
    for (const h of ['L', 'R'] as HandName[]) {
      const A = arms[h];
      const s = A.side;
      const limbSegs = hi ? 9 : 7;
      // shoulder joint & upper sleeve
      acc.matte.add(new THREE.IcosahedronGeometry(1, 1), color(PAL.shirt), rigid(A.upper), at(A.upper, place(0, 0.012, 0, 0, 0, 0, 0.0495, 0.054, 0.049)));
      acc.matte.add(
        tube(
          [
            [0.0, 0.05],
            [0.08, 0.0495],
            [0.17, 0.0465],
            [0.25, 0.0435],
            [0.298, 0.0415],
          ],
          limbSegs,
          0.95,
          false,
          false,
        ),
        color(PAL.shirt),
        rigid(A.upper),
        at(A.upper),
      );
      // sleeve garter with a small gold clasp
      acc.satin.add(
        tube(
          [
            [0.104, 0.0498],
            [0.109, 0.0528],
            [0.125, 0.0522],
            [0.13, 0.0488],
          ],
          limbSegs,
          0.95,
          false,
          false,
        ),
        color(PAL.garter),
        rigid(A.upper),
        at(A.upper),
      );
      acc.gold.add(new THREE.BoxGeometry(0.004, 0.014, 0.01), color(PAL.gold), rigid(A.upper), at(A.upper, place(0.0545 * s, 0.117, 0)));
      // elbow & forearm sleeve gathered into a crisp cuff
      acc.matte.add(new THREE.IcosahedronGeometry(0.0445, 1), color(PAL.shirt), rigid(A.fore), at(A.fore));
      acc.matte.add(
        tube(
          [
            [0.0, 0.0438],
            [0.075, 0.0462],
            [0.15, 0.043],
            [0.205, 0.0365],
          ],
          limbSegs,
          0.95,
          false,
          false,
        ),
        color(PAL.shirt),
        rigid(A.fore),
        at(A.fore),
      );
      acc.matte.add(
        tube(
          [
            [0.196, 0.0368],
            [0.2, 0.0392],
            [0.252, 0.039],
            [0.258, 0.0355],
            [0.259, 0.024],
          ],
          limbSegs,
          0.9,
          false,
          true,
        ),
        color(PAL.cuff),
        rigid(A.fore),
        at(A.fore),
      );
      acc.gold.add(new THREE.BoxGeometry(0.004, 0.012, 0.009), color(PAL.gold), rigid(A.fore), at(A.fore, place(0.0395 * s, 0.226, 0)));

      // hand: wrist, palm, thenar pad, four two-segment fingers and a thumb
      const skin = color(PAL.skin);
      const fseg = hi ? 6 : 4;
      acc.matte.add(tube([[-0.03, 0.0225], [0.012, 0.024]], fseg + 2, 0.75, false, false), skin, rigid(A.hand), at(A.hand));
      acc.matte.add(
        loft(
          [
            { y: 0.004, rx: 0.026, rzF: 0.0135, cz: -0.002 },
            { y: 0.03, rx: 0.033, rzF: 0.0142, cz: -0.002 },
            { y: 0.062, rx: 0.0385, rzF: 0.0136, cz: -0.0015 },
            { y: 0.09, rx: 0.039, rzF: 0.0122, cz: 0 },
            { y: 0.099, rx: 0.033, rzF: 0.0095, cz: 0 },
          ],
          hi ? 10 : 8,
          { exp: 3, capBottom: true, capTop: true },
        ),
        skin,
        rigid(A.hand),
        at(A.hand),
      );
      acc.matte.add(new THREE.IcosahedronGeometry(1, 0), skin, rigid(A.hand), at(A.hand, place(0.019 * s, 0.032, -0.009, 0, 0, -0.35 * s, 0.014, 0.026, 0.011)));
      FINGER_DEFS.forEach((f, i) => {
        const [p, d] = A.fingers[i]!;
        acc.matte.add(
          tube(
            [
              [-0.007, f.r * 1.02],
              [f.l1 * 0.5, f.r * 0.96],
              [f.l1 + 0.003, f.r * 0.9],
            ],
            fseg,
            0.86,
          ),
          skin,
          rigid(p),
          at(p),
        );
        acc.matte.add(
          tube(
            [
              [-0.004, f.r * 0.9],
              [f.l2 * 0.55, f.r * 0.82],
              [f.l2 - 0.006, f.r * 0.72],
              [f.l2, f.r * 0.32],
            ],
            fseg,
            0.84,
            false,
            true,
          ),
          skin,
          rigid(d),
          at(d),
        );
      });
      const [t1, t2] = A.thumb;
      acc.matte.add(
        tube(
          [
            [-0.01, THUMB_DEF.r * 1.08],
            [THUMB_DEF.l1 * 0.5, THUMB_DEF.r],
            [THUMB_DEF.l1 + 0.003, THUMB_DEF.r * 0.9],
          ],
          fseg,
          0.85,
        ),
        skin,
        rigid(t1),
        at(t1),
      );
      acc.matte.add(
        tube(
          [
            [-0.004, THUMB_DEF.r * 0.9],
            [THUMB_DEF.l2 * 0.55, THUMB_DEF.r * 0.82],
            [THUMB_DEF.l2 - 0.006, THUMB_DEF.r * 0.7],
            [THUMB_DEF.l2, THUMB_DEF.r * 0.3],
          ],
          fseg,
          0.84,
          false,
          true,
        ),
        skin,
        rigid(t2),
        at(t2),
      );
      // deck block (hidden unless a deck / packet is held): card edges ivory, top and bottom card backs
      const deckGeo = new THREE.BoxGeometry(CARD_W, CARD_H, DECK_T);
      acc.matte.add(
        deckGeo,
        (_t, c) => {
          const lp = c.clone().applyMatrix4(inverses[index.get(A.deck)!]!);
          return color(Math.abs(lp.z + DECK_T / 2) > DECK_T * 0.45 ? PAL.cardBack : PAL.deckEdge);
        },
        rigid(A.deck),
        at(A.deck, place(0, 0, -DECK_T / 2)),
      );
    }

    // ── held card proxy: ivory card with a burgundy back panel on +Z ──
    {
      const c = card;
      acc.matte.add(new THREE.BoxGeometry(CARD_W, CARD_H, 0.0007), color(PAL.cardFace), rigid(c), at(c));
      acc.matte.add(new THREE.PlaneGeometry(CARD_W - 0.008, CARD_H - 0.008), color(PAL.cardBack), rigid(c), at(c, place(0, 0, 0.00037)));
    }

    for (const k of MAT_KEYS) {
      const old = skinned[k].geometry;
      skinned[k].geometry = acc[k].build();
      old.dispose();
    }
  }

  buildGeometry(quality);

  return {
    root,
    hips,
    spine1,
    spine2,
    chest,
    neck,
    head,
    eyeL,
    eyeR,
    card,
    arms,
    skeleton,
    eyeRest,
    meshes,
    rebuild: buildGeometry,
    setLocale: (l) => badge.setText(l),
    triangles() {
      let n = 0;
      for (const m of meshes) {
        const g = m.geometry;
        n += (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
      }
      return n;
    },
    drawCalls: () => meshes.length,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const mat of Object.values(materials)) mat.dispose();
      badgeMat.dispose();
      badge.dispose();
      skeleton.dispose();
      root.removeFromParent();
    },
  };
}
