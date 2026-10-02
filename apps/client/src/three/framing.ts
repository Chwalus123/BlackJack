import * as THREE from 'three';
import { DEALER_POS, HE_TABLE, heStackPos } from './layout';
import type { TableKind } from './table';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraPose {
  target: THREE.Vector3;
  /** Unit vector from the target toward the eye. */
  dir: THREE.Vector3;
  /** Eye distance of the designed pose (before fitting). */
  dist: number;
  vfov: number;
  /** Distance at which the table's width just fits the screen. */
  widthDist: number;
}

/** A seat behind the players, high enough to see the dealer chest-up and every betting spot. */
export function basePose(kind: TableKind, aspect: number): CameraPose {
  const blackjack = kind === 'blackjack';
  // Hold'em looks down more steeply (~37°) so the flat community cards are less foreshortened.
  const target = blackjack ? new THREE.Vector3(0, 0.27, -0.04) : new THREE.Vector3(0, 0.24, -0.05);
  const eye = blackjack ? new THREE.Vector3(0, 1.1, 2.02) : new THREE.Vector3(0, 1.8, 2.0);
  const dir = eye.clone().sub(target);
  const dist = dir.length();
  dir.normalize();
  const portrait = aspect < 1;
  const vfov = portrait ? 62 : 42;
  if (portrait) {
    // Portrait phones: look down more steeply and fit the table's width to the screen.
    const pitch = Math.min(Math.atan2(dir.y, dir.z) + THREE.MathUtils.degToRad(14), THREE.MathUtils.degToRad(50));
    dir.set(0, Math.sin(pitch), Math.cos(pitch));
    target.y -= 0.1;
    target.z += 0.06;
  }
  const halfWidth = blackjack ? 0.8 : 0.98;
  const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(vfov / 2)) * aspect);
  return { target, dir, dist, vfov, widthDist: (halfWidth / Math.tan(hHalf)) * 1.04 };
}

/** What the Hold'em framing keeps on screen: the dealer's head, the near rail and the hero's seat plate. */
export const HE_FRAME = {
  headTopY: 0.98,
  railZ: HE_TABLE.centerZ + HE_TABLE.halfDepth + 0.1,
  /** How far the hero's seat plate hangs below its anchor, in CSS px (compact plates on small screens). */
  plateDrop: (w: number, h: number) => (w <= 640 || h <= 560 ? 48 : 66),
  /** On wide screens the top bar's controls sit in the corners, so the dealer's head may rise into its band. */
  topFor: (w: number, insets: Insets) => (w >= 700 ? 0 : insets.top),
  pad: 8,
  /** Never squeeze the scene below this share of the screen height (very small phones). */
  minShare: 0.4,
} as const;

const tmp = new THREE.Vector3();

/**
 * Hold'em framing: move the camera as close as the free area allows (the dealer's head below the top bar, the
 * near rail and the hero's seat plate above the dock, the table's width on screen), then lens-shift the view
 * into that area. The closer camera makes the board larger; the fit keeps the dock from covering seats.
 */
export function frameHoldemCamera(camera: THREE.PerspectiveCamera, pose: CameraPose, w: number, h: number, insets: Insets): void {
  const { bottom, left, right } = insets;
  const pad = HE_FRAME.pad;
  const top = HE_FRAME.topFor(w, insets);
  const avail = Math.max(h - top - bottom - 2 * pad, h * HE_FRAME.minShare);
  const plateDrop = HE_FRAME.plateDrop(w, h);
  const headTop = new THREE.Vector3(DEALER_POS.x, HE_FRAME.headTopY, DEALER_POS.z);
  const plate = heStackPos(HE_TABLE.heroSpot);
  const plateAnchor = new THREE.Vector3(plate.x, plate.y, plate.z);
  const rail = new THREE.Vector3(0, 0, HE_FRAME.railZ);
  camera.fov = pose.vfov;
  camera.aspect = w / h;
  camera.clearViewOffset();
  const measure = (d: number) => {
    camera.position.copy(pose.target).addScaledVector(pose.dir, d);
    camera.lookAt(pose.target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const y = (p: THREE.Vector3) => (-tmp.copy(p).project(camera).y * 0.5 + 0.5) * h;
    return { yTop: y(headTop), yBottom: Math.max(y(plateAnchor) + plateDrop, y(rail)) };
  };
  const fits = (d: number) => {
    const m = measure(d);
    return m.yBottom - m.yTop <= avail;
  };
  let lo = Math.max(1.2, pose.widthDist);
  let hi = Math.max(lo, 9);
  if (fits(lo)) hi = lo;
  else {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
  }
  const { yTop, yBottom } = measure(hi);
  // Centre the content in the free band between the top bar and the dock.
  const band = h - top - bottom;
  const offY = yTop - top - Math.max(pad, (band - (yBottom - yTop)) / 2);
  const offX = (right - left) / 2;
  if (offX || offY) camera.setViewOffset(w, h, offX, offY, w, h);
  camera.updateProjectionMatrix();
}
