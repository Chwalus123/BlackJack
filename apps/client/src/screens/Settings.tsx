import './landing.css';
import { t, locale, setLocale } from '../i18n';
import { Page } from '../ui/chrome';
import { settings, updateSettings, SPEEDS, type Speed } from '../store/settings';

const speedKey = (s: Speed) => (s === 'inf' ? 'speed.inf' : (`speed.${s}` as const));

export function Settings() {
  const s = settings.value;
  return (
    <Page backTo="/" title={t('settings.title')}>
      <h1 class="screen-title gold-text" tabIndex={-1}>
        {t('settings.title')}
      </h1>
      <div class="plaque" style={{ maxWidth: 620, margin: '22px auto 0', display: 'grid', gap: 22 }}>
        <div class="field">
          <span class="label">{t('lang.label')}</span>
          <div class="segmented" role="group">
            {(['pl', 'en'] as const).map((l) => (
              <button type="button" aria-pressed={locale.value === l} onClick={() => setLocale(l)}>
                {t(l === 'pl' ? 'lang.pl' : 'lang.en')}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">{t('settings.speed')}</span>
          <div class="segmented" role="group">
            {SPEEDS.map((sp) => (
              <button type="button" aria-pressed={s.speed === sp} onClick={() => updateSettings({ speed: sp })}>
                {t(speedKey(sp) as 'speed.1')}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">{t('settings.motion')}</span>
          <div class="segmented" role="group">
            {(['system', 'on', 'off'] as const).map((m) => (
              <button type="button" aria-pressed={s.reducedMotion === m} onClick={() => updateSettings({ reducedMotion: m })}>
                {t(`settings.motion.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">{t('settings.quality')}</span>
          <div class="segmented" role="group">
            {(['auto', 'high', 'low'] as const).map((q) => (
              <button type="button" aria-pressed={s.quality === q} onClick={() => updateSettings({ quality: q })}>
                {t(`settings.quality.${q}`)}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">{t('settings.sound')}</span>
          <div class="segmented" role="group">
            {[true, false].map((on) => (
              <button type="button" aria-pressed={s.sound === on} onClick={() => updateSettings({ sound: on })}>
                {t(on ? 'settings.on' : 'settings.off')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}
