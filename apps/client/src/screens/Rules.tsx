import './landing.css';
import { locale, t } from '../i18n';
import { RULES } from '../i18n/rules';
import { navigate } from '../app/router';
import { Page } from '../ui/chrome';
import { DecoDivider } from '../ui/deco';
import type { GameKind } from './ModeSelect';

export function Rules({ game }: { game: GameKind }) {
  const doc = RULES[locale.value][game];
  return (
    <Page backTo="/" title={doc.title}>
      <article class="plaque" style={{ maxWidth: 820, margin: '12px auto 0', padding: 'clamp(18px, 4vw, 36px)' }}>
        <h1 class="screen-title gold-text" tabIndex={-1}>
          {doc.title}
        </h1>
        <DecoDivider />
        <p style={{ fontSize: 17, color: 'var(--c-ivory)' }}>{doc.intro}</p>
        <nav aria-label={t('rules.toc')} style={{ margin: '14px 0 6px' }}>
          <ol style={{ columns: '2 220px', paddingLeft: 20, color: 'var(--c-ivory-dim)' }}>
            {doc.sections.map((s, i) => (
              <li>
                <a href={`#/rules/${game}`} onClick={(e) => { e.preventDefault(); document.getElementById(`r-${i}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
                  {s.h}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {doc.sections.map((s, i) => (
          <section id={`r-${i}`} style={{ marginTop: 22 }}>
            <h2 class="gold-text" style={{ fontSize: 20 }}>
              {s.h}
            </h2>
            {s.p?.map((p) => <p style={{ color: 'var(--c-ivory-dim)' }}>{p}</p>)}
            {s.list && (
              <ul style={{ color: 'var(--c-ivory-dim)', paddingLeft: 22, display: 'grid', gap: 6 }}>
                {s.list.map((x) => (
                  <li>{x}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 26 }}>
          <button class="btn btn-brass btn-lg" onClick={() => navigate(`/${game}`)}>
            {t('landing.play')}
          </button>
        </div>
      </article>
    </Page>
  );
}
