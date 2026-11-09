import { useTicking } from './hooks';

/** Shrinking bar for a decision deadline (`now` comes from the session clock). */
export function TimerBar({ deadline, now, total = 20000 }: { deadline: number | null; now: () => number; total?: number }) {
  useTicking(deadline != null);
  if (deadline == null) return null;
  const left = Math.max(0, deadline - now());
  const k = Math.max(0, Math.min(1, left / total));
  return (
    <div class={`timer ${left < 5000 ? 'warn' : ''}`} role="timer" aria-label={`${Math.ceil(left / 1000)} s`}>
      <i style={{ transform: `scaleX(${k})` }} />
    </div>
  );
}

export function Countdown({ deadline, now }: { deadline: number | null; now: () => number }) {
  useTicking(deadline != null);
  if (deadline == null) return null;
  const s = Math.max(0, Math.ceil((deadline - now()) / 1000));
  return <span class="tabular">0:{String(s).padStart(2, '0')}</span>;
}
