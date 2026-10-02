import './landing.css';
import { useState } from 'preact/hooks';
import { CHIP, type Money } from '@casino/engine';
import { formatMoney, t } from '../i18n';
import { navigate } from '../app/router';
import { Page } from '../ui/chrome';
import { DecoDivider } from '../ui/deco';
import { profile, resetWallet } from '../session/wallet';
import { loadJSON, saveJSON } from '../store/persist';
import { settings, updateSettings, SPEEDS, type Speed } from '../store/settings';
import type { GameKind } from './ModeSelect';

export type TableStyle = 'mixed' | 'tight' | 'loose';

export interface SoloSetupData {
  bots: number;
  style: TableStyle;
  limits: [Money, Money]; // blackjack
  blinds: [Money, Money]; // hold'em
  buyInBB: number; // hold'em
}

export const BJ_LIMITS: [Money, Money][] = [
  [5 * CHIP, 500 * CHIP],
  [10 * CHIP, 1000 * CHIP],
  [25 * CHIP, 2500 * CHIP],
  [100 * CHIP, 10000 * CHIP],
];
export const HE_BLINDS: [Money, Money][] = [
  [1 * CHIP, 2 * CHIP],
  [5 * CHIP, 10 * CHIP],
  [25 * CHIP, 50 * CHIP],
  [100 * CHIP, 200 * CHIP],
];
const BANKROLLS: Money[] = [500 * CHIP, 1000 * CHIP, 5000 * CHIP, 10000 * CHIP];
const BUYINS = [40, 100, 200];

export function defaultSetup(game: GameKind): SoloSetupData {
  return {
    bots: game === 'blackjack' ? 2 : 3,
    style: 'mixed',
    limits: BJ_LIMITS[0]!,
    blinds: HE_BLINDS[0]!,
    buyInBB: 100,
  };
}

export function loadSetup(game: GameKind): SoloSetupData {
  return { ...defaultSetup(game), ...loadJSON<Partial<SoloSetupData>>(`setup:${game}`, {}) };
}

const speedKey = (s: Speed) => (s === 'inf' ? 'speed.inf' : (`speed.${s}` as const));

export function SoloSetup({ game }: { game: GameKind }) {
  const [s, setS] = useState<SoloSetupData>(loadSetup(game));
  const [custom, setCustom] = useState('');
  const wallet = profile.value.wallet;
  const minBots = game === 'holdem' ? 1 : 0;
  const update = (patch: Partial<SoloSetupData>) => setS({ ...s, ...patch });
  const title = t(game === 'blackjack' ? 'game.blackjack' : 'game.holdem');

  const minStake = game === 'blackjack' ? s.limits[0] : s.blinds[1] * Math.min(...BUYINS);
  const canStart = wallet >= minStake;

  const start = () => {
    saveJSON(`setup:${game}`, s);
    navigate(`/${game}/solo/table`);
  };

  return (
    <Page backTo={`/${game}`} title={`${title} · ${t('mode.solo')}`}>
      <h1 class="screen-title gold-text" tabIndex={-1}>
        {t('setup.title')}
      </h1>
      <p class="screen-sub">
        {title} · {t('mode.solo')}
      </p>
      <DecoDivider />
      <div class="plaque" style={{ maxWidth: 700, margin: '12px auto 0', display: 'grid', gap: 22 }}>
        <div class="field">
          <span class="label">{t('setup.bankroll')}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <span class="display gold-text" style={{ fontSize: 30 }}>
              {formatMoney(wallet)}
            </span>
            <span style={{ color: 'var(--c-ivory-mute)', fontSize: 13 }}>{t('setup.resetWallet')}:</span>
          </div>
          <div class="segmented" role="group" aria-label={t('setup.resetWallet')}>
            {BANKROLLS.map((b) => (
              <button type="button" aria-pressed={false} onClick={() => resetWallet(b)}>
                {formatMoney(b)}
              </button>
            ))}
            <input
              class="input"
              style={{ width: 130, minHeight: 42 }}
              inputMode="numeric"
              placeholder={t('setup.custom')}
              value={custom}
              aria-label={t('setup.custom')}
              onInput={(e) => setCustom((e.target as HTMLInputElement).value.replace(/[^\d]/g, '').slice(0, 7))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Math.min(1_000_000, Math.max(100, Number(custom))) * CHIP;
                  if (Number(custom) > 0) resetWallet(v);
                  setCustom('');
                }
              }}
              onBlur={() => {
                if (Number(custom) > 0) resetWallet(Math.min(1_000_000, Math.max(100, Number(custom))) * CHIP);
                setCustom('');
              }}
            />
          </div>
        </div>

        {game === 'blackjack' ? (
          <div class="field">
            <span class="label">{t('setup.limits')}</span>
            <div class="segmented" role="group">
              {BJ_LIMITS.map((l) => (
                <button type="button" aria-pressed={s.limits[0] === l[0]} onClick={() => update({ limits: l })}>
                  {formatMoney(l[0])} – {formatMoney(l[1])}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div class="field">
              <span class="label">{t('setup.blinds')}</span>
              <div class="segmented" role="group">
                {HE_BLINDS.map((b) => (
                  <button type="button" aria-pressed={s.blinds[1] === b[1]} onClick={() => update({ blinds: b })}>
                    {formatMoney(b[0])} / {formatMoney(b[1])}
                  </button>
                ))}
              </div>
            </div>
            <div class="field">
              <span class="label">{t('setup.buyIn')}</span>
              <div class="segmented" role="group">
                {BUYINS.map((n) => (
                  <button type="button" aria-pressed={s.buyInBB === n} onClick={() => update({ buyInBB: n })}>
                    {formatMoney(n * s.blinds[1])} · {t('mp.buyInBB', { n })}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div class="field">
          <span class="label">{t('setup.bots')}</span>
          <div class="segmented" role="group">
            {[0, 1, 2, 3, 4]
              .filter((n) => n >= minBots)
              .map((n) => (
                <button type="button" aria-pressed={s.bots === n} onClick={() => update({ bots: n })}>
                  {n === 0 ? t('setup.botsNone') : n}
                </button>
              ))}
          </div>
        </div>

        {s.bots > 0 && (
          <div class="field">
            <span class="label">{t('setup.style')}</span>
            <div class="segmented" role="group">
              {(['mixed', 'tight', 'loose'] as const).map((st) => (
                <button type="button" aria-pressed={s.style === st} onClick={() => update({ style: st })}>
                  {t(`style.${st}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div class="field">
          <span class="label">{t('setup.speed')}</span>
          <div class="segmented" role="group">
            {SPEEDS.map((sp) => (
              <button type="button" aria-pressed={settings.value.speed === sp} onClick={() => updateSettings({ speed: sp })}>
                {t(speedKey(sp) as 'speed.1')}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button class="btn btn-brass btn-lg" disabled={!canStart} onClick={start}>
            {t('setup.start')}
          </button>
        </div>
        {!canStart && <p style={{ textAlign: 'center', color: 'var(--c-danger)', margin: 0 }}>{t('table.broke')}</p>}
      </div>
    </Page>
  );
}
