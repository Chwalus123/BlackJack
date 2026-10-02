import { expect, test, type Locator } from '@playwright/test';
import { fastSettings } from './helpers';

/** Click if present and enabled — never auto-waits (a missing button just means "not now"). */
async function tryClick(l: Locator): Promise<boolean> {
  if ((await l.count()) === 0) return false;
  if (!(await l.first().isEnabled())) return false;
  await l.first().click({ timeout: 2000 }).catch(() => undefined);
  return true;
}

test('single-player blackjack: bet, deal, play a hand, wallet persists, next round opens', async ({ page }) => {
  await fastSettings(page, { locale: 'en' });
  await page.goto('/#/blackjack/solo');
  await page.getByRole('button', { name: '1', exact: true }).click(); // one AI player
  await page.getByRole('button', { name: 'Take a seat' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const deal = page.getByRole('button', { name: /^Deal/ });
  await expect(deal).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /^25 \(3\)/ }).click(); // a 25 chip
  await expect(deal).toBeEnabled();
  await deal.click();
  await expect(deal).toHaveCount(0);
  let seenOutcome = false;
  for (let i = 0; i < 300; i++) {
    seenOutcome ||= (await page.locator('.outcome-badge').count()) > 0;
    if (seenOutcome && (await deal.count()) > 0) break;
    if (!(await tryClick(page.getByRole('button', { name: /^Stand/ })))) await tryClick(page.getByRole('button', { name: 'No', exact: true }));
    await page.waitForTimeout(100);
  }
  const wallet = await page.evaluate(() => JSON.parse(localStorage.getItem('jacbos:v1:profile') ?? '{}').wallet as number);
  expect(seenOutcome || wallet !== 100000).toBe(true);
  // A new round opens without reloading.
  await expect(deal).toBeVisible({ timeout: 30000 });
  // Wallet survives a reload.
  await page.reload();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jacbos:v1:profile') ?? '{}').wallet as number);
  expect(after).toBe(wallet);
});
