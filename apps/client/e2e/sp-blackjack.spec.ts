import { expect, test } from '@playwright/test';
import { fastSettings } from './helpers';

test('single-player blackjack: bet, deal, play a hand, wallet persists', async ({ page }) => {
  await fastSettings(page, { locale: 'en' });
  await page.goto('/#/blackjack/solo');
  await page.getByRole('button', { name: '1', exact: true }).click(); // one AI player
  await page.getByRole('button', { name: 'Take a seat' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const deal = page.getByRole('button', { name: /^Deal/ });
  await expect(deal).toBeVisible();
  await page.getByRole('button', { name: /^25 \(3\)/ }).click(); // a 25 chip
  await expect(deal).toBeEnabled();
  await deal.click();
  // Play the hand out: stand whenever it is our turn, decline insurance.
  for (let i = 0; i < 40; i++) {
    const stand = page.getByRole('button', { name: /^Stand/ });
    const no = page.getByRole('button', { name: 'No', exact: true });
    if (await stand.isEnabled().catch(() => false)) await stand.click();
    else if (await no.isVisible().catch(() => false)) await no.click();
    if (await page.locator('.outcome-badge').first().isVisible().catch(() => false)) break;
    await page.waitForTimeout(150);
  }
  await expect(page.locator('.outcome-badge').first()).toBeVisible();
  const wallet = await page.evaluate(() => JSON.parse(localStorage.getItem('jacbos:v1:profile') ?? '{}').wallet);
  expect(typeof wallet).toBe('number');
  // A new round opens without reloading.
  await expect(deal).toBeVisible({ timeout: 20000 });
});
