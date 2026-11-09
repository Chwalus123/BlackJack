import { nextInt, type RngState } from './chacha';

/** In-place Fisher–Yates shuffle: every permutation is equally likely. */
export function shuffle<T>(arr: T[], rng: RngState): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}
