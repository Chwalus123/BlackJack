import { describe, expect, it } from 'vitest';
import { he } from '../src/index';

/** Every 7-card hand (133,784,560): category counts and 4,824 distinct values. Runs with SLOW=1. */
describe('7-card evaluator sweep', () => {
  it('matches the known 7-card category counts', () => {
    const counts = new Array<number>(10).fill(0);
    const seen = new Uint8Array(1 << 24);
    const h = [0, 0, 0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++) {
      h[0] = a;
      for (let b = a + 1; b < 52; b++) {
        h[1] = b;
        for (let c = b + 1; c < 52; c++) {
          h[2] = c;
          for (let d = c + 1; d < 52; d++) {
            h[3] = d;
            for (let e = d + 1; e < 52; e++) {
              h[4] = e;
              for (let f = e + 1; f < 52; f++) {
                h[5] = f;
                for (let g = f + 1; g < 52; g++) {
                  h[6] = g;
                  const v = he.eval7(h);
                  seen[v >> 0] = 1;
                  const cat = v >> 20;
                  counts[cat === 8 && ((v >> 16) & 15) === 14 ? 9 : cat]!++;
                }
              }
            }
          }
        }
      }
    }
    // high, pair, two pair, trips, straight, flush, full house, quads, straight flush (excl. royal), royal
    expect(counts).toEqual([23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 37260, 4324]);
    expect(seen.reduce((a, x) => a + x, 0)).toBe(4824);
  });
});
