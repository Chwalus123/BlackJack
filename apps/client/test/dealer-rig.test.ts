import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDealer, type DealerRig } from '../src/three/dealer';

const W = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const SHOE = W(0.6, 0.06, -0.3);
const DISCARD = W(-0.6, 0.04, -0.3);
const spot = (deg: number, r = 0.66) => W(r * Math.sin((deg * Math.PI) / 180), 0, -0.35 + r * Math.cos((deg * Math.PI) / 180));

function triangles(rig: DealerRig): { tris: number; draws: number } {
  let tris = 0;
  let draws = 0;
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    draws++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { tris, draws };
}

function allFinite(rig: DealerRig): boolean {
  let ok = true;
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((o) => {
    if (o.matrixWorld.elements.some((e) => !Number.isFinite(e))) ok = false;
  });
  return ok;
}

const run = (rig: DealerRig, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) rig.update(dt);
};

let rigs: DealerRig[] = [];
const make = (opts?: Parameters<typeof createDealer>[0]) => {
  const r = createDealer(opts);
  r.root.position.set(0, 0, -0.6);
  rigs.push(r);
  return r;
};
afterEach(() => {
  for (const r of rigs) r.dispose();
  rigs = [];
});

describe('dealer rig (no WebGL)', () => {
  it('builds a skinned, procedural model within budget', () => {
    const rig = make({ quality: 'high' });
    const hi = triangles(rig);
    expect(hi.tris).toBeGreaterThan(1500);
    expect(hi.tris).toBeLessThanOrEqual(8000);
    expect(hi.draws).toBeLessThanOrEqual(8);
    const skinned = rig.root.children.filter((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
    expect(skinned.length).toBeGreaterThan(0);
    expect(skinned.every((m) => m.castShadow)).toBe(true);
    const bones = skinned[0]!.skeleton.bones.map((b) => b.name);
    for (const name of ['hips', 'spine1', 'spine2', 'chest', 'neck', 'head', 'eyeL', 'eyeR', 'clavicleL', 'upperArmL', 'forearmL', 'handL', 'thumb1R', 'index2R'])
      expect(bones).toContain(name);
    expect(rig.root.getObjectByName('gripL')).toBeTruthy();
    expect(rig.root.getObjectByName('gripR')).toBeTruthy();

    const low = make({ quality: 'low' });
    expect(triangles(low).tris).toBeLessThan(hi.tris);
    // switching quality rebuilds in place
    rig.setQuality('low');
    expect(triangles(rig).tris).toBe(triangles(low).tris);
  });

  it('stands in proportion: shoulders ~0.64, head ~0.86, hands in front above the felt', () => {
    const rig = make();
    rig.update(0.016);
    const v = new THREE.Vector3();
    const local = (name: string) => rig.root.worldToLocal(rig.root.getObjectByName(name)!.getWorldPosition(v).clone());
    expect(local('upperArmL').y).toBeCloseTo(0.64, 1);
    expect(local('upperArmL').x).toBeGreaterThan(0.15);
    expect(local('upperArmR').x).toBeLessThan(-0.15);
    expect(local('head').y + 0.07).toBeCloseTo(0.86, 1);
    for (const h of ['left', 'right'] as const) {
      const p = rig.root.worldToLocal(rig.handWorldPosition(h, new THREE.Vector3()));
      expect(p.y).toBeGreaterThan(0);
      expect(p.z).toBeGreaterThan(0.15);
    }
  });

  it('runs a queued deal wave and every other gesture without NaNs, firing callbacks in order', async () => {
    const rig = make();
    const log: string[] = [];
    const releases: THREE.Vector3[] = [];
    const dones: Promise<void>[] = [];
    [60, 40, 20, 0, -20, -40, -60].forEach((deg, i) =>
      dones.push(
        rig.dealFromShoe(SHOE, spot(deg), {
          durationMs: 380,
          onRelease: (p) => {
            log.push(`deal${i}`);
            releases.push(p.clone());
          },
        }).done,
      ),
    );
    dones.push(rig.dealFromShoe(SHOE, W(-0.04, 0, -0.14), { durationMs: 380, onRelease: () => log.push('dealer') }).done);
    dones.push(rig.flip(W(0.035, 0, -0.14), { durationMs: 450, onFlip: () => log.push('flip') }).done);
    dones.push(rig.peek(W(0.035, 0, -0.14), { durationMs: 900 }).done);
    dones.push(rig.burn({ durationMs: 300, onRelease: () => log.push('burn') }).done);
    dones.push(rig.sweep([spot(40), spot(0), spot(-40)], DISCARD, { durationMs: 900, onGrab: (i) => log.push(`grab${i}`) }).done);
    dones.push(rig.pushChips(spot(20, 0.78), { durationMs: 600, onRelease: () => log.push('push') }).done);
    dones.push(rig.takeChips(spot(-20, 0.78), { durationMs: 500, onGrab: () => log.push('take') }).done);
    dones.push(rig.point(spot(0, 0.78), { durationMs: 700 }).done);
    dones.push(rig.tap(W(0.1, 0, -0.14), { durationMs: 500 }).done);
    dones.push(rig.shuffle({ durationMs: 2000 }).done);
    expect(rig.busy).toBe(true);

    for (let t = 0; t < 12; t += 1 / 60) {
      rig.update(1 / 60);
      const p = rig.handWorldPosition('right', new THREE.Vector3());
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
    expect(allFinite(rig)).toBe(true);
    expect(rig.busy).toBe(false);
    await Promise.all(dones);
    expect(log).toEqual(['deal0', 'deal1', 'deal2', 'deal3', 'deal4', 'deal5', 'deal6', 'dealer', 'flip', 'burn', 'grab0', 'grab1', 'grab2', 'push', 'take']);
    for (const p of releases) {
      const l = rig.root.worldToLocal(p.clone());
      expect(l.y).toBeGreaterThan(0); // above the felt
      expect(l.z).toBeGreaterThan(0.12); // in front of the dealer
    }
  });

  it('deals rhythmically: queued cards overlap instead of waiting for a full return', () => {
    const rig = make();
    const at: number[] = [];
    let t = 0;
    for (let i = 0; i < 6; i++) rig.dealFromShoe(SHOE, spot(60 - 20 * i), { durationMs: 380, onRelease: () => at.push(t) });
    while (t < 4) {
      rig.update(1 / 120);
      t += 1 / 120;
    }
    expect(at).toHaveLength(6);
    const gaps = at.slice(1).map((v, i) => v - at[i]!);
    for (const g of gaps) {
      expect(g).toBeGreaterThan(0.25);
      expect(g).toBeLessThan(0.38); // < durationMs: the next card is drawn while the right hand returns
    }
  });

  it('flush() snaps the whole queue synchronously, in order, and resolves every handle', async () => {
    const rig = make();
    const order: string[] = [];
    const hs = [
      rig.dealFromShoe(SHOE, spot(0), { durationMs: 380, onRelease: () => order.push('a') }),
      rig.flip(W(0, 0, -0.12), { durationMs: 450, onFlip: () => order.push('b') }),
      rig.sweep([spot(20), spot(-20)], DISCARD, { durationMs: 900, onGrab: (i) => order.push(`c${i}`) }),
      rig.pushChips(spot(0, 0.78), { durationMs: 600, onRelease: () => order.push('d') }),
    ];
    rig.update(0.05);
    rig.flush();
    expect(order).toEqual(['a', 'b', 'c0', 'c1', 'd']);
    expect(rig.busy).toBe(false);
    await Promise.all(hs.map((h) => h.done));
    expect(allFinite(rig)).toBe(true);
  });

  it('setSpeed(Infinity) completes gestures instantly; finite speeds scale time', async () => {
    const rig = make();
    const order: string[] = [];
    rig.dealFromShoe(SHOE, spot(0), { durationMs: 380, onRelease: () => order.push('queued') });
    rig.setSpeed(Infinity);
    expect(order).toEqual(['queued']);
    const h = rig.takeChips(spot(20, 0.78), { durationMs: 500, onGrab: () => order.push('instant') });
    expect(order).toEqual(['queued', 'instant']);
    await h.done;

    rig.setSpeed(2);
    let fired = -1;
    let t = 0;
    rig.flip(W(0, 0, -0.12), { durationMs: 1000, onFlip: () => (fired = t) });
    while (t < 2) {
      rig.update(1 / 100);
      t += 1 / 100;
    }
    expect(fired).toBeGreaterThan(0.15);
    expect(fired).toBeLessThan(0.4); // the flip lands mid-gesture: ~0.52 × 1000 ms / 2
  });

  it('keeps going when a caller callback throws', async () => {
    const rig = make();
    const seen: string[] = [];
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const a = rig.dealFromShoe(SHOE, spot(0), {
        durationMs: 380,
        onRelease: () => {
          seen.push('a');
          throw new Error('caller bug');
        },
      });
      const b = rig.flip(W(0, 0, -0.12), { durationMs: 450, onFlip: () => seen.push('b') });
      run(rig, 2);
      await Promise.all([a.done, b.done]);
      expect(seen).toEqual(['a', 'b']);
    } finally {
      console.error = quiet;
    }
  });

  it('never throws for unreachable, behind-the-dealer or invalid targets', async () => {
    const rig = make();
    const bad = [W(0, 0, -3), W(5, 0, 5), W(0, 3, -0.6), W(NaN, 0, 0), W(0, -2, 0.2)];
    const dones: Promise<void>[] = [];
    for (const b of bad) {
      dones.push(rig.dealFromShoe(b, b, { durationMs: 380 }).done);
      dones.push(rig.dealFromHand(b, { durationMs: 260 }).done);
      dones.push(rig.flip(b, { durationMs: 450 }).done);
      dones.push(rig.peek(b, { durationMs: 300 }).done);
      dones.push(rig.sweep([b, b], b, { durationMs: 400 }).done);
      dones.push(rig.pushChips(b, { durationMs: 300 }).done);
      dones.push(rig.takeChips(b, { durationMs: 300 }).done);
      dones.push(rig.point(b, { durationMs: 300 }).done);
      dones.push(rig.tap(b, { durationMs: 300 }).done);
    }
    dones.push(rig.sweep([], DISCARD, { durationMs: 300 }).done);
    dones.push(rig.dealFromShoe(SHOE, spot(0), { durationMs: NaN }).done);
    rig.lookAt(W(NaN, 1, 1));
    expect(() => run(rig, 20, 1 / 30)).not.toThrow();
    expect(allFinite(rig)).toBe(true);
    await Promise.all(dones);
  });

  it("Hold'em: deck in hand, thumb-push deals and burns report release points", () => {
    const rig = make();
    rig.setDeckInHand(true);
    run(rig, 1.5);
    const deck = rig.root.getObjectByName('deckL')!;
    expect(deck.scale.z).toBeGreaterThan(0.9);
    const rel: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = ((-150 + (300 * i) / 9) * Math.PI) / 180;
      rig.dealFromHand(W(0.95 * Math.sin(a), 0, 0.05 + 0.48 * Math.cos(a)), { durationMs: 260, onRelease: (p) => rel.push(p.clone()) });
    }
    rig.burn({ durationMs: 300, onRelease: (p) => rel.push(p.clone()) });
    run(rig, 5);
    expect(rel).toHaveLength(11);
    for (const p of rel) {
      const l = rig.root.worldToLocal(p.clone());
      expect(l.y).toBeGreaterThan(0);
      expect(l.z).toBeGreaterThan(0.12);
    }
    rig.setDeckInHand(false);
    run(rig, 2);
    expect(deck.scale.z).toBeLessThan(0.01);
  });

  it('looks at a target, blinks, sets the badge language and disposes cleanly', async () => {
    const rig = make({ locale: 'en' });
    rig.setLocale('pl');
    rig.setReducedMotion(true);
    rig.lookAt(W(0.6, 0.4, 0.6));
    run(rig, 1);
    const head = rig.root.getObjectByName('head')!;
    const yawLeft = new THREE.Euler().setFromQuaternion(head.quaternion, 'YXZ').y;
    expect(yawLeft).toBeGreaterThan(0.05); // turned toward +X
    rig.lookAt(null);
    run(rig, 8);
    const eye = rig.root.getObjectByName('eyeL')!;
    expect(Number.isFinite(eye.scale.y)).toBe(true);

    const pending = rig.shuffle({ durationMs: 2000 });
    const meshes: THREE.Mesh[] = [];
    rig.root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    let disposed = 0;
    for (const m of meshes) m.geometry.addEventListener('dispose', () => disposed++);
    rig.dispose();
    expect(disposed).toBe(meshes.length);
    await pending.done; // pending gestures resolve on dispose
    expect(() => rig.update(0.1)).not.toThrow();
    await rig.point(W(0, 0, 0), { durationMs: 300 }).done;
    rigs = rigs.filter((r) => r !== rig);
  });
});
