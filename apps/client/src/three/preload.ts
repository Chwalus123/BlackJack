/** Warm the 3D chunk while the player is still choosing (called on hover of PLAY). */
let started = false;
export function preload(): void {
  if (started) return;
  started = true;
  void import('../screens/TableScreen');
}
