import * as THREE from 'three';
import { DECK_SOCKET, DECK_T, type HandName, sideOf } from './model';
import { DIM, handBasis, type Basis, type Side, type Vec3 } from './ik';

/**
 * Finger poses: per finger [knuckle curl, middle-joint curl, spread toward the thumb] for index, middle, ring,
 * pinky, then the thumb [flex, abduction (out), tip flex]. Degrees; blended linearly.
 */
export const FINGER_COUNT = 15;
export type FingerPoseName = 'rest' | 'grip' | 'pinch' | 'press' | 'flat' | 'open' | 'tap' | 'cup' | 'deck' | 'push' | 'riffle';

const POSES: Record<FingerPoseName, number[]> = {
  rest: [16, 22, 2, 19, 25, 0, 23, 30, -2, 27, 32, -5, 14, 12, 14],
  grip: [10, 20, 0, 12, 22, 0, 40, 58, -2, 48, 62, -4, 40, -14, 18],
  pinch: [20, 30, 0, 23, 33, 0, 42, 58, -2, 50, 64, -4, 44, -18, 20],
  press: [8, 14, 1, 9, 15, 0, 16, 24, -2, 22, 28, -4, 10, 16, 8],
  flat: [3, 4, 3, 3, 4, 0, 3, 4, -3, 4, 4, -7, 6, 22, 4],
  open: [7, 9, 5, 6, 8, 0, 8, 10, -5, 10, 12, -10, 6, 32, 8],
  tap: [72, 88, 0, 76, 90, 0, 80, 90, 0, 82, 88, -2, 32, -6, 34],
  cup: [32, 36, 2, 34, 40, 0, 36, 42, -3, 38, 42, -6, 24, 8, 16],
  deck: [34, 58, 6, 40, 62, 0, 44, 62, -2, 48, 62, -4, 12, 18, 6],
  push: [34, 58, 6, 40, 62, 0, 44, 62, -2, 48, 62, -4, 2, 30, -8],
  riffle: [26, 40, 4, 28, 42, 0, 30, 44, -2, 34, 46, -5, 30, 4, 26],
};

export function fingerPose(name: FingerPoseName): Float32Array {
  return Float32Array.from(POSES[name]);
}

const tmpM = new THREE.Matrix4();
const vx = new THREE.Vector3();
const vy = new THREE.Vector3();
const vz = new THREE.Vector3();

export function basisToQuat(b: Basis, out = new THREE.Quaternion()): THREE.Quaternion {
  vx.set(b.x.x, b.x.y, b.x.z);
  vy.set(b.y.x, b.y.y, b.y.z);
  vz.set(b.z.x, b.z.y, b.z.z);
  return out.setFromRotationMatrix(tmpM.makeBasis(vx, vy, vz));
}

export function quatToBasis(q: THREE.Quaternion): Basis {
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return { x: { x: x.x, y: x.y, z: x.z }, y: { x: y.x, y: y.y, z: y.z }, z: { x: z.x, y: z.y, z: z.z } };
}

/** Hand orientation in rig space: fingers along `heading` (horizontal), pitched down, supinated (palm turning up). */
export function handQuat(h: HandName, heading: Vec3 | THREE.Vector3, pitchDown: number, supinate = 0, out = new THREE.Quaternion()): THREE.Quaternion {
  return basisToQuat(handBasis(sideOf(h), { x: heading.x, y: 0, z: heading.z }, pitchDown, supinate), out);
}

export const GRIP = new THREE.Vector3(DIM.grip.x, DIM.grip.y, DIM.grip.z);
/** Contact points in hand space. */
export const CONTACT = {
  grip: GRIP,
  knuckles: new THREE.Vector3(0, 0.1, -0.05),
  palm: new THREE.Vector3(0, 0.05, -0.022),
  tips: new THREE.Vector3(0, 0.178, -0.02),
  pads: new THREE.Vector3(0, 0.165, -0.03),
} as const;

/** Grip-socket position that puts a hand-space contact point on `contact` for orientation q. */
export function gripFromContact(contact: THREE.Vector3, q: THREE.Quaternion, local: THREE.Vector3): THREE.Vector3 {
  return GRIP.clone().sub(local).applyQuaternion(q).add(contact);
}

/** Deck block centre in hand space for a side. */
export function deckCentreLocal(s: Side): THREE.Vector3 {
  return new THREE.Vector3(DECK_SOCKET.x * s, DECK_SOCKET.y, DECK_SOCKET.z - DECK_T / 2);
}

/** Grip-socket position that holds the deck centre at `centre`. */
export function gripForDeck(h: HandName, centre: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3 {
  return gripFromContact(centre, q, deckCentreLocal(sideOf(h)));
}

export interface HandPose {
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  fingers: Float32Array;
}

/** Resting stance: hands on the felt either side of the chip rack. */
export function neutralHand(h: HandName, deckInHand: boolean): HandPose {
  const s = sideOf(h);
  if (deckInHand && h === 'L') {
    const rot = handQuat('L', new THREE.Vector3(-0.5, 0, 1), 0.22, 1.2);
    return { pos: gripForDeck('L', DECK_HOLD.clone(), rot), rot, fingers: fingerPose('deck') };
  }
  if (deckInHand) {
    const rot = handQuat('R', new THREE.Vector3(0.25, 0, 1), 0.6, 0.08);
    return { pos: new THREE.Vector3(-0.15, 0.065, 0.25), rot, fingers: fingerPose('rest') };
  }
  const rot = handQuat(h, new THREE.Vector3(-0.18 * s, 0, 1), 0.62, 0.12);
  return { pos: new THREE.Vector3(0.27 * s, 0.048, 0.215), rot, fingers: fingerPose('rest') };
}

/** Where the Hold'em deck sits in the left hand at rest (rig space). */
export const DECK_HOLD = new THREE.Vector3(0.19, 0.095, 0.265);

/** Torso posture (lean, side, twist) at rest. */
export const NEUTRAL_BODY = new THREE.Vector3(0.08, 0, 0);
