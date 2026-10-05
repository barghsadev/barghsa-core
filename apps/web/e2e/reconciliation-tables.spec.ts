import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { formatBrowserDate } from './browser-date';
import { reconciliationItem } from '../src/test/payment-review-fixtures';

for (const locale of ['en', 'fa'] as const) {
  test(`reconciliation cards retain review drafts and visible focus across screen sizes (${locale})`, async ({
    page,
  }, info) => {
    const word = (key: string) => t(`admin.reconciliation.${key}`, locale);
    const item = {
      ...reconciliationItem,
      description: 'مغایرت مانده کیف پول نمونه',
      assignedToUsername: 'staff.sample',
    };
    let status = 200,
      reads = 0,
      writes = 0,
      hold = false;
    let held: Route | undefined;
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/reconciliation/items/access', (route) =>
      route.fulfill({ json: { canView: true, canResolve: true } })
    );
    await page.route('**/api/admin/reconciliation/items?*', (route) => {
      reads++;
      if (hold) {
        held = route;
        return;
      }
      return route.fulfill({ status, json: [item] });
    });
    await page.route('**/api/admin/reconciliation/items/*/resolve', (route) => {
      writes++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto('/admin/reconciliation');
    await page.setViewportSize({ width: 900, height: 900 });
    const table = page.getByRole('table', { name: word('title'), exact: true });
    const record = table.locator('tbody tr').first();
    await expect(record.getByRole('rowheader')).toContainText(item.description);
    const viewport = page.getByRole('region', { name: word('tableTitle'), exact: true });
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect(viewport).toBeFocused();
    expect(await table.locator('thead').evaluate((node) => getComputedStyle(node).position)).toBe(
      'sticky'
    );
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await record.getByRole('button', { name: item.description, exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await page.locator('#rex-note').fill('Retained reconciliation draft');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toHaveCount(1);
    await expect(page.locator('#rex-note')).toHaveValue('Retained reconciliation draft');
    await expect(dialog.locator('pre')).toContainText('9007199254740993');
    await dialog.getByRole('button', { name: word('dismiss'), exact: true }).click();
    await expect(page.getByRole('heading', { name: word('title'), exact: true })).toBeFocused();
    const cards = page.getByRole('list', { name: word('title'), exact: true });
    const card = cards.locator(':scope > li').first();
    await expect(card).toContainText(word('high'));
    await expect(card).toContainText(word('open'));
    await expect(card).toContainText('staff.sample');
    await expect(card.locator('time')).toHaveAttribute(
      'datetime',
      new Date(item.createdAt).toISOString()
    );
    await expect(card.locator('time')).toContainText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
        item.createdAt
      )
    );
    expect(reads).toBe(1);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await card.screenshot({
        path: '/Users/majid/.local/state/barghsa-manual-batches/reconciliation-tables/reconciliation-card-fa.png',
      });
    hold = true;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await card.getByRole('button', { name: item.description, exact: true }).click();
    await page.locator('#rex-note').fill('Draft during unavailable read');
    await held!.fulfill({ status: 503, json: {} });
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('button', { name: word('resolve'), exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('#rex-note')).toHaveValue('Draft during unavailable read');
    hold = false;
    await dialog.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('#rex-note')).toHaveValue('Draft during unavailable read');
    await dialog.getByRole('button', { name: word('dismiss'), exact: true }).click();
    await expect(page.getByRole('heading', { name: word('title'), exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    status = 403;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(cards).toHaveCount(0);
    await expect(page.getByRole('table', { includeHidden: true })).toHaveCount(0);
    await expect(page.locator('#rex-note')).toHaveCount(0);
    expect(writes).toBe(0);
  });
}
