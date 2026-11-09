import './landing.css';
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { t } from '../i18n';
import { navigate } from '../app/router';
import { Page } from '../ui/chrome';
import { DecoDivider, Icon } from '../ui/deco';

export type GameKind = 'blackjack' | 'holdem';

const serverUp = signal<boolean | null>(null);

async function probe(): Promise<void> {
  try {
    const r = await fetch('/healthz', { cache: 'no-store' });
    serverUp.value = r.ok;
  } catch {
    serverUp.value = false;
  }
}

export function ModeSelect({ game }: { game: GameKind }) {
  useEffect(() => {
    void probe();
  }, []);
  const title = t(game === 'blackjack' ? 'game.blackjack' : 'game.holdem');
  return (
    <Page backTo="/" title={title}>
      <h1 class="screen-title gold-text" tabIndex={-1}>
        {title}
      </h1>
      <p class="screen-sub">{t('mode.title')}</p>
      <DecoDivider />
      <div class="mode-cards">
        <button class="plaque mode-card" onClick={() => navigate(`/${game}/solo`)}>
          <h2 class="gold-text">{t('mode.solo')}</h2>
          <p>{t('mode.solo.desc')}</p>
        </button>
        <button class="plaque mode-card" disabled={serverUp.value === false} onClick={() => navigate(`/lobby?game=${game}`)}>
          <h2 class="gold-text" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="users" size={24} /> {t('mode.multi')}
          </h2>
          <p>{serverUp.value === false ? t('mode.multi.offline') : t('mode.multi.desc')}</p>
        </button>
      </div>
    </Page>
  );
}
