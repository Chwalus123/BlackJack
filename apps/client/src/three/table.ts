import * as THREE from 'three';
import { COLORS } from '../shared/tokens';
import { BJ_DISCARD, BJ_RACK, BJ_SHOE, bjOutline, heOutline } from './layout';
import { BJ_FELT_EXTENT, HE_FELT_EXTENT, type FeltExtent } from './textures/felt';

export type TableKind = 'blackjack' | 'holdem';

function planarUV(geo: THREE.BufferGeometry, ext: FeltExtent) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv[i * 2] = (x - ext.x0) / (ext.x1 - ext.x0);
    uv[i * 2 + 1] = 1 - (z - ext.z0) / (ext.z1 - ext.z0);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** XZ outline → THREE.Shape in XY (we rotate the resulting geometry so +Y local = −Z world). */
function shapeFrom(points: { x: number; z: number }[]): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach((p, i) => (i === 0 ? s.moveTo(p.x, -p.z) : s.lineTo(p.x, -p.z)));
  s.closePath();
  return s;
}

function offsetOutline(points: { x: number; z: number }[], d: number, closed: boolean): { x: number; z: number }[] {
  // Offset each vertex along the averaged outward normal (polygon is counter-clockwise in X/−Z).
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    // outward normal for our winding
    const nx = tz / len;
    const nz = -tx / len;
    return { x: p.x + nx * d, z: p.z + nz * d };
  });
}

export interface TableMeshes {
  group: THREE.Group;
  felt: THREE.Mesh;
  feltMaterial: THREE.MeshStandardMaterial;
  shoeCards: THREE.Mesh | null;
  setShoeFill(frac: number): void;
  dispose(): void;
}

export function buildTable(kind: TableKind, feltCanvas: HTMLCanvasElement, quality: 'low' | 'high'): TableMeshes {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const outline = kind === 'blackjack' ? bjOutline(quality === 'high' ? 96 : 48) : heOutline(quality === 'high' ? 112 : 56);
  const ext = kind === 'blackjack' ? BJ_FELT_EXTENT : HE_FELT_EXTENT;

  // Felt
  const feltTex = track(new THREE.CanvasTexture(feltCanvas));
  feltTex.colorSpace = THREE.SRGBColorSpace;
  feltTex.anisotropy = 8;
  const feltMaterial = track(new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.96, metalness: 0 }));
  const feltGeo = track(new THREE.ShapeGeometry(shapeFrom(outline), 1));
  feltGeo.rotateX(-Math.PI / 2);
  planarUV(feltGeo, ext);
  const felt = new THREE.Mesh(feltGeo, feltMaterial);
  felt.receiveShadow = true;
  felt.name = 'felt';
  group.add(felt);

  // Rail (padded leather) along the players' edge; Hold'em rail runs all the way round.
  const closed = kind === 'holdem';
  const railPts = offsetOutline(outline, 0.035, closed).map((p) => new THREE.Vector3(p.x, 0.022, p.z));
  const railCurve = new THREE.CatmullRomCurve3(railPts, closed, 'centripetal');
  const railMat = track(new THREE.MeshStandardMaterial({ color: COLORS.leather, roughness: 0.55, metalness: 0.05 }));
  const rail = new THREE.Mesh(track(new THREE.TubeGeometry(railCurve, quality === 'high' ? 220 : 110, 0.042, quality === 'high' ? 18 : 10, closed)), railMat);
  rail.castShadow = true;
  rail.receiveShadow = true;
  group.add(rail);
  // Stitch line on the rail
  const stitchMat = track(new THREE.LineDashedMaterial({ color: COLORS.gold500, dashSize: 0.006, gapSize: 0.005, transparent: true, opacity: 0.7 }));
  const stitchPts = offsetOutline(outline, 0.035, closed).map((p) => new THREE.Vector3(p.x, 0.0645, p.z));
  const stitchGeo = track(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(stitchPts, closed).getPoints(400)));
  const stitch = new THREE.Line(stitchGeo, stitchMat);
  stitch.computeLineDistances();
  group.add(stitch);

  // Wood track between felt and rail (a thin flat ribbon)
  const inner = outline;
  const outer = offsetOutline(outline, 0.012, closed);
  const woodGeo = new THREE.BufferGeometry();
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    verts.push(inner[i]!.x, 0.001, inner[i]!.z, outer[i]!.x, 0.001, outer[i]!.z);
    if (i < inner.length - 1 || closed) {
      const a = i * 2;
      const b = ((i + 1) % inner.length) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  woodGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  woodGeo.setIndex(idx);
  woodGeo.computeVertexNormals();
  track(woodGeo);
  const woodMat = track(new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide }));
  group.add(new THREE.Mesh(woodGeo, woodMat));

  // Apron / table body: extruded outline, black lacquer with a brass trim line.
  const bodyShape = shapeFrom(offsetOutline(outline, 0.07, closed));
  const bodyGeo = track(new THREE.ExtrudeGeometry(bodyShape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 24 }));
  bodyGeo.rotateX(-Math.PI / 2); // shape XY(−z) → XZ, extrusion depth → +Y …
  bodyGeo.translate(0, -0.102, 0); // … then sink it below the felt
  const lacquer = track(new THREE.MeshStandardMaterial({ color: COLORS.lacquer900, roughness: 0.28, metalness: 0.2 }));
  const body = new THREE.Mesh(bodyGeo, lacquer);
  body.receiveShadow = true;
  group.add(body);
  const brass = track(new THREE.MeshStandardMaterial({ color: COLORS.gold500, roughness: 0.3, metalness: 0.9 }));
  const trimPts = offsetOutline(outline, 0.081, closed).map((p) => new THREE.Vector3(p.x, -0.06, p.z));
  const trim = new THREE.Mesh(track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trimPts, closed), 160, 0.0045, 6, closed)), brass);
  group.add(trim);

  // Pedestal and floor
  const pedestal = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.24, 0.66, 24)), lacquer);
  pedestal.position.set(0, -0.44, kind === 'blackjack' ? 0.05 : 0.03);
  group.add(pedestal);
  const floorTex = track(buildCarpetTexture());
  const floorMat = track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1, metalness: 0 }));
  const floor = new THREE.Mesh(track(new THREE.CircleGeometry(6, 48)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.76;
  floor.receiveShadow = true;
  group.add(floor);

  let shoeCards: THREE.Mesh | null = null;
  if (kind === 'blackjack') {
    // Shoe: lacquered wedge with a brass plate; the card block shrinks as cards are dealt.
    const shoe = new THREE.Group();
    const shoeBody = new THREE.Mesh(track(new THREE.BoxGeometry(0.11, 0.075, 0.2)), lacquer);
    shoeBody.position.set(0, 0.0375, 0);
    shoeBody.castShadow = true;
    shoe.add(shoeBody);
    const plate = new THREE.Mesh(track(new THREE.BoxGeometry(0.112, 0.012, 0.03)), brass);
    plate.position.set(0, 0.07, 0.09);
    shoe.add(plate);
    const cardMat = track(new THREE.MeshStandardMaterial({ color: '#efe6d0', roughness: 0.8 }));
    shoeCards = new THREE.Mesh(track(new THREE.BoxGeometry(0.068, 0.092, 0.17)), cardMat);
    shoeCards.position.set(0, 0.06, -0.005);
    shoeCards.rotation.x = -0.35;
    shoe.add(shoeCards);
    shoe.position.set(BJ_SHOE.x, 0, BJ_SHOE.z - 0.04);
    shoe.rotation.y = -0.45;
    group.add(shoe);

    // Discard tray
    const tray = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.05, 0.13)), lacquer);
    tray.position.set(BJ_DISCARD.x, 0.025, BJ_DISCARD.z - 0.02);
    tray.rotation.y = 0.45;
    tray.castShadow = true;
    group.add(tray);
  }

  // Chip rack in front of the dealer, filled with instanced decorative chips.
  const rack = new THREE.Group();
  const rackW = kind === 'blackjack' ? 0.46 : 0.36;
  const rackBody = new THREE.Mesh(track(new THREE.BoxGeometry(rackW, 0.03, 0.11)), lacquer);
  rackBody.position.y = 0.015;
  rackBody.castShadow = true;
  rack.add(rackBody);
  const rackTrim = new THREE.Mesh(track(new THREE.BoxGeometry(rackW + 0.004, 0.004, 0.114)), brass);
  rackTrim.position.y = 0.031;
  rack.add(rackTrim);
  rack.position.set(BJ_RACK.x, 0, kind === 'blackjack' ? BJ_RACK.z : -0.41);
  group.add(rack);

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== felt && o !== floor) (o as THREE.Mesh).castShadow ||= false;
  });

  return {
    group,
    felt,
    feltMaterial,
    shoeCards,
    setShoeFill(frac: number) {
      if (!shoeCards) return;
      const f = Math.max(0.04, Math.min(1, frac));
      shoeCards.scale.z = f;
      shoeCards.position.z = -0.005 - (1 - f) * 0.085;
      shoeCards.visible = frac > 0;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Dark patterned casino carpet, generated. */
function buildCarpetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a0709';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(201, 162, 74, 0.13)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = i * 64 + 32;
      const y = j * 64 + 32;
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x + 22, y);
      ctx.lineTo(x, y + 22);
      ctx.lineTo(x - 22, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(138, 28, 46, 0.35)';
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
