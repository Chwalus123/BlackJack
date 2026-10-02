import { rankOf, suitOf, type Card } from '../../core/cards';

/**
 * Equity (thousandths) of each starting hand against one random hand, 60k Monte Carlo trials each,
 * generated offline with heEquity. Index by rank index 0..12 (2..A): GRID[hi][lo] suited,
 * GRID[lo][hi] offsuit, GRID[r][r] pairs.
 */
const GRID: readonly (readonly number[])[] = [
  [501, 323, 331, 345, 343, 347, 367, 397, 416, 444, 473, 505, 548],
  [359, 536, 350, 365, 360, 368, 374, 401, 424, 452, 482, 514, 558],
  [368, 387, 568, 378, 383, 384, 393, 405, 433, 463, 494, 527, 565],
  [380, 394, 418, 601, 398, 405, 413, 428, 443, 471, 499, 534, 580],
  [379, 396, 414, 432, 633, 424, 433, 446, 462, 476, 510, 538, 576],
  [384, 398, 416, 440, 450, 666, 453, 461, 478, 497, 516, 549, 590],
  [405, 407, 428, 444, 461, 477, 694, 480, 498, 516, 536, 558, 597],
  [423, 436, 438, 456, 472, 489, 509, 721, 514, 533, 553, 577, 606],
  [449, 455, 469, 471, 489, 504, 522, 539, 753, 550, 571, 594, 625],
  [472, 483, 491, 503, 506, 526, 540, 555, 579, 773, 579, 604, 635],
  [502, 507, 519, 530, 535, 543, 559, 577, 594, 599, 801, 617, 643],
  [531, 539, 550, 559, 567, 574, 585, 598, 616, 626, 633, 824, 651],
  [573, 582, 591, 602, 596, 608, 619, 627, 643, 653, 661, 672, 850],
];

const cell = (hole: readonly Card[]): [number, number] => {
  const a = rankOf(hole[0]!) - 2;
  const b = rankOf(hole[1]!) - 2;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return suitOf(hole[0]!) === suitOf(hole[1]!) ? [hi, lo] : [lo, hi];
};

/** Heads-up preflop equity of a starting hand against a random hand (0..1). */
export const preflopEquity = (hole: readonly Card[]): number => {
  const [r, c] = cell(hole);
  return GRID[r]![c]! / 1000;
};

// Fraction of the 1326 starting hands that are better, counting ties half: 0 = AA, ~1 = 32o.
const PCT: number[][] = (() => {
  const cls: { r: number; c: number; eq: number; combos: number }[] = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) cls.push({ r, c, eq: GRID[r]![c]!, combos: r === c ? 6 : r > c ? 4 : 12 });
  const out = GRID.map((row) => row.map(() => 0));
  for (const k of cls) {
    let better = 0;
    let same = 0;
    for (const o of cls) {
      if (o.eq > k.eq) better += o.combos;
      else if (o.eq === k.eq) same += o.combos;
    }
    out[k.r]![k.c] = (better + same / 2) / 1326;
  }
  return out;
})();

/** Starting-hand percentile: 0 = best, 1 = worst. */
export const preflopPercentile = (hole: readonly Card[]): number => {
  const [r, c] = cell(hole);
  return PCT[r]![c]!;
};
