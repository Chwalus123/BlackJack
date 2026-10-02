import { TableHost, type GameModule, type SeatId, type Batch, type BotDriver } from '@casino/engine';
import type { ActResult, GameKind, GameSession, SessionMessage } from './types';
import { cryptoSeed, realScheduler } from './scheduler';

type AnyModule = GameModule<any, any, any, any, any, any>;

export interface LocalSeatSpec {
  player: string;
  name: string;
  bot?: string;
  bankroll?: number;
}

/**
 * Single-player: the real engine runs in the browser behind the same TableHost the server uses. The human
 * has no decision clock; bots act after the table finishes presenting (presentation gate) plus think time.
 */
export class LocalSession<V, E, L extends { dId: number }> implements GameSession<V, E, L> {
  readonly mode = 'local' as const;
  readonly host: TableHost<AnyModule>;
  private listeners = new Set<(m: SessionMessage<V, E, L>) => void>();
  private gate: () => number = () => 0;
  humanSeat: SeatId | null = null;
  private lastLegal = 'null';

  constructor(
    readonly game: GameKind,
    private readonly module: AnyModule,
    rules: unknown,
    private readonly opts: {
      seats: LocalSeatSpec[];
      human: string;
      decide: BotDriver<any, any, any>['decide'];
      thinkScale: () => number;
      onState?: (state: any) => void;
      /** Hold'em seats people by JOIN, blackjack by SIT. */
      joinAction: 'SIT' | 'JOIN';
    },
  ) {
    const state = module.create(rules, cryptoSeed(), realScheduler.now());
    this.host = new TableHost(module, state, {
      scheduler: realScheduler,
      entropy: cryptoSeed,
      onBatch: (b) => this.onBatch(b),
      graceMs: 0,
      bots: {
        personaOf: (s, seat) => {
          const st = s as { seats: ({ id?: number; bot: string | null } | null)[] };
          if (module.id === 'holdem') return st.seats[seat]?.bot ?? null;
          return st.seats.find((x) => x && x.id === seat)?.bot ?? null;
        },
        decide: opts.decide,
        gate: () => this.gate(),
        thinkScale: opts.thinkScale,
      },
    });
  }

  /** Seat everybody and start the table. */
  start(): void {
    for (const s of this.opts.seats) {
      const r = this.host.dispatch({ type: this.opts.joinAction, player: s.player, name: s.name, bot: s.bot, bankroll: s.bankroll, buyIn: s.bankroll });
      if (!r.ok) console.warn('seat failed', s, r.error);
    }
    this.humanSeat = this.findHuman();
    this.host.start();
    this.emit({ kind: 'snapshot', view: this.view(), legal: this.legal(), you: this.humanSeat });
  }

  private findHuman(): SeatId | null {
    const st = this.host.state as { seats: ({ id?: number; player: string } | null)[] };
    if (this.module.id === 'holdem') {
      const i = st.seats.findIndex((s) => s?.player === this.opts.human);
      return i >= 0 ? i : null;
    }
    return (st.seats.find((s) => s?.player === this.opts.human) as { id: number } | undefined)?.id ?? null;
  }

  view(): V {
    return this.module.view(this.host.state, this.humanSeat == null ? { kind: 'spectator' } : { kind: 'seat', seat: this.humanSeat });
  }

  legal(): L | null {
    return this.humanSeat == null ? null : (this.module.legal(this.host.state, this.humanSeat) as L | null);
  }

  private onBatch(b: Batch<any, any>) {
    if (this.humanSeat == null) this.humanSeat = this.findHuman();
    const reveals = b.priv.filter((r) => r.seat === this.humanSeat);
    const legal = this.legal();
    this.lastLegal = JSON.stringify(legal);
    this.emit({ kind: 'batch', pub: b.pub as E[], reveals, legal });
    this.opts.onState?.(b.state);
  }

  private emit(m: SessionMessage<V, E, L>) {
    for (const l of this.listeners) l(m);
  }

  subscribe(fn: (m: SessionMessage<V, E, L>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async act(action: { type: string } & Record<string, unknown>): Promise<ActResult> {
    if (this.humanSeat == null) return { ok: false, error: { code: 'UNKNOWN_SEAT' } };
    const r = this.host.dispatch({ ...action, seat: this.humanSeat });
    if (r.ok) {
      // Legal can change without events in rare cases (e.g. a rejected-then-retried state); keep the HUD current.
      const legal = this.legal();
      const s = JSON.stringify(legal);
      if (s !== this.lastLegal) {
        this.lastLegal = s;
        this.emit({ kind: 'legal', legal });
      }
    }
    return r;
  }

  setPresentationGate(fn: () => number): void {
    this.gate = fn;
  }

  now(): number {
    return realScheduler.now();
  }

  dispose(): void {
    this.host.dispose();
    this.listeners.clear();
  }
}
