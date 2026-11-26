import { productionManifest } from './production-manifest';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms as setup } from './catalogue-form-fixture';
import { tCatalogue } from '../../../packages/i18n/src/catalogue';
import { confirmationText } from '@barghsa/i18n/confirmation';
import {
  catalogueBase as base,
  catalogueId as id,
  catalogueConfig,
  catalogueProduct,
  catalogueDetail,
  catalogueReferences,
  hardwareId,
  secondCatalogueId,
} from '../src/test/catalogue-fixtures';
async function reads(page: Page) {
  await page.route('**/api/admin/catalogue/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === base) return route.fulfill({ json: [catalogueProduct()] });
    if (url.pathname.endsWith('/rule-references'))
      return route.fulfill({ json: catalogueReferences });
    return route.fulfill({ json: catalogueDetail() });
  });
}

test('saving-plan hardware search retains selected equipment and requires unavailable items to be removed', async ({
  page,
}) => {
  await setup(page, 'en', false);
  const meter = {
    ...catalogueProduct('hardware', hardwareId),
    title: { en: 'Meter kit', fa: 'بسته کنتور' },
  };
  const sensor = {
    ...catalogueProduct('hardware', secondCatalogueId),
    title: { en: 'Current sensor', fa: 'حسگر جریان' },
  };
  const retired = {
    ...catalogueProduct('hardware', '85000000-0000-4000-8000-000000000004'),
    title: { en: 'Legacy meter', fa: 'کنتور قدیمی' },
    status: 'archived',
  };
  const writes: Array<{ hardwareIds: string[] }> = [];
  await page.route('**/api/admin/catalogue/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === base) return route.fulfill({ json: [meter, sensor, retired] });
    if (url.pathname.endsWith('/rule-references'))
      return route.fulfill({ json: catalogueReferences });
    if (url.pathname.endsWith('/configuration'))
      return route.fulfill({
        json: { ...catalogueConfig, hardwareIds: writes[0]?.hardwareIds ?? [meter.id, retired.id] },
      });
    const plan = catalogueDetail('saving_plan');
    if (route.request().method() === 'GET') return route.fulfill({ json: plan });
    const body = route.request().postDataJSON();
    writes.push(body);
    return route.fulfill({ json: { ...plan, ...body } });
  });

  await page.goto(`/admin/catalogue/saving_plan/${id}/edit`);
  const equipment = page.getByRole('region', { name: 'Compatible hardware', exact: true });
  const find = equipment.getByRole('searchbox', { name: 'Find compatible equipment' });
  const chosen = equipment.getByRole('checkbox', { name: /Meter kit/ });
  const removed = equipment.getByRole('checkbox', {
    name: /Legacy meter.*Choice no longer available/,
  });
  const add = equipment.getByRole('checkbox', { name: /Current sensor/ });
  await expect(chosen).toBeChecked();
  await expect(removed).toBeChecked();
  await find.fill('حسگر');
  await expect(add).toBeVisible();
  await expect(chosen).toBeChecked();
  await add.check();

  await find.fill('something else');
  await find.press('Enter');
  await expect(equipment.getByRole('status')).toHaveText(
    'No unselected equipment matches your search.'
  );
  await expect(add).toBeChecked();
  await expect(removed).toBeChecked();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const save = page.getByRole('button', { name: 'Save product', exact: true });
  await save.click();
  await expect(
    equipment.getByText('Choose at least one available hardware product.')
  ).toBeVisible();
  expect(writes).toEqual([]);
  await removed.press('Space');
  await expect(removed).toHaveCount(0);
  await expect(find).toBeFocused();
  await save.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => writes[0]?.hardwareIds).toEqual([meter.id, sensor.id]);
});
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`catalogue fields focus, freeze, map safe errors and verify product/price receipts (${locale}, dark=${dark})`, async ({
      page,
    }) => {
      await setup(page, locale, dark);
      await reads(page);
      const label = (key: string) => tCatalogue(key, locale);
      let phase: 'field' | 'mismatch' | 'success' | 'denied' = 'field';
      const writes: unknown[] = [];
      await page.route(`**${base}/${id}`, (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: catalogueDetail() });
        const body = route.request().postDataJSON();
        writes.push(body);
        if (phase === 'denied')
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:FORBIDDEN' } });
        if (phase === 'field')
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['titleEn'],
                message: 'private backend text',
              },
            },
          });
        return route.fulfill({
          json: {
            ...catalogueDetail(),
            ...body,
            title: { ...body.title, en: phase === 'mismatch' ? 'Wrong title' : body.title.en },
          },
        });
      });
      let priceField = true;
      await page.route(`**${base}/${id}/prices`, (route) => {
        const body = route.request().postDataJSON();
        writes.push(body);
        if (priceField)
          return route.fulfill({
            status: 400,
            json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['price'] } },
          });
        return route.fulfill({
          json: {
            ...catalogueDetail(),
            priceHistory: [
              {
                id: 'new-version',
                price: body.price,
                effectiveFrom: '2026-12-01T00:00:00Z',
                effectiveUntil: null,
              },
            ],
          },
        });
      });
      await page.goto('/admin/catalogue');
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
      const edit = () =>
        page.getByRole('link', {
          name: `${label('edit')} ${catalogueProduct().title[locale]}`,
          exact: true,
        });
      await edit().click();
      const title = page.locator('#catalogue-titleEn');
      await expect(page.getByRole('button', { name: label('save'), exact: true })).toBeInViewport({
        ratio: 0.99,
      });
      await title.fill(' ');
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await expect(title).toBeFocused();
      await expect(title).toHaveAttribute('aria-invalid', 'true');
      await expect(title).toHaveAccessibleDescription(label('invalidTitleEn'));
      expect(writes).toEqual([]);
      const raw = '  Updated product  ';
      await title.fill(raw);
      const description = page.locator('#catalogue-descriptionEn');
      const disclosure = page.locator('details').filter({ has: description }).locator('summary');
      await expect(description).toBeHidden();
      await expect(disclosure).toHaveAccessibleName(label('descriptionEn'));
      await disclosure.press('Enter');
      await expect(description).toHaveValue(catalogueProduct().description.en);
      await description.fill('x'.repeat(4001));
      await disclosure.press('Enter');
      await expect(description).toBeHidden();
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await expect(description).toBeFocused();
      await expect(description).toHaveAccessibleDescription(label('invalidDescription'));
      expect(writes).toEqual([]);
      await description.fill(catalogueProduct().description.en);
      await disclosure.press('Enter');
      await expect(description).toBeHidden();
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      const confirm = () =>
        dialog.getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true });
      await expect(title).toBeDisabled();
      await confirm().click();
      await expect(dialog).toBeHidden();
      await expect(title).toBeFocused();
      await expect(title).toHaveValue(raw);
      await expect(page.locator('body')).not.toContainText('private backend text');
      phase = 'mismatch';
      await title.fill(raw + ' ');
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await confirm().click();
      await expect(dialog.getByRole('alert')).toHaveText(confirmationText('unconfirmed', locale));
      await expect(confirm()).toBeDisabled();
      await expect(title).toHaveValue(raw + ' ');
      await dialog.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(writes).toHaveLength(2);
      await expect(title).toHaveValue(raw + ' ');
      phase = 'success';
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await confirm().click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(`/admin/catalogue/consultation/${id}`);
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: label('saved') })
      ).toBeVisible();
      expect(writes).toEqual(
        Array(3).fill({
          title: { fa: catalogueProduct().title.fa, en: 'Updated product' },
          description: catalogueProduct().description,
          categories: [],
        })
      );
      await page.getByRole('link', { name: label('addPrice'), exact: true }).click();
      const price = page.locator('#catalogue-price');
      await price.fill('1e3');
      await page.getByRole('button', { name: label('savePrice'), exact: true }).click();
      await expect(price).toBeFocused();
      await expect(price).toHaveAccessibleDescription(label('invalidPrice'));
      const amount = locale === 'fa' ? ' ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳ ' : ' 9007199254740993 ';
      await price.fill(amount);
      await page.getByRole('radio', { name: label('schedule'), exact: true }).check();
      const clock = page.locator('#catalogue-time');
      await clock.fill(locale === 'fa' ? '۱۴۳۵' : '14:35');
      await expect(clock).toHaveValue('14:35');
      await page.getByRole('radio', { name: label('applyNow'), exact: true }).check();
      await page.getByRole('button', { name: label('savePrice'), exact: true }).click();
      await confirm().click();
      await expect(dialog).toBeHidden();
      await expect(price).toBeFocused();
      await expect(price).toHaveValue(amount);
      priceField = false;
      await price.fill(amount + ' ');
      await page.getByRole('button', { name: label('savePrice'), exact: true }).click();
      await confirm().click();
      await expect(dialog).toBeHidden();
      expect(writes.slice(3)).toEqual(Array(2).fill({ price: '9007199254740993' }));
      await page.getByRole('link', { name: label('editProduct'), exact: true }).click();
      await title.fill('Draft before denial');
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark && test.info().project.name === 'mobile-safari')
        await page.screenshot({
          path: '/tmp/barghsa-catalogue-forms-fa-dark-mobile.png',
          fullPage: true,
        });
      phase = 'denied';
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await confirm().click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('alert')).toContainText(label('denied'));
      await expect(
        page.locator('form').filter({ hasNot: page.locator('#product-search') })
      ).toHaveCount(0);
      await expect(page.getByRole('form', { name: label('listFilters'), exact: true })).toHaveCount(
        0
      );
      await expect(page.getByRole('main')).not.toContainText('Sample product');
    });
  }
for (const locale of ['en', 'fa'] as const)
  test(`catalogue unavailable validation preserves drafts (${locale})`, async ({ page }) => {
    await setup(page, locale, false);
    await reads(page);
    const manifest = await productionManifest();
    await page.route('**/' + manifest['src/lib/catalogue-form-schemas.ts'].file, (route) =>
      route.abort()
    );
    const label = (key: string) => tCatalogue(key, locale);
    await page.goto('/admin/catalogue');
    await page.getByRole('link', { name: label('add'), exact: true }).click();
    await page.locator('#catalogue-titleFa').fill('محصول');
    await page.locator('#catalogue-titleEn').fill('Keep draft');
    await page.getByRole('button', { name: label('save'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label('validationUnavailable'));
    await expect(page.locator('#catalogue-titleEn')).toHaveValue('Keep draft');
    await expect(page.locator('#catalogue-titleEn')).toBeEnabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
test('catalogue delayed validator blocks duplicate submits and ignores a changed rule basis', async ({
  page,
}) => {
  await setup(page, 'en', false);
  await reads(page);
  const manifest = await productionManifest();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/' + manifest['src/lib/catalogue-form-schemas.ts'].file, async (route) => {
    await pending;
    await route.continue();
  });
  let changed = false;
  await page.route(`**${base}/${id}/rule-references`, (route) =>
    route.fulfill({ json: { ...catalogueReferences, vatOverride: changed } })
  );
  await page.goto('/admin/catalogue');
  await page.getByRole('link', { name: 'Edit Sample product' }).click();
  await page.locator('#catalogue-titleEn').fill(' ');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.locator('#catalogue-titleEn')).toBeDisabled();
  await page.getByRole('form', { name: 'Product editor' }).evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  changed = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('VAT');
  release();
  await expect(page.locator('#catalogue-titleEn')).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#catalogue-titleEn')).toHaveValue('Sample product');
  await expect(page.locator('#catalogue-titleEn')).not.toHaveAttribute('aria-invalid', 'true');
});
test('catalogue scheduled prices reject DST gaps, invalidate changed zones and verify future history', async ({
  page,
}) => {
  // Keep native Date constructors: replacing them breaks timezone subclasses at DST gaps.
  await page.addInitScript(() => {
    Date.now = () => Date.parse('2026-03-07T12:00:00Z');
  });
  await setup(page, 'en', false);
  await reads(page);
  let zone = 'America/New_York';
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: zone } })
  );
  const writes: { price: string; effectiveFrom: string }[] = [];
  await page.route(`**${base}/${id}/prices`, (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    return route.fulfill({
      json: {
        ...catalogueDetail(),
        priceHistory: [
          {
            id: 'future',
            price: body.price,
            effectiveFrom: body.effectiveFrom,
            effectiveUntil: null,
          },
        ],
      },
    });
  });
  await page.goto('/admin/catalogue');
  await page.getByRole('link', { name: 'Sample product', exact: true }).click();
  await page.getByRole('link', { name: 'Add price version', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Apply after confirmation' })).toBeChecked();
  await page.locator('#catalogue-price').fill('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
  await page.getByLabel('Use a specific effective date').check();
  await page.getByRole('button', { name: 'Save price', exact: true }).click();
  await expect(page.locator('#catalogue-date')).toBeFocused();
  await page.locator('#catalogue-date').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /March 8th/ })
    .click();
  await page.locator('#catalogue-time').fill('02:30');
  await page.getByRole('button', { name: 'Save price', exact: true }).click();
  await expect(page.locator('#catalogue-date')).toHaveAttribute('aria-invalid', 'true');
  expect(writes).toEqual([]);
  await page.locator('#catalogue-time').fill('03:30');
  await page.getByRole('button', { name: 'Save price', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  zone = 'Asia/Tokyo';
  await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#catalogue-price')).toHaveValue('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
  await expect(page.locator('#catalogue-date')).toContainText('Choose');
  await page.locator('#catalogue-date').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /March 9th/ })
    .click();
  await page.getByRole('button', { name: 'Save price', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(writes).toEqual([
    { price: '9007199254740993', effectiveFrom: '2026-03-08T18:30:00.000Z' },
  ]);
});
