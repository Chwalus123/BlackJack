import type * as THREE from 'three';
import { DealerRuntime } from './rig';

/**
 * Jacbos Casino — the procedural 3D croupier.
 *
 * Built entirely in code (bones + faceted vertex-coloured primitives, one tiny canvas texture for the
 * name badge). Gestures animate IK targets along smooth curves; the caller animates card / chip flights
 * from the callbacks. Rig-local +Z faces the players; place `root` at the dealer's position.
 */

export type DealerHand = 'left' | 'right';
export interface GestureHandle {
  done: Promise<void>;
}
export interface GestureOpts {
  durationMs: number;
}

export interface DealerRig {
  readonly root: THREE.Group;
  /** True while a gesture is running or queued — keep calling update() until it is false. */
  readonly busy: boolean;
  /** Advance idle + gesture animation by dt seconds. Called every frame by the scene. */
  update(dt: number): void;
  /** Speed multiplier for all gestures (1 = normal, 2 = twice as fast; Infinity = snap to end states instantly). */
  setSpeed(mult: number): void;
  /** No idle sway/breathing, shorter straighter moves. */
  setReducedMotion(on: boolean): void;
  /** Badge text KRUPIER / DEALER. */
  setLocale(l: 'pl' | 'en'): void;
  /** Segment counts (geometry is rebuilt in place). */
  setQuality(q: 'low' | 'high'): void;
  /** Head/eyes track a world point (spring-damped); null = neutral. */
  lookAt(worldTarget: THREE.Vector3 | null): void;
  /** World position of a hand's grip socket (where a held card sits). */
  handWorldPosition(hand: DealerHand, out: THREE.Vector3): THREE.Vector3;
  /** Hold'em: show a small deck block in the left hand. */
  setDeckInHand(visible: boolean): void;

  dealFromShoe(shoe: THREE.Vector3, target: THREE.Vector3, o: GestureOpts & { onRelease?: (releasePos: THREE.Vector3) => void }): GestureHandle;
  /** Hold'em thumb-push + pitch. */
  dealFromHand(target: THREE.Vector3, o: GestureOpts & { onRelease?: (releasePos: THREE.Vector3) => void }): GestureHandle;
  /** Turn a card over on the felt. */
  flip(at: THREE.Vector3, o: GestureOpts & { onFlip?: () => void }): GestureHandle;
  /** Lift the corner of the hole card. */
  peek(at: THREE.Vector3, o: GestureOpts): GestureHandle;
  burn(o: GestureOpts & { onRelease?: (p: THREE.Vector3) => void }): GestureHandle;
  /** Collect cards to the discard. */
  sweep(from: THREE.Vector3[], to: THREE.Vector3, o: GestureOpts & { onGrab?: (i: number) => void }): GestureHandle;
  /** Pay / push a pot. */
  pushChips(to: THREE.Vector3, o: GestureOpts & { onRelease?: () => void }): GestureHandle;
  /** Collect losing bets. */
  takeChips(from: THREE.Vector3, o: GestureOpts & { onGrab?: () => void }): GestureHandle;
  /** "Your turn" open-palm gesture. */
  point(at: THREE.Vector3, o: GestureOpts): GestureHandle;
  /** Knock the felt. */
  tap(at: THREE.Vector3, o: GestureOpts): GestureHandle;
  /** Reshuffle / reload-the-shoe flourish. */
  shuffle(o: GestureOpts): GestureHandle;
  /** Snap every queued gesture to its end state (callbacks still fire, in order). */
  flush(): void;
  dispose(): void;
}

export interface CreateDealerOptions {
  quality?: 'low' | 'high';
  locale?: 'pl' | 'en';
  /**
   * Show the dealer's own card proxy in hand between drawing a card and releasing it (default true). Turn
   * off if the caller attaches its real card to `handWorldPosition()` instead.
   */
  showHeldCards?: boolean;
}

export function createDealer(opts: CreateDealerOptions = {}): DealerRig {
  return new DealerRuntime(opts);
}
