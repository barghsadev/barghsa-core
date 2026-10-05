import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { t as appText } from '@barghsa/i18n/app';
import {
  catalogueBase as base,
  catalogueTypes,
  catalogueId as id,
  secondCatalogueId,
  hardwareId,
  catalogueProduct,
  catalogueDetail,
  catalogueReferences,
  catalogueConfig,
} from '../src/test/catalogue-fixtures';

const exactPrice = '900719925474099123';
const westernDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^0-9]/g, '');

for (const type of catalogueTypes)
  for (const locale of ['en', 'fa'] as const) {
    test(`product catalogue tables retain ${type} metadata and command ownership (${locale})`, async ({
      page,
    }, info) => {
      const label = (key: string) => tCatalogue(key, locale);
      const dark = type === 'saving_plan' || type === 'hardware';
      await setupCatalogueForms(page, locale, dark, {
        numberStyle: locale === 'fa' ? 'western' : 'persian',
      });
      const category =
        type === 'electricity'
          ? 'thermal_electricity'
          : 'electricity_generation_station_consultation';
      const rows = [
        {
          ...catalogueProduct(type),
          title: { en: 'Energy service <script>', fa: 'خدمت انرژی <script>' },
          description: { en: 'Saved description\nSecond line', fa: 'توضیحات ذخیره‌شده\nخط دوم' },
          price: exactPrice,
          categories: type === 'electricity' || type === 'consultation' ? [category] : [],
          electricityLimits: type === 'electricity' ? { minKwh: '100', maxKwh: '0' } : null,
        },
        {
          ...catalogueProduct(type, secondCatalogueId),
          title: { en: 'Not priced', fa: 'بدون قیمت' },
          description: null,
          price: null,
          status: 'inactive',
        },
        {
          ...catalogueProduct(type, '85000000-0000-4000-8000-000000000004'),
          title: { en: 'Archived service', fa: 'خدمت بایگانی‌شده' },
          status: 'archived',
        },
      ];
      let failed = false,
        denied = false,
        listReads = 0,
        detailReads = 0;
      const writes: unknown[] = [];
      await page.route('**/api/admin/catalogue/**', (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') {
          writes.push(route.request().postDataJSON());
          return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        }
        if (url.pathname === base) {
          if (url.searchParams.get('type') === 'hardware' && type === 'saving_plan')
            return route.fulfill({ json: [catalogueProduct('hardware', hardwareId)] });
          listReads++;
          return denied
            ? route.fulfill({ status: 403, json: {} })
            : failed
              ? route.fulfill({ status: 503, json: {} })
              : route.fulfill({ json: rows });
        }
        if (url.pathname === `${base}/${id}`) {
          detailReads++;
          return route.fulfill({ json: { ...catalogueDetail(type), ...rows[0] } });
        }
        if (url.pathname.endsWith('/rule-references'))
          return route.fulfill({ json: catalogueReferences });
        if (url.pathname.endsWith('/configuration'))
          return route.fulfill({ json: catalogueConfig });
        if (url.pathname.endsWith('/inventory'))
          return route.fulfill({
            json: {
              hardwareId: id,
              stockTracking: false,
              stockCount: 0,
              reservedCount: 0,
              reservationMinutes: 1440,
            },
          });
        return route.fulfill({ status: 404, json: {} });
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/admin/catalogue?type=${type}`);
      const content = page.locator('[data-slot=list-content]');
      const records = content.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2)'
      );
      await expect(records).toHaveCount(3);
      await expect(content.getByRole('table')).toHaveAccessibleName(
        `${label(type)} · ${label('title')}`
      );
      await expect(
        content.getByRole('columnheader', { name: label('description'), exact: true })
      ).toBeVisible();
      await expect(
        content.getByRole('columnheader', { name: label('price'), exact: true })
      ).toBeVisible();
      const inspectRecords = async () => {
        await expect(records.nth(0)).toContainText(rows[0]!.title[locale]);
        await expect(records.nth(0)).toContainText(rows[0]!.description![locale]);
        await expect(records.nth(0)).toContainText(label('active'));
        expect(westernDigits(await records.nth(0).innerText())).toContain(exactPrice);
        await expect(records.nth(1)).toContainText(label('unset'));
        await expect(records.nth(1)).toContainText(label('inactive'));
        await expect(records.nth(2)).toContainText(label('archived'));
        await expect(records.nth(1)).toContainText('—');
        if (type === 'electricity' || type === 'consultation')
          await expect(records.nth(0)).toContainText(label(category));
        if (type === 'electricity') {
          await expect(records.nth(0)).toContainText(label('noUpperLimit'));
          await expect(records.nth(0)).toContainText('thermal');
          expect(westernDigits(await records.nth(2).innerText())).toContain('5000');
        }
        expect(await content.locator('script').count()).toBe(0);
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-slot=list-content]')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations
        ).toEqual([]);
      };
      await inspectRecords();
      const reads = listReads;
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(content.getByRole('table')).toHaveCount(0);
      await inspectRecords();
      expect(listReads).toBe(reads);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(
        await records
          .nth(0)
          .getByRole('button')
          .evaluate((button) => button.getBoundingClientRect().height)
      ).toBeGreaterThanOrEqual(44);
      if (
        locale === 'fa' &&
        info.project.name === 'mobile-safari' &&
        process.env.BARGHSA_SCREENSHOT_DIR &&
        (type === 'electricity' || type === 'saving_plan')
      ) {
        await page.setViewportSize({ width: 390, height: 2200 });
        await page.screenshot({
          path: `${process.env.BARGHSA_SCREENSHOT_DIR}/product-${type}-fa-${dark ? 'dark' : 'light'}.png`,
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await records.nth(0).getByRole('button').click();
      const editor = page
        .locator('form[aria-label]')
        .filter({ has: page.locator('#catalogue-titleEn') });
      await expect(editor).toHaveAccessibleName(label('editor'));
      const input = editor.locator('#catalogue-titleEn');
      await expect(input).toHaveValue(rows[0]!.title.en);
      await input.fill('  Preserved raw product draft  ');
      await page.getByRole('button', { name: label('addPrice'), exact: true }).click();
      const price = page.locator('#catalogue-price');
      await price.fill('  19000  ');
      await editor.getByRole('button', { name: label('save'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await dialog.locator('input[type=password]').fill('synthetic-only-password');
      const selectedReads = detailReads;
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(dialog.locator('input[type=password]')).toHaveValue('synthetic-only-password');
      await expect(editor).toHaveCount(1);
      await expect(input).toHaveValue('  Preserved raw product draft  ');
      await expect(price).toHaveValue('  19000  ');
      expect(listReads).toBe(reads);
      expect(detailReads).toBe(selectedReads);
      expect(writes).toHaveLength(1);
      await dialog
        .getByRole('button', { name: appText('team.cancel', locale), exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(input).toHaveValue('  Preserved raw product draft  ');
      failed = true;
      await page
        .getByRole('button', { name: label('refresh'), exact: true })
        .first()
        .click();
      const retry = content.getByRole('button', { name: label('retry'), exact: true });
      await expect(retry).toBeVisible();
      await expect(records).toHaveCount(3);
      await expect(records.nth(0).getByRole('button')).toBeEnabled();
      await expect(input).toHaveValue('  Preserved raw product draft  ');
      failed = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      await expect(input).toHaveValue('  Preserved raw product draft  ');
      denied = true;
      await page
        .getByRole('button', { name: label('refresh'), exact: true })
        .first()
        .click();
      await expect(content.getByText(label('denied'))).toBeVisible();
      await expect(records).toHaveCount(0);
      await expect(editor).toHaveCount(0);
      await expect(price).toHaveCount(0);
      expect(writes).toHaveLength(1);
    });
  }
