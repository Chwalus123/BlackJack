import { useEffect, useMemo, useState } from 'preact/hooks';
import { bj, type Money, type SeatId } from '@casino/engine';
import { formatMoney, t } from '../../i18n';
import { TRAY } from '../../shared/chips';
import { bjBetPos, bjCardPos, bjDealerCardPos, bjStackPos, BJ_TABLE, type V3 } from '../../three/layout';
import type { TableContext } from '../table/TableView';
import { ChipSvg } from '../chips/ChipSvg';
import { Icon, SuitIcon } from '../deco';
import { Countdown, TimerBar } from '../table/Timer';
import { toast } from '../chrome';

type V = bj.BJView;
type L = bj.BJLegal;

function totalLabel(cards: (number | null)[]): { text: string; cls: string } | null {
  const known = cards.filter((c): c is number => c != null);
  if (known.length === 0) return null;
  const v = bj.handValue(known);
  if (v.total > 21) return { text: String(v.total), cls: 'bust' };
  if (known.length === 2 && v.total === 21 && cards.length === 2) return { text: '21', cls: 'bj' };
  if (v.soft && v.total < 21) return { text: `${v.total - 10}/${v.total}`, cls: '' };
  return { text: String(v.total), cls: '' };
}

const OUTCOME_KEY = {
  blackjack: 'outcome.blackjack',
  win: 'outcome.win',
  push: 'outcome.push',
  lose: 'outcome.lose',
  bust: 'outcome.bust',
  evenMoney: 'outcome.evenMoney',
} as const;

export function BlackjackHud({ ctx }: { ctx: TableContext }) {
  const { scene, store, session } = ctx;
  const director = ctx.bjDirector!;
  const view = store.presented.value as V | null;
  const auth = store.authoritative.value as V | null;
  const legal = store.legal.value as L | null;
  const ready = store.ready.value;
  const you = store.you.value;
  void ctx.anchors.value; // re-render when anchors move

  const [chip, setChip] = useState<Money>(TRAY[1]!);
  const [pending, setPending] = useState<Money[]>([]);
  const [lastBet, setLastBet] = useState<Money>(0);
  const [busy, setBusy] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);

  const me = view?.seats.find((s) => s.id === you) ?? null;
  const myAuth = auth?.seats.find((s) => s.id === you) ?? null;
  const pendingTotal = pending.reduce((a, b) => a + b, 0);
  const heroSpot = you != null ? director.spots.get(you) ?? BJ_TABLE.heroSpot : BJ_TABLE.heroSpot;
  const freeBet = legal?.kind === 'bet' && legal.mode === 'free' ? legal : null;
  const fixedBet = legal?.kind === 'bet' && legal.mode === 'fixed' ? legal : null;
  const betting = !!freeBet && ready;

  // Pending (not yet dealt) chips are shown on the felt in 3D.
  useEffect(() => {
    scene.chips.setStack('pending', bjBetPos(heroSpot, 0, 1), freeBet ? pendingTotal : 0);
    scene.wake(100);
  }, [pendingTotal, !!freeBet, heroSpot]);
  useEffect(() => () => scene.chips.setStack('pending', bjBetPos(0, 0, 1), 0), []);
  useEffect(() => {
    if (!freeBet) setPending([]);
  }, [!!freeBet]);

  const act = async (a: { type: string } & Record<string, unknown>) => {
    if (busy) return false;
    setBusy(true);
    const r = await session.act({ ...a, dId: (legal as { dId?: number } | null)?.dId });
    setBusy(false);
    if (!r.ok) {
      const code = r.error.code;
      if (code !== 'STALE_TURN') toast(t(`error.${code}` as 'error.generic') || t('error.generic'), 'error');
      return false;
    }
    return true;
  };

  const stackLeft = (myAuth?.stack ?? 0) - pendingTotal;
  const addChip = (d: Money) => {
    if (!freeBet) return;
    if (pendingTotal + d > freeBet.max) return toast(t('table.limits', { min: formatMoney(freeBet.min), max: formatMoney(freeBet.max) }));
    if (d > stackLeft) return;
    setPending([...pending, d]);
  };
  const deal = async () => {
    if (!freeBet) return;
    if (pendingTotal > 0) {
      if (pendingTotal < freeBet.min) return toast(t('table.minBet', { amount: formatMoney(freeBet.min) }));
      const ok = await act({ type: 'BET', amount: pendingTotal });
      if (!ok) return;
      setLastBet(pendingTotal);
    }
    await session.act({ type: 'DEAL' });
    setPending([]);
  };
  const repeat = () => {
    if (!freeBet || lastBet <= 0) return;
    const amount = Math.min(lastBet, freeBet.max, myAuth?.stack ?? 0);
    setPending(breakIntoTray(amount));
  };
  const doubleBet = () => {
    if (!freeBet) return;
    const amount = Math.min(pendingTotal * 2, freeBet.max, myAuth?.stack ?? 0);
    setPending(breakIntoTray(amount));
  };

  // Keyboard play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (freeBet && ready) {
        const n = Number(k);
        if (n >= 1 && n <= TRAY.length) {
          setChip(TRAY[n - 1]!);
          return;
        }
        if (k === 'enter') void deal();
        else if (k === 'backspace') setPending(pending.slice(0, -1));
        else if (k === ' ') addChip(chip);
        return;
      }
      if (legal?.kind === 'play' && ready) {
        if (k === 'h' && legal.hit) void act({ type: 'HIT' });
        else if (k === 's') void act({ type: 'STAND' });
        else if (k === 'd' && legal.double) void act({ type: 'DOUBLE' });
        else if (k === 'p' && legal.split) void act({ type: 'SPLIT' });
      } else if (legal?.kind === 'insurance' && ready) {
        if (k === 'y' || k === 't') void act({ type: 'INSURANCE', take: true });
        else if (k === 'n') void act({ type: 'INSURANCE', take: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const proj = (p: V3) => scene.project(p);
  const seatsShown = useMemo(() => (view ? view.seats.filter((s) => director.spots.has(s.id)) : []), [view, ctx.anchors.value]);
  const results = store.results.value;
  const announce = store.announce.value;
  const now = () => session.now();

  const dealerCards = view?.dealer.cards ?? [];
  const dealerTotal = totalLabel(dealerCards.map((c) => c.card));
  const dealerAnchor = proj({ ...bjDealerCardPos(0), x: bjDealerCardPos(Math.max(0, dealerCards.length - 1)).x / 2, z: -0.19 });

  const myTurn = legal?.kind === 'play' && ready;
  const statusText = (() => {
    if (!view) return '';
    if (view.paused) return t('table.paused');
    if (view.phase === 'idle') return t('table.waiting');
    if (fixedBet && fixedBet.decided) return t('table.placeBets');
    return '';
  })();

  return (
    <>
      <div class="anchor-layer" aria-hidden="true">
        {seatsShown.map((s) => {
          const spot = director.spots.get(s.id)!;
          const plate = proj(bjStackPos(spot));
          const active = !!view?.turn?.seats.includes(s.id) && view.phase === 'play' && s.hands.some((h) => h.state === 'play' || h.state === 'waitCard');
          return (
            <>
              <div class={`seat-plate ${s.id === you ? 'me' : ''} ${active ? 'active' : ''}`} style={{ left: plate.x, top: plate.y + 14 }}>
                <div class="name">
                  {s.id === you ? t('table.you') : s.name}
                  {s.bot && <span class="tag">{t('table.bot')}</span>}
                </div>
                <div class="stack">{formatMoney(s.stack)}</div>
                {s.status !== 'active' && (
                  <div class="status">{t(s.status === 'sittingOut' ? 'table.sittingOut' : s.status === 'pending' ? 'table.pending' : 'table.leaving')}</div>
                )}
                {s.away && <div class="status">{t('table.away')}</div>}
                {active && <TimerBar deadline={s.deadline} now={now} total={view?.rules.decisionMs ?? 20000} />}
              </div>
              {s.hands.map((h, hi) => {
                if (h.cards.length === 0) return null;
                const last = proj(bjCardPos(spot, hi, s.hands.length, h.cards.length - 1));
                const lbl = totalLabel(h.cards.map((c) => c.card));
                const res = results.find((r) => r.seat === s.id && r.hand === hi);
                const betAt = proj(bjBetPos(spot, hi, s.hands.length));
                return (
                  <>
                    {lbl && (
                      <div class={`total-badge ${lbl.cls}`} style={{ left: last.x, top: last.y - 18 }}>
                        {lbl.text}
                      </div>
                    )}
                    {h.outcome && (
                      <div class={`outcome-badge ${h.outcome}`} style={{ left: betAt.x, top: betAt.y - 34 }}>
                        {t(OUTCOME_KEY[h.outcome])}
                        {res && res.net !== 0 && ` ${res.net > 0 ? '+' : '−'}${formatMoney(Math.abs(res.net))}`}
                      </div>
                    )}
                    {h.bet > 0 && !h.outcome && (
                      <div class="bet-amount" style={{ left: betAt.x, top: betAt.y + 22 }}>
                        {formatMoney(h.bet)}
                      </div>
                    )}
                  </>
                );
              })}
            </>
          );
        })}
        {dealerTotal && (
          <div class={`total-badge ${dealerTotal.cls}`} style={{ left: dealerAnchor.x, top: dealerAnchor.y }}>
            {t('table.dealer')} · {dealerTotal.text}
          </div>
        )}
        {freeBet && pendingTotal > 0 && (() => {
          const p = proj(bjBetPos(heroSpot, 0, 1));
          return (
            <div class="bet-amount" style={{ left: p.x, top: p.y + 22 }}>
              {formatMoney(pendingTotal)}
            </div>
          );
        })()}
      </div>
      {betting && (() => {
        const c = proj(bjBetPos(heroSpot, 0, 1));
        const edge = proj({ ...bjBetPos(heroSpot, 0, 1), x: bjBetPos(heroSpot, 0, 1).x + 0.06 });
        const r = Math.max(26, Math.abs(edge.x - c.x));
        return (
          <button
            class="bet-spot"
            style={{ left: c.x, top: c.y, width: r * 2, height: r * 2 }}
            aria-label={`${t('table.bet')}: ${formatMoney(chip)}`}
            onClick={() => addChip(chip)}
            onContextMenu={(e) => {
              e.preventDefault();
              setPending(pending.slice(0, -1));
            }}
          />
        );
      })()}

      {announce && (
        <div class="announce" key={announce.id} role="status" aria-live="polite">
          {t(`announce.${announce.key}` as 'announce.bj.placeBets', announce.params)}
        </div>
      )}

      <button class="btn btn-lacquer btn-sm" style={{ position: 'absolute', right: 'var(--gutter)', top: 64, zIndex: 21 }} onClick={() => setShowPlayers(!showPlayers)} aria-expanded={showPlayers}>
        <Icon name="users" size={16} /> {view?.seats.length ?? 0}
      </button>
      {showPlayers && view && <PlayersPanel view={view} you={you} shown={director.spots} onClose={() => setShowPlayers(false)} />}

      <div class="dock" role="region" aria-label={t('table.summary')}>
        <div class="dock-row wallet">
          <span>
            {t('table.wallet')}: <b>{formatMoney(Math.max(0, (me?.stack ?? myAuth?.stack ?? 0) - (freeBet ? pendingTotal : 0)))}</b>
          </span>
          {(freeBet ? pendingTotal : me?.hands.reduce((a, h) => a + h.bet, 0) ?? 0) > 0 && (
            <span>
              {t('table.bet')}: <b>{formatMoney(freeBet ? pendingTotal : me!.hands.reduce((a, h) => a + h.bet, 0))}</b>
            </span>
          )}
          {view && (view.phase === 'betting' || view.phase === 'insurance') && view.phaseDeadline != null && (
            <span>
              {t('table.placeBets')}: <b><Countdown deadline={view.phaseDeadline} now={now} /></b>
            </span>
          )}
          {statusText && <span>{statusText}</span>}
        </div>

        {freeBet && ready && (
          <>
            <div class="chip-tray" role="group" aria-label={t('bj.chipHint')}>
              {TRAY.map((d, i) => (
                <button
                  class="chip-btn"
                  aria-pressed={chip === d}
                  aria-label={`${formatMoney(d)} (${i + 1})`}
                  disabled={d > stackLeft || d > freeBet.max}
                  onClick={() => {
                    setChip(d);
                    addChip(d);
                  }}
                >
                  <ChipSvg denom={d} size={44} />
                </button>
              ))}
            </div>
            <div class="dock-row">
              <button class="btn btn-ghost btn-sm" disabled={pending.length === 0} onClick={() => setPending(pending.slice(0, -1))}>
                {t('bj.undoChip')}
              </button>
              <button class="btn btn-lacquer btn-sm" disabled={pending.length === 0} onClick={() => setPending([])}>
                {t('bj.clear')}
              </button>
              <button class="btn btn-lacquer btn-sm" disabled={lastBet <= 0 || pending.length > 0} onClick={repeat}>
                {t('bj.repeat')}
              </button>
              <button class="btn btn-lacquer btn-sm" disabled={pendingTotal === 0 || pendingTotal * 2 > freeBet.max || pendingTotal * 2 > (myAuth?.stack ?? 0)} onClick={doubleBet}>
                {t('bj.double2')}
              </button>
              <button class="btn btn-brass btn-lg" disabled={busy || (pendingTotal < freeBet.min && !(pendingTotal === 0 && freeBet.canDeal))} onClick={() => void deal()}>
                {t('bj.deal')}
                <span class="kbd">Enter</span>
              </button>
            </div>
          </>
        )}

        {fixedBet && ready && (
          <div class="dock-row">
            {!fixedBet.decided ? (
              <>
                <button class="btn btn-brass btn-lg" disabled={busy} onClick={() => void act({ type: 'BET', amount: fixedBet.stake })}>
                  {t('bj.betStake', { amount: formatMoney(fixedBet.stake) })}
                </button>
                <button class="btn btn-lacquer" disabled={busy} onClick={() => void act({ type: 'PASS' })}>
                  {t('bj.pass')}
                </button>
              </>
            ) : (
              <button class="btn btn-ghost" disabled={busy} onClick={() => void act({ type: 'CLEAR_BET' })}>
                {t('bj.undoBet')}
              </button>
            )}
            <label class="btn btn-ghost btn-sm" style={{ gap: 8 }}>
              <input type="checkbox" checked={!!me?.autoBet} onChange={(e) => void act({ type: 'SET_AUTOBET', value: (e.target as HTMLInputElement).checked })} />
              {t('bj.autoBet')}
            </label>
          </div>
        )}

        {legal?.kind === 'insurance' && ready && (
          <div class="prompt" role="group">
            <span class="q">{legal.evenMoney ? t('bj.evenMoney.q') : t('bj.insurance.q', { amount: formatMoney(legal.cost) })}</span>
            <button class="btn btn-brass btn-sm" disabled={busy} onClick={() => void act({ type: 'INSURANCE', take: true })}>
              {t('bj.yes')}
            </button>
            <button class="btn btn-lacquer btn-sm" disabled={busy} onClick={() => void act({ type: 'INSURANCE', take: false })}>
              {t('bj.no')}
            </button>
          </div>
        )}

        {legal?.kind === 'play' && (
          <div class="dock-row action-bar" role="group" aria-label={t('table.yourTurn')}>
            <button class="btn btn-brass" disabled={!myTurn || busy || !legal.hit} onClick={() => void act({ type: 'HIT' })}>
              {t('bj.hit')}
              <span class="kbd">H</span>
            </button>
            <button class="btn btn-velvet" disabled={!myTurn || busy} onClick={() => void act({ type: 'STAND' })}>
              {t('bj.stand')}
              <span class="kbd">S</span>
            </button>
            {legal.double && (
              <button class="btn btn-lacquer" disabled={!myTurn || busy} onClick={() => void act({ type: 'DOUBLE' })}>
                {t('bj.double')} +{formatMoney(legal.doubleCost)}
                <span class="kbd">D</span>
              </button>
            )}
            {legal.split && (
              <button class="btn btn-lacquer" disabled={!myTurn || busy} onClick={() => void act({ type: 'SPLIT' })}>
                {t('bj.split')} +{formatMoney(legal.splitCost)}
                <span class="kbd">P</span>
              </button>
            )}
          </div>
        )}

        {legal?.kind === 'rebuy' && session.mode === 'remote' && (
          <button class="btn btn-brass" onClick={() => void act({ type: 'REBUY' })}>
            {t('bj.rebuy', { amount: formatMoney(legal.amount) })}
          </button>
        )}
        {legal?.kind === 'sitIn' && (
          <button class="btn btn-brass" onClick={() => void act({ type: 'SIT_IN' })}>
            {t('bj.sitIn')}
          </button>
        )}
      </div>
      <div class="sr-only" aria-live="assertive">
        {myTurn ? t('table.yourTurn') : ''}
      </div>
    </>
  );
}

/** Greedy split of an amount into tray chips (for REPEAT / ×2). */
function breakIntoTray(amount: Money): Money[] {
  const out: Money[] = [];
  let rest = amount;
  for (let i = TRAY.length - 1; i >= 0; i--) {
    const d = TRAY[i]!;
    while (rest >= d) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}

function PlayersPanel({ view, you, shown, onClose }: { view: V; you: SeatId | null; shown: Map<SeatId, number>; onClose: () => void }) {
  return (
    <aside class="players-panel" aria-label={t('table.players')}>
      <header>
        <h2 class="gold-text" style={{ fontSize: 16 }}>
          {t('table.players')} ({view.seats.length})
        </h2>
        <button class="btn btn-ghost btn-icon" aria-label={t('nav.back')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <ul>
        {[...view.seats]
          .sort((a, b) => a.order - b.order)
          .map((s) => (
            <li class={s.id === you ? 'me' : ''}>
              <span class="avatar" aria-hidden="true">
                {s.name.slice(0, 2).toUpperCase()}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.id === you ? t('table.you') : s.name} {s.bot && <span class="kbd">{t('table.bot')}</span>}
                </div>
                <div class="mini-cards">
                  {s.hands.flatMap((h) => h.cards).map((c) => (
                    <MiniCard card={c.card} />
                  ))}
                  {!shown.has(s.id) && s.hands.length === 0 && <span style={{ color: 'var(--c-ivory-mute)', fontWeight: 400 }}>—</span>}
                </div>
              </div>
              <span class="tabular" style={{ color: 'var(--c-gold300)' }}>
                {formatMoney(s.stack)}
              </span>
            </li>
          ))}
      </ul>
    </aside>
  );
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_KEYS = ['c', 'd', 'h', 's'] as const;
export function MiniCard({ card }: { card: number | null }) {
  if (card == null) return <span class="mini-card back">?</span>;
  const r = (card >> 2) + 2;
  const s = card & 3;
  return (
    <span class={`mini-card ${s === 1 || s === 2 ? 'red' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      {RANKS[r - 2]}
      <SuitIcon suit={SUIT_KEYS[s]!} size={10} />
    </span>
  );
}
