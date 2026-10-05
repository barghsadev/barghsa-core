import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { formatBrowserDate } from './browser-date';
import { t } from '@barghsa/i18n/admin-ui';
import { tVat } from '@barghsa/i18n/vat';
import { adminTosText } from '../src/pages/admin-tos-text';
import { termsVersion } from '../src/test/content-catalogue-fixtures';
import {
  vatRate,
  electricityVatRate,
  vatProduct,
  vatOverride,
} from '../src/test/vat-catalogue-fixtures';
import { policyLimit, uploadPolicy } from '../src/test/policy-catalogue-fixtures';

const screenshotRoot = process.env['BARGHSA_SCREENSHOT_DIR'] ?? '/tmp';
async function inspect(page: Page) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function desktop(
  page: Page,
  caption: string,
  locale: 'en' | 'fa',
  count: number,
  columns: number
) {
  const table = page.getByRole('table', { name: caption, exact: true });
  await expect(table.locator('tbody tr:has(th[scope=row])')).toHaveCount(count);
  await expect(table.getByRole('columnheader')).toHaveCount(columns);
  await expect(table.locator('thead')).toHaveCSS('position', 'sticky');
  const viewport = page.getByRole('region', { name: caption, exact: true });
  await viewport.focus();
  await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
  await expect(viewport).toBeFocused();
  await expect
    .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
    .toBeGreaterThan(0);
  return table;
}

for (const locale of ['en', 'fa'] as const) {
  test(`terms history keeps one version view and raw draft through responsive recovery (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    const text = adminTosText(locale);
    const published = {
      ...termsVersion(),
      id: 'published',
      versionId: 'v1',
      status: 'published',
      isActive: true,
      changeType: 'major',
      publishedAt: '2026-09-24T20:45:00.000Z',
      createdBy: 'staff-sample',
    };
    let status = 200,
      reads = 0,
      writes = 0;
    await page.route('**/api/admin/tos/versions', (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      }
      reads++;
      return route.fulfill({ status, json: status === 200 ? [termsVersion(), published] : {} });
    });
    await page.goto('/admin/tos');
    await page.setViewportSize({ width: 900, height: 900 });
    const table = await desktop(page, text.history, locale, 2, 7);
    const saved = table.locator('tbody tr').filter({ hasText: 'v1' });
    await expect(saved.getByRole('rowheader')).toHaveText('v1');
    await expect(saved).toContainText(text.major);
    await expect(saved).toContainText('staff-sample');
    await expect(saved.locator('time')).toHaveAttribute('datetime', published.publishedAt);
    await expect(saved.locator('time')).toHaveText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
        published.publishedAt
      )
    );
    await saved.getByRole('button', { name: text.view, exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText('staff-sample');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(dialog).toHaveCount(1);
    expect([reads, writes]).toEqual([1, 0]);
    await dialog.getByRole('button', { name: text.close, exact: true }).click();
    await expect(page.getByRole('button', { name: text.refresh, exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = page.getByRole('list', { name: text.history, exact: true });
    await expect(cards.locator(':scope > li')).toHaveCount(2);
    await expect(page.getByRole('table', { name: text.history, exact: true })).not.toBeVisible();
    const card = cards.locator(':scope > li').filter({ hasText: 'v1' });
    await expect(card).toContainText(text.major);
    await expect(card.locator('time')).toHaveAttribute('datetime', published.publishedAt);
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await card.screenshot({ path: `${screenshotRoot}/terms-card-fa.png` });
    await cards.getByRole('button', { name: text.edit, exact: true }).click();
    const raw = page.getByRole('textbox', { name: text.english, exact: true });
    await raw.fill('  Local unpublished terms  ');
    const form = page.locator('form').filter({ has: raw });
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(raw).toContainText('  Local unpublished terms  ');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#admintospage-field-1')).toHaveCount(1);
    expect([reads, writes]).toEqual([1, 0]);
    status = 503;
    await page.getByRole('button', { name: text.refresh, exact: true }).click();
    await expect(form.locator('button[type=submit]')).toBeDisabled();
    await expect(raw).toContainText('Local unpublished terms');
    await expect(cards.locator(':scope > li')).toHaveCount(2);
    status = 200;
    await page.getByRole('button', { name: text.refresh, exact: true }).click();
    await expect(form.locator('button[type=submit]')).toBeEnabled();
    await inspect(page);
    status = 403;
    await page.getByRole('button', { name: text.refresh, exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: text.denied })).toBeVisible();
    await expect(page.locator('table,ol[role=list],#admintospage-field-1')).toHaveCount(0);
    expect(writes).toBe(0);
  });

  test(`VAT tables preserve published digits, account dates and one captured decision across breakpoints (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    const label = (key: string) => tVat(`admin.vat.${key}`, locale);
    let status = 200,
      reads = 0;
    const writes: unknown[] = [];
    const rows = [vatRate, electricityVatRate];
    await page.route('**/api/admin/finance/vat', (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        writes.push(body);
        rows.push({ ...electricityVatRate, ...body, id: 'saved-rate' });
        return route.fulfill({ status: 201, json: rows.at(-1) });
      }
      reads++;
      return route.fulfill({ status, json: status === 200 ? rows : {} });
    });
    await page.route('**/api/admin/finance/vat/overrides', (route) => {
      reads++;
      return route.fulfill({ json: [vatOverride] });
    });
    await page.route('**/api/admin/finance/vat/products', (route) => {
      reads++;
      return route.fulfill({ json: [vatProduct] });
    });
    await page.goto('/admin/vat');
    await page.setViewportSize({ width: 900, height: 900 });
    const table = await desktop(page, label('rates'), locale, 2, 6);
    const overrides = await desktop(page, label('overrides'), locale, 1, 6);
    await expect(overrides.getByRole('rowheader')).toHaveText(vatProduct.title[locale]);
    await expect(table.locator('tbody tr').first()).toContainText(locale === 'fa' ? '9%' : '۹');
    await expect(table.locator('time').first()).toHaveAttribute('datetime', vatRate.effectiveFrom);
    await expect(table.locator('time').first()).toHaveText(
      await page.evaluate(
        ({ stamp, locale }) => new Date(stamp).toLocaleString(locale, { timeZone: 'Asia/Tehran' }),
        { stamp: vatRate.effectiveFrom, locale }
      )
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const rates = page.getByRole('list', { name: label('rates'), exact: true });
    const products = page.getByRole('list', { name: label('overrides'), exact: true });
    await expect(rates.locator(':scope > li')).toHaveCount(2);
    await expect(products.locator(':scope > li')).toHaveCount(1);
    await expect(products).toContainText(label('openEnded'));
    await expect(products.locator('time')).toHaveAttribute('datetime', vatOverride.effectiveFrom);
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await products.screenshot({ path: `${screenshotRoot}/vat-card-fa.png` });
    await page.getByRole('button', { name: label('addRate'), exact: true }).click();
    await page.locator('#vat-percent').fill(' 7.25 ');
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('#vat-percent')).toHaveValue(' 7.25 ');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(reads).toBe(3);
    expect(writes).toEqual([]);
    await page
      .getByRole('form', { name: label('editor'), exact: true })
      .getByRole('button', { name: label('save'), exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toHaveCount(1);
    expect(reads).toBe(3);
    expect(writes).toEqual([]);
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#vat-percent')).toHaveCount(0);
    expect(writes).toEqual([{ category: 'electricity', rateBasisPoints: 725 }]);
    await expect(rates.locator(':scope > li')).toHaveCount(3);
    status = 403;
    await page.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('denied'));
    await expect(page.locator('table,ol[role=list]')).toHaveCount(0);
  });

  test(`upload policy cards preserve effective limits, open history and one raw editor across responsive recovery (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    const label = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
    const refresh = t('admin.jobs.refresh', locale);
    let status = 200,
      reads = 0,
      canEdit = true,
      writes = 0;
    let pendingAccess: Promise<void> | null = null;
    let releaseAccess!: () => void;
    await page.route('**/api/admin/upload-policies/access', async (route) => {
      reads++;
      await pendingAccess;
      return route.fulfill({ json: { canEdit } });
    });
    await page.route('**/api/admin/upload-policies/limits', (route) => {
      reads++;
      return route.fulfill({ json: [policyLimit] });
    });
    await page.route('**/api/admin/upload-policies', (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      }
      reads++;
      return route.fulfill({ status, json: status === 200 ? [uploadPolicy] : {} });
    });
    await page.goto('/admin/upload-policies');
    await page.setViewportSize({ width: 900, height: 900 });
    const table = await desktop(page, label('catalogue'), locale, 1, 5);
    const record = table.locator('tbody tr:has(th[scope=row])');
    await expect(record.getByRole('rowheader')).toHaveText(label('category.document'));
    await expect(record).toContainText('.pdf');
    await expect(record.locator('td').nth(0)).not.toContainText('.docx');
    await expect(record).toContainText(`${locale === 'fa' ? '2' : '۲'} ${label('mib')}`);
    await expect(record).toContainText(label('configured'));
    await record.locator('summary').click();
    await expect(record.locator('details')).toHaveAttribute('open', '');
    await expect(record.locator('time')).toHaveAttribute(
      'datetime',
      new Date(uploadPolicy.effectiveFrom).toISOString()
    );
    await expect(record.locator('time')).toHaveText(
      await formatBrowserDate(
        page,
        locale,
        { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
        uploadPolicy.effectiveFrom
      )
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = page.getByRole('list', { name: label('catalogue'), exact: true });
    const card = cards.locator(':scope > li');
    await expect(card).toHaveCount(1);
    await expect(card.locator('details')).toHaveAttribute('open', '');
    await expect(card).toContainText(uploadPolicy.createdBy);
    await expect(card).toContainText(label('openEnded'));
    expect(reads).toBe(3);
    expect(writes).toBe(0);
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await card.screenshot({ path: `${screenshotRoot}/upload-card-fa.png` });
    await card
      .getByRole('button', { name: `${label('edit')} ${label('category.document')}`, exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    const raw = dialog.locator('#upload-policy-size');
    await raw.fill('1.25');
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(dialog).toHaveCount(1);
    await expect(raw).toHaveValue('1.25');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(raw).toHaveValue('1.25');
    expect(reads).toBe(3);
    expect(writes).toBe(0);
    status = 503;
    await dialog.getByRole('button', { name: refresh, exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(label('loadError'));
    await expect(raw).toHaveValue('1.25');
    await expect(dialog.getByRole('button', { name: label('save'), exact: true })).toBeDisabled();
    status = 200;
    await dialog.getByRole('button', { name: t('admin.jobs.reload', locale), exact: true }).click();
    await expect(dialog.getByRole('button', { name: label('save'), exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: label('cancel'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: refresh, exact: true })).toBeFocused();
    await expect(card.locator('details')).toHaveAttribute('open', '');
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(record.locator('details')).toHaveAttribute('open', '');
    await page.setViewportSize({ width: 390, height: 844 });
    await card
      .getByRole('button', { name: `${label('edit')} ${label('category.document')}`, exact: true })
      .click();
    pendingAccess = new Promise<void>((resolve) => {
      releaseAccess = resolve;
    });
    await dialog.getByRole('button', { name: refresh, exact: true }).click();
    await expect(dialog.getByRole('button', { name: refresh, exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: label('cancel'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: label('title'), level: 1, exact: true })
    ).toBeFocused();
    releaseAccess();
    pendingAccess = null;
    await expect(page.getByRole('button', { name: refresh, exact: true })).toBeEnabled();
    canEdit = false;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('forbidden'));
    await expect(page.locator('table,ol[role=list],#upload-policy-size')).toHaveCount(0);
    canEdit = true;
    await page.getByRole('button', { name: refresh, exact: true }).click();
    await expect(card.locator('details')).not.toHaveAttribute('open', '');
    expect(writes).toBe(0);
  });
}
