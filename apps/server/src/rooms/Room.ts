import { TableHost, type Batch, type Money, type Reveal, type Scheduler, type Seed, type SeatId } from '@casino/engine';
import type {
  ChatMsg, ErrorCode, EventsBatch, GameAction, MemberInfo, PrivateBatch, RoomMeta, RoomSettings, RoomSnapshot, RoomStatus, RoomSummary,
} from '@casino/protocol';
import { stakeLabel } from '@casino/protocol';
import type { GameAdapter } from './adapters';

export interface RoomIO {
  /** Public batch to everyone in the room. */
  publish(code: string, b: EventsBatch): void;
  /** Private message to one player. */
  whisper(playerId: string, p: PrivateBatch): void;
  meta(code: string, m: RoomMeta): void;
  chat(code: string, m: ChatMsg): void;
  kicked(playerId: string, reason: 'kicked' | 'closed'): void;
}

interface Member {
  id: string;
  nickname: string;
  connected: boolean;
  joinedAt: number;
  grace: ReturnType<typeof setTimeout> | null;
  wantsSeat: boolean;
}

/** Events after which any player's legal actions may have changed. */
const COALESCE_ABOVE = 24;
const COALESCE_MS = 100;
const GLOBAL_EVENTS = new Set(['Phase', 'RoundStarted', 'TurnStarted', 'InsuranceOffered', 'Paused', 'SeatJoined', 'SeatLeft', 'CardsCollected']);

export type RoomResult = { ok: true } | { ok: false; code: ErrorCode };
const fail = (code: ErrorCode): RoomResult => ({ ok: false, code });
const OK: RoomResult = { ok: true };

/**
 * One multiplayer table: members (players + spectators), the host, the spectator queue (Hold'em), a chip
 * ledger for people who leave their seat, and the authoritative engine running in a TableHost.
 */
export class Room {
  readonly createdAt = Date.now();
  status: RoomStatus = 'waiting';
  hostId: string;
  members = new Map<string, Member>();
  queue: string[] = [];
  ledger = new Map<string, Money>();
  host: TableHost<any>;
  eid = 0;
  lastActivity = Date.now();
  private lastLegal = new Map<string, string>();
  private metaTimer: ReturnType<typeof setTimeout> | null = null;
  private chatSeq = 0;
  closed = false;

  constructor(
    readonly code: string,
    public name: string,
    readonly visibility: 'public' | 'private',
    public settings: RoomSettings,
    readonly adapter: GameAdapter,
    hostId: string,
    private readonly io: RoomIO,
    private readonly env: {
      scheduler: Scheduler;
      entropy: () => Seed;
      seed: () => Seed;
      maxPlayers: number;
      maxSpectators: number;
      graceMs: number;
      log: (msg: string, data?: Record<string, unknown>) => void;
    },
  ) {
    this.hostId = hostId;
    this.host = null as unknown as TableHost<any>;
    this.createHost();
  }

  get game() {
    return this.settings.game;
  }

  /** A fresh engine for the current settings; it stays paused until the host starts the game. */
  private createHost(): void {
    const m = this.adapter.module;
    const state = m.create(this.adapter.rules(this.settings, this.env.maxPlayers), this.env.seed(), this.env.scheduler.now());
    this.host = new TableHost(m, state, {
      scheduler: this.env.scheduler,
      entropy: this.env.entropy,
      onBatch: (b) => this.onBatch(b),
      // Validate-then-mutate in place: no full-state copy per action (property-tested in the engine).
      inPlace: true,
    });
    this.host.dispatch({ type: 'PAUSE', value: true });
    this.host.start();
  }

  // ───────────── broadcasting ─────────────

  private pending: { pub: unknown[]; priv: Reveal[] } | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Engine output arrives here. Big tables coalesce batches (≈100 ms) to cut fan-out; small ones send at once. */
  private onBatch(b: Batch<any, any>): void {
    this.lastActivity = Date.now();
    // Chips of seats that cashed out go to the room ledger so rejoining never resets anyone's chips.
    for (const ev of b.pub as { e: string; reason?: string; from?: { k: string; seat?: SeatId }; amount?: number; seat?: unknown }[]) {
      if (ev.e === 'ChipsMoved' && ev.reason === 'cashOut' && ev.from?.k === 'stack') {
        const p = this.seatPlayer.get(ev.from.seat!);
        if (p) this.ledger.set(p, (this.ledger.get(p) ?? 0) + (ev.amount ?? 0));
      }
      if (ev.e === 'SeatJoined') {
        const sv = ev.seat as { id: SeatId; player: string };
        this.seatPlayer.set(sv.id, sv.player);
      }
    }
    if (!this.pending) this.pending = { pub: [], priv: [] };
    this.pending.pub.push(...b.pub);
    this.pending.priv.push(...b.priv);
    if (this.members.size <= COALESCE_ABOVE) this.flush();
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), COALESCE_MS);
  }

  /** Send everything accumulated since the last flush: private parts first, then one public batch. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.pending;
    if (!batch || this.closed) return;
    this.pending = null;
    this.eid++;
    const st = this.host.state;
    const pub = batch.pub as Record<string, unknown>[];
    const byPlayer = new Map<string, Reveal[]>();
    for (const r of batch.priv) {
      const p = this.adapter.playerOf(st, r.seat) ?? this.seatPlayer.get(r.seat);
      if (p) byPlayer.set(p, [...(byPlayer.get(p) ?? []), r]);
    }
    // Legal actions only change for seats an event touches, unless the table-wide state moved on.
    const global = this.game === 'holdem' || pub.some((e) => GLOBAL_EVENTS.has(e.e as string));
    const touched = new Set<string>();
    if (!global) {
      for (const ev of pub) {
        for (const v of [ev.seat, (ev.to as { seat?: number })?.seat, (ev.from as { seat?: number })?.seat]) {
          if (typeof v === 'number') {
            const p = this.adapter.playerOf(st, v) ?? this.seatPlayer.get(v);
            if (p) touched.add(p);
          }
        }
      }
    }
    for (const [pid, member] of this.members) {
      if (!member.connected) continue;
      if (!global && !touched.has(pid) && !byPlayer.has(pid)) continue;
      const seat = this.adapter.seatOf(st, pid);
      const legal = seat == null ? null : this.adapter.module.legal(st, seat);
      const key = JSON.stringify([seat, legal]);
      const reveals = byPlayer.get(pid) ?? [];
      if (reveals.length || key !== this.lastLegal.get(pid)) {
        this.lastLegal.set(pid, key);
        this.io.whisper(pid, { eid: this.eid, reveals, legal, you: seat });
      }
    }
    this.io.publish(this.code, { eid: this.eid, pub, serverNow: this.env.scheduler.now() });
    for (const ev of pub) if (ev.e === 'SeatLeft' && typeof ev.seat === 'number') this.seatPlayer.delete(ev.seat);
    if (pub.some((e) => e.e === 'SeatJoined' || e.e === 'SeatLeft' || e.e === 'Phase')) {
      this.updateStatusFromEngine();
      this.fillFromQueue();
      this.scheduleMeta();
    }
  }

  private seatPlayer = new Map<SeatId, string>();

  private updateStatusFromEngine(): void {
    const st = this.host.state as { paused: boolean; phase: string };
    if (this.status === 'running' && st.paused && (st.phase === 'idle' || st.phase === 'waiting')) this.status = 'paused';
  }

  scheduleMeta(): void {
    if (this.metaTimer) return;
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      if (!this.closed) this.io.meta(this.code, this.meta());
    }, 120);
  }

  meta(): RoomMeta {
    const members: MemberInfo[] = [...this.members.values()].map((m) => ({
      id: m.id,
      nickname: m.nickname,
      seat: this.adapter.seatOf(this.host.state, m.id),
      connected: m.connected,
      queued: this.queue.includes(m.id),
    }));
    return {
      code: this.code,
      name: this.name,
      game: this.game,
      visibility: this.visibility,
      hostId: this.hostId,
      status: this.status,
      settings: this.settings,
      members,
      queue: [...this.queue],
    };
  }

  summary(): RoomSummary {
    const players = this.adapter.seatedCount(this.host.state);
    return {
      code: this.code,
      name: this.name,
      game: this.game,
      status: this.status,
      players,
      spectators: Math.max(0, this.members.size - players),
      stakeLabel: stakeLabel(this.settings),
      maxSeats: this.settings.game === 'holdem' ? this.settings.maxSeats : this.env.maxPlayers || null,
    };
  }

  snapshot(playerId: string | null): RoomSnapshot {
    this.flush(); // the snapshot must not include events that have not been given an eid yet
    const st = this.host.state;
    const seat = playerId ? this.adapter.seatOf(st, playerId) : null;
    const m = this.adapter.module;
    if (playerId) this.lastLegal.set(playerId, JSON.stringify([seat, seat == null ? null : m.legal(st, seat)]));
    return {
      meta: this.meta(),
      view: m.view(st, seat == null ? { kind: 'spectator' } : { kind: 'seat', seat }),
      legal: seat == null ? null : m.legal(st, seat),
      you: seat,
      eid: this.eid,
      serverNow: this.env.scheduler.now(),
    };
  }

  // ───────────── membership ─────────────

  join(playerId: string, nickname: string): RoomResult {
    const existing = this.members.get(playerId);
    if (existing) {
      existing.nickname = nickname;
      this.reconnect(playerId);
      return OK;
    }
    const spectators = [...this.members.keys()].filter((id) => this.adapter.seatOf(this.host.state, id) == null).length;
    if (this.env.maxSpectators > 0 && spectators >= this.env.maxSpectators) return fail('ROOM_FULL');
    this.members.set(playerId, { id: playerId, nickname, connected: true, joinedAt: Date.now(), grace: null, wantsSeat: false });
    this.scheduleMeta();
    return OK;
  }

  /** Take a seat (blackjack: always, unless capped; Hold'em: a free seat or the queue). */
  sit(playerId: string): RoomResult {
    const m = this.members.get(playerId);
    if (!m) return fail('NOT_IN_ROOM');
    const st = this.host.state;
    if (this.adapter.seatOf(st, playerId) != null) return fail('ALREADY_SEATED');
    if (this.adapter.freeSeats(st) <= 0) {
      if (this.game !== 'holdem') return fail('ROOM_FULL');
      if (!this.queue.includes(playerId)) this.queue.push(playerId);
      m.wantsSeat = true;
      this.scheduleMeta();
      return OK;
    }
    return this.seat(m);
  }

  private seat(m: Member): RoomResult {
    // Returning players bring back what they left with; broke players may rebuy only if the host allows it.
    let chips = this.ledger.get(m.id);
    const minimum = this.settings.game === 'blackjack' ? this.settings.stake : this.settings.bb;
    if (chips == null) chips = this.adapter.buyIn(this.settings);
    else if (chips < minimum) {
      if (this.settings.rebuy !== 'whenBroke') return fail('INSUFFICIENT_FUNDS');
      chips += this.adapter.buyIn(this.settings);
    }
    const r = this.host.dispatch(this.adapter.sitAction(m.id, m.nickname, chips));
    if (!r.ok) return fail(r.error.code as ErrorCode);
    this.ledger.delete(m.id);
    this.queue = this.queue.filter((x) => x !== m.id);
    m.wantsSeat = false;
    this.scheduleMeta();
    return OK;
  }

  /** Seat queued spectators while there are free seats (connected ones only; others keep their place). */
  fillFromQueue(): void {
    for (const pid of [...this.queue]) {
      if (this.adapter.freeSeats(this.host.state) <= 0) return;
      const m = this.members.get(pid);
      if (!m) {
        this.queue = this.queue.filter((x) => x !== pid);
        continue;
      }
      if (!m.connected) continue;
      this.seat(m);
    }
  }

  stand(playerId: string): RoomResult {
    this.queue = this.queue.filter((x) => x !== playerId);
    const seat = this.adapter.seatOf(this.host.state, playerId);
    if (seat == null) {
      this.scheduleMeta();
      return OK;
    }
    const r = this.host.dispatch({ type: 'LEAVE', seat });
    this.scheduleMeta();
    return r.ok ? OK : fail(r.error.code as ErrorCode);
  }

  leave(playerId: string): void {
    this.stand(playerId);
    const m = this.members.get(playerId);
    if (m?.grace) clearTimeout(m.grace);
    this.members.delete(playerId);
    this.lastLegal.delete(playerId);
    if (playerId === this.hostId) this.migrateHost();
    this.scheduleMeta();
  }

  disconnect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    m.connected = false;
    const seat = this.adapter.seatOf(this.host.state, playerId);
    if (seat != null) this.host.dispatch({ type: 'SET_AWAY', seat, away: true });
    if (m.grace) clearTimeout(m.grace);
    m.grace = setTimeout(() => {
      m.grace = null;
      if (m.connected) return;
      this.stand(playerId);
      if (playerId === this.hostId) this.migrateHost();
      this.scheduleMeta();
    }, this.env.graceMs);
    this.scheduleMeta();
  }

  reconnect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    m.connected = true;
    if (m.grace) {
      clearTimeout(m.grace);
      m.grace = null;
    }
    const seat = this.adapter.seatOf(this.host.state, playerId);
    if (seat != null) this.host.dispatch({ type: 'SET_AWAY', seat, away: false });
    this.lastLegal.delete(playerId);
    this.fillFromQueue();
    this.scheduleMeta();
  }

  private migrateHost(): void {
    const candidates = [...this.members.values()].filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const seated = candidates.find((m) => this.adapter.seatOf(this.host.state, m.id) != null);
    const next = seated ?? candidates[0];
    if (next) {
      this.hostId = next.id;
      this.chatSystem(`host:${next.nickname}`);
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.connected) n++;
    return n;
  }

  // ───────────── gameplay ─────────────

  action(playerId: string, a: GameAction): RoomResult {
    const seat = this.adapter.seatOf(this.host.state, playerId);
    if (seat == null) return fail('UNKNOWN_SEAT');
    if (a.type === 'LEAVE') return this.stand(playerId);
    const action = this.adapter.intent(a, seat, this.settings);
    if (!action) return fail('BAD_REQUEST');
    const r = this.host.dispatch(action);
    return r.ok ? OK : fail(r.error.code as ErrorCode);
  }

  // ───────────── host powers ─────────────

  start(by: string): RoomResult {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (this.adapter.seatedCount(this.host.state) < this.adapter.minPlayers) return fail('NEED_PLAYERS');
    const r = this.host.dispatch({ type: 'PAUSE', value: false });
    if (!r.ok) return fail(r.error.code as ErrorCode);
    this.status = 'running';
    this.scheduleMeta();
    return OK;
  }

  pause(by: string, value: boolean): RoomResult {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (!value) return this.start(by);
    const r = this.host.dispatch({ type: 'PAUSE', value: true });
    if (!r.ok) return fail(r.error.code as ErrorCode);
    this.status = 'paused';
    this.updateStatusFromEngine();
    this.scheduleMeta();
    return OK;
  }

  kick(by: string, target: string): RoomResult {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (target === this.hostId || !this.members.has(target)) return fail('BAD_REQUEST');
    // A kick never forces a fold/stand: the seat leaves when the hand ends.
    this.leave(target);
    this.io.kicked(target, 'kicked');
    return OK;
  }

  updateSettings(by: string, settings: RoomSettings): RoomResult {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (settings.game !== this.game) return fail('BAD_REQUEST');
    if (this.status === 'running' || this.adapter.inHand(this.host.state)) return fail('BAD_PHASE');
    // Rebuild the table with the new rules; seated players keep their chips.
    const st = this.host.state as { seats: unknown[] };
    const seated = [...this.members.values()].filter((m) => this.adapter.seatOf(st, m.id) != null);
    const stacks = new Map<string, Money>();
    for (const m of seated) {
      const seat = this.adapter.seatOf(st, m.id)!;
      const s = (this.adapter.module.view(st, { kind: 'spectator' }) as { seats: ({ id?: number; stack: number } | null)[] }).seats;
      const sv = this.game === 'holdem' ? s[seat] : s.find((x) => x?.id === seat);
      stacks.set(m.id, sv?.stack ?? 0);
    }
    this.host.dispose();
    this.settings = settings;
    this.seatPlayer.clear();
    this.createHost();
    for (const m of seated) {
      const chips = stacks.get(m.id) ?? this.adapter.buyIn(settings);
      this.host.dispatch(this.adapter.sitAction(m.id, m.nickname, chips));
    }
    for (const pid of this.members.keys()) this.io.whisper(pid, { eid: this.eid, reveals: [], legal: null, you: null });
    this.eid++;
    this.scheduleMeta();
    return OK;
  }

  close(reason: 'closed' = 'closed'): void {
    if (this.closed) return;
    this.host.dispatch({ type: 'ABORT' });
    this.closed = true;
    this.host.dispose();
    for (const m of this.members.values()) {
      if (m.grace) clearTimeout(m.grace);
      this.io.kicked(m.id, reason);
    }
    if (this.metaTimer) clearTimeout(this.metaTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.members.clear();
  }

  // ───────────── chat ─────────────

  chat(playerId: string, text: string): RoomResult {
    const m = this.members.get(playerId);
    if (!m) return fail('NOT_IN_ROOM');
    this.io.chat(this.code, { id: ++this.chatSeq, from: playerId, nickname: m.nickname, text, at: Date.now() });
    return OK;
  }

  private chatSystem(text: string): void {
    this.io.chat(this.code, { id: ++this.chatSeq, from: 'system', nickname: '', text, at: Date.now() });
  }
}
