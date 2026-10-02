import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COLORS } from '../shared/tokens';
import { createDealer, type DealerRig } from '../three/dealer';

/**
 * #/sandbox — a self-contained stage for the procedural croupier: felt, target markers, orbit camera and a
 * panel that fires every gesture. Cards and chips here are deliberately simple stand-ins.
 */

// ───────────────────────── table targets (world space) ─────────────────────────

const DEALER_AT = new THREE.Vector3(0, 0, -0.6);
const SHOE = new THREE.Vector3(0.6, 0.06, -0.3);
const DISCARD = new THREE.Vector3(-0.6, 0.04, -0.3);
const RACK = new THREE.Vector3(0, 0.03, -0.4);
const POT = new THREE.Vector3(0, 0, 0.12);
const DEG = Math.PI / 180;
const arc = (r: number, deg: number) => new THREE.Vector3(r * Math.sin(deg * DEG), 0, -0.35 + r * Math.cos(deg * DEG));
const BJ_ANGLES = [60, 40, 20, 0, -20, -40, -60];
const BJ_BETS = BJ_ANGLES.map((a) => arc(0.78, a));
const BJ_CARDS = BJ_ANGLES.map((a) => arc(0.66, a));
const dealerCard = (slot: number) => new THREE.Vector3(-0.06 + slot * 0.08, 0, -0.12);
const HE_SEAT_ANGLES = Array.from({ length: 10 }, (_, i) => -150 + (300 * i) / 9);
const HE_SEATS = HE_SEAT_ANGLES.map((a) => new THREE.Vector3(0.95 * Math.sin(a * DEG), 0, 0.05 + 0.48 * Math.cos(a * DEG)));
const HE_HOLE = HE_SEATS.map((p) => p.clone().lerp(new THREE.Vector3(0, 0, 0.05), 0.24));
const HE_BOARD = [-0.26, -0.13, 0, 0.13, 0.26].map((x) => new THREE.Vector3(x, 0, -0.02));

const CARD_W = 0.0635;
const CARD_H = 0.0889;
const CHIP_R = 0.0195;
const CHIP_H = 0.0034;

type Mode = 'blackjack' | 'holdem';

interface Tween {
  t: number;
  dur: number;
  update: (k: number) => void;
  done?: () => void;
}

interface Api {
  rig: DealerRig;
  setSpeed(s: number): void;
  setMode(m: Mode): void;
  dealRound(): void;
  flipHole(): void;
  peek(): void;
  burn(): void;
  sweep(): void;
  pay(): void;
  collect(): void;
  point(): void;
  tap(): void;
  shuffle(): void;
  holdem(): void;
  clear(): void;
  exportGlb(): void;
  setEyeContact(on: boolean): void;
  stats(): string;
}

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function buildStage(host: HTMLElement): { api: Api; dispose: () => void } {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: the soft variant is PCF + shadow.radius
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.lacquer950);
  scene.fog = new THREE.Fog(COLORS.lacquer950, 3.5, 9);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.3;

  // A player's-eye seat; aimed a little higher than the felt so the dealer is framed chest-up.
  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 30);
  camera.position.set(0, 0.58, 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.36, -0.3);
  controls.enableDamping = true;
  controls.minDistance = 0.3;
  controls.maxDistance = 4;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  // lights: warm key spot with soft PCF shadows + hemisphere fill
  const hemi = new THREE.HemisphereLight('#ffe7c4', '#1a0b08', 0.6);
  scene.add(hemi);
  const key = new THREE.SpotLight('#ffe0ad', 48, 7, 0.72, 0.6, 1.6);
  key.position.set(0.35, 2.3, 0.7);
  key.target.position.set(0, 0.2, -0.35);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 3;
  key.shadow.camera.near = 0.6;
  key.shadow.camera.far = 4.5;
  scene.add(key, key.target);

  const disposables: { dispose(): void }[] = [env];
  const track = <T extends { dispose(): void }>(x: T): T => (disposables.push(x), x);

  // kidney felt (players' arc + the dealer's straight edge), rail, lacquered apron and floor
  const ARC_Z = -0.3339;
  const ARC_R = 0.9539;
  const EDGE_Z = -0.42;
  const outline: THREE.Vector2[] = [];
  const a0 = Math.atan2(0.95, EDGE_Z - ARC_Z);
  for (let i = 0; i <= 96; i++) {
    const a = a0 - (2 * a0 * i) / 96;
    outline.push(new THREE.Vector2(ARC_R * Math.sin(a), -(ARC_Z + ARC_R * Math.cos(a))));
  }
  const shape = new THREE.Shape(outline);
  const felt = new THREE.Mesh(track(new THREE.ShapeGeometry(shape, 1)), track(new THREE.MeshStandardMaterial({ color: COLORS.felt600, roughness: 0.95 })));
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);
  const body = new THREE.Mesh(
    track(new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 })),
    track(new THREE.MeshStandardMaterial({ color: COLORS.lacquer900, roughness: 0.3, metalness: 0.2 })),
  );
  body.rotation.x = -Math.PI / 2;
  body.position.y = -0.11;
  body.receiveShadow = true;
  scene.add(body);
  const railPts = outline.map((p) => {
    const v = new THREE.Vector3(p.x, 0.02, -p.y);
    const out = new THREE.Vector3(v.x, 0, v.z - ARC_Z).normalize().multiplyScalar(0.035);
    return v.add(out);
  });
  const rail = new THREE.Mesh(
    track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 160, 0.04, 12, false)),
    track(new THREE.MeshStandardMaterial({ color: COLORS.leather, roughness: 0.55 })),
  );
  rail.castShadow = true;
  rail.receiveShadow = true;
  scene.add(rail);
  const floor = new THREE.Mesh(track(new THREE.CircleGeometry(8, 48)), track(new THREE.MeshStandardMaterial({ color: '#170708', roughness: 1 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.76;
  floor.receiveShadow = true;
  scene.add(floor);

  const markerGeo = track(new THREE.RingGeometry(0.03, 0.036, 40));
  const dotGeo = track(new THREE.CircleGeometry(0.012, 20));
  const goldMat = track(new THREE.MeshBasicMaterial({ color: COLORS.gold500, transparent: true, opacity: 0.85 }));
  const ivoryMat = track(new THREE.MeshBasicMaterial({ color: COLORS.ivoryDim, transparent: true, opacity: 0.7 }));
  const burgMat = track(new THREE.MeshBasicMaterial({ color: COLORS.burgundy500, transparent: true, opacity: 0.85 }));
  const bjMarkers = new THREE.Group();
  const heMarkers = new THREE.Group();
  scene.add(bjMarkers, heMarkers);
  const marker = (g: THREE.Group, p: THREE.Vector3, mat: THREE.Material, ring = true) => {
    const m = new THREE.Mesh(ring ? markerGeo : dotGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.0008, p.z);
    g.add(m);
  };
  BJ_BETS.forEach((p) => marker(bjMarkers, p, goldMat));
  BJ_CARDS.forEach((p) => marker(bjMarkers, p, ivoryMat, false));
  [0, 1, 2, 3].forEach((s) => marker(bjMarkers, dealerCard(s), ivoryMat, false));
  marker(bjMarkers, SHOE, burgMat);
  marker(bjMarkers, DISCARD, burgMat);
  HE_SEATS.forEach((p) => marker(heMarkers, p, goldMat));
  HE_HOLE.forEach((p) => marker(heMarkers, p, ivoryMat, false));
  HE_BOARD.forEach((p) => marker(heMarkers, p, ivoryMat, false));
  marker(heMarkers, POT, burgMat);

  // simple props: shoe, discard tray, chip rack
  const lacquer = track(new THREE.MeshStandardMaterial({ color: COLORS.lacquer800, roughness: 0.3, metalness: 0.2 }));
  const brass = track(new THREE.MeshStandardMaterial({ color: COLORS.gold500, roughness: 0.3, metalness: 0.9 }));
  const shoe = new THREE.Mesh(track(new THREE.BoxGeometry(0.11, 0.075, 0.2)), lacquer);
  shoe.position.set(SHOE.x + 0.03, 0.0375, SHOE.z - 0.05);
  shoe.rotation.y = -0.45;
  shoe.castShadow = true;
  const tray = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.05, 0.13)), lacquer);
  tray.position.set(DISCARD.x, 0.025, DISCARD.z - 0.02);
  tray.rotation.y = 0.45;
  tray.castShadow = true;
  bjMarkers.add(shoe, tray);
  const rack = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.03, 0.11)), lacquer);
  rack.position.set(RACK.x, 0.015, RACK.z + 0.025);
  rack.castShadow = true;
  const rackTrim = new THREE.Mesh(track(new THREE.BoxGeometry(0.464, 0.006, 0.006)), brass);
  rackTrim.position.set(RACK.x, 0.03, RACK.z + 0.083);
  scene.add(rack, rackTrim);

  // the dealer
  const rig = createDealer({ quality: 'high', locale: 'pl' });
  rig.root.position.copy(DEALER_AT);
  scene.add(rig.root);
  let eyeContact = true;
  rig.lookAt(camera.position);

  // ── stand-in cards & chips ──
  const cardGeo = track(new THREE.BoxGeometry(CARD_W, 0.0006, CARD_H));
  const cardSide = track(new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.7 }));
  const cardBack = track(new THREE.MeshStandardMaterial({ color: '#7a1426', roughness: 0.55 }));
  const cardFace = track(new THREE.MeshStandardMaterial({ color: COLORS.ivory, roughness: 0.6, emissive: '#2a2418' }));
  const cardMats = [cardSide, cardSide, cardBack, cardFace, cardSide, cardSide];
  const chipGeo = track(new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H * 6, 24));
  const chipMat = track(new THREE.MeshStandardMaterial({ color: COLORS.burgundy500, roughness: 0.45, metalness: 0.1 }));
  const chipEdge = track(new THREE.MeshStandardMaterial({ color: COLORS.ivory, roughness: 0.5 }));
  const props = new THREE.Group();
  scene.add(props);

  let speed = 1;
  const tweens: Tween[] = [];
  const tween = (durS: number, update: (k: number) => void, done?: () => void) => {
    if (!Number.isFinite(speed) || durS <= 0) {
      update(1);
      done?.();
      return;
    }
    tweens.push({ t: 0, dur: durS, update, done });
  };

  interface Card {
    mesh: THREE.Mesh;
    at: THREE.Vector3;
    faceUp: boolean;
  }
  const cards: Card[] = [];
  const spawnCard = (from: THREE.Vector3, to: THREE.Vector3, faceUp: boolean, stack: number): Card => {
    const m = new THREE.Mesh(cardGeo, cardMats);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.copy(from);
    const yaw = Math.atan2(to.x, to.z + 0.35);
    m.rotation.set(0, yaw * 0.6, 0);
    props.add(m);
    const card: Card = { mesh: m, at: to.clone().setY(0.0004 + stack * 0.0007), faceUp };
    const start = from.clone();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const r0 = m.rotation.y;
    tween(0.18 + dist * 0.55, (k) => {
      const e = easeOut(k);
      m.position.set(start.x + (card.at.x - start.x) * e, start.y + (card.at.y - start.y) * easeOut(Math.min(1, k * 2.2)), start.z + (card.at.z - start.z) * e);
      m.rotation.y = r0 + (yaw - r0) * e;
      if (faceUp) m.rotation.z = Math.PI * Math.min(1, k * 1.3);
    });
    cards.push(card);
    return card;
  };
  const chipStacks: THREE.Group[] = [];
  const makeStack = (n: number) => {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(chipGeo, i % 2 ? chipEdge : chipMat);
      c.scale.y = 1 / 6;
      c.position.y = CHIP_H * (i + 0.5);
      c.castShadow = true;
      g.add(c);
    }
    props.add(g);
    chipStacks.push(g);
    return g;
  };
  const slide = (obj: THREE.Object3D, to: THREE.Vector3, dur: number, done?: () => void) => {
    const from = obj.position.clone();
    tween(dur, (k) => obj.position.lerpVectors(from, to, easeInOut(k)), done);
  };

  let mode: Mode = 'blackjack';
  let pointAt = 0;

  const holeCard = () => cards.find((c) => c.at.distanceTo(dealerCard(1).setY(c.at.y)) < 0.02);

  const api: Api = {
    rig,
    setSpeed(s) {
      speed = s;
      rig.setSpeed(s);
      if (!Number.isFinite(s)) for (const tw of tweens.splice(0)) {
        tw.update(1);
        tw.done?.();
      }
    },
    setMode(m) {
      mode = m;
      bjMarkers.visible = m === 'blackjack';
      heMarkers.visible = m === 'holdem';
      rig.setDeckInHand(m === 'holdem');
      api.clear();
    },
    dealRound() {
      if (mode !== 'blackjack') api.setMode('blackjack');
      api.clear();
      const n = (p: THREE.Vector3) => cards.filter((c) => Math.hypot(c.at.x - p.x, c.at.z - p.z) < 0.05).length;
      for (let round = 0; round < 2; round++) {
        BJ_CARDS.forEach((spot) => {
          const to = spot.clone().add(new THREE.Vector3(0.016 * round, 0, -0.011 * round));
          rig.dealFromShoe(SHOE, to, { durationMs: 380, onRelease: (p) => spawnCard(p, to, true, n(spot)) });
        });
        const d = dealerCard(round);
        rig.dealFromShoe(SHOE, d, { durationMs: 380, onRelease: (p) => spawnCard(p, d, round === 0, 0) });
      }
    },
    flipHole() {
      const c = holeCard();
      const at = c ? c.mesh.position.clone() : dealerCard(1);
      rig.flip(at, {
        durationMs: 450,
        onFlip: () => {
          if (!c || c.faceUp) return;
          c.faceUp = true;
          const y0 = c.mesh.position.y;
          tween(0.32, (k) => {
            c.mesh.rotation.z = Math.PI * easeInOut(k);
            c.mesh.position.y = y0 + Math.sin(Math.PI * k) * 0.03;
          });
        },
      });
    },
    peek() {
      const c = holeCard();
      rig.peek(c ? c.mesh.position.clone() : dealerCard(1), { durationMs: 900 });
      if (c) tween(0.8, (k) => (c.mesh.rotation.x = -Math.sin(Math.PI * k) * 0.22));
    },
    burn() {
      rig.burn({
        durationMs: 300,
        onRelease: (p) => {
          const to = mode === 'holdem' ? new THREE.Vector3(-0.3, 0, -0.3) : DISCARD.clone().setY(0.03);
          spawnCard(p, to, false, 0);
        },
      });
    },
    sweep() {
      if (!cards.length) return;
      const list = cards.splice(0);
      rig.sweep(
        list.map((c) => c.mesh.position.clone()),
        mode === 'holdem' ? new THREE.Vector3(-0.3, 0.004, -0.3) : DISCARD,
        {
          durationMs: 900,
          onGrab: (i) => {
            const c = list[i];
            if (!c) return;
            slide(c.mesh, DISCARD.clone().setY(0.045), 0.35, () => props.remove(c.mesh));
          },
        },
      );
    },
    pay() {
      const spot = BJ_BETS[(pointAt + 3) % 7]!;
      const stack = makeStack(5);
      stack.position.set(RACK.x, 0.03, RACK.z + 0.03);
      stack.visible = false;
      rig.pushChips(spot, {
        durationMs: 600,
        onRelease: () => {
          const hand = rig.handWorldPosition(spot.x > 0.3 ? 'left' : 'right', new THREE.Vector3());
          stack.position.set(hand.x, 0.001, hand.z);
          stack.visible = true;
          slide(stack, spot.clone().add(new THREE.Vector3(0.05, 0, 0)), 0.3);
        },
      });
    },
    collect() {
      const spot = BJ_BETS[(pointAt + 5) % 7]!;
      const stack = makeStack(4);
      stack.position.copy(spot);
      rig.takeChips(spot, { durationMs: 500, onGrab: () => slide(stack, RACK.clone().setY(0.032), 0.28, () => props.remove(stack)) });
    },
    point() {
      const spot = mode === 'holdem' ? HE_SEATS[pointAt % 10]! : BJ_BETS[pointAt % 7]!;
      pointAt++;
      rig.point(spot, { durationMs: 700 });
    },
    tap() {
      rig.tap(mode === 'holdem' ? new THREE.Vector3(0.05, 0, -0.12) : dealerCard(2), { durationMs: 500 });
    },
    shuffle() {
      rig.shuffle({ durationMs: 2000 });
    },
    holdem() {
      if (mode !== 'holdem') api.setMode('holdem');
      api.clear();
      for (let round = 0; round < 2; round++)
        HE_HOLE.forEach((p) => {
          const to = p.clone().add(new THREE.Vector3((round - 0.5) * 0.04, 0, 0));
          rig.dealFromHand(to, { durationMs: 260, onRelease: (r) => spawnCard(r, to, false, 0) });
        });
      const muck = new THREE.Vector3(-0.3, 0, -0.3);
      const street = (slots: number[]) => {
        rig.burn({ durationMs: 300, onRelease: (p) => spawnCard(p, muck, false, 0) });
        for (const s of slots) rig.dealFromHand(HE_BOARD[s]!, { durationMs: 320, onRelease: (r) => spawnCard(r, HE_BOARD[s]!, true, 0) });
      };
      street([0, 1, 2]);
      street([3]);
      street([4]);
    },
    clear() {
      rig.flush();
      for (const tw of tweens.splice(0)) {
        tw.update(1);
        tw.done?.();
      }
      for (const c of cards.splice(0)) props.remove(c.mesh);
      for (const s of chipStacks.splice(0)) props.remove(s);
      props.clear();
    },
    exportGlb() {
      new GLTFExporter().parse(
        rig.root,
        (result) => {
          const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'jacbos-dealer.glb';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        },
        (err) => console.error('[sandbox] glTF export failed', err),
        { binary: true },
      );
    },
    setEyeContact(on) {
      eyeContact = on;
      rig.lookAt(on ? camera.position : null);
    },
    stats() {
      const i = renderer.info.render;
      return `${i.triangles.toLocaleString('en')} tris · ${i.calls} draws`;
    },
  };

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  if (import.meta.env.DEV) (window as unknown as { __dealerSandbox?: unknown }).__dealerSandbox = { camera, controls, api, rig, THREE };

  let raf = 0;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (tweens.length) {
      const step = dt * (Number.isFinite(speed) ? speed : 1e9);
      for (const tw of [...tweens]) {
        tw.t += step;
        const k = Math.min(1, tw.t / tw.dur);
        tw.update(k);
        if (k >= 1) {
          tweens.splice(tweens.indexOf(tw), 1);
          tw.done?.();
        }
      }
    }
    controls.update();
    if (eyeContact) rig.lookAt(camera.position);
    rig.update(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    api,
    dispose() {
      cancelAnimationFrame(raf);
      if (import.meta.env.DEV) delete (window as unknown as { __dealerSandbox?: unknown }).__dealerSandbox;
      ro.disconnect();
      controls.dispose();
      rig.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// ───────────────────────── UI ─────────────────────────

const CSS = `
.dsb { position: fixed; inset: 0; background: ${COLORS.lacquer950}; color: ${COLORS.ivory}; font-family: 'Montserrat Variable', system-ui, sans-serif; }
.dsb-stage { position: absolute; inset: 0; }
.dsb-panel { position: absolute; top: 14px; left: 14px; width: min(310px, calc(100vw - 28px)); max-height: calc(100dvh - 28px); overflow: auto;
  background: linear-gradient(180deg, rgba(20,17,16,0.92), rgba(11,9,8,0.92)); border: 1px solid ${COLORS.gold800};
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 18px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(230,200,120,0.12); border-radius: 4px; padding: 14px 14px 12px; }
.dsb-panel h1 { font-family: 'Cinzel Variable', 'Cinzel', Georgia, serif; font-weight: 700; font-size: 17px; letter-spacing: 0.18em; margin: 0 0 2px; color: ${COLORS.gold300}; text-transform: uppercase; }
.dsb-sub { font-size: 11px; letter-spacing: 0.08em; color: ${COLORS.ivoryMute}; margin-bottom: 10px; }
.dsb-rule { height: 1px; margin: 10px 0; background: linear-gradient(90deg, transparent, ${COLORS.gold700}, transparent); }
.dsb-label { font-family: 'Cinzel Variable', Georgia, serif; font-size: 11px; letter-spacing: 0.16em; color: ${COLORS.gold500}; text-transform: uppercase; margin: 2px 0 6px; }
.dsb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dsb button { font: 600 12px/1 'Montserrat Variable', system-ui, sans-serif; letter-spacing: 0.04em; color: ${COLORS.gold300}; background: ${COLORS.lacquer900};
  border: 1px solid ${COLORS.gold800}; border-radius: 3px; padding: 9px 8px; cursor: pointer; transition: border-color .15s, color .15s, background .15s; }
.dsb button:hover { border-color: ${COLORS.gold500}; color: ${COLORS.gold200}; background: ${COLORS.lacquer800}; }
.dsb button:focus-visible { outline: 2px solid ${COLORS.gold400}; outline-offset: 1px; }
.dsb button[aria-pressed='true'] { background: linear-gradient(180deg, ${COLORS.gold600}, ${COLORS.gold800}); color: ${COLORS.lacquer950}; border-color: ${COLORS.gold300}; }
.dsb button.dsb-wide { grid-column: span 2; }
.dsb-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; }
.dsb-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 0; font-size: 12px; color: ${COLORS.ivoryDim}; }
.dsb-stats { font-size: 11px; color: ${COLORS.ivoryMute}; letter-spacing: 0.04em; margin-top: 8px; font-variant-numeric: tabular-nums; }
.dsb-hint { position: absolute; right: 14px; bottom: 12px; font-size: 11px; color: ${COLORS.ivoryMute}; letter-spacing: 0.06em; pointer-events: none; }
@media (max-width: 640px) { .dsb-panel { top: auto; bottom: 10px; left: 10px; max-height: 46dvh; } }
`;

export function Sandbox(): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [speed, setSpeed] = useState(1);
  const [reduced, setReduced] = useState(false);
  const [locale, setLocale] = useState<'pl' | 'en'>('pl');
  const [quality, setQuality] = useState<'low' | 'high'>('high');
  const [mode, setMode] = useState<Mode>('blackjack');
  const [eyes, setEyes] = useState(true);
  const [stats, setStats] = useState('');

  useEffect(() => {
    if (!host.current) return;
    let stage: ReturnType<typeof buildStage> | null = null;
    try {
      stage = buildStage(host.current);
      api.current = stage.api;
    } catch (err) {
      console.error('[sandbox] WebGL unavailable', err);
    }
    const timer = window.setInterval(() => api.current && setStats(api.current.stats()), 500);
    return () => {
      window.clearInterval(timer);
      api.current = null;
      stage?.dispose();
    };
  }, []);

  const call = (fn: (a: Api) => void) => () => api.current && fn(api.current);
  const speeds: [number, string][] = [
    [0.5, '0.5×'],
    [1, '1×'],
    [2, '2×'],
    [Infinity, '∞'],
  ];

  return (
    <div class="dsb">
      <style>{CSS}</style>
      <div class="dsb-stage" ref={host} />
      <section class="dsb-panel" aria-label="Dealer sandbox">
        <h1>Krupier</h1>
        <div class="dsb-sub">Procedural dealer · gesture sandbox</div>

        <div class="dsb-label">Table</div>
        <div class="dsb-seg" role="group" aria-label="Table">
          {(['blackjack', 'holdem'] as Mode[]).map((m) => (
            <button
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                api.current?.setMode(m);
              }}
            >
              {m === 'blackjack' ? 'Blackjack' : "Hold'em"}
            </button>
          ))}
        </div>
        <div class="dsb-rule" />

        <div class="dsb-label">Blackjack</div>
        <div class="dsb-grid">
          <button class="dsb-wide" onClick={call((a) => (setMode('blackjack'), a.dealRound()))}>
            Deal round (7 spots + dealer)
          </button>
          <button onClick={call((a) => a.flipHole())}>Flip hole card</button>
          <button onClick={call((a) => a.peek())}>Peek</button>
          <button onClick={call((a) => a.burn())}>Burn</button>
          <button onClick={call((a) => a.sweep())}>Sweep</button>
          <button onClick={call((a) => a.pay())}>Push chips</button>
          <button onClick={call((a) => a.collect())}>Take chips</button>
          <button onClick={call((a) => a.point())}>Point</button>
          <button onClick={call((a) => a.tap())}>Tap</button>
          <button class="dsb-wide" onClick={call((a) => a.shuffle())}>
            Shuffle
          </button>
        </div>
        <div class="dsb-rule" />
        <div class="dsb-label">Hold'em</div>
        <div class="dsb-grid">
          <button class="dsb-wide" onClick={call((a) => (setMode('holdem'), a.holdem()))}>
            Deal 10 seats + board
          </button>
        </div>
        <div class="dsb-rule" />

        <div class="dsb-label">Speed</div>
        <div class="dsb-seg" role="group" aria-label="Speed">
          {speeds.map(([v, label]) => (
            <button
              aria-pressed={speed === v}
              onClick={() => {
                setSpeed(v);
                api.current?.setSpeed(v);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="dsb-row">
          <span>Reduced motion</span>
          <button
            aria-pressed={reduced}
            onClick={() => {
              setReduced(!reduced);
              api.current?.rig.setReducedMotion(!reduced);
            }}
          >
            {reduced ? 'On' : 'Off'}
          </button>
        </div>
        <div class="dsb-row">
          <span>Badge</span>
          <div class="dsb-seg">
            {(['pl', 'en'] as const).map((l) => (
              <button
                aria-pressed={locale === l}
                onClick={() => {
                  setLocale(l);
                  api.current?.rig.setLocale(l);
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div class="dsb-row">
          <span>Quality</span>
          <div class="dsb-seg">
            {(['low', 'high'] as const).map((q) => (
              <button
                aria-pressed={quality === q}
                onClick={() => {
                  setQuality(q);
                  api.current?.rig.setQuality(q);
                }}
              >
                {q === 'low' ? 'Low' : 'High'}
              </button>
            ))}
          </div>
        </div>
        <div class="dsb-row">
          <span>Eye contact</span>
          <button
            aria-pressed={eyes}
            onClick={() => {
              setEyes(!eyes);
              api.current?.setEyeContact(!eyes);
            }}
          >
            {eyes ? 'On' : 'Off'}
          </button>
        </div>
        <div class="dsb-rule" />
        <div class="dsb-grid">
          <button onClick={call((a) => a.clear())}>Clear table</button>
          <button onClick={call((a) => a.exportGlb())}>Export glTF</button>
        </div>
        <div class="dsb-stats" aria-live="off">
          {stats}
        </div>
      </section>
      <div class="dsb-hint">Drag to orbit · scroll to zoom</div>
    </div>
  );
}
