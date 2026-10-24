import { expect, test, type Page } from '@playwright/test';
import { STATIC_BASE } from './ports.ts';

async function add(
  page: Page,
  type: 'income' | 'expense',
  amount: string,
  category: string,
  date: string,
  note = '',
) {
  await page.locator(`button[data-type="${type}"]`).click();
  await page.fill('#f-amount', amount);
  await page.fill('#f-category', category);
  await page.fill('#f-date', date);
  await page.fill('#f-note', note);
  await page.click('#f-submit');
}

test('tracks income and expenses by day, month and category', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(
        'joyconhub.expenses.v1',
        JSON.stringify({ transactions: [], currency: 'USD' }),
      );
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto(`${STATIC_BASE}expenses.html`);

  await add(page, 'income', '3000', 'Salary', '2026-03-01');
  await add(page, 'expense', '1,200', 'Rent', '2026-03-01');
  await add(page, 'expense', '45.50', 'Groceries', '2026-03-04', 'Weekly shop');
  await add(page, 'expense', '20', 'Groceries', '2026-03-04');

  const summary = page.locator('#summary');
  await expect(page.locator('#month-title')).toContainText('2026');
  await expect(summary.locator('.income strong')).toHaveText('$3,000.00');
  await expect(summary.locator('.expense strong')).toHaveText('$1,265.50');
  await expect(summary.locator('.net strong')).toHaveText('+$1,734.50');

  // Daily tracker: one row per active day, newest first, with month-to-date balance.
  await page.click('[data-tab="daily"]');
  const days = page.locator('#view tbody tr');
  await expect(days).toHaveCount(2);
  await expect(days.first().locator('td').nth(2)).toHaveText('$65.50');
  await expect(days.first().locator('td').nth(4)).toHaveText('+$1,734.50');

  // Monthly tracker shows the month in its year.
  await page.click('[data-tab="monthly"]');
  await expect(page.locator('[data-month="2026-03"] td').nth(3)).toHaveText('+$1,734.50');

  // Categories, largest first.
  await page.click('[data-tab="categories"]');
  const spend = page.locator('.cat-block.expense li');
  await expect(spend.locator('.cat-name')).toHaveText(['Rent', 'Groceries']);
  await expect(spend.nth(1).locator('.cat-amt')).toHaveText('$65.50');

  // Clicking a category lists its transactions; edit one and delete another.
  await spend.nth(1).click();
  await expect(page.locator('.tx')).toHaveCount(2);
  await page.locator('.tx', { hasText: 'Weekly shop' }).locator('[data-edit]').click();
  await page.fill('#f-amount', '50');
  await page.click('#f-submit');
  page.once('dialog', (d) => d.accept());
  await page.locator('.tx', { hasNotText: 'Weekly shop' }).locator('[data-delete]').click();
  await expect(page.locator('.tx')).toHaveCount(1);
  await expect(summary.locator('.expense strong')).toHaveText('$1,250.00');

  // Data survives a reload (which reopens on the current month, so check the all-time balance).
  await page.reload();
  await expect(summary.locator('.balance strong')).toHaveText('+$1,750.00');
});
