/**
 * ChaCha20 (RFC 8439) block function and a serialisable CSPRNG built on it.
 * Only 32-bit integer operations — no BigInt — so it runs identically in browsers and Node.
 * The generator state is plain JSON so it can live inside the game state (deterministic replay),
 * but it is NEVER serialised to clients.
 */
export type Seed = readonly number[]; // 8 × u32 = 256 bits

export interface RngState {
  k: number[]; // 8 key words
  n: number; // block counter
  b: number[]; // current 16-word output block
  i: number; // next word index in b (16 = exhausted)
}

const rotl = (v: number, c: number) => ((v << c) | (v >>> (32 - c))) >>> 0;

function quarter(x: Uint32Array, a: number, b: number, c: number, d: number) {
  x[a] = (x[a]! + x[b]!) >>> 0; x[d] = rotl(x[d]! ^ x[a]!, 16);
  x[c] = (x[c]! + x[d]!) >>> 0; x[b] = rotl(x[b]! ^ x[c]!, 12);
  x[a] = (x[a]! + x[b]!) >>> 0; x[d] = rotl(x[d]! ^ x[a]!, 8);
  x[c] = (x[c]! + x[d]!) >>> 0; x[b] = rotl(x[b]! ^ x[c]!, 7);
}

/** One ChaCha20 block: 16 little-endian u32 words of keystream. */
export function chachaBlock(key: readonly number[], counter: number, nonce: readonly number[] = [0, 0, 0]): number[] {
  const s = new Uint32Array(16);
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) s[4 + i] = key[i]! >>> 0;
  s[12] = counter >>> 0;
  s[13] = nonce[0]! >>> 0; s[14] = nonce[1]! >>> 0; s[15] = nonce[2]! >>> 0;
  const x = new Uint32Array(s);
  for (let r = 0; r < 10; r++) {
    quarter(x, 0, 4, 8, 12); quarter(x, 1, 5, 9, 13); quarter(x, 2, 6, 10, 14); quarter(x, 3, 7, 11, 15);
    quarter(x, 0, 5, 10, 15); quarter(x, 1, 6, 11, 12); quarter(x, 2, 7, 8, 13); quarter(x, 3, 4, 9, 14);
  }
  const out: number[] = new Array(16);
  for (let i = 0; i < 16; i++) out[i] = (x[i]! + s[i]!) >>> 0;
  return out;
}

function normSeed(seed: Seed): number[] {
  const k: number[] = [];
  for (let i = 0; i < 8; i++) k.push((seed[i] ?? 0) >>> 0);
  return k;
}

export function createRng(seed: Seed): RngState {
  return { k: normSeed(seed), n: 0, b: [], i: 16 };
}

export function nextU32(s: RngState): number {
  if (s.i >= 16) {
    s.b = chachaBlock(s.k, s.n);
    s.n = (s.n + 1) >>> 0;
    if (s.n === 0) rekey(s, [0x9e3779b9]); // counter wrap: derive a fresh key
    s.i = 0;
  }
  return s.b[s.i++]!;
}

/** Uniform integer in [0, n) by rejection sampling (no modulo bias). */
export function nextInt(s: RngState, n: number): number {
  if (!(n >= 1 && n <= 0x100000000 && Number.isInteger(n))) throw new Error(`nextInt: bad bound ${n}`);
  const limit = 0x100000000 - (0x100000000 % n);
  for (;;) {
    const x = nextU32(s);
    if (x < limit) return x % n;
  }
}

/** Uniform float in [0, 1) with 32 bits of precision. */
export const nextFloat = (s: RngState): number => nextU32(s) / 0x100000000;

/**
 * Re-key with fresh host entropy: k' = first 8 words of ChaCha20(k XOR entropy, counter 0xffffffff).
 * Called at every shuffle so earlier output never predicts the next deck.
 */
export function rekey(s: RngState, entropy: Seed): void {
  const mixed = s.k.map((w, i) => (w ^ ((entropy[i] ?? 0) >>> 0)) >>> 0);
  const blk = chachaBlock(mixed, 0xffffffff, [0x6b6e6f63, 0x6b657963, 0x00000001]);
  s.k = blk.slice(0, 8);
  s.n = 0;
  s.b = [];
  s.i = 16;
}
