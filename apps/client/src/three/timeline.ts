/** Minimal tween runner driven by the scene clock. Speed = Infinity completes tweens immediately. */
export type Ease = (t: number) => number;
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn: Ease = (t) => t * t * t;
export const linear: Ease = (t) => t;

interface Tween {
  dur: number;
  delay: number;
  t: number;
  ease: Ease;
  update: (k: number) => void;
  resolve: () => void;
}

export class Tweens {
  private list: Tween[] = [];
  speed = 1;

  add(durationMs: number, update: (k: number) => void, opts?: { ease?: Ease; delay?: number }): Promise<void> {
    return new Promise((resolve) => {
      const tw: Tween = { dur: Math.max(0, durationMs), delay: opts?.delay ?? 0, t: 0, ease: opts?.ease ?? easeInOut, update, resolve };
      if (!Number.isFinite(this.speed) || tw.dur + tw.delay === 0) {
        update(1);
        resolve();
        return;
      }
      this.list.push(tw);
    });
  }

  wait(ms: number): Promise<void> {
    return this.add(ms, () => undefined, { ease: linear });
  }

  /** Advance by dt milliseconds of wall time. */
  tick(dtMs: number): void {
    if (this.list.length === 0) return;
    const step = Number.isFinite(this.speed) ? dtMs * this.speed : Infinity;
    const done: Tween[] = [];
    for (const tw of this.list) {
      tw.t += step;
      const k = tw.t <= tw.delay ? 0 : Math.min(1, (tw.t - tw.delay) / (tw.dur || 1));
      if (tw.t > tw.delay || k >= 1) tw.update(tw.ease(k));
      if (k >= 1) done.push(tw);
    }
    if (done.length) {
      this.list = this.list.filter((x) => !done.includes(x));
      for (const tw of done) tw.resolve();
    }
  }

  /** Complete everything now. */
  flush(): void {
    const all = this.list;
    this.list = [];
    for (const tw of all) {
      tw.update(1);
      tw.resolve();
    }
  }

  get busy(): boolean {
    return this.list.length > 0;
  }
}
