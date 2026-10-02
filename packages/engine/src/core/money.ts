/**
 * Money is an integer number of minor units: 100 = 1 chip (displayed "1" / "1.00").
 * Every wager is a multiple of the table unit, and ratios only have denominators that divide 100,
 * so every payout is an exact integer — a 5-chip blackjack pays 7.50 with no rounding anywhere.
 */
export type Money = number;
export const CHIP = 100;
export type Ratio = readonly [num: number, den: number];

export const isMoney = (m: unknown): m is Money => typeof m === 'number' && Number.isSafeInteger(m) && m >= 0;

export function payout(bet: Money, [n, d]: Ratio): Money {
  const p = (bet * n) / d;
  if (!Number.isInteger(p)) throw new Error(`Non-integer payout ${bet} × ${n}/${d}`);
  return p;
}

export const chips = (n: number): Money => Math.round(n * CHIP);

/** Casino chip denominations in minor units, smallest first. Colours live in the client. */
export const DENOMINATIONS: readonly Money[] = [50, 100, 250, 500, 2500, 10000, 50000, 100000, 500000, 2500000];

/** Greedy breakdown of an amount into chip denominations (largest first). */
export function breakdown(amount: Money, denoms: readonly Money[] = DENOMINATIONS): Money[] {
  const out: Money[] = [];
  let rest = amount;
  for (let i = denoms.length - 1; i >= 0; i--) {
    const d = denoms[i]!;
    while (rest >= d) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
