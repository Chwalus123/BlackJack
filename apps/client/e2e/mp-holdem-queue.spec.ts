import { expect, test, type Browser, type Page } from '@playwright/test';
import { fastSettings } from './helpers';

async function player(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await fastSettings(p, { locale: 'en' });
  await p.goto('/#/lobby');
  await p.getByLabel('Your nickname').fill(name);
  await p.getByRole('button', { name: 'Continue' }).click();
  return p;
}

test("multiplayer Hold'em: fixed blinds, a full table queues the next player", async ({ browser }) => {
  const a = await player(browser, 'Ala');
  await a.goto('/#/lobby/new?game=holdem');
  await a.getByRole('button', { name: "Texas Hold'em" }).click();
  await a.locator('#seats').evaluate((el: HTMLInputElement) => {
    el.value = '2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(a.getByText('Seats: 2')).toBeVisible();
  await a.getByRole('button', { name: 'Open a table' }).click();
  await expect(a).toHaveURL(/#\/r\/[A-Z0-9]{6}$/);
  const code = a.url().split('/r/')[1]!;
  const b = await player(browser, 'Bob');
  const c = await player(browser, 'Cyd');
  await b.goto(`/#/r/${code}`);
  await c.goto(`/#/r/${code}`);
  for (const p of [a, b]) await p.getByRole('button', { name: 'Take a seat' }).click();
  await c.getByRole('button', { name: 'Take a seat' }).click();
  await expect(c.getByText('You are #1 in the queue for a seat')).toBeVisible();
  await a.getByRole('button', { name: 'Start the game' }).click();
  // Somebody gets to act within a few seconds, with blinds marked on the plates.
  await expect(a.locator('.seat-plate .tag', { hasText: /^(SB|BB)$/ }).first()).toBeVisible({ timeout: 30000 });
  await expect(async () => {
    const n = (await a.getByRole('button', { name: /^(Check|Call|Fold)/ }).count()) + (await b.getByRole('button', { name: /^(Check|Call|Fold)/ }).count());
    expect(n).toBeGreaterThan(0);
  }).toPass({ timeout: 30000 });
  for (const p of [a, b, c]) await p.context().close();
});
