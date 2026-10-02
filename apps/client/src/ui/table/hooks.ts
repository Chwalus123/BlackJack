import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

/** A shared ticking clock for countdowns (only ticks while something subscribes). */
const clock = signal(performance.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

export function useTicking(active: boolean): number {
  useEffect(() => {
    if (!active) return;
    subscribers++;
    if (!timer) timer = setInterval(() => (clock.value = performance.now()), 200);
    return () => {
      subscribers--;
      if (subscribers === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [active]);
  return clock.value;
}
