import { expect, test } from '@playwright/test';
import { fastSettings } from './helpers';

test('landing is casino-styled, Polish by default, English toggle persists', async ({ page }) => {
  await fastSettings(page);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText(/JACBOS CASINO/i);
  await expect(page.getByRole('button', { name: 'Graj' }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play' }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Rules' }).first().click();
  await expect(page.locator('h1')).toContainText('Blackjack');
});

test('no horizontal scroll on a phone', async ({ page }) => {
  await fastSettings(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(360);
});
