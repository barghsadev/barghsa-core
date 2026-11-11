import { checkRoutePresentation } from './route-presentation';
import { test, expect, type Page, type TestInfo } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { standardMaintenanceNotice } from '@barghsa/i18n/maintenance-public';
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
  const confirmPause = async () => {
    await expect(confirm()).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'destructive');
    await confirm().click();
  };
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
    confirmPause,
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
async function inspect(page: Page, locale: string, info: TestInfo, name: string) {
  const dialog = page.getByRole('dialog');
  const inDialog = (await dialog.count()) > 0;
  if (inDialog) await expect(dialog).toHaveCSS('opacity', '1');
  expect(
    (await new AxeBuilder({ page }).include(inDialog ? '[role="dialog"]' : 'main > div').analyze())
      .violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && info.project.name === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 2000 });
    if (inDialog) await dialog.scrollIntoViewIfNeeded();
    else
      await page
        .getByRole('heading', { name: tMaintenance('adminTitle', 'fa'), exact: true })
        .scrollIntoViewIfNeeded();
    const path = info.outputPath(`${name}-fa.png`);
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
  test(`maintenance can keep the pause rationale private (${locale})`, async ({ page }, info) => {
    const { word, confirmPause, save, row } = await setup(page, locale);
    const visibility = page.getByRole('checkbox', { name: word('publishReason'), exact: true });
    await expect(visibility).toBeChecked();
    await visibility.focus();
    await visibility.press('Space');
    await expect(visibility).not.toBeChecked();
    const privateReason = { fa: 'دلیل داخلی آزمایشی', en: 'Private fixture rationale' };
    await page.getByLabel(word('privateReasonFa'), { exact: true }).fill(privateReason.fa);
    await page.getByLabel(word('privateReasonEn'), { exact: true }).fill(privateReason.en);
    const writes: unknown[] = [];
    await page.route('**/api/admin/maintenance/electricity_checkout', async (route) => {
      writes.push(route.request().postDataJSON());
      const next = {
        ...row(),
        reason: standardMaintenanceNotice,
        version: 2,
        updatedAt: '2026-10-05T12:00:00.000Z',
      };
      save(next);
      await route.fulfill({ json: next });
    });
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(word('standardNotice'), { exact: true })).toBeVisible();
    await expect(dialog.getByText(privateReason.en, { exact: true })).toBeVisible();
    await inspect(page, locale, info, 'private-reason-confirmation');
    await confirmPause();
    await expect
      .poll(() => writes)
      .toMatchObject([
        { active: true, publishReason: false, reason: privateReason, expectedVersion: 1 },
      ]);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(privateReason.en, { exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: word('manage'), exact: true })
      .first()
      .click();
    await expect(visibility).not.toBeChecked();
    await expect(page.getByLabel(word('privateReasonEn'), { exact: true })).toHaveValue('');
  });

  test(`maintenance validates raw fields and owns an account-zone save (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirmPause, save, row } = await setup(page, locale);
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const active = page.getByRole('checkbox', { name: word('active'), exact: true });
      await expect(active).toBeVisible();
      const { width, height } = await active.evaluate((input: HTMLInputElement) =>
        input.labels![0]!.getBoundingClientRect().toJSON()
      );
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    }
    await checkRoutePresentation(page, info, locale);
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
    const date = page.getByRole('combobox', { name: word('returnDate'), exact: true });
    const time = page.getByLabel(word('returnTime'), { exact: true });
    for (const field of [fa, en, owner, date, time])
      await expect(field).toHaveAttribute('aria-required', 'true');
    await fa.fill(' ');
    await en.fill(' ');
    await owner.fill(' ');
    await time.fill('');
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    await expect(fa).toBeFocused();
    await expect(fa).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('group', { name: word('estimatedUntil'), exact: true })
    ).toHaveAttribute('aria-invalid', 'true');
    for (const field of [date, time])
      await expect(field).toHaveAccessibleDescription(word('invalidDeadline'));
    expect(writes).toHaveLength(0);
    await inspect(page, locale, info, 'validation');
    await fa.fill('  پیام تازه مشتری  ');
    await en.fill('  A new customer message  ');
    await owner.fill('  Operations  ');
    await time.fill('04:15');
    for (const field of [date, time]) await expect(field).not.toHaveAttribute('aria-describedby');
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
    await inspect(page, locale, info, 'confirmation');
    await confirmPause();
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
    await expect(
      page
        .getByTestId('admin-settings-layout')
        .getByRole('status')
        .filter({
          hasText: word('saved'),
        })
    ).toHaveText(word('saved'));
    await expect(fa).toHaveCount(0);
  });
  test(`maintenance preserves server feedback and requires review after an unknown save (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirm, confirmPause, row, save, read } = await setup(page, locale);
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
    await confirmPause();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(owner).toBeFocused();
    await expect(owner).toHaveValue('  Revised Operations  ');
    await expect(owner).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    await confirmPause();
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
    await inspect(page, locale, info, 'recovery');
    await page.getByRole('button', { name: word('returnToEditing'), exact: true }).click();
    await expect(owner).toBeEnabled();
    await expect(owner).toHaveValue('  Revised Operations  ');
    await page.getByRole('checkbox', { name: word('active'), exact: true }).uncheck();
    for (const key of ['reasonFa', 'reasonEn', 'owner', 'returnDate', 'returnTime'])
      await expect(page.getByLabel(word(key), { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect(
      page
        .getByTestId('admin-settings-layout')
        .getByRole('status')
        .filter({
          hasText: word('saved'),
        })
    ).toHaveText(word('saved'));
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

  test(`maintenance inherits the deadline and reviews a late save (${locale})`, async ({
    page,
  }) => {
    const { word, confirmPause, row, save, read } = await setup(page, locale);
    await page.clock.install();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: unknown[] = [];
    await page.route('**/api/admin/maintenance/electricity_checkout', async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      const next = { ...row(), ...body, version: body.expectedVersion + 1 };
      save(next);
      read(503);
      await held;
      return route.fulfill({ json: next }).catch(() => {});
    });
    try {
      const owner = page.getByLabel(word('owner'), { exact: true });
      await owner.fill('Reviewed Operations');
      await page.getByRole('button', { name: word('save'), exact: true }).click();
      await confirmPause();
      await expect.poll(() => writes.length).toBe(1);
      await expect(page.getByRole('dialog').locator('button[type=submit]')).toHaveAttribute(
        'aria-busy',
        'true'
      );
      await page.clock.fastForward(15_200);
      await expect(page.getByText(word('unconfirmed'), { exact: true })).toBeVisible();
      await expect(page.getByText(word('loadError'), { exact: true })).toBeVisible();
      await expect(owner).toHaveValue('Reviewed Operations');
      await expect(owner).toBeDisabled();
      const resume = page.getByRole('button', { name: word('returnToEditing'), exact: true });
      await expect(resume).toBeDisabled();
      release();
      read(200);
      await page.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(resume).toBeEnabled();
      await resume.click();
      await expect(owner).toBeEnabled();
      expect(writes).toHaveLength(1);
      expect(row().version).toBe(2);
    } finally {
      release();
    }
  });

  test(`maintenance retries a stalled refresh without writing the retained draft (${locale})`, async ({
    page,
  }) => {
    await page.clock.install();
    const { word } = await setup(page, locale);
    let reads = 0;
    let writes = 0;
    await page.route('**/api/admin/maintenance', (route) => {
      if (++reads > 1) return route.fallback();
    });
    await page.route('**/api/admin/maintenance/electricity_checkout', (route) => {
      writes++;
      return route.fulfill({ status: 500 });
    });
    const owner = page.getByLabel(word('owner'), { exact: true });
    const refresh = page.getByRole('button', { name: word('refresh'), exact: true });
    await owner.fill('Keep this private draft');
    await refresh.click();
    await expect.poll(() => reads).toBe(1);
    await page.clock.fastForward(15_001);
    await expect(page.getByText(word('loadError'), { exact: true })).toBeVisible();
    await expect(owner).toBeDisabled();
    await expect(owner).toHaveValue('Keep this private draft');
    await refresh.click();
    await expect(owner).toBeEnabled();
    await expect(owner).toHaveValue('Keep this private draft');
    expect(reads).toBe(2);
    expect(writes).toBe(0);
  });
}
