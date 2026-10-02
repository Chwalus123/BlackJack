import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ChipLayer } from './chips';
import { CardLayer } from './cards';
import { createDealer, type DealerRig } from './dealer';
import { BJ_RACK, DEALER_POS, type V3 } from './layout';
import { buildTable, type TableKind, type TableMeshes } from './table';
import { buildCardAtlas, TILE_BACK_BLUE, TILE_BACK_RED } from './textures/cardAtlas';
import { buildBlackjackFelt, buildHoldemFelt, type FeltText } from './textures/felt';
import { ensureFonts } from './textures/fonts';
import { Tweens } from './timeline';

export type Quality = 'low' | 'high';

export function detectQuality(): Quality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  return coarse || small ? 'low' : 'high';
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Owns the renderer, camera, lights, table, cards, chips and the dealer. Rendering is on demand: frames
 * are drawn while anything animates and stop when idle (saves battery), plus a slow idle tick for the
 * dealer's breathing on the high tier.
 */
export class TableScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30);
  readonly tweens = new Tweens();
  readonly cards: CardLayer;
  readonly chips: ChipLayer;
  readonly dealer: DealerRig;
  readonly table: TableMeshes;
  readonly quality: Quality;
  private readonly env: THREE.Texture;
  private raf = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly frameListeners = new Set<() => void>();
  private readonly resizeObserver: ResizeObserver;
  private idleUntil = 0;
  private hidden = false;

  private constructor(
    readonly kind: TableKind,
    private readonly host: HTMLElement,
    quality: Quality,
    felt: HTMLCanvasElement,
    locale: 'pl' | 'en',
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'manipulation';
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#0b0908');
    this.scene.fog = new THREE.Fog('#0b0908', 3.2, 9);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.32;

    // Lights: warm key spot over the table, soft hemisphere fill, faint rim from behind the dealer.
    const hemi = new THREE.HemisphereLight('#ffe7c4', '#1a0b08', 0.55);
    this.scene.add(hemi);
    const key = new THREE.SpotLight('#ffe2b0', 46, 6, 0.78, 0.65, 1.6);
    key.position.set(0.15, 2.3, 0.55);
    key.target.position.set(0, 0, -0.05);
    key.castShadow = quality === 'high';
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.00015;
    key.shadow.radius = 4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 4;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight('#ffcf8a', 0.6);
    rim.position.set(-1.2, 1.4, -2);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight('#c9d6ff', 0.25);
    fill.position.set(0.5, 1.2, 2.5);
    this.scene.add(fill);

    this.table = buildTable(kind, felt, quality);
    this.scene.add(this.table.group);

    const atlas = buildCardAtlas(quality === 'high' ? 256 : 192);
    this.cards = new CardLayer(atlas, this.tweens, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.cards.group);
    this.chips = new ChipLayer(this.tweens, quality);
    this.chips.fillRack(kind === 'blackjack' ? BJ_RACK : { x: 0, y: 0, z: -0.41 }, kind === 'blackjack' ? 0.44 : 0.34);
    this.scene.add(this.chips.group);

    this.dealer = createDealer({ quality, locale });
    this.dealer.root.position.set(DEALER_POS.x, DEALER_POS.y, DEALER_POS.z);
    this.dealer.setDeckInHand(kind === 'holdem');
    this.scene.add(this.dealer.root);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
    this.resize();
  }

  static async create(kind: TableKind, host: HTMLElement, opts: { quality?: Quality; locale: 'pl' | 'en'; felt: FeltText }): Promise<TableScene> {
    await ensureFonts();
    const quality = opts.quality ?? detectQuality();
    const felt = kind === 'blackjack' ? buildBlackjackFelt(opts.felt, quality === 'high' ? 1100 : 650) : buildHoldemFelt(opts.felt, quality === 'high' ? 1000 : 600);
    return new TableScene(kind, host, quality, felt, opts.locale);
  }

  setCardBack(blue: boolean): void {
    this.cards.backTile = blue ? TILE_BACK_BLUE : TILE_BACK_RED;
  }

  setSpeed(mult: number): void {
    this.tweens.speed = mult;
    this.dealer.setSpeed(mult);
  }

  setReducedMotion(on: boolean): void {
    this.dealer.setReducedMotion(on);
  }

  setInsets(i: Insets): void {
    this.insets = i;
    this.resize();
  }

  onFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  /** Keep rendering for at least `ms` (e.g. while HUD overlays track something). */
  wake(ms = 600): void {
    this.idleUntil = Math.max(this.idleUntil, performance.now() + ms);
    this.start();
  }

  start(): void {
    if (this.running || this.disposed || this.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    const elapsed = Math.max(0, now - this.last);
    this.last = now;
    // Game timing follows the wall clock even on slow devices; the dealer rig steps in small slices.
    this.tweens.tick(Math.min(500, elapsed));
    let rest = Math.min(0.5, elapsed / 1000);
    while (rest > 0) {
      const dt = Math.min(0.05, rest);
      this.dealer.update(dt);
      rest -= dt;
    }
    this.renderer.render(this.scene, this.camera);
    for (const f of this.frameListeners) f();
    const busy = this.tweens.busy || now < this.idleUntil;
    // The high tier keeps a gentle idle loop so the dealer breathes; the low tier sleeps when idle.
    if (busy || this.quality === 'high') this.raf = requestAnimationFrame(this.loop);
    else this.running = false;
  };

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // A seat behind the players, high enough to see the dealer chest-up and every betting spot.
    const blackjack = this.kind === 'blackjack';
    const target = blackjack ? new THREE.Vector3(0, 0.27, -0.04) : new THREE.Vector3(0, 0.33, -0.08);
    const eye = blackjack ? new THREE.Vector3(0, 1.1, 2.02) : new THREE.Vector3(0, 1.42, 2.4);
    const dir = eye.clone().sub(target);
    let dist = dir.length();
    dir.normalize();
    const portrait = aspect < 1;
    const vfov = portrait ? 62 : 42;
    if (portrait) {
      // Portrait phones: look down more steeply and fit the table's width to the screen.
      const pitch = Math.atan2(dir.y, dir.z) + THREE.MathUtils.degToRad(14);
      dir.set(0, Math.sin(pitch), Math.cos(pitch));
      target.y -= 0.1;
      target.z += 0.06;
    }
    const halfWidth = blackjack ? 0.8 : 0.98;
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(vfov / 2)) * aspect);
    dist = Math.max(dist, (halfWidth / Math.tan(hHalf)) * 1.04);
    this.camera.fov = vfov;
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    // Shift the view so the table centre sits in the area not covered by HUD docks.
    const { top, bottom, left, right } = this.insets;
    if (top || bottom || left || right) {
      this.camera.setViewOffset(w, h, (right - left) / 2, (bottom - top) / 2, w, h);
    } else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.dealer.lookAt(this.camera.position);
    this.wake(50);
  }

  private readonly tmp = new THREE.Vector3();
  /** World → CSS pixel coordinates relative to the host element. */
  project(p: V3): { x: number; y: number; visible: boolean } {
    this.tmp.set(p.x, p.y, p.z).project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h, visible: this.tmp.z < 1 && Math.abs(this.tmp.x) <= 1.05 && Math.abs(this.tmp.y) <= 1.05 };
  }

  /** Snap every running animation to its end state. */
  flush(): void {
    this.dealer.flush();
    this.tweens.flush();
    this.wake(50);
  }

  private onVisibility = () => {
    this.hidden = document.visibilityState === 'hidden';
    if (this.hidden) {
      cancelAnimationFrame(this.raf);
      this.running = false;
    } else {
      this.flush();
      this.start();
    }
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.raf);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.tweens.flush();
    this.cards.dispose();
    this.chips.dispose();
    this.dealer.dispose();
    this.table.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
