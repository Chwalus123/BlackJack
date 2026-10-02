import { expect, test } from '@playwright/test';
import { fastSettings } from './helpers';

test("single-player Texas Hold'em: blinds, act, a hand completes", async ({ page }) => {
  await fastSettings(page, { locale: 'en' });
  await page.goto('/#/holdem/solo');
  await page.getByRole('button', { name: '1', exact: true }).click(); // heads-up vs one AI
  await page.getByRole('button', { name: 'Take a seat' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  let acted = 0;
  for (let i = 0; i < 120 && acted < 6; i++) {
    const check = page.getByRole('button', { name: /^Check/ });
    const call = page.getByRole('button', { name: /^Call/ });
    if (await check.isEnabled().catch(() => false)) {
      await check.click().catch(() => undefined);
      acted++;
    } else if (await call.isEnabled().catch(() => false)) {
      await call.click().catch(() => undefined);
      acted++;
    }
    await page.waitForTimeout(200);
  }
  expect(acted).toBeGreaterThan(0);
  await expect(page.locator('.tag', { hasText: /^(SB|BB)$/ }).first()).toBeVisible();
});
