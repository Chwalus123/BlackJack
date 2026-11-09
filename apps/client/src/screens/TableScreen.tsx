import { useEffect, useMemo, useState } from 'preact/hooks';
import { Blackjack, bj, createRng, decideBlackjack, CHIP, formatCard, type Money } from '@casino/engine';
import { formatMoney, t } from '../i18n';
import { navigate } from '../app/router';
import { LocalSession, type LocalSeatSpec } from '../session/LocalSession';
import { profile, resetWallet, setWallet, recordHand } from '../session/wallet';
import { speedMult } from '../store/settings';
import { cryptoSeed } from '../session/scheduler';
import { TableView } from '../ui/table/TableView';
import { Dialog } from '../ui/chrome';
import type { GameKind } from './ModeSelect';
import { loadSetup, type TableStyle } from './SoloSetup';
import { createHoldemLocal } from '../ui/holdem/local';

void formatCard;

const BOT_NAMES = ['Wiktor', 'Hanna', 'Leon', 'Stella', 'Maks', 'Iris', 'Oskar', 'Nina'];

function bjPersonas(style: TableStyle, n: number): string[] {
  const pool = style === 'tight' ? ['cautious', 'steady'] : style === 'loose' ? ['highRoller', 'steady'] : ['steady', 'cautious', 'highRoller', 'steady'];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]!);
}

function pickNames(n: number): string[] {
  const seed = cryptoSeed()[0]!;
  const start = seed % BOT_NAMES.length;
  return Array.from({ length: n }, (_, i) => BOT_NAMES[(start + i) % BOT_NAMES.length]!);
}

function createBlackjackLocal(): { session: LocalSession<bj.BJView, bj.BJEvent, bj.BJLegal>; info: string; startBankroll: Money } {
  const setup = loadSetup('blackjack');
  const [min, max] = setup.limits;
  const wallet = profile.value.wallet;
  const rules = bj.blackjackSinglePlayer({ min, max, bankroll: wallet, animScale: Number.isFinite(speedMult.value) ? 1 / speedMult.value : 0 });
  rules.startingBankroll = Math.max(profile.value.startingBankroll, min);
  const names = pickNames(setup.bots);
  const personas = bjPersonas(setup.style, setup.bots);
  const bots: LocalSeatSpec[] = names.map((name, i) => ({ player: `bot${i}`, name, bot: personas[i]!, bankroll: 1000 * CHIP }));
  // The human sits in the middle of the play order, like the centre seat at a casino table.
  const half = Math.floor(bots.length / 2);
  const seats: LocalSeatSpec[] = [...bots.slice(0, half), { player: 'me', name: 'Me', bankroll: wallet }, ...bots.slice(half)];
  const rng = createRng(cryptoSeed());
  const session = new LocalSession<bj.BJView, bj.BJEvent, bj.BJLegal>('blackjack', Blackjack, rules, {
    seats,
    human: 'me',
    joinAction: 'SIT',
    decide: (view, legal, seat, persona) => decideBlackjack(view, legal, seat, persona, rng),
    thinkScale: () => (Number.isFinite(speedMult.value) ? 1 / speedMult.value : 0),
    onState: (st: bj.BJState) => {
      const me = st.seats.find((s) => s.player === 'me');
      if (!me) return;
      const onTable = me.hands.reduce((a, h) => a + h.bet, 0) + me.insurance;
      setWallet(me.stack + onTable);
    },
  });
  return { session, info: t('table.limits', { min: formatMoney(min), max: formatMoney(max) }), startBankroll: rules.startingBankroll };
}

export function TableScreen({ game }: { game: GameKind; mode: 'solo' }) {
  const kit = useMemo(() => (game === 'blackjack' ? createBlackjackLocal() : createHoldemLocal()), [game]);
  const [broke, setBroke] = useState(false);

  useEffect(() => {
    const s = kit.session;
    const unsub = s.subscribe((m) => {
      if (m.kind === 'batch') {
        for (const ev of m.pub as { e: string; seat?: number; net?: number }[]) {
          if (ev.e === 'HandResult' && ev.seat === (s as LocalSession<any, any, any>).humanSeat) recordHand(ev.net ?? 0);
        }
      }
      const legal = (m as { legal?: { kind: string } | null }).legal;
      setBroke(legal?.kind === 'rebuy');
    });
    (s as LocalSession<any, any, any>).start();
    return () => {
      unsub();
      s.dispose();
    };
  }, [kit]);

  return (
    <TableView
      game={game}
      session={kit.session}
      onLeave={() => navigate(`/${game}/solo`)}
      info={
        <>
          <strong>{t(game === 'blackjack' ? 'game.blackjack' : 'game.holdem')}</strong>
          <span>{kit.info}</span>
        </>
      }
      overlay={
        broke && (
          <Dialog title={t('bankrupt.title')}>
            <p style={{ color: 'var(--c-ivory-dim)' }}>{t('bankrupt.body', { amount: formatMoney(kit.startBankroll) })}</p>
            <div class="actions">
              <button
                class="btn btn-brass"
                onClick={() => {
                  resetWallet(kit.startBankroll);
                  void kit.session.act({ type: 'REBUY' });
                }}
              >
                {t('bankrupt.reset')}
              </button>
              <button class="btn btn-lacquer" onClick={() => navigate(`/${game}/solo`)}>
                {t('nav.leaveTable')}
              </button>
            </div>
          </Dialog>
        )
      }
    />
  );
}
