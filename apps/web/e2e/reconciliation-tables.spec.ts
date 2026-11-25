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
      detailReads = 0,
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
      if (new URL(route.request().url()).searchParams.get('limit') === '1')
        return route.fulfill({ json: [] });
      reads++;
      return route.fulfill({ status, json: [item] });
    });
    await page.route(`**/api/admin/reconciliation/items/${item.id}`, (route) => {
      detailReads++;
      if (hold) {
        held = route;
        return;
      }
      return route.fulfill({ json: item });
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
    await record.getByRole('link', { name: item.description, exact: true }).focus();
    await page.keyboard.press('Enter');
    const detail = page.getByTestId('reconciliation-record');
    await expect(page).toHaveURL(new RegExp(`/admin/reconciliation/${item.id}`));
    await expect(
      page.getByRole('heading', { name: word('reviewTitle'), exact: true })
    ).toBeFocused();
    await expect(detail.locator('#rex-note')).toHaveCount(0);
    await detail.getByRole('link', { name: word('resolve'), exact: true }).click();
    await page.locator('#rex-note').fill('Retained reconciliation draft');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(detail).toBeVisible();
    await expect(page.locator('#rex-note')).toHaveValue('Retained reconciliation draft');
    await detail.getByText(word('diagnostics'), { exact: true }).click();
    await expect(detail.locator('pre')).toContainText('9007199254740993');
    await expect(detail.locator('time')).toHaveAttribute(
      'datetime',
      new Date(item.createdAt).toISOString()
    );
    await expect(detail.locator('time')).toContainText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
        item.createdAt
      )
    );
    expect(reads).toBe(1);
    expect(detailReads).toBe(2);
    const backToCase = page.getByRole('link', { name: word('backToCase'), exact: true });
    await backToCase.click();
    const back = page.getByRole('link', { name: word('backToQueue'), exact: true });
    await back.click();
    const cards = page.getByRole('list', { name: word('title'), exact: true });
    const card = cards.locator(':scope > li').first();
    await expect(card).toContainText(word('high'));
    await expect(card).toContainText(word('open'));
    await expect(card).toContainText('staff.sample');
    expect(reads).toBe(2);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await card.screenshot({
        path: test.info().outputPath('reconciliation-card-fa.png'),
      });
    await card.getByRole('link', { name: item.description, exact: true }).click();
    await detail.getByRole('link', { name: word('resolve'), exact: true }).click();
    await page.locator('#rex-note').fill('Draft during unavailable read');
    hold = true;
    await detail.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await held!.fulfill({ status: 503, json: {} });
    await expect(detail.getByRole('alert')).toBeVisible();
    await expect(detail.getByRole('button', { name: word('resolve'), exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('#rex-note')).toHaveValue('Draft during unavailable read');
    hold = false;
    await detail.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(detail.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('#rex-note')).toHaveValue('Draft during unavailable read');
    expect(reads).toBe(2);
    await backToCase.click();
    await back.click();
    await expect(page.getByRole('link', { name: item.description, exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    status = 403;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(cards).toHaveCount(0);
    await expect(page.getByRole('table', { includeHidden: true })).toHaveCount(0);
    await expect(page.locator('#rex-note')).toHaveCount(0);
    expect(writes).toBe(0);
  });
}
