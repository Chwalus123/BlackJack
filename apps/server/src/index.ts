import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type { Scheduler, Seed } from '@casino/engine';
import { loadConfig, type Config } from './config';
import { buildHttp } from './http';
import { attachIo } from './io';
import { RoomManager } from './rooms/RoomManager';
import { SessionStore } from './sessions';

export const serverScheduler: Scheduler = {
  now: () => performance.timeOrigin + performance.now(),
  at: (t, fn) => {
    const h = setTimeout(fn, Math.max(0, t - (performance.timeOrigin + performance.now())));
    h.unref?.();
    return h;
  },
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const cryptoSeed = (): Seed => Array.from({ length: 8 }, () => randomBytes(4).readUInt32LE(0));

export interface RunningServer {
  port: number;
  url: string;
  rooms: RoomManager;
  close(): Promise<void>;
  drain(): Promise<void>;
}

export async function startServer(overrides: Partial<Config> = {}, opts: { seed?: () => Seed; scheduler?: Scheduler } = {}): Promise<RunningServer> {
  const cfg = { ...loadConfig(), ...overrides } as Config;
  const sessions = new SessionStore();
  let draining = false;
  const startedAt = Date.now();

  const app = await buildHttp(cfg, () => ({
    ok: !draining,
    rooms: rooms.rooms.size,
    connections: io.engine.clientsCount,
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
  }));
  const log = app.log;

  const io = attachIo(app.server, { cfg, rooms: () => rooms, sessions, draining: () => draining, log });

  const rooms: RoomManager = new RoomManager(
    {
      publish: (code, b) => io.to(`t:${code}`).emit('game:events', b),
      whisper: (pid, p) => io.to(`p:${pid}`).emit('game:private', p),
      meta: (code, m) => io.to(`t:${code}`).emit('room:meta', m),
      chat: (code, m) => io.to(`t:${code}`).emit('room:chat', m),
      kicked: (pid, reason) => {
        io.to(`p:${pid}`).emit('room:kicked', { reason });
        const s = sessions.get(pid);
        if (s) {
          if (s.socket && s.roomCode) void s.socket.leave(`t:${s.roomCode}`);
          s.roomCode = null;
        }
      },
    },
    {
      scheduler: opts.scheduler ?? serverScheduler,
      entropy: cryptoSeed,
      seed: opts.seed ?? cryptoSeed,
      maxRooms: cfg.MAX_ROOMS,
      maxPlayers: cfg.MAX_PLAYERS_PER_ROOM,
      maxSpectators: cfg.MAX_SPECTATORS_PER_ROOM,
      graceMs: cfg.RECONNECT_GRACE_MS,
      emptyTtlMs: cfg.EMPTY_ROOM_TTL_MS,
      log: (msg, data) => log.info(data ?? {}, msg),
    },
  );

  const sweep = setInterval(() => sessions.sweep(6 * 3600_000), 600_000);
  sweep.unref();

  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.PORT;
  log.info({ port, staticDir: cfg.staticDir }, 'Jacbos Casino server listening');

  const close = async () => {
    clearInterval(sweep);
    rooms.dispose();
    await new Promise<void>((r) => io.close(() => r()));
    await app.close().catch(() => undefined);
  };

  /** Graceful shutdown: refuse new work, tell players, give running hands time to finish, then stop. */
  const drain = async () => {
    if (draining) return;
    draining = true;
    io.emit('server:notice', { kind: 'shutdown' });
    const deadline = Date.now() + cfg.DRAIN_TIMEOUT_MS;
    while (Date.now() < deadline && [...rooms.rooms.values()].some((r) => r.adapter.inHand(r.host.state))) {
      await new Promise((r) => setTimeout(r, 250));
    }
    await close();
  };

  return { port, url: `http://localhost:${port}`, rooms, close, drain };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  startServer()
    .then((srv) => {
      const stop = (sig: string) => {
        console.log(`${sig} received — draining`);
        void srv.drain().then(() => process.exit(0));
      };
      process.on('SIGTERM', () => stop('SIGTERM'));
      process.on('SIGINT', () => stop('SIGINT'));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
