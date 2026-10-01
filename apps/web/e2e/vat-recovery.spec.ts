import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { tVat } from '@barghsa/i18n/vat';
import { t as appT } from '@barghsa/i18n/app';
import {
  vatRate,
  electricityVatRate,
  vatProduct,
  vatOverride,
} from '../src/test/vat-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa') {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'admin',
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}
async function inspect(page: Page, name: string, locale: string, project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-vat-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  const label = (key: string) => tVat(`admin.vat.${key}`, locale);
  test(`VAT rate draft and frozen decision recover independently (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      productReads = 0,
      overrideReads = 0;
    const writes: unknown[] = [];
    await page.route('**/api/admin/finance/vat', (route) => {
      if (route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON());
        return route.fulfill({ json: {} });
      }
      return route.fulfill(
        fail ? { status: 503, json: {} } : { json: [vatRate, electricityVatRate] }
      );
    });
    await page.route('**/api/admin/finance/vat/overrides', (route) => {
      overrideReads++;
      return route.fulfill({ json: [vatOverride] });
    });
    await page.route('**/api/admin/finance/vat/products', (route) => {
      productReads++;
      return route.fulfill({ json: [vatProduct] });
    });
    await page.goto('/admin/vat');
    const region = page
      .getByRole('region', { name: label('rates'), exact: true })
      .locator('[data-slot="scroll-area-viewport"]');
    await region.focus();
    await region.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => region.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: label('addRate'), exact: true }).click();
    await page.locator('#vat-percent').fill('7.25');
    fail = true;
    await page.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('ratesError'));
    await expect(
      page.getByRole('table', { name: label('rates'), exact: true }).locator('tbody tr')
    ).toHaveCount(2);
    await page.locator('#vat-percent').fill('8.5');
    await expect(page.getByRole('button', { name: label('save'), exact: true })).toBeDisabled();
    const before = [productReads, overrideReads];
    fail = false;
    await page.getByRole('button', { name: label('ratesRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect([productReads, overrideReads]).toEqual(before);
    await expect(page.locator('#vat-percent')).toHaveValue('8.5');
    await inspect(page, 'rate-draft', locale, info.project.name);
    await page.getByRole('button', { name: label('save'), exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: appT('team.confirm', locale), exact: true });
    fail = true;
    await dialog.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(label('ratesError'));
    await expect(confirm).toBeDisabled();
    fail = false;
    await dialog.getByRole('button', { name: label('ratesRetry'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([{ category: 'electricity', rateBasisPoints: 850 }]);
  });
  test(`VAT override retains choices and withdrawn product invalidates confirmation (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let fail = false,
      removed = false,
      rateReads = 0,
      overrideReads = 0;
    await page.route('**/api/admin/finance/vat', (route) => {
      rateReads++;
      return route.fulfill({ json: [vatRate, electricityVatRate] });
    });
    await page.route('**/api/admin/finance/vat/overrides', (route) => {
      overrideReads++;
      return route.fulfill({ json: [vatOverride] });
    });
    await page.route('**/api/admin/finance/vat/products', (route) =>
      route.fulfill(fail ? { status: 503, json: {} } : { json: removed ? [] : [vatProduct] })
    );
    await page.goto('/admin/vat');
    await page.getByRole('button', { name: label('addOverride'), exact: true }).click();
    await page.locator('#vat-product').selectOption(vatProduct.id);
    await page.locator('#vat-rate').selectOption(vatRate.id);
    fail = true;
    await page.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('productsError'));
    await expect(page.locator('#vat-product')).toHaveValue(vatProduct.id);
    const before = [rateReads, overrideReads];
    fail = false;
    await page.getByRole('button', { name: label('productsRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect([rateReads, overrideReads]).toEqual(before);
    await expect(page.locator('#vat-rate')).toHaveValue(vatRate.id);
    await inspect(page, 'override', locale, info.project.name);
    await page.getByRole('button', { name: label('save'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    removed = true;
    await dialog.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#vat-product')).toHaveValue(vatProduct.id);
    await expect(page.locator('#vat-product')).toContainText(label('unavailable'));
    await expect(page.getByRole('button', { name: label('save'), exact: true })).toBeDisabled();
  });
  test(`VAT timezone recovery keeps scheduling input and denial removes private histories (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let failZone = false,
      denied = false,
      zone = 'Asia/Tehran',
      ratesRead = 0;
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill(failZone ? { status: 503, json: {} } : { json: { timezone: zone } })
    );
    await page.route('**/api/admin/finance/vat', (route) => {
      ratesRead++;
      return route.fulfill(
        denied ? { status: 403, json: {} } : { json: [vatRate, electricityVatRate] }
      );
    });
    await page.route('**/api/admin/finance/vat/overrides', (route) =>
      route.fulfill({ json: [vatOverride] })
    );
    await page.route('**/api/admin/finance/vat/products', (route) =>
      route.fulfill({ json: [vatProduct] })
    );
    await page.goto('/admin/vat');
    await page.getByRole('button', { name: label('addRate'), exact: true }).click();
    await page.locator('#vat-percent').fill('7.25');
    await page.getByRole('checkbox').check();
    await page.locator('#vat-time').fill('10:15');
    await expect(page.locator('#vat-time')).toHaveAttribute('dir', 'ltr');
    failZone = true;
    await page.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('timezoneError'));
    await expect(page.locator('#vat-time')).toHaveValue('10:15');
    const before = ratesRead;
    failZone = false;
    await page.getByRole('button', { name: label('timezoneRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(ratesRead).toBe(before);
    await inspect(page, 'schedule', locale, info.project.name);
    zone = 'UTC';
    await page.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('invalidDate'));
    await expect(page.locator('#vat-percent')).toHaveValue('7.25');
    await expect(page.locator('#vat-time')).toHaveValue('10:15');
    denied = true;
    await page.getByRole('button', { name: label('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(label('denied'));
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.locator('#vat-percent')).toHaveCount(0);
  });
}
