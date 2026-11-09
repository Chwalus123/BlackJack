import type { Scheduler, Seed } from '@casino/engine';

export const realScheduler: Scheduler = {
  now: () => performance.now(),
  at: (t, fn) => setTimeout(fn, Math.max(0, t - performance.now())),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function cryptoSeed(): Seed {
  return Array.from(crypto.getRandomValues(new Uint32Array(8)));
}
