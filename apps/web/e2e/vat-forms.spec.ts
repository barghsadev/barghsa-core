import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { tVat } from '../../../packages/i18n/src/vat';
import {
  vatRate,
  electricityVatRate,
  vatProduct,
  vatOverride,
} from '../src/test/vat-catalogue-fixtures';
async function setup(page: Page, locale: 'fa' | 'en', darkMode: boolean) {
  await page.addInitScript((locale) => localStorage.setItem('barghsa.locale', locale), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: true,
        requiresTosAcceptance: false,
        navigation: fullNavigation('staff'),
      },
    })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Finance',
        appTitleFa: 'امور مالی',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
        numberStyle: locale === 'fa' ? 'persian' : 'western',
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}

async function catalogue(page: Page) {
  await page.route('**/api/admin/finance/vat/overrides', (route) =>
    route.fulfill({ json: [vatOverride] })
  );
  await page.route('**/api/admin/finance/vat/products', (route) =>
    route.fulfill({ json: [vatProduct] })
  );
}
test('VAT delayed validation locks duplicate submits and rejects a changed financial basis', async ({
  page,
}) => {
  await setup(page, 'en', false);
  await catalogue(page);
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  ) as Record<string, { file: string }>;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/' + manifest['src/lib/vat-form-schema.ts']!.file, async (route) => {
    await pending;
    await route.continue();
  });
  let changed = false,
    writes = 0;
  await page.route('**/api/admin/finance/vat', (route) => {
    if (route.request().method() === 'POST') writes++;
    return route.fulfill({
      json: [vatRate, { ...electricityVatRate, rateBasisPoints: changed ? 700 : 900 }],
    });
  });
  await page.goto('/admin/vat');
  await page.getByRole('button', { name: 'Add rate', exact: true }).click();
  await page.locator('#vat-percent').fill(' 7.25 ');
  await page.getByRole('button', { name: 'Save rate', exact: true }).click();
  await expect(page.locator('#vat-percent')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
  await page.getByRole('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  changed = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Category rate history' })).toContainText('7%');
  release();
  await expect(page.locator('#vat-percent')).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#vat-percent')).toHaveValue(' 7.25 ');
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Save rate', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    const label = (key: string) => tVat('admin.vat.' + key, locale);
    test(`VAT forms validate, focus, freeze and verify writes (${locale}, dark=${dark})`, async ({
      page,
    }) => {
      await setup(page, locale, dark);
      await catalogue(page);
      let phase: 'stepup' | 'mismatch' | 'success' = 'stepup';
      let verified = false;
      const writes: unknown[] = [];
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: {} });
      });
      await page.route('**/api/admin/finance/vat', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: [vatRate, electricityVatRate] });
        const body = route.request().postDataJSON();
        writes.push(body);
        if (phase === 'stepup' && !verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        if (phase === 'stepup')
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['percent'],
                message: 'private backend text',
              },
            },
          });
        return route.fulfill({
          status: 201,
          json: {
            ...electricityVatRate,
            id: 'new-rate',
            rateBasisPoints: phase === 'mismatch' ? 726 : 725,
          },
        });
      });
      await page.goto('/admin/vat');
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
      await page.getByRole('button', { name: label('addRate'), exact: true }).click();
      const percent = page.locator('#vat-percent');
      await percent.fill('1.234');
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await expect(percent).toBeFocused();
      await expect(percent).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('alert')).toContainText(label('invalidPercent'));
      expect(writes).toEqual([]);
      const raw = locale === 'fa' ? '۰۷٫۲۵' : ' 7.25 ';
      await percent.fill(raw);
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      const confirm = () =>
        dialog.getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true });
      await expect(percent).toBeDisabled();
      await confirm().click();
      await dialog.locator('#team-step-up-password').fill('test-only');
      await confirm().click();
      await expect(dialog).toBeHidden();
      await expect(percent).toBeFocused();
      await expect(percent).toHaveValue(raw);
      expect(writes).toEqual(Array(2).fill({ category: 'electricity', rateBasisPoints: 725 }));
      await expect(page.locator('body')).not.toContainText('private backend text');
      phase = 'mismatch';
      await percent.fill(raw + ' ');
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await confirm().click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(percent).toHaveValue(raw + ' ');
      phase = 'success';
      await confirm().click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('status').filter({ hasText: label('saved') })).toBeVisible();
      await page.getByRole('button', { name: label('addOverride'), exact: true }).click();
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await expect(page.locator('#vat-product')).toBeFocused();
      await expect(page.locator('#vat-rate')).toHaveAttribute('aria-invalid', 'true');
      await page.locator('#vat-product').selectOption(vatProduct.id);
      await page.locator('#vat-rate').selectOption(vatRate.id);
      await page.route('**/api/admin/finance/vat/overrides', (route) =>
        route.fulfill(
          route.request().method() === 'GET'
            ? { json: [vatOverride] }
            : { status: 403, json: { error: 'AUTHZ:FORBIDDEN' } }
        )
      );
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark && test.info().project.name === 'mobile-safari')
        await page.screenshot({
          path: '/tmp/barghsa-vat-forms-fa-dark-mobile.png',
          fullPage: true,
        });
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await confirm().click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('alert')).toContainText(label('denied'));
      await expect(page.locator('form, table')).toHaveCount(0);
    });
  }
for (const locale of ['en', 'fa'] as const)
  test(`VAT unavailable validator preserves draft (${locale})`, async ({ page }) => {
    await setup(page, locale, false);
    await catalogue(page);
    const label = (key: string) => tVat('admin.vat.' + key, locale);
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    ) as Record<string, { file: string }>;
    await page.route('**/' + manifest['src/lib/vat-form-schema.ts']!.file, (route) =>
      route.abort()
    );
    let writes = 0;
    await page.route('**/api/admin/finance/vat', (route) => {
      if (route.request().method() === 'POST') writes++;
      return route.fulfill({ json: [vatRate, electricityVatRate] });
    });
    await page.goto('/admin/vat');
    await page.getByRole('button', { name: label('addRate'), exact: true }).click();
    await page.locator('#vat-percent').fill(' 7.25 ');
    await page.getByRole('button', { name: label('save'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('validationUnavailable'));
    await expect(page.locator('#vat-percent')).toHaveValue(' 7.25 ');
    await expect(page.locator('#vat-percent')).toBeEnabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(0);
  });
