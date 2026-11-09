import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { bj, CHIP } from '@casino/engine';
import { PROTOCOL_VERSION, type Ack, type ClientToServerEvents, type RoomSnapshot, type ServerToClientEvents, type SessionInfo } from '@casino/protocol';
import { startServer, type RunningServer } from '../src/index';

type C = Socket<ServerToClientEvents, ClientToServerEvents>;

let srv: RunningServer;

beforeAll(async () => {
  srv = await startServer({ PORT: 0, HOST: '127.0.0.1', LOG_LEVEL: 'silent', RECONNECT_GRACE_MS: 2000, STATIC_DIR: '/nonexistent' } as never, { seed: () => [1, 2, 3, 4, 5, 6, 7, 8] });
});
afterAll(async () => {
  await srv.close();
});

interface Client {
  s: C;
  info: SessionInfo;
  events: { eid: number; pub: { e: string; [k: string]: unknown }[] }[];
  privates: { eid: number; legal: unknown; reveals: unknown[]; you: number | null }[];
  metas: unknown[];
  raw: unknown[];
}

async function connect(nickname: string, token?: string): Promise<Client> {
  const s: C = ioc(srv.url, { transports: ['websocket'], auth: { protocol: PROTOCOL_VERSION, nickname, locale: 'pl', ...(token ? { token } : {}) }, forceNew: true });
  const c: Client = { s, info: null as never, events: [], privates: [], metas: [], raw: [] };
  s.onAny((ev, ...args) => c.raw.push([ev, ...args]));
  s.on('game:events', (b) => c.events.push(b as Client['events'][number]));
  s.on('game:private', (p) => c.privates.push(p as Client['privates'][number]));
  s.on('room:meta', (m) => c.metas.push(m));
  c.info = await new Promise<SessionInfo>((res, rej) => {
    s.once('session', res);
    s.once('connect_error', rej);
  });
  return c;
}

function call<T>(c: Client, ev: keyof ClientToServerEvents, payload: unknown): Promise<Ack<T>> {
  return new Promise((res) => (c.s.emit as (...a: unknown[]) => void)(ev, payload, res));
}

const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('multiplayer blackjack server', () => {
  it('rejects bad handshakes', async () => {
    const s = ioc(srv.url, { transports: ['websocket'], auth: { protocol: 999 }, forceNew: true });
    const e = await new Promise<Error>((res) => s.once('connect_error', res));
    expect(e.message).toBe('PROTOCOL_MISMATCH');
    s.close();
  });

  it('host creates a room, a friend joins by code, both play a fixed-stake round', async () => {
    const a = await connect('Ania');
    const b = await connect('Bartek');
    const created = await call<{ code: string }>(a, 'room:create', {
      name: 'Stół Ani',
      visibility: 'public',
      settings: { game: 'blackjack', stake: 25 * CHIP, bankrollMultiple: 50, decisionSec: 10, betSec: 5, rebuy: 'whenBroke' },
    });
    expect(created.ok).toBe(true);
    const code = (created as { data: { code: string } }).data.code;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    const listed = await call<{ code: string }[]>(b, 'lobby:list', {});
    expect(listed.ok && listed.data.some((r) => r.code === code)).toBe(true);

    const ja = await call<RoomSnapshot>(a, 'room:join', { code });
    const jb = await call<RoomSnapshot>(b, 'room:join', { code: code.toLowerCase() });
    expect(ja.ok && jb.ok).toBe(true);

    // Not the host → cannot start; nobody seated → cannot start
    expect(await call(b, 'host:start', {})).toEqual({ ok: false, code: 'NOT_HOST' });
    expect(await call(a, 'host:start', {})).toEqual({ ok: false, code: 'NEED_PLAYERS' });

    expect((await call(a, 'seat:sit', {})).ok).toBe(true);
    expect((await call(b, 'seat:sit', {})).ok).toBe(true);
    expect((await call(a, 'host:start', {})).ok).toBe(true);

    await until(() => a.privates.some((p) => (p.legal as bj.BJLegal | null)?.kind === 'bet'));
    expect((await call(a, 'game:action', { type: 'BET', amount: 999999 })).ok).toBe(true); // fixed stake ignores amount
    expect((await call(b, 'game:action', { type: 'BET' })).ok).toBe(true);

    // Both act at the same time (simultaneous decisions) until the round settles.
    await until(() => a.events.some((x) => x.pub.some((e) => e.e === 'Phase' && (e.phase === 'play' || e.phase === 'results'))));
    for (let i = 0; i < 20; i++) {
      for (const c of [a, b]) {
        const legal = c.privates.at(-1)?.legal as bj.BJLegal | null;
        if (legal?.kind === 'play') await call(c, 'game:action', { type: 'STAND', dId: legal.dId });
        if (legal?.kind === 'insurance') await call(c, 'game:action', { type: 'INSURANCE', take: false, dId: legal.dId });
      }
      if (a.events.some((x) => x.pub.some((e) => e.e === 'Phase' && e.phase === 'results'))) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(a.events.some((x) => x.pub.some((e) => e.e === 'Phase' && e.phase === 'results'))).toBe(true);

    // Event ids are contiguous for every client.
    for (const c of [a, b]) c.events.forEach((x, i) => i > 0 && expect(x.eid).toBe(c.events[i - 1]!.eid + 1));

    // The dealer's hole card is never public before it is flipped; tokens never leak to other players.
    for (const x of b.events) for (const e of x.pub) if (e.e === 'CardDealt' && (e.to as { t: string }).t === 'dealer' && (e.to as { slot: number }).slot === 1) expect(e.card).toBeNull();
    expect(JSON.stringify(b.raw)).not.toContain(a.info.token);

    a.s.close();
    b.s.close();
  });

  it('a refresh keeps the seat (token resume) and stale/forged input is rejected', async () => {
    const a = await connect('Celina');
    const created = await call<{ code: string }>(a, 'room:create', {
      name: 'Reconnect',
      visibility: 'private',
      settings: { game: 'blackjack', stake: 10 * CHIP, bankrollMultiple: 20, decisionSec: 10, betSec: 5, rebuy: 'never' },
    });
    const code = (created as { data: { code: string } }).data.code;
    await call(a, 'room:join', { code });
    await call(a, 'seat:sit', {});
    const listed = await call<{ code: string }[]>(a, 'lobby:list', {});
    expect(listed.ok && listed.data.some((r) => r.code === code)).toBe(false); // private

    // forged host-only fields / unknown actions
    expect(await call(a, 'game:action', { type: 'SIT', player: 'x' })).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(await call(a, 'game:action', { type: 'BET', seat: 99 })).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(await call(a, 'game:action', { type: 'TIMEOUT' })).toEqual({ ok: false, code: 'BAD_REQUEST' });

    const token = a.info.token;
    a.s.close();
    await new Promise((r) => setTimeout(r, 100));
    const again = await connect('Celina', token);
    expect(again.info.playerId).toBe(a.info.playerId);
    const snap = await new Promise<RoomSnapshot>((res) => {
      if (again.raw.some((x) => (x as unknown[])[0] === 'room:snapshot')) res((again.raw.find((x) => (x as unknown[])[0] === 'room:snapshot') as unknown[])[1] as RoomSnapshot);
      else again.s.once('room:snapshot', res);
    });
    expect(snap.meta.code).toBe(code);
    expect(snap.you).not.toBeNull();
    again.s.close();
  });

  it('kick and close notify members', async () => {
    const a = await connect('Host');
    const b = await connect('Guest');
    const created = await call<{ code: string }>(a, 'room:create', {
      name: 'K',
      visibility: 'public',
      settings: { game: 'blackjack', stake: 5 * CHIP, bankrollMultiple: 20, decisionSec: 10, betSec: 5, rebuy: 'never' },
    });
    const code = (created as { data: { code: string } }).data.code;
    await call(a, 'room:join', { code });
    await call(b, 'room:join', { code });
    const kicked = new Promise((res) => b.s.once('room:kicked', res));
    expect((await call(a, 'host:kick', { playerId: b.info.playerId })).ok).toBe(true);
    expect(await kicked).toEqual({ reason: 'kicked' });
    expect((await call(a, 'host:close', {})).ok).toBe(true);
    expect(srv.rooms.get(code)).toBeUndefined();
    a.s.close();
    b.s.close();
  });
});
