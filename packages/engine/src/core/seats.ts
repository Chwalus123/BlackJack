/** Circular helpers over a fixed-size seat array (Hold'em positions). */
export function nextIndex<T>(arr: readonly (T | null)[], from: number, pred: (x: T, i: number) => boolean): number | null {
  const n = arr.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const x = arr[i];
    if (x != null && pred(x, i)) return i;
  }
  return null;
}
