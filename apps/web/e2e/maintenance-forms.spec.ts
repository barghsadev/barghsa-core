import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { t } from '@barghsa/i18n/admin-ui';
import AxeBuilder from '@axe-core/playwright';
import type { MaintenanceSetting } from '../src/lib/maintenance-form';

test.use({ timezoneId: 'America/Los_Angeles' });
async function setup(page: Page, locale: 'en' | 'fa') {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        logoUrl: null,
        faviconUrl: null,
        darkMode: locale === 'fa',
      },
    })
  );
  let current: MaintenanceSetting = {
    capability: 'electricity_checkout',
    active: true,
    reason: { fa: 'در حال بررسی خدمت', en: 'Service is being checked' },
    estimatedUntil: '2099-01-01T00:00:32.000Z',
    owner: 'Operations',
    version: 1,
    updatedAt: '2026-10-05T00:00:00.000Z',
  };
  let status = 200,
    malformed = false;
  await page.route('**/api/admin/maintenance', (route) =>
    route.fulfill({
      status,
      json: malformed
        ? []
        : [
            current,
            ...(['saving_orders', 'solar_requests', 'wallet_topup', 'ai_chat'] as const).map(
              (capability) => ({
                capability,
                active: false,
                reason: null,
                estimatedUntil: null,
                owner: null,
                version: 0,
                updatedAt: null,
              })
            ),
          ],
    })
  );
  const word = (key: string) => tMaintenance(key, locale);
  const confirm = () =>
    page.getByRole('dialog').getByRole('button', { name: t('team.confirm', locale), exact: true });
  await page.goto('/admin/maintenance');
  await expect(page.getByRole('heading', { name: word('adminTitle'), exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: word('manage'), exact: true }).first()
  ).toBeEnabled();
  await page
    .getByRole('button', { name: word('manage'), exact: true })
    .first()
    .click();
  return {
    word,
    confirm,
    save: (value: MaintenanceSetting) => {
      current = value;
    },
    row: () => current,
    read: (value: number, bad = false) => {
      status = value;
      malformed = bad;
    },
  };
}
async function inspect(page: Page, locale: string, project: string, name: string) {
  const dialog = page.getByRole('dialog');
  const inDialog = (await dialog.count()) > 0;
  if (inDialog) await expect(dialog).toHaveCSS('opacity', '1');
  expect(
    (await new AxeBuilder({ page }).include(inDialog ? '[role="dialog"]' : 'main > div').analyze())
      .violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 2000 });
    if (inDialog) await dialog.scrollIntoViewIfNeeded();
    else
      await page
        .getByRole('heading', { name: tMaintenance('adminTitle', 'fa'), exact: true })
        .scrollIntoViewIfNeeded();
    const path = `/Users/majid/.local/state/barghsa-manual-batches/maintenance-settings-forms/${name}-fa.png`;
    if (inDialog) await dialog.screenshot({ path });
    else
      await page
        .locator('section')
        .filter({
          has: page.getByRole('heading', { name: tMaintenance('adminTitle', 'fa'), exact: true }),
        })
        .screenshot({ path });
  }
}
for (const locale of ['en', 'fa'] as const) {
  test(`maintenance validates raw fields and owns an account-zone save (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirm, save, row } = await setup(page, locale);
    const writes: Record<string, unknown>[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/maintenance/electricity_checkout', async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      await pending;
      const next = {
        ...row(),
        ...body,
        version: body.expectedVersion + 1,
        updatedAt: '2026-10-05T12:00:00.000Z',
      };
      save(next);
      await route.fulfill({ json: next });
    });
    const fa = page.getByLabel(word('reasonFa'), { exact: true });
    const en = page.getByLabel(word('reasonEn'), { exact: true });
    const owner = page.getByLabel(word('owner'), { exact: true });
    await fa.fill(' ');
    await en.fill(' ');
    await owner.fill(' ');
    await page.getByLabel(word('returnTime'), { exact: true }).fill('');
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    await expect(fa).toBeFocused();
    await expect(fa).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('group', { name: word('estimatedUntil'), exact: true })
    ).toHaveAttribute('aria-invalid', 'true');
    expect(writes).toHaveLength(0);
    await inspect(page, locale, info.project.name, 'validation');
    await fa.fill('  پیام تازه مشتری  ');
    await en.fill('  A new customer message  ');
    await owner.fill('  Operations  ');
    await page.getByLabel(word('returnTime'), { exact: true }).fill('04:15');
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('A new customer message', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Asia/Tehran', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: word('manage'), includeHidden: true }).first()
    ).toBeDisabled();
    await inspect(page, locale, info.project.name, 'confirmation');
    await confirm().click();
    await expect.poll(() => writes.length).toBe(1);
    await dialog.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      active: true,
      reason: { fa: 'پیام تازه مشتری', en: 'A new customer message' },
      owner: 'Operations',
      estimatedUntil: '2099-01-01T00:45:00.000Z',
      expectedVersion: 1,
    });
    release();
    await expect(page.getByText(word('saved'), { exact: true })).toBeVisible();
    await expect(fa).toHaveCount(0);
  });
  test(`maintenance preserves server feedback and requires review after an unknown save (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirm, row, save, read } = await setup(page, locale);
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/admin/maintenance/electricity_checkout', async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (writes.length === 1)
        return route.fulfill({
          status: 400,
          json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['owner'] } },
        });
      const next = {
        ...row(),
        ...body,
        version: body.expectedVersion + 1,
        updatedAt: '2026-10-05T12:00:00.000Z',
      };
      save(next);
      if (writes.length === 2) {
        read(503);
        return route.fulfill({ json: { ...next, version: body.expectedVersion } });
      }
      return route.fulfill({ json: next });
    });
    const owner = page.getByLabel(word('owner'), { exact: true });
    await owner.fill('  Revised Operations  ');
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(owner).toBeFocused();
    await expect(owner).toHaveValue('  Revised Operations  ');
    await expect(owner).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect(page.getByText(word('unconfirmed'), { exact: true })).toBeVisible();
    await expect(page.getByText(word('loadError'), { exact: true })).toBeVisible();
    await expect(owner).toHaveValue('  Revised Operations  ');
    await expect(owner).toBeDisabled();
    await expect(
      page.getByRole('button', { name: word('returnToEditing'), exact: true })
    ).toBeDisabled();
    await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(writes).toHaveLength(2);
    read(200);
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(
      page.getByRole('button', { name: word('returnToEditing'), exact: true })
    ).toBeEnabled();
    await inspect(page, locale, info.project.name, 'recovery');
    await page.getByRole('button', { name: word('returnToEditing'), exact: true }).click();
    await expect(owner).toBeEnabled();
    await expect(owner).toHaveValue('  Revised Operations  ');
    await page.getByRole('checkbox', { name: word('active'), exact: true }).uncheck();
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect(page.getByText(word('saved'), { exact: true })).toBeVisible();
    expect(writes[2]).toEqual({
      active: false,
      reason: null,
      owner: null,
      estimatedUntil: null,
      expectedVersion: 2,
    });
  });
  test(`maintenance retains stale drafts and clears private work on denied reads (${locale})`, async ({
    page,
  }) => {
    const { word, row, save, read } = await setup(page, locale);
    const owner = page.getByLabel(word('owner'), { exact: true });
    await owner.fill('  My unsaved draft  ');
    save({ ...row(), version: 2, owner: 'Other operator' });
    await page
      .getByRole('button', { name: word('refresh'), exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        document.querySelector('form')?.requestSubmit();
      });
    await expect(page.getByText(word('versionConflict'), { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(owner).toBeDisabled();
    await expect(owner).toHaveValue('  My unsaved draft  ');
    await page.getByRole('button', { name: word('reset'), exact: true }).click();
    await expect(owner).toHaveValue('Other operator');
    read(200, true);
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.getByText(word('loadError'), { exact: true })).toBeVisible();
    await expect(owner).toBeDisabled();
    await expect(owner).toHaveValue('Other operator');
    read(403);
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.getByText(word('denied'), { exact: true })).toBeVisible();
    await expect(owner).toHaveCount(0);
    await expect(page.getByText('Other operator')).toHaveCount(0);
  });
}
