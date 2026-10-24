import { expect, test, type Page } from '@playwright/test';
import { MONEY_BASE } from './ports.ts';

async function add(
  page: Page,
  type: 'income' | 'expense',
  amount: string,
  category: string,
  date: string,
  note = '',
) {
  await page.click('#add-open');
  await page.locator(`button[data-type="${type}"]`).click();
  await page.fill('#f-amount', amount);
  await page.locator('#category-chips [data-chip]', { hasText: category }).first().click();
  await page.fill('#f-date', date);
  await page.fill('#f-note', note);
  await page.click('#f-submit');
  await expect(page.locator('#tx-sheet')).toBeHidden();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('tracks money in and out by day, month and category on a phone', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(
        'money-tracker.data.v1',
        JSON.stringify({ transactions: [], currency: 'USD' }),
      );
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto(MONEY_BASE);

  await add(page, 'income', '3000', 'Salary', '2026-03-01');
  await add(page, 'expense', '1,200', 'Rent', '2026-03-01');
  await add(page, 'expense', '45.50', 'Groceries', '2026-03-04', 'Weekly shop');
  await expect(page.locator('#toast')).toContainText('$45.50');
  await add(page, 'expense', '20', 'Groceries', '2026-03-04');

  const summary = page.locator('#summary');
  await expect(page.locator('#month-title')).toContainText('2026');
  await expect(summary.locator('.income strong')).toHaveText('$3,000');
  await expect(summary.locator('.expense strong')).toHaveText('$1,265.50');
  await expect(summary.locator('.net strong')).toHaveText('+$1,734.50');

  // Daily tracker: one row per active day, newest first, with the running balance.
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

  // Tapping a category lists its entries; tap one to edit it, another to delete it.
  await spend.nth(1).click();
  await expect(page.locator('.tx')).toHaveCount(2);
  await page.locator('.tx', { hasText: 'Weekly shop' }).click();
  await page.fill('#f-amount', '50');
  await page.click('#f-submit');
  await page.locator('.tx', { hasNotText: 'Weekly shop' }).click();
  page.once('dialog', (d) => d.accept());
  await page.click('#f-delete');
  await expect(page.locator('.tx')).toHaveCount(1);
  await expect(summary.locator('.expense strong')).toHaveText('$1,250');

  // Data survives a restart (which reopens on the current month, so check the all-time balance).
  await page.reload();
  await expect(summary.locator('.balance strong')).toHaveText('+$1,750');
});

test('adds entries from bank SMS once, and explains a refused permission', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    (window as unknown as { __moneyFakeSms: unknown }).__moneyFakeSms = {
      // Remembered across reloads, like Android does.
      get permission() {
        return sessionStorage.getItem('deny')
          ? 'denied'
          : (sessionStorage.getItem('perm') ?? 'prompt');
      },
      set permission(v: string) {
        sessionStorage.setItem('perm', v);
      },
      messages: [
        {
          id: '101',
          address: 'AD-HDFCBK-S',
          body: 'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On today Ref 429876543210',
          date: now - 120_000,
        },
        {
          id: '102',
          address: 'VK-HDFCBK',
          body: 'INR 85,000.00 credited to HDFC Bank A/c XX1234 for NEFT ACME SALARY. Avl bal INR 1,20,000.00',
          date: now - 90_000,
        },
        {
          id: '103',
          address: 'AD-HDFCBK',
          body: 'Your OTP is 123456 for Rs 10',
          date: now - 60_000,
        },
      ],
    };
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      localStorage.setItem(
        'money-tracker.data.v1',
        JSON.stringify({ transactions: [], currency: 'INR' }),
      );
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto(MONEY_BASE);

  page.once('dialog', (d) => d.accept()); // "Also add bank SMS from earlier this month?"
  await page.locator('#sms-banner [data-sms="enable"]').click();
  await expect(page.locator('#toast')).toHaveText('Added 2 entries from bank SMS');
  await expect(page.locator('#sms-banner')).toHaveCount(0);
  await expect(page.locator('#summary .income strong')).toHaveText('₹85,000');
  await expect(page.locator('#summary .expense strong')).toHaveText('₹250');

  await page.click('[data-tab="transactions"]');
  await expect(page.locator('.tx .badge')).toHaveCount(2);
  await expect(page.locator('.tx', { hasText: 'Food & Dining' })).toContainText('SWIGGY');
  await expect(page.locator('.tx', { hasText: 'Salary' })).toContainText('+₹85,000.00');

  // Reopening the app reads the same inbox again without adding anything twice.
  await page.reload();
  await page.click('[data-tab="transactions"]');
  await expect(page.locator('.tx')).toHaveCount(2);
  await page.click('#menu-open');
  await expect(page.locator('#sms-toggle')).toBeChecked();

  // Permission refused: the switch turns off and the menu explains how to allow it.
  await page.evaluate(() => sessionStorage.setItem('deny', '1'));
  await page.reload();
  await page.click('#menu-open');
  await expect(page.locator('#sms-settings .warn')).toContainText('Allow restricted settings');
  await expect(page.locator('#sms-toggle')).not.toBeChecked();
});
