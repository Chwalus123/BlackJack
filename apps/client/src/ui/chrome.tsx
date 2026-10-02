import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { locale, setLocale, t } from '../i18n';
import { navigate } from '../app/router';
import { Icon, Monogram } from './deco';

export function LangToggle() {
  return (
    <div class="lang-toggle" role="group" aria-label={t('lang.label')}>
      {(['pl', 'en'] as const).map((l) => (
        <button type="button" aria-pressed={locale.value === l} onClick={() => setLocale(l)} lang={l} title={t(l === 'pl' ? 'lang.pl' : 'lang.en')}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function TopBar({ backTo, children }: { backTo?: string; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {backTo != null && (
          <button type="button" class="btn btn-ghost btn-icon" aria-label={t('nav.back')} onClick={() => navigate(backTo)}>
            <Icon name="back" />
          </button>
        )}
        <a class="brand" href="#/" aria-label={t('nav.home')}>
          <Monogram size={34} />
          <span>{t('app.name').toUpperCase()}</span>
        </a>
      </div>
      <div class="tools">
        {children}
        <LangToggle />
        <button type="button" class="btn btn-ghost btn-icon" aria-label={t('nav.settings')} onClick={() => navigate('/settings')}>
          <Icon name="gear" />
        </button>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer class="footer">
      <span>{t('app.disclaimer')}</span>
    </footer>
  );
}

export function Page({ backTo, children, tools, title }: { backTo?: string; children: ComponentChildren; tools?: ComponentChildren; title?: string }) {
  const h = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.title = title ? `${title} · ${t('app.name')}` : t('app.name');
    h.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [title, locale.value]);
  return (
    <div class="page" ref={h}>
      <a class="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        ↓
      </a>
      <TopBar backTo={backTo}>{tools}</TopBar>
      <main class="page-main" id="main" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  );
}

// ───── Toasts ─────
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}
export const toasts = signal<Toast[]>([]);
let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value.slice(-3), { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), ms);
}
export function ToastStack() {
  return (
    <div class="toast-stack" role="status" aria-live="polite">
      {toasts.value.map((x) => (
        <div key={x.id} class={`toast ${x.kind === 'error' ? 'error' : ''}`}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

// ───── Dialog ─────
export function Dialog({ title, children, onClose, labelledBy = 'dlg-title' }: { title: string; children: ComponentChildren; onClose?: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])') ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div class="dialog plaque" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <h2 id={labelledBy} class="gold-text">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
