import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { tGift } from '@barghsa/i18n/gifts';
import { t } from '@barghsa/i18n/admin-ui';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { formatBrowserDate } from './browser-date';
import { giftCode } from '../src/test/gift-code-fixtures';

const exactIrr = '9007199254740993';
const fixed = {
  ...giftCode(),
  code: 'BARGHSA_EXACT',
  discountValue: exactIrr,
  usage: { consumed: 12, released: 2, totalDiscountIrr: exactIrr },
};
const percentage = {
  ...giftCode(1),
  code: 'BARGHSA_SAMPLE',
  discountType: 'percentage' as const,
  discountValue: '1250',
  maxCapIrr: '500000',
  eligibility: 'profile' as const,
  profileIds: ['11111111-1111-4111-8111-111111111111'],
  restoreAfterPayment: true,
  validFrom: '2026-09-24T00:00:00.000Z',
  validUntil: '2026-10-31T00:00:00.000Z',
  usage: { consumed: 3, released: 1, totalDiscountIrr: '125000' },
};
const normalizedDigits = (value: string) =>
  value
    .replace(/[۰-۹٠-٩]/g, (digit) => String(digit.charCodeAt(0) - (digit >= '۰' ? 0x6f0 : 0x660)))
    .replace(/[^0-9]/g, '');

async function inspect(page: Page) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const locale of ['en', 'fa'] as const) {
  const word = (key: string) => tGift(`admin.gifts.${key}`, locale);

  test(`gift-code tables preserve exact terms, usage and one edit draft through responsive recovery (${locale})`, async ({
    page,
  }, info) => {
    let status = 200,
      listReads = 0,
      statsReads = 0,
      writes = 0;
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/promotions/gift-codes**', (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      }
      const isStats = new URL(route.request().url()).pathname.endsWith('/stats');
      if (isStats) statsReads++;
      else listReads++;
      return route.fulfill({
        status,
        json:
          status !== 200
            ? {}
            : isStats
              ? { code: fixed, perProfile: [], recentRedemptions: [] }
              : [fixed, percentage],
      });
    });
    await page.goto('/admin/gift-codes');
    await page.setViewportSize({ width: 900, height: 900 });
    const table = page.getByRole('table', { name: word('title'), exact: true });
    const records = table.locator('tbody tr:has(th[scope=row])');
    await expect(records).toHaveCount(2);
    await expect(records.first().getByRole('rowheader')).toHaveText(fixed.code);
    const headings = await table.locator('thead th').allTextContents();
    const cell = (row: Locator, key: string) =>
      row.locator('th,td').nth(headings.findIndex((value) => value.trim() === word(key)));
    expect(
      normalizedDigits(await cell(records.first(), 'discount').locator('bdi').innerText())
    ).toBe(exactIrr);
    expect(normalizedDigits(await cell(records.first(), 'totalDiscount').innerText())).toBe(
      exactIrr
    );
    const count = locale === 'fa' ? '12' : '۱۲';
    await expect(cell(records.first(), 'consumed')).toHaveText(count);
    await expect(records.last()).toContainText(word('restricted'));
    await expect(records.last()).toContainText(word('restorePaid'));
    expect(
      normalizedDigits(await cell(records.last(), 'discount').locator('bdi').first().innerText())
    ).toBe('125');
    expect(
      normalizedDigits(await cell(records.last(), 'discount').locator('bdi').last().innerText())
    ).toBe(percentage.maxCapIrr);
    expect(await table.locator('thead').evaluate((node) => getComputedStyle(node).position)).toBe(
      'sticky'
    );
    const viewport = page.getByRole('region', { name: word('tableTitle'), exact: true });
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect(viewport).toBeFocused();
    await expect
      .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    await inspect(page);
    await records
      .first()
      .getByRole('button', { name: `${word('edit')} ${fixed.code}`, exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#gift-value')).toHaveValue(exactIrr);
    await page.locator('#gift-value').fill('۰۰۰۱۲۳۴۵');
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = page.getByRole('list', { name: word('title'), exact: true });
    const card = cards.locator(':scope > li').first();
    const sample = cards.locator(':scope > li').last();
    const field = (record: Locator, key: string) =>
      record.getByText(word(key), { exact: true }).locator('..').locator('dd');
    await expect(cards.locator(':scope > li')).toHaveCount(2);
    await expect(card.getByRole('heading', { name: fixed.code, exact: true })).toBeVisible();
    expect(normalizedDigits(await field(card, 'discount').locator('bdi').innerText())).toBe(
      exactIrr
    );
    expect(normalizedDigits(await field(card, 'totalDiscount').innerText())).toBe(exactIrr);
    await expect(field(card, 'consumed')).toHaveText(count);
    await expect(sample).toContainText(word('restricted'));
    await expect(sample).toContainText(word('restorePaid'));
    expect(
      normalizedDigits(await field(sample, 'discount').locator('bdi').last().innerText())
    ).toBe(percentage.maxCapIrr);
    for (const [index, stamp] of [percentage.validFrom, percentage.validUntil].entries()) {
      await expect(sample.locator('time').nth(index)).toHaveAttribute('datetime', stamp);
      await expect(sample.locator('time').nth(index)).toContainText(
        await formatBrowserDate(
          page,
          locale,
          { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
          stamp
        )
      );
    }
    await expect(card).toContainText(word('noExpiry'));
    await expect(page.locator('#gift-value')).toHaveCount(1);
    await expect(page.locator('#gift-value')).toHaveValue('۰۰۰۱۲۳۴۵');
    expect([listReads, statsReads, writes]).toEqual([1, 1, 0]);
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await sample.screenshot({
        path: '/Users/majid/.local/state/barghsa-manual-batches/gift-code-tables/gift-code-card-fa.png',
      });
    status = 503;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: word('error') })
        .first()
    ).toBeVisible();
    await expect(
      card.getByRole('button', { name: `${word('edit')} ${fixed.code}`, exact: true })
    ).toBeDisabled();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('#gift-value')).toHaveValue('۰۰۰۱۲۳۴۵');
    await expect(page.getByRole('button', { name: word('save'), exact: true })).toBeDisabled();
    status = 200;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('#gift-value')).toHaveValue('۰۰۰۱۲۳۴۵');
    status = 403;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.getByRole('table', { includeHidden: true })).toHaveCount(0);
    await expect(cards).toHaveCount(0);
    await expect(page.locator('#gift-value')).toHaveCount(0);
    expect(writes).toBe(0);
  });

  test(`gift-code table actions retain one captured status review across screen sizes (${locale})`, async ({
    page,
  }) => {
    let current = { ...percentage },
      listReads = 0;
    const writes: unknown[] = [];
    await crmShell(page, locale);
    await page.route('**/api/admin/promotions/gift-codes**', (route) => {
      if (route.request().method() === 'GET') {
        listReads++;
        return route.fulfill({ json: [current] });
      }
      writes.push(route.request().postDataJSON());
      current = { ...current, status: 'inactive' };
      return route.fulfill({ json: current });
    });
    await page.goto('/admin/gift-codes');
    await page.setViewportSize({ width: 900, height: 900 });
    const table = page.getByRole('table', { name: word('title'), exact: true });
    const dialog = page.getByRole('dialog');
    const toggleName = `${word('deactivate')} ${current.code}`;
    await table.getByRole('button', { name: toggleName, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toContainText(word('confirmStatus'));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
    const refresh = page.getByRole('button', { name: word('refresh'), exact: true });
    await expect(refresh).toBeFocused();
    const cards = page.getByRole('list', { name: word('title'), exact: true });
    await cards.getByRole('button', { name: toggleName, exact: true }).click();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(dialog).toHaveCount(1);
    expect([listReads, writes.length]).toEqual([1, 0]);
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([{ status: 'inactive' }]);
    await expect(
      table.getByRole('button', { name: `${word('activate')} ${current.code}`, exact: true })
    ).toBeVisible();
    await expect(table.locator('tbody tr:has(th[scope=row])')).toContainText(word('inactive'));
    await expect(page.getByRole('status').filter({ hasText: word('saved') })).toBeVisible();
    await expect(refresh).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(cards).toContainText(word('inactive'));
    expect(writes).toHaveLength(1);
  });
}
