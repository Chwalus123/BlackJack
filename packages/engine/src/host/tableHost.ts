import type { Seed } from '../core/chacha';
import type { GameModule } from '../core/game';
import { LATENCY_GRACE_MS } from '../core/pacing';
import type { EngineError, Reveal, SeatId } from '../core/types';

export interface Scheduler {
  now(): number;
  at(t: number, fn: () => void): unknown;
  cancel(h: unknown): void;
}

export interface Batch<S, E> {
  pub: E[];
  priv: Reveal[];
  state: S;
  /** The action that produced the batch (host-stamped). */
  action: { type: string; seat?: SeatId };
}

export interface BotDriver<S, V, L> {
  personaOf(state: S, seat: SeatId): string | null;
  decide(view: V, legal: L, seat: SeatId, persona: string): Promise<{ action: Record<string, unknown> & { type: string }; thinkMs: number }> | { action: Record<string, unknown> & { type: string }; thinkMs: number };
  /** Earliest time a bot may act (e.g. when the client finishes presenting). Defaults to now. */
  gate?(): number;
  /** Multiplier on think time (single-player speed setting). */
  thinkScale?(): number;
}

export type DispatchResult = { ok: true } | { ok: false; error: EngineError };

type AnyModule = GameModule<any, any, any, any, any, any>;

/**
 * The one runtime for a table, shared by the single-player client and the multiplayer server.
 * Stamps time and entropy, applies actions, arms the single deadline timer and drives bots.
 */
export class TableHost<M extends AnyModule> {
  state: ReturnType<M['create']>;
  private timer: unknown = null;
  private timerAt: number | null = null;
  private botJobs = new Map<SeatId, { dId: number; handle: unknown }>();
  private disposed = false;

  constructor(
    private readonly m: M,
    state: ReturnType<M['create']>,
    private readonly opts: {
      scheduler: Scheduler;
      entropy: () => Seed;
      onBatch: (b: Batch<ReturnType<M['create']>, any>) => void;
      bots?: BotDriver<ReturnType<M['create']>, any, any>;
      graceMs?: number;
      inPlace?: boolean;
    },
  ) {
    this.state = state;
  }

  start(): void {
    this.rearm();
  }

  dispatch(action: Record<string, unknown> & { type: string }): DispatchResult {
    if (this.disposed) return { ok: false, error: { code: 'BAD_PHASE', detail: 'disposed' } };
    const stamped = { ...action, at: this.opts.scheduler.now(), entropy: this.opts.entropy() };
    const r = this.m.apply(this.state, stamped, this.opts.inPlace ? { inPlace: true } : undefined);
    if (!r.ok) return { ok: false, error: r.error };
    this.state = r.state;
    if (r.pub.length || r.priv.length) {
      this.opts.onBatch({ pub: r.pub, priv: r.priv, state: this.state, action: { type: action.type, seat: action.seat as SeatId | undefined } });
    }
    this.rearm();
    return { ok: true };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer != null) this.opts.scheduler.cancel(this.timer);
    for (const j of this.botJobs.values()) this.opts.scheduler.cancel(j.handle);
    this.botJobs.clear();
  }

  private rearm(): void {
    if (this.disposed) return;
    const sched = this.opts.scheduler;
    const d = this.m.nextDeadline(this.state);
    const fireAt = d == null ? null : d + (this.opts.graceMs ?? LATENCY_GRACE_MS);
    if (fireAt !== this.timerAt) {
      if (this.timer != null) sched.cancel(this.timer);
      this.timer = null;
      this.timerAt = fireAt;
      if (fireAt != null) {
        this.timer = sched.at(fireAt, () => {
          this.timer = null;
          this.timerAt = null;
          this.dispatch({ type: 'TIMEOUT' });
        });
      }
    }
    this.driveBots();
  }

  private driveBots(): void {
    const bots = this.opts.bots;
    if (!bots) return;
    const sched = this.opts.scheduler;
    const pending = new Set(this.m.pendingDecisions(this.state));
    for (const [seat, job] of this.botJobs) {
      if (!pending.has(seat)) {
        sched.cancel(job.handle);
        this.botJobs.delete(seat);
      }
    }
    for (const seat of pending) {
      const persona = bots.personaOf(this.state, seat);
      if (!persona) continue;
      const legal = this.m.legal(this.state, seat) as { dId: number } | null;
      if (!legal) continue;
      const job = this.botJobs.get(seat);
      if (job && job.dId === legal.dId) continue;
      if (job) sched.cancel(job.handle);
      const view = this.m.view(this.state, { kind: 'seat', seat });
      const run = async () => {
        const dec = await bots.decide(view, legal, seat, persona);
        if (this.disposed) return;
        const cur = this.botJobs.get(seat);
        if (!cur || cur.dId !== legal.dId) return;
        const wait = Math.max(0, (bots.gate?.() ?? sched.now()) - sched.now()) + dec.thinkMs * (bots.thinkScale?.() ?? 1);
        cur.handle = sched.at(sched.now() + wait, () => {
          const still = this.botJobs.get(seat);
          if (!still || still.dId !== legal.dId) return;
          this.botJobs.delete(seat);
          const r = this.dispatch(dec.action);
          if (!r.ok && r.error.code !== 'STALE_TURN') {
            // Defensive: a bot must never stall the table — fall back to the most passive legal move.
            for (const type of ['STAND', 'CHECK', 'FOLD', 'PASS']) if (this.dispatch({ type, seat }).ok) break;
          }
        });
      };
      this.botJobs.set(seat, { dId: legal.dId, handle: null });
      void run();
    }
  }
}
