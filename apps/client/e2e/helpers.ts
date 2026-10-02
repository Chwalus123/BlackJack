import type { Page } from '@playwright/test';

/** Fast, deterministic UI: instant animations, Polish locale, fresh wallet. */
export async function fastSettings(page: Page, opts: { locale?: 'pl' | 'en'; speed?: number | 'inf' } = {}) {
  await page.addInitScript(
    ({ locale, speed }) => {
      try {
        if (!sessionStorage.getItem('e2e-init')) {
          sessionStorage.setItem('e2e-init', '1');
          localStorage.clear();
          localStorage.setItem('jacbos:v1:settings', JSON.stringify({ sound: false, speed, reducedMotion: 'off' }));
          localStorage.setItem('jacbos:v1:locale', JSON.stringify(locale));
        }
      } catch {
        /* ignore */
      }
    },
    { locale: opts.locale ?? 'pl', speed: opts.speed ?? 'inf' },
  );
}
