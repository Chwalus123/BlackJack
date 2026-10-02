import * as THREE from 'three';
import type { Card } from '@casino/engine';
import { CARD_H, CARD_W, type V3 } from './layout';
import { TILE_BACK_RED, type CardAtlas } from './textures/cardAtlas';
import { easeInOut, easeOut, type Tweens } from './timeline';

/**
 * Cards on the table. Each card is one mesh (one draw call) whose geometry carries both faces: the front
 * tile on +Y and the back tile on −Y, mapped into the shared generated atlas. A parent group holds the
 * position/yaw; the mesh holds the flip, so flipping never disturbs where the card points.
 */
export interface CardObj {
  cid: number;
  card: Card | null;
  group: THREE.Group;
  mesh: THREE.Mesh;
  faceUp: boolean;
}

const THICK = 0.00035;

function cardShape(): THREE.Shape {
  const w = CARD_W;
  const h = CARD_H;
  const r = 0.0035;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

export class CardLayer {
  readonly group = new THREE.Group();
  private readonly cards = new Map<number, CardObj>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly texture: THREE.CanvasTexture;
  private readonly base: THREE.ShapeGeometry;
  backTile = TILE_BACK_RED;

  constructor(
    private readonly atlas: CardAtlas,
    private readonly tweens: Tweens,
    anisotropy = 8,
  ) {
    this.texture = new THREE.CanvasTexture(atlas.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    this.material = new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.45, metalness: 0, side: THREE.FrontSide });
    this.base = new THREE.ShapeGeometry(cardShape(), 3);
  }

  /** Geometry with front (+Y, tile `front`) and back (−Y, back tile) faces. */
  private buildGeometry(frontTile: number): THREE.BufferGeometry {
    const src = this.base;
    const pos = src.getAttribute('position') as THREE.BufferAttribute;
    const index = src.getIndex()!;
    const n = pos.count;
    const positions = new Float32Array(n * 2 * 3);
    const normals = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const f = this.atlas.uv(frontTile);
    const b = this.atlas.uv(this.backTile);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i); // shape Y → world −Z (card "up" points away from the player)
      const u = (x + CARD_W / 2) / CARD_W;
      const v = (y + CARD_H / 2) / CARD_H;
      // front
      positions.set([x, THICK, -y], i * 3);
      normals.set([0, 1, 0], i * 3);
      uvs.set([f.u0 + u * (f.u1 - f.u0), f.v0 + v * (f.v1 - f.v0)], i * 2);
      // back (mirrored so the back art is not reversed)
      const j = n + i;
      positions.set([x, 0, -y], j * 3);
      normals.set([0, -1, 0], j * 3);
      uvs.set([b.u1 - u * (b.u1 - b.u0), b.v0 + v * (b.v1 - b.v0)], j * 2);
    }
    const idx: number[] = [];
    for (let k = 0; k < index.count; k += 3) {
      const a = index.getX(k);
      const c = index.getX(k + 1);
      const d = index.getX(k + 2);
      idx.push(a, c, d); // XY counter-clockwise stays counter-clockwise seen from +Y after y → −z
      idx.push(n + c, n + a, n + d); // back faces −Y
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  }

  has(cid: number): boolean {
    return this.cards.has(cid);
  }

  get(cid: number): CardObj | undefined {
    return this.cards.get(cid);
  }

  all(): CardObj[] {
    return [...this.cards.values()];
  }

  /** `scale` enlarges a card in place (Hold'em community cards are drawn bigger than hole cards). */
  create(cid: number, card: Card | null, pos: V3, yaw: number, faceUp: boolean, scale = 1): CardObj {
    this.remove(cid);
    const mesh = new THREE.Mesh(this.buildGeometry(card ?? this.backTile), this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotation.z = faceUp ? 0 : Math.PI;
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    group.rotation.y = yaw;
    group.scale.setScalar(scale);
    group.add(mesh);
    this.group.add(group);
    const obj: CardObj = { cid, card, group, mesh, faceUp };
    this.cards.set(cid, obj);
    return obj;
  }

  setFace(cid: number, card: Card): void {
    const o = this.cards.get(cid);
    if (!o || o.card === card) return;
    o.card = card;
    const old = o.mesh.geometry;
    o.mesh.geometry = this.buildGeometry(card);
    old.dispose();
  }

  /** Arc flight from → to, spinning to the target yaw. Lands flat; optionally turns face up and resizes on the way. */
  fly(cid: number, to: V3, toYaw: number, durationMs: number, opts?: { from?: V3; height?: number; faceUp?: boolean; scale?: number }): Promise<void> {
    const o = this.cards.get(cid);
    if (!o) return Promise.resolve();
    const g = o.group;
    const from = opts?.from ? new THREE.Vector3(opts.from.x, opts.from.y, opts.from.z) : g.position.clone();
    const target = new THREE.Vector3(to.x, to.y, to.z);
    const yaw0 = g.rotation.y;
    const h = opts?.height ?? Math.min(0.08, from.distanceTo(target) * 0.12);
    const flip0 = o.mesh.rotation.z;
    const flip1 = opts?.faceUp === undefined ? flip0 : opts.faceUp ? 0 : Math.PI;
    if (opts?.faceUp !== undefined) o.faceUp = opts.faceUp;
    const tilt = flip0 !== flip1 ? 0 : 0.18;
    const s0 = g.scale.x;
    const s1 = opts?.scale ?? s0;
    return this.tweens.add(
      durationMs,
      (k) => {
        g.position.lerpVectors(from, target, k);
        if (s1 !== s0) g.scale.setScalar(s0 + (s1 - s0) * k);
        g.position.y += Math.sin(Math.PI * k) * h;
        g.rotation.y = yaw0 + (toYaw - yaw0) * k;
        o.mesh.rotation.z = flip0 + (flip1 - flip0) * k;
        o.mesh.rotation.x = Math.sin(Math.PI * k) * tilt;
      },
      { ease: easeOut },
    );
  }

  flip(cid: number, faceUp: boolean, durationMs: number, onEdge?: () => void): Promise<void> {
    const o = this.cards.get(cid);
    if (!o) return Promise.resolve();
    const start = o.mesh.rotation.z;
    const end = faceUp ? 0 : Math.PI;
    o.faceUp = faceUp;
    const y0 = o.group.position.y;
    let edged = false;
    return this.tweens.add(
      durationMs,
      (k) => {
        o.mesh.rotation.z = start + (end - start) * k;
        o.group.position.y = y0 + Math.sin(Math.PI * k) * 0.035;
        if (!edged && k >= 0.5) {
          edged = true;
          onEdge?.();
        }
      },
      { ease: easeInOut },
    );
  }

  /** Lift the corner of a face-down card (dealer peek). */
  peek(cid: number, durationMs: number): Promise<void> {
    const o = this.cards.get(cid);
    if (!o) return Promise.resolve();
    const x0 = o.mesh.rotation.x;
    return this.tweens.add(durationMs, (k) => {
      o.mesh.rotation.x = x0 - Math.sin(Math.PI * k) * 0.35;
    });
  }

  remove(cid: number): void {
    const o = this.cards.get(cid);
    if (!o) return;
    this.group.remove(o.group);
    o.mesh.geometry.dispose();
    this.cards.delete(cid);
  }

  clear(): void {
    for (const cid of [...this.cards.keys()]) this.remove(cid);
  }

  dispose(): void {
    this.clear();
    this.base.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
