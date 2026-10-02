import { Holdem, he, createRng, decideHoldem, type Money } from '@casino/engine';
import { formatMoney, t } from '../../i18n';
import { LocalSession, type LocalSeatSpec } from '../../session/LocalSession';
import { profile, setWallet } from '../../session/wallet';
import { speedMult } from '../../store/settings';
import { cryptoSeed } from '../../session/scheduler';
import { loadSetup } from '../../screens/SoloSetup';

const BOT_NAMES = ['Wiktor', 'Hanna', 'Leon', 'Stella', 'Maks', 'Iris', 'Oskar', 'Nina'];

function personas(style: string, n: number): string[] {
  const pool = style === 'tight' ? ['rock', 'tag'] : style === 'loose' ? ['lag', 'station'] : ['tag', 'station', 'lag', 'rock'];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]!);
}

/** Bots decide in a Web Worker; falls back to the main thread if workers are unavailable. */
function makeDecider() {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('../../session/ai.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  const rng = createRng(cryptoSeed());
  let seq = 0;
  const pending = new Map<number, (d: unknown) => void>();
  worker?.addEventListener('message', (e: MessageEvent<{ id: number; decision?: unknown; error?: string }>) => {
    const cb = pending.get(e.data.id);
    pending.delete(e.data.id);
    cb?.(e.data.decision ?? null);
  });
  const decide = (view: he.HView, legal: he.HLegal, seat: number, persona: string) => {
    if (!worker) return decideHoldem(view, legal, seat, persona, rng);
    const id = ++seq;
    return new Promise<ReturnType<typeof decideHoldem>>((resolve) => {
      pending.set(id, (d) => resolve((d as ReturnType<typeof decideHoldem>) ?? decideHoldem(view, legal, seat, persona, rng)));
      worker!.postMessage({ id, view, legal, seat, persona });
    });
  };
  return { decide, dispose: () => worker?.terminate() };
}

export function createHoldemLocal() {
  const setup = loadSetup('holdem');
  const [sb, bb] = setup.blinds;
  const buyIn: Money = Math.min(setup.buyInBB * bb, profile.value.wallet);
  const rules = he.holdemSinglePlayer({ sb, bb, buyIn: setup.buyInBB * bb, animScale: Number.isFinite(speedMult.value) ? 1 / speedMult.value : 0 });
  const names = BOT_NAMES.slice(0, setup.bots);
  const ps = personas(setup.style, setup.bots);
  const seats: LocalSeatSpec[] = [{ player: 'me', name: 'Me', bankroll: buyIn }, ...names.map((name, i) => ({ player: `bot${i}`, name, bot: ps[i]!, bankroll: setup.buyInBB * bb }))];
  // Chips not brought to the table stay in the wallet; the wallet always counts table chips as owned.
  let offTable = profile.value.wallet - buyIn;
  const decider = makeDecider();
  const session = new LocalSession<he.HView, he.HEvent, he.HLegal>('holdem', Holdem, rules, {
    seats,
    human: 'me',
    joinAction: 'JOIN',
    decide: decider.decide as never,
    thinkScale: () => (Number.isFinite(speedMult.value) ? 1 / speedMult.value : 0),
    onState: (st: he.HState) => {
      const me = st.seats.find((s) => s?.player === 'me');
      if (!me) return;
      setWallet(Math.max(0, offTable) + me.stack + me.street + me.committed);
    },
  });
  // A rebuy brings another buy-in from the wallet.
  session.subscribe((m) => {
    if (m.kind !== 'batch') return;
    for (const ev of m.pub) {
      if (ev.e === 'ChipsMoved' && ev.reason === 'rebuy' && ev.to.k === 'stack' && ev.to.seat === session.humanSeat) offTable -= ev.amount;
    }
  });
  const origDispose = session.dispose.bind(session);
  session.dispose = () => {
    decider.dispose();
    origDispose();
  };
  return {
    session,
    info: `${t('setup.blinds')}: ${formatMoney(sb)} / ${formatMoney(bb)}`,
    startBankroll: profile.value.startingBankroll,
  };
}
