import './landing.css';
import { t } from '../i18n';
import { navigate } from '../app/router';
import { Page } from '../ui/chrome';
import { DecoDivider, SuitIcon, Sunburst } from '../ui/deco';

function Bulbs() {
  const n = 22;
  const bulbs = [];
  for (let i = 0; i < n; i++) bulbs.push({ left: `${(i / (n - 1)) * 100}%`, top: '0%' });
  for (let i = 0; i < n; i++) bulbs.push({ left: `${(i / (n - 1)) * 100}%`, top: '100%' });
  for (let i = 1; i < 5; i++) bulbs.push({ left: '0%', top: `${(i / 5) * 100}%` }, { left: '100%', top: `${(i / 5) * 100}%` });
  return (
    <div class="bulbs" aria-hidden="true">
      {bulbs.map((b) => (
        <span class="bulb" style={b} />
      ))}
    </div>
  );
}

function BlackjackEmblem() {
  return (
    <svg class="emblem" viewBox="0 0 120 84" aria-hidden="true">
      <g transform="rotate(-12 44 46)">
        <rect x="22" y="10" width="44" height="64" rx="5" fill="#f4ecd8" stroke="#c9a24a" />
        <text x="30" y="30" font-family="'Montserrat Variable',sans-serif" font-weight="800" font-size="16" fill="#141110">A</text>
        <path transform="translate(34 40) scale(0.2)" d="M50 6 C58 22 92 40 92 62 C92 78 76 86 62 78 C66 88 70 92 76 96 H24 C30 92 34 88 38 78 C24 86 8 78 8 62 C8 40 42 22 50 6 Z" fill="#141110" />
      </g>
      <g transform="rotate(10 76 46)">
        <rect x="54" y="10" width="44" height="64" rx="5" fill="#f4ecd8" stroke="#c9a24a" />
        <text x="62" y="30" font-family="'Montserrat Variable',sans-serif" font-weight="800" font-size="16" fill="#c0283a">K</text>
        <path transform="translate(66 40) scale(0.2)" d="M50 94 C38 80 6 60 6 34 C6 18 18 8 31 8 C40 8 46 13 50 21 C54 13 60 8 69 8 C82 8 94 18 94 34 C94 60 62 80 50 94 Z" fill="#c0283a" />
      </g>
    </svg>
  );
}

function HoldemEmblem() {
  const chip = (x: number, y: number, c: string) => (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="4" rx="16" ry="6" fill="#000" opacity="0.35" />
      <ellipse cx="0" cy="0" rx="16" ry="6" fill={c} stroke="#f4ecd8" stroke-dasharray="3 3" />
    </g>
  );
  return (
    <svg class="emblem" viewBox="0 0 120 84" aria-hidden="true">
      {chip(30, 66, '#b3202d')}
      {chip(30, 60, '#16130f')}
      {chip(30, 54, '#1f7a43')}
      {chip(92, 66, '#5b2a86')}
      {chip(92, 60, '#b3202d')}
      <rect x="44" y="12" width="32" height="46" rx="4" fill="#5e1220" stroke="#e6c878" />
      <rect x="48" y="16" width="24" height="38" rx="2" fill="none" stroke="#e6c878" stroke-dasharray="2 2" />
      <text x="60" y="40" text-anchor="middle" font-family="'Cinzel Variable',serif" font-weight="800" font-size="12" fill="#e6c878">JC</text>
    </svg>
  );
}

export function Landing() {
  return (
    <div class="landing">
      <div class="curtain left" />
      <div class="curtain right" />
      <Page>
        <Sunburst class="sunburst" />
        <section class="marquee" aria-labelledby="landing-title">
          <Bulbs />
          <h1 id="landing-title" tabIndex={-1} class="gold-text">
            {t('app.name').toUpperCase()}
          </h1>
          <div class="tag">{t('app.tagline')}</div>
        </section>
        <DecoDivider />
        <div class="game-cards">
          {(['blackjack', 'holdem'] as const).map((g) => (
            <article class="game-card" aria-labelledby={`gc-${g}`}>
              <div class="suits" aria-hidden="true">
                <SuitIcon suit="s" color="#e6c878" />
                <SuitIcon suit="h" color="#e6c878" />
                <SuitIcon suit="d" color="#e6c878" />
                <SuitIcon suit="c" color="#e6c878" />
              </div>
              {g === 'blackjack' ? <BlackjackEmblem /> : <HoldemEmblem />}
              <h2 id={`gc-${g}`} class="gold-text">
                {t(g === 'blackjack' ? 'game.blackjack' : 'game.holdem')}
              </h2>
              <p>{t(g === 'blackjack' ? 'game.blackjack.tagline' : 'game.holdem.tagline')}</p>
              <div class="actions">
                <button class="btn btn-brass btn-lg" onClick={() => navigate(`/${g}`)} onMouseEnter={() => void import('../three/preload').then((m) => m.preload())}>
                  {t('landing.play')}
                </button>
                <button class="btn btn-lacquer" onClick={() => navigate(`/rules/${g}`)}>
                  {t('landing.rules')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </Page>
    </div>
  );
}
