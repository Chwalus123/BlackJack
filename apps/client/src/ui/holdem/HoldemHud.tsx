import { useEffect, useState } from 'preact/hooks';
import { he, type Money, type SeatId } from '@casino/engine';
import { formatMoney, t } from '../../i18n';
import { HE_POT, heBetPos, heHolePos, heStackPos, heBoardPos } from '../../three/layout';
import type { TableContext } from '../table/TableView';
import type { HoldemDirector } from '../../three/heDirector';
import { TimerBar } from '../table/Timer';
import { Icon } from '../deco';
import { BigCard, CardSlot, cardLabel } from '../cards/BigCard';
import { toast } from '../chrome';

type V = he.HView;
type L = he.HLegal;
type Act = Extract<L, { kind: 'act' }>;

/** Phases in which a hand is being played, so the board box shows (with empty slots before the flop). */
const HAND_PHASES = new Set<he.HPhase>(['preflop', 'flop', 'turn', 'river', 'showdown']);


export function handName(value: number | null): string {
  if (value == null) return '';
  const d = he.describeHand(value);
  const r = (n: number | undefined) => (n == null ? '' : t(`rank.${n}` as 'rank.2'));
  const r1 = (n: number | undefined) => (n == null ? '' : t(`rank1.${n}` as 'rank1.2'));
  const key = `hand.${d.cat}` as 'hand.pair';
  const high = d.cat === 'highCard' || d.cat === 'straight' || d.cat === 'flush' || d.cat === 'straightFlush';
  return t(key, { r1: high ? r1(d.ranks[0]) : r(d.ranks[0]), r2: d.cat === 'fullHouse' ? r(d.ranks[1]) : r(d.ranks[1]) });
}

export function HoldemHud({ ctx, director }: { ctx: TableContext; director: HoldemDirector }) {
  const { scene, store, session } = ctx;
  const view = store.presented.value as V | null;
  const legal = store.legal.value as L | null;
  const ready = store.ready.value;
  const you = store.you.value;
  void ctx.anchors.value;
  const [busy, setBusy] = useState(false);
  const [raiseTo, setRaiseTo] = useState<Money>(0);
  const [showPlayers, setShowPlayers] = useState(false);
  const act = legal?.kind === 'act' ? (legal as Act) : null;
  const range = act ? act.bet ?? act.raise : null;

  useEffect(() => {
    if (range) setRaiseTo(range.min);
  }, [range?.min, range?.max, act?.dId]);

  const send = async (a: { type: string } & Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    const r = await session.act({ ...a, dId: legal?.dId });
    setBusy(false);
    if (!r.ok && r.error.code !== 'STALE_TURN') toast(t(`error.${r.error.code}` as 'error.generic'), 'error');
  };

  // keyboard: F fold, C check/call, R raise, A all-in
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!act || !ready || (e.target as HTMLElement)?.closest('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && act.fold) void send({ type: 'FOLD' });
      else if (k === 'c') void send({ type: act.check ? 'CHECK' : 'CALL' });
      else if (k === 'r' && range) void send({ type: act.bet ? 'BET' : 'RAISE', to: raiseTo });
      else if (k === 'a' && act.allIn != null) void send({ type: 'ALL_IN' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const proj = (p: { x: number; y: number; z: number }) => scene.project(p);
  const now = () => session.now();
  const me = you != null ? view?.seats[you] ?? null : null;
  const results = store.results.value;
  const announce = store.announce.value;

  // Community cards and the hero's cards as large 2D cards in the dock. Everything comes from the presented
  // view, so a card appears here only once it has landed on the 3D table.
  const board = view?.board ?? [];
  const showBoard = !!view && (board.length > 0 || HAND_PHASES.has(view.phase));
  const hole = me?.hole ?? [];
  const holeKnown = hole.length === 2 && hole.every((c) => c.card != null);
  const known = (cs: readonly { card: number | null }[]) => cs.map((c) => c.card).filter((c): c is number => c != null);
  const heroHand = holeKnown && board.length >= 3 ? handName(he.eval7([...known(hole), ...known(board)])) : '';
  // At showdown the winning five cards light up and the rest dim (same set the 3D table lifts).
  const best = director.highlight;
  const markOf = (cid: number): 'win' | 'dim' | undefined => (best.size === 0 ? undefined : best.has(cid) ? 'win' : 'dim');
  const boardLabel = known(board).map(cardLabel).join(' ');

  const snap = (v: number) => {
    if (!act || !range) return v;
    const u = act.unit;
    const s = Math.round(v / u) * u;
    return Math.max(range.min, Math.min(range.max, s));
  };
  const presets: { label: string; to: Money }[] = [];
  if (act && range) {
    const pot = act.pot;
    const cur = view?.currentBet ?? 0;
    const myStreet = me?.street ?? 0;
    presets.push({ label: t('he.min'), to: range.min });
    if (view?.phase === 'preflop' && cur > 0) {
      for (const x of [2.5, 3, 4]) presets.push({ label: t('he.x', { n: x }), to: snap(cur * x) });
    } else {
      const callAmt = act.toCall;
      for (const [label, f] of [[t('he.halfPot'), 0.5], [t('he.threeQuarterPot'), 0.75], [t('he.pot'), 1]] as const) {
        presets.push({ label, to: snap(cur + callAmt + (pot + callAmt) * f - (cur - myStreet)) });
      }
    }
  }

  return (
    <>
      <div class="anchor-layer he-anchors" aria-hidden="true">
        {view?.seats.map((s, id) => {
          const spot = director.spots.get(id);
          if (!s || spot == null) return null;
          const plate = proj(heStackPos(spot));
          const active = view.toAct === id;
          const res = results.filter((r) => r.seat === id).reduce((a, r) => a + r.net, 0);
          return (
            <>
              <div class={`seat-plate ${id === you ? 'me' : ''} ${active ? 'active' : ''}`} style={{ left: plate.x, top: plate.y + 12, opacity: s.folded ? 0.6 : 1 }}>
                <div class="name">
                  {id === you ? t('table.you') : s.name}
                  {s.bot && <span class="tag">{t('table.bot')}</span>}
                  {view.button === id && <span class="tag">{t('he.button')}</span>}
                  {view.sb === id && view.phase !== 'waiting' && <span class="tag">{t('he.sb')}</span>}
                  {view.bb === id && view.phase !== 'waiting' && <span class="tag">{t('he.bb')}</span>}
                </div>
                <div class="stack">{formatMoney(s.stack)}</div>
                <div class="status">
                  {s.allIn
                    ? t('he.allInTag')
                    : s.folded
                      ? t('he.folded')
                      : s.status === 'busted'
                        ? t('he.busted')
                        : s.status === 'sittingOut'
                          ? t('table.sittingOut')
                          : s.lastAction
                            ? t(`he.${s.lastAction}` as 'he.fold', { amount: formatMoney(s.street) })
                            : ''}
                </div>
                {active && <TimerBar deadline={s.deadline} now={now} total={view.rules.decisionMs ?? 20000} />}
              </div>
              {s.street > 0 && (() => {
                const b = proj(heBetPos(spot));
                return (
                  <div class="bet-amount" style={{ left: b.x, top: b.y + 18 }}>
                    {formatMoney(s.street)}
                  </div>
                );
              })()}
              {res > 0 && (() => {
                const h = proj(heHolePos(spot, 0));
                return (
                  <div class="outcome-badge win" style={{ left: h.x, top: h.y - 30 }}>
                    +{formatMoney(res)}
                  </div>
                );
              })()}
            </>
          );
        })}
        {view && view.totalPot > 0 && (() => {
          const p = proj({ x: HE_POT.x, y: 0, z: HE_POT.z });
          return (
            <div class="total-badge" style={{ left: p.x, top: p.y + 30 }}>
              {t('he.potTotal', { amount: formatMoney(view.totalPot) })}
              {view.pots.length > 1 && (
                <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                  ({view.pots.map((x) => formatMoney(x.amount)).join(' · ')})
                </span>
              )}
            </div>
          );
        })()}
        {view && view.board.length > 0 && results.length > 0 && (() => {
          const p = proj(heBoardPos(2));
          const shown = view.seats.filter((s) => s?.shown);
          return shown.length ? <div class="total-badge bj" style={{ left: p.x, top: p.y - 40 }}>{t('announce.he.showdown')}</div> : null;
        })()}
      </div>

      {announce && (
        <div class="announce" key={announce.id} role="status" aria-live="polite">
          {announce.key === 'he.wins' && announce.params?.seat === you
            ? t('announce.he.youWin')
            : t(`announce.${announce.key}` as 'announce.he.flop', announceParams(view, announce.params))}
        </div>
      )}

      <button class="btn btn-lacquer btn-sm" style={{ position: 'absolute', right: 'var(--gutter)', top: 64, zIndex: 21 }} onClick={() => setShowPlayers(!showPlayers)} aria-expanded={showPlayers}>
        <Icon name="users" size={16} /> {view?.seats.filter(Boolean).length ?? 0}
      </button>
      {showPlayers && view && <HoldemPlayers view={view} you={you} onClose={() => setShowPlayers(false)} />}

      <div class="dock he-dock" role="region" aria-label={t('table.summary')}>
        {showBoard && (
          <div class="card-box board-box" role="group" aria-label={boardLabel ? `${t('he.board')}: ${boardLabel}` : t('he.board')}>
            <span class="card-box-label">{t('he.board')}</span>
            <div class="card-box-cards">
              {[0, 1, 2, 3, 4].map((i) => {
                const c = board[i];
                return c && c.card != null ? <BigCard key={c.cid} card={c.card} mark={markOf(c.cid)} /> : <CardSlot key={`slot-${i}`} />;
              })}
            </div>
          </div>
        )}
        <div class="he-dock-main">
          <div class="dock-row wallet he-wallet">
            <span class="he-stack">
              {t('table.wallet')}: <b>{formatMoney(me?.stack ?? 0)}</b>
            </span>
            {view && (
              <span class="he-blinds">
                {formatMoney(view.rules.sb)} / {formatMoney(view.rules.bb)}
              </span>
            )}
            {view?.paused && <span>{t('table.paused')}</span>}
            {view?.phase === 'waiting' && !view.paused && <span>{t('table.waiting')}</span>}
          </div>

          {act && (
            <>
              {range && (
                <div class="dock-row raise-panel">
                  {presets.map((p) => (
                    <button class="btn btn-ghost btn-sm" disabled={!ready || busy} onClick={() => setRaiseTo(p.to)}>
                      {p.label}
                    </button>
                  ))}
                  <input
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={act.unit}
                    value={raiseTo}
                    aria-label={t(act.bet ? 'he.bet' : 'he.raise', { amount: formatMoney(raiseTo) })}
                    onInput={(e) => setRaiseTo(snap(Number((e.target as HTMLInputElement).value)))}
                    style={{ flex: '1 1 160px', accentColor: '#c9a24a' }}
                  />
                  <span class="tabular" style={{ minWidth: 70, color: 'var(--c-gold200)', fontWeight: 700 }}>
                    {formatMoney(raiseTo)}
                  </span>
                </div>
              )}
              <div class="dock-row action-bar" role="group" aria-label={t('table.yourTurn')}>
                {act.fold && (
                  <button class="btn btn-velvet" disabled={!ready || busy} onClick={() => void send({ type: 'FOLD' })}>
                    {t('he.fold')}
                    <span class="kbd">F</span>
                  </button>
                )}
                {act.check ? (
                  <button class="btn btn-lacquer" disabled={!ready || busy} onClick={() => void send({ type: 'CHECK' })}>
                    {t('he.check')}
                    <span class="kbd">C</span>
                  </button>
                ) : (
                  act.call != null && (
                    <button class="btn btn-lacquer" disabled={!ready || busy} onClick={() => void send({ type: 'CALL' })}>
                      {t(act.callIsAllIn ? 'he.callAllIn' : 'he.call', { amount: formatMoney(act.call) })}
                      <span class="kbd">C</span>
                    </button>
                  )
                )}
                {range && (
                  <button class="btn btn-brass" disabled={!ready || busy} onClick={() => void send({ type: act.bet ? 'BET' : 'RAISE', to: raiseTo })}>
                    {t(act.bet ? 'he.bet' : 'he.raise', { amount: formatMoney(raiseTo) })}
                    <span class="kbd">R</span>
                  </button>
                )}
                {act.allIn != null && (
                  <button class="btn btn-brass" disabled={!ready || busy} onClick={() => void send({ type: 'ALL_IN' })}>
                    {t('he.allIn', { amount: formatMoney(act.allIn) })}
                    <span class="kbd">A</span>
                  </button>
                )}
              </div>
            </>
          )}
          {legal?.kind === 'rebuy' && session.mode === 'remote' && (
            <button class="btn btn-brass" onClick={() => void send({ type: 'REBUY' })}>
              {t('he.rebuy', { amount: formatMoney(legal.amount) })}
            </button>
          )}
          {legal?.kind === 'sitIn' && (
            <button class="btn btn-brass" onClick={() => void send({ type: 'SIT_IN' })}>
              {t('bj.sitIn')}
            </button>
          )}
          {session.mode === 'remote' && me && view?.rules.entry === 'postOrWait' && me.needBB && (
            <label class="btn btn-ghost btn-sm" style={{ gap: 8 }}>
              <input type="checkbox" checked={me.waitForBB} onChange={(e) => void send({ type: 'SET_WAIT_BB', value: (e.target as HTMLInputElement).checked })} />
              {t('he.waitForBB')}
            </label>
          )}
        </div>
        {hole.length > 0 && (
          <div class="card-box hero-box" role="group" aria-label={t('he.yourCards')}>
            <span class="card-box-label">{t('he.yourCards')}</span>
            <div class="card-box-cards">
              {hole.map((c) => (
                <BigCard key={c.cid} card={c.card} mark={markOf(c.cid)} />
              ))}
            </div>
            {heroHand && <span class="card-box-caption">{heroHand}</span>}
          </div>
        )}
      </div>
      <ShowdownLog view={view} results={results} you={you} />
      <div class="sr-only" aria-live="assertive">
        {act && ready ? t('table.yourTurn') : ''}
      </div>
    </>
  );
}

/** Engine announcements carry seats and minor units; the HUD shows names and formatted chips. */
function announceParams(view: V | null, p?: Record<string, string | number>): Record<string, string | number> | undefined {
  if (!p) return p;
  const out: Record<string, string | number> = { ...p };
  if (typeof p.seat === 'number') out.name = view?.seats[p.seat]?.name ?? '';
  if (typeof p.amount === 'number') out.amount = formatMoney(p.amount);
  if (typeof p.sb === 'number') out.sb = formatMoney(p.sb);
  if (typeof p.bb === 'number') out.bb = formatMoney(p.bb);
  return out;
}

function ShowdownLog({ view, results, you }: { view: V | null; results: { seat: SeatId; net: number; hand: number; value?: number | null }[]; you: SeatId | null }) {
  if (!view || results.length === 0) return null;
  const lines = results.map((r) => {
    const s = view.seats[r.seat];
    const name = s?.name ?? '?';
    return { key: `${r.seat}-${r.hand}`, name, mine: r.seat === you, amount: r.net, shown: s?.shown, value: r.value ?? null };
  });
  return (
    <div class="plaque" style={{ position: 'absolute', left: '50%', top: '22%', transform: 'translateX(-50%)', zIndex: 16, padding: '10px 18px', pointerEvents: 'none', textAlign: 'center' }}>
      {lines.map((l) => (
        <div class="gold-text" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          {l.value != null
            ? t(l.mine ? 'he.youWinWith' : 'he.winsWith', { name: l.name, amount: formatMoney(l.amount), hand: handName(l.value) })
            : t(l.mine ? 'he.youWin' : 'he.wins', { name: l.name, amount: formatMoney(l.amount) })}
        </div>
      ))}
    </div>
  );
}

function HoldemPlayers({ view, you, onClose }: { view: V; you: SeatId | null; onClose: () => void }) {
  return (
    <aside class="players-panel" aria-label={t('table.players')}>
      <header>
        <h2 class="gold-text" style={{ fontSize: 16 }}>
          {t('table.players')}
        </h2>
        <button class="btn btn-ghost btn-icon" aria-label={t('nav.back')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <ul>
        {view.seats.map((s, id) =>
          s ? (
            <li class={id === you ? 'me' : ''}>
              <span class="avatar">{id + 1}</span>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {id === you ? t('table.you') : s.name} {view.button === id && <span class="kbd">D</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-ivory-mute)' }}>{s.folded ? t('he.folded') : s.allIn ? t('he.allInTag') : s.lastAction ?? ''}</div>
              </div>
              <span class="tabular" style={{ color: 'var(--c-gold300)' }}>
                {formatMoney(s.stack)}
              </span>
            </li>
          ) : null,
        )}
      </ul>
    </aside>
  );
}
