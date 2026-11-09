import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { z } from 'zod';
import {
  ChatInput, CreateRoomInput, GameAction, HandshakeAuth, JoinRoomInput, KickInput, PauseInput, PROTOCOL_VERSION, SettingsPatch,
  type Ack, type ClientToServerEvents, type ErrorCode, type ServerToClientEvents, type SessionInfo,
} from '@casino/protocol';
import { normalizeText, NICKNAME_RE, LIMITS } from '@casino/protocol';
import type { Config } from './config';
import type { RoomManager } from './rooms/RoomManager';
import type { Room } from './rooms/Room';
import { SessionStore, type Session } from './sessions';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { session: Session; ip: string }>;

export interface IoDeps {
  cfg: Config;
  rooms: () => RoomManager;
  sessions: SessionStore;
  draining: () => boolean;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

const err = (code: ErrorCode): { ok: false; code: ErrorCode } => ({ ok: false, code });

/** Validate → rate-limit → run. Every inbound message goes through here; payloads are never spread into state. */
function handler<S extends z.ZodTypeAny, T>(
  socket: Sock,
  schema: S | null,
  fn: (input: z.infer<S>, s: Session) => Ack<T> | Promise<Ack<T>>,
  opts?: { host?: boolean },
) {
  return async (payload: unknown, ack: unknown) => {
    const reply = typeof ack === 'function' ? (ack as (r: Ack<T>) => void) : () => undefined;
    const s = socket.data.session;
    s.lastSeen = Date.now();
    if (!s.bucket.take() || (opts?.host && !s.hostBucket.take())) {
      s.violations++;
      if (s.violations > 100) socket.disconnect(true);
      return reply(err('RATE_LIMITED'));
    }
    let input: unknown = payload ?? {};
    if (schema) {
      const p = schema.safeParse(payload ?? {});
      if (!p.success) return reply(err('BAD_REQUEST'));
      input = p.data;
    }
    try {
      reply(await fn(input as z.infer<S>, s));
    } catch (e) {
      reply(err('INTERNAL'));
      throw e;
    }
  };
}

export function attachIo(http: HttpServer, deps: IoDeps): IO {
  const { cfg, sessions } = deps;
  const devOrigins = cfg.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://localhost:3000'];
  const allowed = new Set([...(cfg.PUBLIC_ORIGIN ? [cfg.PUBLIC_ORIGIN] : []), ...devOrigins]);
  const io: IO = new Server(http, {
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20000,
    pingTimeout: 20000,
    serveClient: false,
    cors: { origin: (origin, cb) => cb(null, !origin || allowed.has(origin)) },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      // Same-origin (served by this process or behind the reverse proxy) is always fine.
      const same = !origin || (host && (origin === `https://${host}` || origin === `http://${host}`));
      cb(null, !!same || (!!origin && allowed.has(origin)));
    },
  });

  const perIp = new Map<string, number>();
  const ipOf = (s: Socket) => {
    const fwd = cfg.trustProxy ? String(s.handshake.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() : '';
    return fwd || s.handshake.address || 'unknown';
  };

  io.use((socket, next) => {
    if (deps.draining()) return next(new Error('SERVER_DRAINING'));
    if (io.engine.clientsCount > cfg.MAX_CONNECTIONS) return next(new Error('RATE_LIMITED'));
    const ip = ipOf(socket);
    const n = perIp.get(ip) ?? 0;
    if (n >= cfg.CONNECTIONS_PER_IP) return next(new Error('RATE_LIMITED'));
    const auth = HandshakeAuth.safeParse(socket.handshake.auth ?? {});
    if (!auth.success) {
      const proto = (socket.handshake.auth as { protocol?: unknown } | undefined)?.protocol;
      return next(new Error(proto !== PROTOCOL_VERSION ? 'PROTOCOL_MISMATCH' : 'BAD_REQUEST'));
    }
    let session = sessions.resume(auth.data.token);
    let token = auth.data.token;
    if (!session) {
      const created = sessions.create(auth.data.locale);
      session = created.session;
      token = created.token;
    }
    if (auth.data.nickname) session.nickname = auth.data.nickname;
    session.locale = auth.data.locale;
    (socket as Sock).data.session = session;
    (socket as Sock).data.ip = ip;
    (socket.data as { token?: string }).token = token;
    perIp.set(ip, n + 1);
    next();
  });

  io.on('connection', (raw) => {
    const socket = raw as Sock;
    const s = socket.data.session;
    const token = (socket.data as { token?: string }).token!;
    // One live socket per session: the older tab is told it was replaced.
    if (s.socket && s.socket.id !== socket.id) {
      s.socket.emit('server:notice', { kind: 'replaced' });
      s.socket.disconnect(true);
    }
    s.socket = socket;
    void socket.join(`p:${s.playerId}`);
    const info: SessionInfo = { playerId: s.playerId, token, nickname: s.nickname };
    socket.emit('session', info);

    // Re-attach to the room after a refresh/reconnect.
    const current = s.roomCode ? deps.rooms().get(s.roomCode) : undefined;
    if (current && current.members.has(s.playerId)) {
      void socket.join(`t:${current.code}`);
      current.reconnect(s.playerId);
      socket.emit('room:snapshot', current.snapshot(s.playerId));
    } else s.roomCode = null;

    const roomOf = (): Room | null => (s.roomCode ? deps.rooms().get(s.roomCode) ?? null : null);

    socket.on(
      'session:nickname',
      handler(socket, null, (raw) => {
        const p = raw as { nickname?: unknown } | null;
        const n = normalizeText(String(p?.nickname ?? ''));
        if (n.length < LIMITS.nickname.min || n.length > LIMITS.nickname.max || !NICKNAME_RE.test(n)) return err('NICKNAME');
        s.nickname = n;
        return { ok: true, data: { playerId: s.playerId, token: '', nickname: n } };
      }),
    );

    socket.on(
      'lobby:list',
      handler(socket, null, (raw) => {
        const p = raw as { game?: unknown } | null;
        const g = p?.game === 'blackjack' || p?.game === 'holdem' ? p.game : undefined;
        return { ok: true, data: deps.rooms().list(g) };
      }),
    );

    socket.on(
      'room:create',
      handler(socket, CreateRoomInput, (input) => {
        if (deps.draining()) return err('SERVER_DRAINING');
        if (!s.nickname) return err('NICKNAME');
        const prev = roomOf();
        if (prev) leaveRoom(prev);
        const room = deps.rooms().create(s.playerId, input.name, input.visibility, input.settings);
        if (room === 'TOO_MANY_ROOMS') return err('TOO_MANY_ROOMS');
        if (room === 'UNSUPPORTED') return err('BAD_REQUEST');
        return { ok: true, data: { code: room.code } };
      }),
    );

    socket.on(
      'room:join',
      handler(socket, JoinRoomInput, (input) => {
        if (!s.nickname) return err('NICKNAME');
        const room = deps.rooms().get(input.code);
        if (!room || room.closed) return err('ROOM_NOT_FOUND');
        const prev = roomOf();
        if (prev && prev !== room) leaveRoom(prev);
        const r = room.join(s.playerId, s.nickname);
        if (!r.ok) return r;
        s.roomCode = room.code;
        void socket.join(`t:${room.code}`);
        return { ok: true, data: room.snapshot(s.playerId) };
      }),
    );

    const leaveRoom = (room: Room) => {
      room.leave(s.playerId);
      void socket.leave(`t:${room.code}`);
      s.roomCode = null;
    };

    socket.on(
      'room:leave',
      handler(socket, null, () => {
        const room = roomOf();
        if (room) leaveRoom(room);
        return { ok: true, data: undefined };
      }),
    );

    socket.on(
      'room:resync',
      handler(socket, null, () => {
        const room = roomOf();
        if (!room) return err('NOT_IN_ROOM');
        return { ok: true, data: room.snapshot(s.playerId) };
      }),
    );

    socket.on(
      'room:chat',
      handler(socket, ChatInput, (input) => {
        const room = roomOf();
        if (!room) return err('NOT_IN_ROOM');
        return wrap(room.chat(s.playerId, input.text));
      }),
    );

    socket.on('seat:sit', handler(socket, null, () => withRoom((r) => r.sit(s.playerId))));
    socket.on('seat:stand', handler(socket, null, () => withRoom((r) => r.stand(s.playerId))));
    socket.on('game:action', handler(socket, GameAction, (a) => withRoom((r) => r.action(s.playerId, a))));
    socket.on('host:start', handler(socket, null, () => withRoom((r) => r.start(s.playerId)), { host: true }));
    socket.on('host:pause', handler(socket, PauseInput, (p) => withRoom((r) => r.pause(s.playerId, p.value)), { host: true }));
    socket.on('host:kick', handler(socket, KickInput, (p) => withRoom((r) => r.kick(s.playerId, p.playerId)), { host: true }));
    socket.on('host:settings', handler(socket, SettingsPatch, (p) => withRoom((r) => r.updateSettings(s.playerId, p.settings)), { host: true }));
    socket.on(
      'host:close',
      handler(
        socket,
        null,
        () => {
          const room = roomOf();
          if (!room) return err('NOT_IN_ROOM');
          if (room.hostId !== s.playerId) return err('NOT_HOST');
          deps.rooms().destroy(room.code);
          return { ok: true, data: undefined };
        },
        { host: true },
      ),
    );

    function withRoom(fn: (r: Room) => { ok: true } | { ok: false; code: ErrorCode }): Ack {
      const room = roomOf();
      if (!room) return err('NOT_IN_ROOM');
      return wrap(fn(room));
    }

    socket.on('disconnect', () => {
      const ip = socket.data.ip;
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
      if (perIp.get(ip) === 0) perIp.delete(ip);
      if (s.socket?.id !== socket.id) return;
      s.socket = null;
      s.lastSeen = Date.now();
      roomOf()?.disconnect(s.playerId);
    });
  });

  return io;
}

function wrap(r: { ok: true } | { ok: false; code: ErrorCode }): Ack {
  return r.ok ? { ok: true, data: undefined } : r;
}
