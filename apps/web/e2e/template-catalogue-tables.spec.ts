import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import { t } from '@barghsa/i18n/admin-ui';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { formatBrowserDate } from './browser-date';
import { templateDetail } from '../src/test/document-list-fixtures';
import { contractTemplate, templateVersion } from '../src/test/contract-settings-fixtures';

const digits = (locale: 'en' | 'fa', value: number) =>
  new Intl.NumberFormat(locale, { numberingSystem: locale === 'fa' ? 'latn' : 'arabext' }).format(
    value
  );

async function inspect(page: Page) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function desktop(
  page: Page,
  caption: string,
  scrollLabel: string,
  name: string,
  locale: 'en' | 'fa'
) {
  await page.setViewportSize({ width: 900, height: 900 });
  const table = page.getByRole('table', { name: caption, exact: true });
  const row = table.locator('tbody tr:has(th[scope=row])').first();
  await expect(row.getByRole('rowheader')).toContainText(name);
  expect(await table.locator('thead').evaluate((node) => getComputedStyle(node).position)).toBe(
    'sticky'
  );
  const viewport = page.getByRole('region', { name: scrollLabel, exact: true });
  await viewport.focus();
  await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
  await expect(viewport).toBeFocused();
  await expect
    .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
    .toBeGreaterThan(0);
  await inspect(page);
  return row;
}

async function date(page: Page, record: Locator, locale: 'en' | 'fa', stamp: string) {
  await expect(record.locator('time')).toHaveAttribute('datetime', new Date(stamp).toISOString());
  await expect(record.locator('time')).toContainText(
    await formatBrowserDate(
      page,
      locale,
      { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
      stamp
    )
  );
}

for (const locale of ['en', 'fa'] as const) {
  test(`contract template delete review keeps one owner and restores visible focus after resizing (${locale})`, async ({
    page,
  }) => {
    const word = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
    let writes = 0;
    await crmShell(page, locale);
    await page.route('**/api/admin/contract-templates', (route) =>
      route.fulfill({ json: [contractTemplate] })
    );
    await page.route(`**/api/admin/contract-templates/${contractTemplate.id}`, (route) => {
      writes++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto('/admin/contract-templates');
    await page.setViewportSize({ width: 900, height: 900 });
    const table = page.getByRole('table', { name: word('title'), exact: true });
    const deleteName = `${word('delete')} ${contractTemplate.name}`;
    const heading = page.getByRole('heading', { name: word('title'), exact: true });
    const dialog = page.getByRole('dialog');
    await table.getByRole('button', { name: deleteName, exact: true }).click();
    await expect(dialog).toContainText(word('confirmDelete'));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
    await expect(heading).toBeFocused();
    const cards = page.getByRole('list', { name: word('title'), exact: true });
    const trigger = cards.getByRole('button', { name: deleteName, exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
    await expect(heading).toBeFocused();
    expect(writes).toBe(0);
  });

  test(`document template tables retain one metadata/file workspace across screen sizes (${locale})`, async ({
    page,
  }, info) => {
    const word = (key: Parameters<typeof documentTemplateText>[0]) =>
      documentTemplateText(key, locale);
    const current = {
      ...templateDetail,
      title: 'قالب نمونه قرارداد مشتری',
      description: 'شرایط نمونه برای بررسی کارکنان',
    };
    let status = 200,
      listReads = 0,
      detailReads = 0,
      writes = 0;
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route(
      (url) => url.pathname === '/api/admin/document-templates',
      (route) => {
        if (route.request().method() !== 'GET') {
          writes++;
          return route.fulfill({ status: 500, json: {} });
        }
        listReads++;
        return route.fulfill({ status, json: status === 200 ? [current] : {} });
      }
    );
    await page.route(`**/api/admin/document-templates/${current.id}`, (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      }
      detailReads++;
      return route.fulfill({ status, json: status === 200 ? current : {} });
    });
    await page.goto('/admin/document-templates');
    const row = await desktop(page, word('listTitle'), word('tableTitle'), current.title, locale);
    await expect(row).toContainText(current.description);
    await expect(row).toContainText(word('contract'));
    await expect(row.locator('bdi.tabular-nums')).toHaveText(digits(locale, 1));
    await date(page, row, locale, current.updatedAt);
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = page.getByRole('list', { name: word('listTitle'), exact: true });
    const card = cards.locator(':scope > li').first();
    await expect(card).toContainText(current.description);
    await expect(card.locator('bdi.tabular-nums')).toHaveText(digits(locale, 1));
    await date(page, card, locale, current.updatedAt);
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await card.screenshot({ path: test.info().outputPath('document-template-card-fa.png') });
    await card.getByRole('link', { name: current.title, exact: true }).focus();
    await page.keyboard.press('Enter');
    const main = page.getByRole('main');
    const workspace = page.getByRole('region', { name: word('workspaceTitle'), exact: true });
    await expect(main.getByRole('heading', { name: current.title, exact: true })).toBeVisible();
    await workspace.getByRole('link', { name: word('edit'), exact: true }).click();
    await page.locator('#document-template-title').fill('Raw private metadata');
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('#document-template-title')).toHaveValue('Raw private metadata');
    await expect(page.locator('#document-template-summary')).toHaveCount(0);
    expect([listReads, detailReads, writes]).toEqual([1, 2, 0]);
    const refresh = main.getByRole('button', { name: word('refresh'), exact: true });
    status = 503;
    await refresh.click();
    await expect(workspace.getByRole('alert')).toContainText(word('detailError'));
    await expect(page.locator('#document-template-title')).toHaveValue('Raw private metadata');
    await expect(workspace.getByRole('button', { name: word('save'), exact: true })).toBeDisabled();
    status = 200;
    await refresh.click();
    await expect(workspace.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('#document-template-title')).toHaveValue('Raw private metadata');
    status = 403;
    await refresh.click();
    await expect(main.getByRole('alert')).toContainText(word('denied'));
    await expect(page.locator('#document-template-title, #document-template-files')).toHaveCount(0);
    await expect(main).not.toContainText('Raw private metadata');
    expect(writes).toBe(0);
  });

  test(`contract template tables retain metadata/upload drafts and guarded actions across screen sizes (${locale})`, async ({
    page,
  }, info) => {
    const word = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
    const current = {
      ...contractTemplate,
      name: 'قالب نمونه تأمین برق',
      description: 'شرایط نمونه قرارداد تأمین برق',
      versionCount: 1,
      latestVersion: templateVersion,
    };
    let status = 200,
      listReads = 0,
      detailReads = 0,
      writes = 0;
    await crmShell(page, locale);
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/contract-templates', (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      }
      listReads++;
      return route.fulfill({ status, json: status === 200 ? [current] : {} });
    });
    await page.route(`**/api/admin/contract-templates/${current.id}`, (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      }
      detailReads++;
      return route.fulfill({
        status,
        json: status === 200 ? { ...current, versions: [templateVersion] } : {},
      });
    });
    await page.goto('/admin/contract-templates');
    const row = await desktop(page, word('title'), word('tableTitle'), current.name, locale);
    await expect(row).toContainText(word('active'));
    await expect(row).toContainText(templateVersion.fileName);
    await expect(row.locator('bdi.tabular-nums')).toHaveText(digits(locale, 1));
    await date(page, row, locale, templateVersion.createdAt);
    await expect(
      row.getByRole('button', { name: `${word('delete')} ${current.name}`, exact: true })
    ).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = page.getByRole('list', { name: word('title'), exact: true });
    const card = cards.locator(':scope > li').first();
    await expect(card).toContainText(current.description);
    await expect(card).toContainText(word('active'));
    await expect(card).toContainText(templateVersion.fileName);
    await expect(card.locator('bdi.tabular-nums')).toHaveText(digits(locale, 1));
    await date(page, card, locale, templateVersion.createdAt);
    await expect(
      card.getByRole('button', { name: `${word('delete')} ${current.name}`, exact: true })
    ).toBeDisabled();
    await inspect(page);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await card.screenshot({ path: test.info().outputPath('contract-template-card-fa.png') });
    expect([listReads, detailReads, writes]).toEqual([1, 0, 0]);
    await card
      .getByRole('link', { name: `${word('editor')} ${current.name}`, exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await page.locator('#template-name').fill('Raw private contract metadata');
    await page.locator('#template-description').fill('Raw contract explanation');
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('#template-name')).toHaveValue('Raw private contract metadata');
    await expect(page.locator('#template-description')).toHaveValue('Raw contract explanation');
    expect([listReads, detailReads]).toEqual([1, 1]);
    status = 503;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(
      page.getByRole('button', { name: word('detailRetry'), exact: true })
    ).toBeVisible();
    await expect(page.locator('#template-name')).toHaveValue('Raw private contract metadata');
    await expect(page.getByRole('button', { name: word('save'), exact: true })).toBeDisabled();
    status = 200;
    await page.getByRole('button', { name: word('detailRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: word('save'), exact: true })).toBeEnabled();
    await expect(page.locator('#template-name')).toHaveValue('Raw private contract metadata');
    status = 403;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.locator('#template-name, #template-file')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('Raw private contract metadata');
    expect(writes).toBe(0);
  });
}
