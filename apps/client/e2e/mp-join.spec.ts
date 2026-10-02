import { expect, test } from '@playwright/test';
import { fastSettings } from './helpers';

test('multiplayer blackjack: host opens a table, a friend joins by link, both play', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await fastSettings(pa, { locale: 'en' });
  await fastSettings(pb, { locale: 'en' });

  await pa.goto('/#/lobby/new?game=blackjack');
  await pa.getByLabel('Your nickname').fill('Ania');
  await pa.getByRole('button', { name: 'Continue' }).click();
  await pa.getByRole('button', { name: '25', exact: true }).click();
  await pa.getByRole('button', { name: 'Open a table' }).click();
  await expect(pa).toHaveURL(/#\/r\/[A-Z0-9]{6}$/);
  const code = pa.url().split('/r/')[1]!;

  await pb.goto(`/#/r/${code}`);
  await pb.getByLabel('Your nickname').fill('Bartek');
  await pb.getByRole('button', { name: 'Continue' }).click();

  await pa.getByRole('button', { name: 'Take a seat' }).click();
  await pb.getByRole('button', { name: 'Take a seat' }).click();
  await expect(pa.locator('.member-list li')).toHaveCount(2);
  await pa.getByRole('button', { name: 'Start the game' }).click();

  for (const p of [pa, pb]) await p.getByRole('button', { name: /^Bet 25/ }).click();
  for (let i = 0; i < 60; i++) {
    for (const p of [pa, pb]) {
      const stand = p.getByRole('button', { name: /^Stand/ });
      if (await stand.isEnabled().catch(() => false)) await stand.click().catch(() => undefined);
      const no = p.getByRole('button', { name: 'No', exact: true });
      if (await no.isVisible().catch(() => false)) await no.click().catch(() => undefined);
    }
    if ((await pa.locator('.outcome-badge').count()) > 0 && (await pb.locator('.outcome-badge').count()) > 0) break;
    await pa.waitForTimeout(200);
  }
  await expect(pa.locator('.outcome-badge').first()).toBeVisible();
  await expect(pb.locator('.outcome-badge').first()).toBeVisible();
  await a.close();
  await b.close();
});
