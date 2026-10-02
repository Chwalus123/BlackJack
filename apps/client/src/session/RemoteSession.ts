import { io, type Socket } from 'socket.io-client';
import { signal } from '@preact/signals';
import {
  PROTOCOL_VERSION, type Ack, type ChatMsg, type ClientToServerEvents, type CreateRoomInput, type EventsBatch, type GameKind, type PrivateBatch,
  type RoomMeta, type RoomSnapshot, type RoomSummary, type ServerToClientEvents, type SessionInfo,
} from '@casino/protocol';
import type { Reveal, SeatId } from '@casino/engine';
import { loadJSON, saveJSON } from '../store/persist';
import { locale } from '../i18n';
import type { ActResult, GameSession, SessionMessage } from './types';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

export const nickname = signal<string | null>(loadJSON<string | null>('nickname', null));
export function setNickname(n: string): void {
  nickname.value = n;
  saveJSON('nickname', n);
}

/**
 * The connection to the multiplayer server. One socket for the whole app; the room's table is exposed as a
 * GameSession so the table UI is identical to single-player.
 */
export class Connection {
  readonly socket: Sock;
  readonly connected = signal(false);
  readonly session = signal<SessionInfo | null>(null);
  readonly meta = signal<RoomMeta | null>(null);
  readonly chat = signal<ChatMsg[]>([]);
  readonly notice = signal<{ kind: 'shutdown' | 'replaced' | 'kicked' | 'closed' | 'error'; detail?: string } | null>(null);
  private table: RemoteTable | null = null;

  constructor() {
    this.socket = io({
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      auth: (cb) =>
        cb({
          protocol: PROTOCOL_VERSION,
          token: loadJSON<string | null>('session', null) ?? undefined,
          nickname: nickname.value ?? undefined,
          locale: locale.value,
        }),
    });
    const s = this.socket;
    s.on('connect', () => (this.connected.value = true));
    s.on('disconnect', () => (this.connected.value = false));
    s.on('connect_error', (e) => {
      if (e.message === 'PROTOCOL_MISMATCH') this.notice.value = { kind: 'error', detail: 'PROTOCOL_MISMATCH' };
    });
    s.on('session', (info) => {
      if (info.token) saveJSON('session', info.token);
      this.session.value = info;
    });
    s.on('room:snapshot', (snap) => {
      this.meta.value = snap.meta;
      this.table?.onSnapshot(snap);
    });
    s.on('room:meta', (m) => (this.meta.value = m));
    s.on('game:events', (b) => this.table?.onEvents(b));
    s.on('game:private', (p) => this.table?.onPrivate(p));
    s.on('room:chat', (m) => (this.chat.value = [...this.chat.value.slice(-80), m]));
    s.on('room:kicked', (r) => {
      this.notice.value = { kind: r.reason };
      this.meta.value = null;
    });
    s.on('server:notice', (n) => (this.notice.value = { kind: n.kind }));
  }

  connect(): void {
    if (!this.socket.connected) this.socket.connect();
  }

  call<T>(ev: keyof ClientToServerEvents, payload: unknown, timeoutMs = 8000): Promise<Ack<T>> {
    return new Promise((resolve) => {
      if (!this.socket.connected) this.connect();
      (this.socket.timeout(timeoutMs).emit as (...a: unknown[]) => void)(ev, payload, (err: unknown, r: Ack<T>) =>
        resolve(err ? { ok: false, code: 'INTERNAL' } : r),
      );
    });
  }

  listRooms(game?: GameKind): Promise<Ack<RoomSummary[]>> {
    return this.call('lobby:list', game ? { game } : {});
  }

  async createRoom(input: CreateRoomInput): Promise<Ack<{ code: string }>> {
    return this.call('room:create', input);
  }

  async join(code: string): Promise<Ack<RoomSnapshot>> {
    this.chat.value = [];
    const r = await this.call<RoomSnapshot>('room:join', { code });
    if (r.ok) {
      this.meta.value = r.data.meta;
      this.table?.onSnapshot(r.data);
    }
    return r;
  }

  async leave(): Promise<void> {
    await this.call('room:leave', {});
    this.meta.value = null;
  }

  /** The table session for the current room (created once, reused across snapshots). */
  tableSession(game: GameKind): RemoteTable {
    if (!this.table || this.table.game !== game) {
      this.table?.dispose();
      this.table = new RemoteTable(this, game);
    }
    return this.table;
  }
}

let conn: Connection | null = null;
export function connection(): Connection {
  if (!conn) conn = new Connection();
  conn.connect();
  return conn;
}

/** GameSession over the socket: snapshot + ordered public batches + private reveals/legal. */
export class RemoteTable implements GameSession<unknown, unknown, unknown> {
  readonly mode = 'remote' as const;
  private listeners = new Set<(m: SessionMessage<unknown, unknown, unknown>) => void>();
  private eid = 0;
  private offset = 0;
  private resyncing = false;
  private buffered: EventsBatch[] = [];
  private privByEid = new Map<number, PrivateBatch>();
  private last: RoomSnapshot | null = null;
  legal: unknown = null;
  you: SeatId | null = null;

  constructor(
    private readonly conn: Connection,
    readonly game: GameKind,
  ) {}

  onSnapshot(s: RoomSnapshot): void {
    this.last = s;
    this.eid = s.eid;
    this.offset = s.serverNow - performance.now();
    this.legal = s.legal;
    this.you = s.you;
    this.privByEid.clear();
    this.emit({ kind: 'snapshot', view: s.view, legal: s.legal, you: s.you });
    const pending = this.buffered.filter((b) => b.eid > s.eid).sort((a, b) => a.eid - b.eid);
    this.buffered = [];
    this.resyncing = false;
    for (const b of pending) this.onEvents(b);
  }

  onPrivate(p: PrivateBatch): void {
    if (p.eid <= this.eid) {
      // Legal changed without a newer public batch (e.g. settings rebuilt): apply now.
      this.legal = p.legal;
      this.emit({ kind: 'legal', legal: p.legal });
      this.setYou(p.you);
      return;
    }
    this.privByEid.set(p.eid, p);
  }

  onEvents(b: EventsBatch): void {
    if (this.resyncing) {
      this.buffered.push(b);
      return;
    }
    if (b.eid <= this.eid) return;
    if (b.eid !== this.eid + 1) {
      this.buffered.push(b);
      void this.resync();
      return;
    }
    this.eid = b.eid;
    this.offset = b.serverNow - performance.now();
    const priv = this.privByEid.get(b.eid);
    this.privByEid.delete(b.eid);
    let reveals: Reveal[] = [];
    if (priv) {
      this.legal = priv.legal;
      reveals = priv.reveals;
    }
    this.emit({ kind: 'batch', pub: b.pub, reveals, legal: this.legal });
    if (priv) this.setYou(priv.you);
  }

  /**
   * The table learns the player's own seat from snapshots. Sitting down or standing up arrives as a private
   * batch instead, so fetch a fresh snapshot then: it carries the seat and the player's own hole cards.
   */
  private setYou(you: SeatId | null): void {
    if (you === this.you) return;
    this.you = you;
    if (this.last) void this.resync();
  }

  private async resync(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    const r = await this.conn.call<RoomSnapshot>('room:resync', {});
    if (r.ok) this.onSnapshot(r.data);
    else this.resyncing = false;
  }

  snapshotNow(): void {
    if (this.last) this.emit({ kind: 'snapshot', view: this.last.view, legal: this.legal, you: this.you });
  }

  private emit(m: SessionMessage<unknown, unknown, unknown>) {
    for (const l of this.listeners) l(m);
  }

  subscribe(fn: (m: SessionMessage<unknown, unknown, unknown>) => void): () => void {
    this.listeners.add(fn);
    // Late subscribers (the table mounts after the join) get a fresh snapshot right away.
    void this.resync();
    return () => this.listeners.delete(fn);
  }

  async act(action: { type: string } & Record<string, unknown>): Promise<ActResult> {
    const { type, amount, to, take, value, dId } = action as Record<string, unknown>;
    const payload: Record<string, unknown> = { type };
    if (typeof amount === 'number') payload.amount = amount;
    if (typeof to === 'number') payload.to = to;
    if (typeof take === 'boolean') payload.take = take;
    if (typeof value === 'boolean') payload.value = value;
    if (typeof dId === 'number') payload.dId = dId;
    const r = await this.conn.call('game:action', payload);
    return r.ok ? { ok: true } : { ok: false, error: { code: r.code } };
  }

  /** Server clock (deadlines in views are server time). */
  now(): number {
    return performance.now() + this.offset;
  }

  dispose(): void {
    this.listeners.clear();
  }
}
