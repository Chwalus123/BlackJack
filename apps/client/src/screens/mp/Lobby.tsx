import '../landing.css';
import './mp.css';
import { useEffect, useState } from 'preact/hooks';
import type { RoomSummary } from '@casino/protocol';
import { formatMoney, t } from '../../i18n';
import { navigate } from '../../app/router';
import { Page, toast } from '../../ui/chrome';
import { DecoDivider, Icon } from '../../ui/deco';
import { connection, nickname } from '../../session/RemoteSession';
import { NicknameGate } from './NicknameGate';
import type { GameKind } from '../ModeSelect';

export function Lobby({ game }: { game: GameKind | null }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [code, setCode] = useState('');
  const [named, setNamed] = useState(!!nickname.value);
  const c = connection();

  const refresh = async () => {
    const r = await c.listRooms(game ?? undefined);
    if (r.ok) setRooms(r.data);
    else toast(t('error.generic'), 'error');
  };
  useEffect(() => {
    if (!named) return;
    void refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [named, game]);

  const title = t('mp.lobby');
  return (
    <Page backTo={game ? `/${game}` : '/'} title={title}>
      <h1 class="screen-title gold-text" tabIndex={-1}>
        {title}
      </h1>
      <p class="screen-sub">{game ? t(game === 'blackjack' ? 'game.blackjack' : 'game.holdem') : t('mode.multi')}</p>
      <DecoDivider />
      {!named ? (
        <NicknameGate onDone={() => setNamed(true)} />
      ) : (
        <div class="lobby-grid">
          <section class="plaque" aria-labelledby="rooms-h">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 id="rooms-h" class="gold-text" style={{ fontSize: 20 }}>
                {t('mp.rooms')}
              </h2>
              <button class="btn btn-ghost btn-sm" onClick={() => void refresh()}>
                {t('mp.refresh')}
              </button>
            </div>
            {rooms && rooms.length === 0 && <p style={{ color: 'var(--c-ivory-dim)' }}>{t('mp.noRooms')}</p>}
            <ul class="room-list">
              {rooms?.map((r) => (
                <li class="room-row">
                  <div>
                    <div class="title">{r.name}</div>
                    <div class="meta">
                      <span class="pill">{t(r.game === 'blackjack' ? 'game.blackjack' : 'game.holdem')}</span>
                      <span>
                        {r.game === 'blackjack'
                          ? t('table.stake', { amount: formatMoney(r.stakeLabel.stake ?? 0) })
                          : `${formatMoney(r.stakeLabel.sb ?? 0)} / ${formatMoney(r.stakeLabel.bb ?? 0)}`}
                      </span>
                      <span>
                        <Icon name="users" size={14} /> {t('mp.players', { count: r.players })}
                        {r.maxSeats ? ` / ${r.maxSeats}` : ''}
                      </span>
                    </div>
                  </div>
                  <button class="btn btn-brass btn-sm" onClick={() => navigate(`/r/${r.code}`)}>
                    {t('mp.join')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <aside style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
            <form
              class="plaque form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const v = code.trim().toUpperCase();
                if (v.length === 6) navigate(`/r/${v}`);
              }}
            >
              <div class="field">
                <label for="code">{t('mp.joinByCode')}</label>
                <input id="code" class="input code-input" maxLength={6} value={code} autoComplete="off" placeholder="ABC123" onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/[^a-z0-9]/gi, '').toUpperCase())} />
              </div>
              <button class="btn btn-lacquer" type="submit" disabled={code.length !== 6}>
                {t('mp.join')}
              </button>
            </form>
            <div class="plaque" style={{ textAlign: 'center' }}>
              <button class="btn btn-brass btn-lg" onClick={() => navigate(`/lobby/new?game=${game ?? 'blackjack'}`)}>
                {t('mp.create')}
              </button>
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}
