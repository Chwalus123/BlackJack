/**
 * Load smoke test: N socket bots at ONE table play H rounds; reports ack latency and completed rounds.
 *   CONNECTIONS_PER_IP=2000 npm start            # in one terminal (or the docker image)
 *   npm run load -- --url http://localhost:3000 --bots 300 --hands 10 [--game holdem]
 */
import { io, type Socket } from 'socket.io-client';
import { CHIP } from '@casino/engine';
import { PROTOCOL_VERSION, type Ack } from '@casino/protocol';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const URL = arg('url', 'http://localhost:3000');
const BOTS = Number(arg('bots', '50'));
const HANDS = Number(arg('hands', '5'));
const GAME = arg('game', 'blackjack') as 'blackjack' | 'holdem';

const acks: number[] = [];
let disconnects = 0;

function call<T>(s: Socket, ev: string, payload: unknown): Promise<Ack<T>> {
  const t0 = performance.now();
  return new Promise((res) =>
    s.timeout(15000).emit(ev, payload, (err: unknown, r: Ack<T>) => {
      acks.push(performance.now() - t0);
      res(err ? ({ ok: false, code: 'INTERNAL' } as Ack<T>) : r);
    }),
  );
}

async function bot(i: number): Promise<Socket> {
  const s = io(URL, { transports: ['websocket'], auth: { protocol: PROTOCOL_VERSION, nickname: `Bot${i}`, locale: 'en' }, forceNew: true });
  await new Promise<void>((res, rej) => {
    s.once('session', () => res());
    s.once('connect_error', rej);
  });
  s.on('disconnect', (r) => {
    if (r !== 'io client disconnect') disconnects++;
  });
  return s;
}

const pct = (xs: number[], p: number) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))] ?? 0;
};

async function main() {
  console.log(`connecting ${BOTS} bots to ${URL} (${GAME})…`);
  const sockets: Socket[] = [];
  for (let i = 0; i < BOTS; i += 25) sockets.push(...(await Promise.all(Array.from({ length: Math.min(25, BOTS - i) }, (_, k) => bot(i + k)))));
  const host = sockets[0]!;
  const settings =
    GAME === 'blackjack'
      ? { game: 'blackjack', stake: 5 * CHIP, bankrollMultiple: 100, decisionSec: 10, betSec: 5, rebuy: 'whenBroke' }
      : { game: 'holdem', sb: 1 * CHIP, bb: 2 * CHIP, buyInBB: 100, decisionSec: 10, maxSeats: 22, rebuy: 'whenBroke' };
  const created = await call<{ code: string }>(host, 'room:create', { name: 'Load test', visibility: 'private', settings });
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  const code = created.data.code;
  let rounds = 0;
  host.on('game:events', (b: { pub: { e: string; phase?: string }[] }) => {
    for (const e of b.pub) if (e.e === 'Phase' && e.phase === 'results') rounds++;
  });
  for (const s of sockets) {
    s.on('game:private', (p: { legal: { kind: string; dId: number; check?: boolean; call?: number | null } | null }) => {
      const l = p.legal;
      if (!l) return;
      const act = (a: Record<string, unknown>) => void call(s, 'game:action', { ...a, dId: l.dId });
      if (l.kind === 'bet') act({ type: 'BET' });
      else if (l.kind === 'insurance') act({ type: 'INSURANCE', take: false });
      else if (l.kind === 'play') act({ type: Math.random() < 0.3 ? 'HIT' : 'STAND' });
      else if (l.kind === 'act') act({ type: l.check ? 'CHECK' : 'CALL' });
      else if (l.kind === 'rebuy') act({ type: 'REBUY' });
    });
  }
  await Promise.all(sockets.map((s) => call(s, 'room:join', { code })));
  await Promise.all(sockets.map((s) => call(s, 'seat:sit', {})));
  const t0 = performance.now();
  const started = await call(host, 'host:start', {});
  if (!started.ok) throw new Error(`start failed: ${started.code}`);
  while (rounds < HANDS && performance.now() - t0 < 10 * 60_000) await new Promise((r) => setTimeout(r, 250));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const health = await fetch(`${URL}/healthz`).then((r) => r.json()).catch(() => null);
  console.log(JSON.stringify({ bots: BOTS, game: GAME, rounds, secs, disconnects, ackP50: pct(acks, 50).toFixed(1), ackP95: pct(acks, 95).toFixed(1), health }, null, 2));
  for (const s of sockets) s.close();
  process.exit(rounds >= HANDS && disconnects === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
