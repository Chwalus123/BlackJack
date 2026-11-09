import { randomInt } from 'node:crypto';
import type { Scheduler, Seed } from '@casino/engine';
import { LIMITS, type GameKind, type RoomSettings, type RoomSummary } from '@casino/protocol';
import { adapters } from './adapters';
import { Room, type RoomIO } from './Room';

export interface RoomEnv {
  scheduler: Scheduler;
  entropy: () => Seed;
  seed: () => Seed;
  maxRooms: number;
  maxPlayers: number;
  maxSpectators: number;
  graceMs: number;
  emptyTtlMs: number;
  log: (msg: string, data?: Record<string, unknown>) => void;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private gcTimer: ReturnType<typeof setInterval>;
  private emptySince = new Map<string, number>();

  constructor(
    private readonly io: RoomIO,
    private readonly env: RoomEnv,
  ) {
    this.gcTimer = setInterval(() => this.gc(), 15000);
    this.gcTimer.unref?.();
  }

  private newCode(): string {
    const a = LIMITS.roomCodeAlphabet;
    for (;;) {
      let c = '';
      for (let i = 0; i < LIMITS.roomCodeLength; i++) c += a[randomInt(a.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create(hostId: string, name: string, visibility: 'public' | 'private', settings: RoomSettings): Room | 'TOO_MANY_ROOMS' | 'UNSUPPORTED' {
    if (this.rooms.size >= this.env.maxRooms) return 'TOO_MANY_ROOMS';
    const adapter = adapters[settings.game];
    if (!adapter) return 'UNSUPPORTED';
    const code = this.newCode();
    const room = new Room(code, name, visibility, settings, adapter, hostId, this.io, {
      scheduler: this.env.scheduler,
      entropy: this.env.entropy,
      seed: this.env.seed,
      maxPlayers: this.env.maxPlayers,
      maxSpectators: this.env.maxSpectators,
      graceMs: this.env.graceMs,
      log: this.env.log,
    });
    this.rooms.set(code, room);
    this.env.log('room created', { code, game: settings.game });
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  list(game?: GameKind): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.visibility === 'public' && !r.closed && (!game || r.game === game))
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 100)
      .map((r) => r.summary());
  }

  destroy(code: string): void {
    const r = this.rooms.get(code);
    if (!r) return;
    r.close();
    this.rooms.delete(code);
    this.emptySince.delete(code);
    this.env.log('room closed', { code });
  }

  /** Rooms with nobody connected for EMPTY_ROOM_TTL are destroyed. */
  gc(now = Date.now()): void {
    for (const [code, r] of this.rooms) {
      if (r.connectedCount() > 0) {
        this.emptySince.delete(code);
        continue;
      }
      const since = this.emptySince.get(code) ?? now;
      this.emptySince.set(code, since);
      if (now - since >= this.env.emptyTtlMs) this.destroy(code);
    }
  }

  dispose(): void {
    clearInterval(this.gcTimer);
    for (const code of [...this.rooms.keys()]) this.destroy(code);
  }
}
