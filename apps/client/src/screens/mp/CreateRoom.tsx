import '../landing.css';
import './mp.css';
import { useState } from 'preact/hooks';
import { defaultSettings, LIMITS, type RoomSettings } from '@casino/protocol';
import { formatMoney, t } from '../../i18n';
import { navigate } from '../../app/router';
import { Page, toast } from '../../ui/chrome';
import { DecoDivider } from '../../ui/deco';
import { connection, nickname } from '../../session/RemoteSession';
import { NicknameGate } from './NicknameGate';
import type { GameKind } from '../ModeSelect';

export function SettingsForm({ value, onChange }: { value: RoomSettings; onChange: (s: RoomSettings) => void }) {
  const s = value;
  return (
    <>
      {s.game === 'blackjack' ? (
        <>
          <div class="field">
            <span class="label">{t('mp.stake')}</span>
            <div class="segmented" role="group">
              {LIMITS.bj.stakes.map((v) => (
                <button type="button" aria-pressed={s.stake === v} onClick={() => onChange({ ...s, stake: v })}>
                  {formatMoney(v)}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span class="label">{t('mp.bankroll')}</span>
            <div class="segmented" role="group">
              {LIMITS.bj.bankrollMultiples.map((n) => (
                <button type="button" aria-pressed={s.bankrollMultiple === n} onClick={() => onChange({ ...s, bankrollMultiple: n })}>
                  {formatMoney(s.stake * n)} · {t('mp.bankrollMultiple', { n })}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div class="field">
            <span class="label">{t('mp.blinds')}</span>
            <div class="segmented" role="group">
              {LIMITS.he.blinds.map(([sb, bb]) => (
                <button type="button" aria-pressed={s.bb === bb} onClick={() => onChange({ ...s, sb, bb })}>
                  {formatMoney(sb)} / {formatMoney(bb)}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span class="label">{t('mp.buyIn')}</span>
            <div class="segmented" role="group">
              {LIMITS.he.buyInBB.map((n) => (
                <button type="button" aria-pressed={s.buyInBB === n} onClick={() => onChange({ ...s, buyInBB: n })}>
                  {formatMoney(s.bb * n)} · {t('mp.buyInBB', { n })}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <label class="label" for="seats">
              {t('mp.maxSeats')}: {s.maxSeats}
            </label>
            <input id="seats" type="range" min={LIMITS.he.maxSeats.min} max={LIMITS.he.maxSeats.max} value={s.maxSeats} onInput={(e) => onChange({ ...s, maxSeats: Number((e.target as HTMLInputElement).value) })} />
          </div>
        </>
      )}
      <div class="field">
        <span class="label">{t('mp.timer')}</span>
        <div class="segmented" role="group">
          {[10, 15, 20, 30, 45, 60].map((n) => (
            <button type="button" aria-pressed={s.decisionSec === n} onClick={() => onChange({ ...s, decisionSec: n })}>
              {t('mp.seconds', { n })}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <span class="label">{t('mp.rebuy')}</span>
        <div class="segmented" role="group">
          {(['whenBroke', 'never'] as const).map((r) => (
            <button type="button" aria-pressed={s.rebuy === r} onClick={() => onChange({ ...s, rebuy: r })}>
              {t(`mp.rebuy.${r}`)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function CreateRoom({ game }: { game: GameKind }) {
  const [named, setNamed] = useState(!!nickname.value);
  const [g, setG] = useState<GameKind>(game);
  const [settings, setSettings] = useState<RoomSettings>(defaultSettings(game));
  const [name, setName] = useState(nickname.value ? `${nickname.value}` : '');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const c = connection();
    const r = await c.createRoom({ name: name || (nickname.value ?? 'Jacbos'), visibility, settings });
    setBusy(false);
    if (!r.ok) return toast(t(`error.${r.code}` as 'error.generic'), 'error');
    navigate(`/r/${r.data.code}`);
  };

  return (
    <Page backTo={`/lobby?game=${g}`} title={t('mp.createTitle')}>
      <h1 class="screen-title gold-text" tabIndex={-1}>
        {t('mp.createTitle')}
      </h1>
      <DecoDivider />
      {!named ? (
        <NicknameGate onDone={() => setNamed(true)} />
      ) : (
        <form class="plaque form-grid" style={{ maxWidth: 720, margin: '12px auto 0' }} onSubmit={create}>
          <div class="field">
            <span class="label">{t('landing.play')}</span>
            <div class="segmented" role="group">
              {(['blackjack', 'holdem'] as const).map((x) => (
                <button type="button" aria-pressed={g === x} onClick={() => { setG(x); setSettings(defaultSettings(x)); }}>
                  {t(x === 'blackjack' ? 'game.blackjack' : 'game.holdem')}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <label for="rname">{t('mp.roomName')}</label>
            <input id="rname" class="input" maxLength={32} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <span class="label">{t('mp.visibility')}</span>
            <div class="segmented" role="group">
              {(['public', 'private'] as const).map((v) => (
                <button type="button" aria-pressed={visibility === v} onClick={() => setVisibility(v)}>
                  {t(v === 'public' ? 'mp.public' : 'mp.private')}
                </button>
              ))}
            </div>
          </div>
          <SettingsForm value={settings} onChange={setSettings} />
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button class="btn btn-brass btn-lg" type="submit" disabled={busy}>
              {t('mp.create')}
            </button>
          </div>
        </form>
      )}
    </Page>
  );
}
