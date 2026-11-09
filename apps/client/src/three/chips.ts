import * as THREE from 'three';
import { breakdown, DENOMINATIONS, type Money } from '@casino/engine';
import { CHIP_H, CHIP_R, type V3 } from './layout';
import { buildChipTexture } from './textures/chips';
import { easeOut, type Tweens } from './timeline';

/** Cylinder whose UVs map the caps to the left half of the chip texture and the edge to the right half. */
function chipGeometry(segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const r = CHIP_R;
  const h = CHIP_H;
  // side
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos.push(r * c, h / 2, r * s, r * c, -h / 2, r * s);
    nor.push(c, 0, s, c, 0, s);
    uv.push(0.5 + 0.5 * (i / segments), 1, 0.5 + 0.5 * (i / segments), 0);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  for (const top of [true, false]) {
    const y = top ? h / 2 : -h / 2;
    const center = pos.length / 3;
    pos.push(0, y, 0);
    nor.push(0, top ? 1 : -1, 0);
    uv.push(0.25, 0.5);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(r * Math.cos(a), y, r * Math.sin(a));
      nor.push(0, top ? 1 : -1, 0);
      uv.push(0.25 + 0.25 * Math.cos(a), 0.5 - 0.5 * Math.sin(a));
      if (i < segments) {
        const k = center + 1 + i;
        if (top) idx.push(center, k + 1, k);
        else idx.push(center, k, k + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  free: number[];
  top: number;
}
interface ChipRef {
  denom: Money;
  slot: number;
}
interface Stack {
  pos: V3;
  amount: Money;
  chips: ChipRef[];
}

const CAPACITY = 640;
const PER_COLUMN = 20;
const MAX_COLUMNS = 5;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class ChipLayer {
  readonly group = new THREE.Group();
  private readonly pools = new Map<Money, Pool>();
  private readonly stacks = new Map<string, Stack>();
  private readonly geometry: THREE.BufferGeometry;
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();
  private jitter = 1;

  constructor(
    private readonly tweens: Tweens,
    quality: 'low' | 'high',
  ) {
    this.geometry = chipGeometry(quality === 'high' ? 36 : 20);
    for (const d of DENOMINATIONS) {
      const tex = new THREE.CanvasTexture(buildChipTexture(d, quality === 'high' ? 128 : 64));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.05 });
      const mesh = new THREE.InstancedMesh(this.geometry, mat, CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.textures.push(tex);
      this.materials.push(mat);
      this.pools.set(d, { mesh, free: [], top: 0 });
      this.group.add(mesh);
    }
  }

  private alloc(denom: Money): ChipRef | null {
    const pool = this.pools.get(denom);
    if (!pool) return null;
    let slot = pool.free.pop();
    if (slot === undefined) {
      if (pool.top >= CAPACITY) return null;
      slot = pool.top++;
      pool.mesh.count = pool.top;
    }
    return { denom, slot };
  }

  private release(c: ChipRef) {
    const pool = this.pools.get(c.denom)!;
    pool.mesh.setMatrixAt(c.slot, HIDDEN);
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.free.push(c.slot);
  }

  private place(c: ChipRef, x: number, y: number, z: number, yaw: number, roll = 0) {
    const pool = this.pools.get(c.denom)!;
    this.p.set(x, y, z);
    this.q.setFromEuler(new THREE.Euler(roll, yaw, 0));
    this.m.compose(this.p, this.q, this.s);
    pool.mesh.setMatrixAt(c.slot, this.m);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  private nextYaw(): number {
    this.jitter = (this.jitter * 16807) % 2147483647;
    return (this.jitter / 2147483647) * Math.PI * 2;
  }

  /** Column offsets for a stack: up to MAX_COLUMNS clustered columns of PER_COLUMN chips. */
  private layout(n: number): { x: number; z: number; level: number }[] {
    const cols = Math.min(MAX_COLUMNS, Math.ceil(n / PER_COLUMN));
    const offsets = [
      [0, 0],
      [2.15, 0],
      [-2.15, 0],
      [1.08, -1.86],
      [-1.08, -1.86],
    ];
    const out: { x: number; z: number; level: number }[] = [];
    for (let i = 0; i < Math.min(n, cols * PER_COLUMN); i++) {
      const col = Math.floor(i / PER_COLUMN);
      const [ox, oz] = offsets[col]!;
      out.push({ x: ox! * CHIP_R, z: oz! * CHIP_R, level: i % PER_COLUMN });
    }
    return out;
  }

  private build(pos: V3, amount: Money): ChipRef[] {
    const denoms = breakdown(amount);
    const slots = this.layout(denoms.length);
    const refs: ChipRef[] = [];
    // Largest chips at the bottom of each column.
    for (let i = 0; i < slots.length; i++) {
      const c = this.alloc(denoms[i]!);
      if (!c) break;
      const sl = slots[i]!;
      this.place(c, pos.x + sl.x, pos.y + CHIP_H * (sl.level + 0.5) + 0.0003, pos.z + sl.z, this.nextYaw());
      refs.push(c);
    }
    return refs;
  }

  /** Set the chips shown at a table location (bet circle, player stack, pot...). */
  setStack(key: string, pos: V3, amount: Money): void {
    const cur = this.stacks.get(key);
    if (cur && cur.amount === amount && cur.pos.x === pos.x && cur.pos.z === pos.z) return;
    if (cur) for (const c of cur.chips) this.release(c);
    if (amount <= 0) {
      this.stacks.delete(key);
      return;
    }
    this.stacks.set(key, { pos, amount, chips: this.build(pos, amount) });
  }

  amountAt(key: string): Money {
    return this.stacks.get(key)?.amount ?? 0;
  }

  clearAll(): void {
    for (const k of [...this.stacks.keys()]) this.setStack(k, { x: 0, y: 0, z: 0 }, 0);
  }

  /** Fly a temporary stack worth `amount` from → to (arc). Resolves when it lands. */
  fly(from: V3, to: V3, amount: Money, durationMs: number, delayMs = 0): Promise<void> {
    if (amount <= 0) return Promise.resolve();
    const refs = this.build(from, amount);
    const yaws = refs.map(() => this.nextYaw());
    const lay = this.layout(refs.length);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const h = Math.min(0.12, 0.03 + dist * 0.15);
    return this.tweens
      .add(
        durationMs,
        (k) => {
          for (let i = 0; i < refs.length; i++) {
            const sl = lay[i]!;
            const kk = Math.min(1, Math.max(0, k * 1.15 - (i / Math.max(1, refs.length)) * 0.15));
            const x = from.x + (to.x - from.x) * kk + sl.x;
            const z = from.z + (to.z - from.z) * kk + sl.z;
            const y = from.y + (to.y - from.y) * kk + CHIP_H * (sl.level + 0.5) + Math.sin(Math.PI * kk) * h;
            this.place(refs[i]!, x, y, z, yaws[i]!);
          }
        },
        { ease: easeOut, delay: delayMs },
      )
      .then(() => {
        for (const c of refs) this.release(c);
      });
  }

  /** Decorative rolls of chips lying in the dealer's rack. */
  fillRack(center: V3, width: number): void {
    const denoms = [100000, 50000, 10000, 2500, 500, 100, 250, 50];
    const rows = denoms.length;
    for (let r = 0; r < rows; r++) {
      const x = center.x - width / 2 + (width / rows) * (r + 0.5);
      for (let i = 0; i < 24; i++) {
        const c = this.alloc(denoms[r]!);
        if (!c) return;
        this.place(c, x, 0.024, center.z - 0.042 + i * CHIP_H * 1.04, 0, Math.PI / 2);
      }
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    for (const p of this.pools.values()) p.mesh.dispose();
  }
}
