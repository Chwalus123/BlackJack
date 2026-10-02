import { expect, test, type Locator } from '@playwright/test';
import { fastSettings } from './helpers';

async function tryClick(l: Locator): Promise<boolean> {
  if ((await l.count()) === 0) return false;
  if (!(await l.first().isEnabled())) return false;
  await l.first().click({ timeout: 2000 }).catch(() => undefined);
  return true;
}

test("single-player Texas Hold'em: blinds are posted, the player acts, hands keep coming", async ({ page }) => {
  await fastSettings(page, { locale: 'en' });
  await page.goto('/#/holdem/solo');
  await page.getByRole('button', { name: '1', exact: true }).click(); // heads-up vs one AI
  await page.getByRole('button', { name: 'Take a seat' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.seat-plate .tag', { hasText: /^(SB|BB)$/ }).first()).toBeVisible({ timeout: 30000 });
  let acted = 0;
  for (let i = 0; i < 400 && acted < 6; i++) {
    if ((await tryClick(page.getByRole('button', { name: /^Check/ }))) || (await tryClick(page.getByRole('button', { name: /^Call/ })))) acted++;
    await page.waitForTimeout(100);
  }
  expect(acted).toBeGreaterThanOrEqual(3);
});
