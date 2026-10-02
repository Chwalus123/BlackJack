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
  // The board and your hole cards are also shown as large 2D cards in the dock.
  const board = page.locator('.board-box');
  const yours = page.locator('.hero-box');
  await expect(yours.getByRole('img')).toHaveCount(2);
  await expect(yours.getByRole('img').first()).toHaveAttribute('aria-label', /^(10|[2-9JQKA])[♣♦♥♠]$/);
  let acted = 0;
  let flopSeen = false;
  for (let i = 0; i < 600 && (acted < 6 || !flopSeen); i++) {
    if ((await tryClick(page.getByRole('button', { name: /^Check/ }))) || (await tryClick(page.getByRole('button', { name: /^Call/ })))) acted++;
    if (!flopSeen && (await board.count()) > 0) {
      // five places on the board; dealt cards replace the empty slots
      expect(await board.locator('.big-card').count()).toBe(5);
      flopSeen = (await board.getByRole('img').count()) >= 3;
    }
    await page.waitForTimeout(100);
  }
  expect(acted).toBeGreaterThanOrEqual(3);
  expect(flopSeen).toBe(true);
});
