import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { CHIP, type he } from '@casino/engine';
import { PROTOCOL_VERSION, type Ack, type RoomMeta } from '@casino/protocol';
import { startServer, type RunningServer } from '../src/index';

let srv: RunningServer;
beforeAll(async () => {
  srv = await startServer({ PORT: 0, HOST: '127.0.0.1', LOG_LEVEL: 'silent', STATIC_DIR: '/nonexistent', CONNECTIONS_PER_IP: 50 } as never, { seed: () => [9, 8, 7, 6, 5, 4, 3, 2] });
});
afterAll(async () => {
  await srv.close();
});

interface P {
  s: Socket;
  id: string;
  legal: he.HLegal | null;
  you: number | null;
  pub: { e: string; [k: string]: unknown }[];
  reveals: { seat: number; cid: number; card: number }[];
  meta: RoomMeta | null;
}

async function player(name: string): Promise<P> {
  const s = ioc(srv.url, { transports: ['websocket'], auth: { protocol: PROTOCOL_VERSION, nickname: name, locale: 'en' }, forceNew: true });
  const p: P = { s, id: '', legal: null, you: null, pub: [], reveals: [], meta: null };
  s.on('game:private', (x: { legal: he.HLegal | null; you: number | null; reveals: P['reveals'] }) => {
    p.legal = x.legal;
    p.you = x.you;
    p.reveals.push(...x.reveals);
  });
  s.on('game:events', (b: { pub: P['pub'] }) => p.pub.push(...b.pub));
  s.on('room:meta', (m: RoomMeta) => (p.meta = m));
  p.id = await new Promise<string>((res) => s.once('session', (i: { playerId: string }) => res(i.playerId)));
  return p;
}

const call = <T,>(p: P, ev: string, payload: unknown) => new Promise<Ack<T>>((res) => p.s.emit(ev, payload, res));
const until = async (pred: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("multiplayer Texas Hold'em server", () => {
  it('fixed blinds, a full hand, private hole cards, and a spectator queue', async () => {
    const [a, b, c] = await Promise.all([player('Ala'), player('Bob'), player('Cyd')]);
    const r = await call<{ code: string }>(a, 'room:create', {
      name: 'HE',
      visibility: 'public',
      settings: { game: 'holdem', sb: 1 * CHIP, bb: 2 * CHIP, buyInBB: 100, decisionSec: 10, maxSeats: 2, rebuy: 'whenBroke' },
    });
    expect(r.ok).toBe(true);
    const code = (r as { data: { code: string } }).data.code;
    for (const p of [a, b, c]) expect((await call(p, 'room:join', { code })).ok).toBe(true);
    for (const p of [a, b, c]) expect((await call(p, 'seat:sit', {})).ok).toBe(true);
    await until(() => !!c.meta && c.meta.queue.includes(c.id));
    expect(c.meta!.queue).toEqual([c.id]); // table of 2 is full → third player queued

    expect((await call(a, 'host:start', {})).ok).toBe(true);
    // Play check/call until a pot is awarded.
    await until(() => a.pub.some((e) => e.e === 'BlindPosted'));
    for (let i = 0; i < 200 && !a.pub.some((e) => e.e === 'PotAwarded'); i++) {
      for (const p of [a, b]) {
        const l = p.legal;
        if (l?.kind === 'act') await call(p, 'game:action', { type: l.check ? 'CHECK' : 'CALL', dId: l.dId });
      }
      await new Promise((res) => setTimeout(res, 30));
    }
    expect(a.pub.some((e) => e.e === 'PotAwarded')).toBe(true);

    // Hole cards: public CardDealt never carries a hole card; each player gets only their own.
    for (const e of c.pub) if (e.e === 'CardDealt' && (e.to as { t: string }).t === 'hole') expect(e.card).toBeNull();
    expect(c.reveals).toHaveLength(0);
    expect(a.reveals.every((x) => x.seat === a.you)).toBe(true);
    expect(b.reveals.every((x) => x.seat === b.you)).toBe(true);
    expect(a.reveals.length).toBeGreaterThanOrEqual(2);

    // When a seat frees up the queued spectator is seated.
    expect((await call(b, 'seat:stand', {})).ok).toBe(true);
    await until(() => !!c.meta && c.meta.members.find((m) => m.id === c.id)?.seat != null, 15000);
    for (const p of [a, b, c]) p.s.close();
  });
});
