import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import {
  catalogueBase as base,
  catalogueTypes,
  catalogueId as id,
  hardwareId,
  catalogueProduct,
  catalogueDetail,
  catalogueReferences,
  catalogueConfig,
  type CatalogueType,
} from '../src/test/catalogue-fixtures.js';

for (const type of catalogueTypes)
  for (const locale of ['en', 'fa'] as const) {
    test(`catalogue ${type} preserves drafts through independent retries and clears denied work (${locale})`, async ({
      page,
    }, testInfo) => {
      const label = (key: string) => tCatalogue(key, locale);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'catalogue-staff',
            isStaff: true,
            operatingContext: 'staff',
            canSwitchContext: true,
            requiresTosAcceptance: false,
          },
        })
      );
      let timezoneFail = type === 'consultation',
        timezoneReads = 0;
      await page.route('**/api/user/settings/timezone', (route) => {
        timezoneReads++;
        return timezoneFail
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({ json: { timezone: 'Asia/Tehran' } });
      });
      let held: Route | undefined,
        holdList = false,
        detailFail = true,
        hardwareFail = type === 'saving_plan',
        hardwareReads = 0,
        writes = 0;
      const listReads: string[] = [],
        otherReads: string[] = [];
      await page.route('**/api/admin/catalogue/**', (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') {
          writes++;
          return route.fulfill({ status: 500, json: {} });
        }
        if (url.pathname === base) {
          const queried = url.searchParams.get('type') as CatalogueType;
          if (queried === 'hardware' && type === 'saving_plan') {
            hardwareReads++;
            return hardwareFail
              ? route.fulfill({ status: 503, json: {} })
              : route.fulfill({ json: [catalogueProduct('hardware', hardwareId)] });
          }
          listReads.push(url.pathname + url.search);
          if (holdList && queried === type) {
            held = route;
            return;
          }
          return route.fulfill({ json: [catalogueProduct(queried)] });
        }
        otherReads.push(url.pathname);
        if (url.pathname === `${base}/${id}`)
          return detailFail
            ? route.fulfill({ status: 503, json: {} })
            : route.fulfill({ json: catalogueDetail(type) });
        if (url.pathname.endsWith('/rule-references'))
          return route.fulfill({ json: catalogueReferences });
        if (url.pathname.endsWith('/configuration'))
          return route.fulfill({ json: catalogueConfig });
        if (url.pathname.endsWith('/inventory'))
          return route.fulfill({
            json: {
              stockTracking: false,
              stockCount: 0,
              reservedCount: 0,
              reservationMinutes: 1440,
            },
          });
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto('/admin/catalogue');
      const content = page.locator('[data-slot="list-content"]');
      await expect(content.getByRole('button').first()).toBeVisible();
      if (type !== 'consultation') {
        await page.getByRole('tab', { name: label(type), exact: true }).click();
        await expect(content.getByRole('button').first()).toBeVisible();
      }
      const productTitle = catalogueProduct(type).title[locale];
      await content
        .getByRole('button', { name: `${label('edit')} ${productTitle}`, exact: true })
        .click();
      const detailError = page.getByRole('alert').filter({ hasText: label('detailError') });
      await expect(detailError).toBeVisible();
      await expect(content.getByRole('button').first()).toBeVisible();
      const initialLists = listReads.length,
        initialHardware = hardwareReads;
      detailFail = false;
      await detailError.getByRole('button', { name: label('retry'), exact: true }).click();
      const titleInput = page.locator('#catalogue-titleEn');
      await expect(titleInput).toBeVisible();
      expect(listReads).toHaveLength(initialLists);
      expect(hardwareReads).toBe(initialHardware);
      await titleInput.fill('Keep product draft');
      if (hardwareFail) {
        const error = page.getByRole('alert').filter({ hasText: label('hardwareError') });
        await expect(error).toBeVisible();
        await expect(page.getByRole('button', { name: label('save'), exact: true })).toBeDisabled();
        hardwareFail = false;
        await error.getByRole('button', { name: label('retry'), exact: true }).click();
        await expect(page.getByRole('button', { name: label('save'), exact: true })).toBeEnabled();
        await expect(titleInput).toHaveValue('Keep product draft');
        expect(listReads).toHaveLength(initialLists);
      }
      if (timezoneFail) {
        const error = page.getByRole('alert').filter({ hasText: label('timezoneError') });
        await expect(error).toBeVisible();
        await expect(
          page.getByRole('button', { name: label('addPrice'), exact: true })
        ).toHaveCount(0);
        timezoneFail = false;
        await error.getByRole('button', { name: label('retry'), exact: true }).click();
        await expect(
          page.getByRole('button', { name: label('addPrice'), exact: true })
        ).toBeVisible();
        await expect(titleInput).toHaveValue('Keep product draft');
        expect(listReads).toHaveLength(initialLists);
      }
      holdList = true;
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      await expect(titleInput).toHaveValue('Keep product draft');
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(content.getByRole('button').first()).toBeVisible();
      await titleInput.fill('Keep refreshed product draft');
      await page.getByRole('button', { name: label('addPrice'), exact: true }).click();
      const priceInput = page.locator('#catalogue-price');
      await priceInput.fill('19000');
      if (type === 'saving_plan')
        await expect(page.locator('#saving-agreement-title')).toBeVisible();
      if (type === 'hardware') await expect(page.locator('#saving-stock-count')).toBeVisible();
      await held!.fulfill({ status: 503, json: {} });
      held = undefined;
      const retry = content.getByRole('button', { name: label('retry'), exact: true });
      await expect(retry).toBeVisible();
      const reads = otherReads.length,
        hardware = hardwareReads,
        timezone = timezoneReads,
        failedQuery = listReads.at(-1);
      holdList = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(listReads.at(-1)).toBe(failedQuery);
      expect(otherReads).toHaveLength(reads);
      expect(hardwareReads).toBe(hardware);
      expect(timezoneReads).toBe(timezone);
      await expect(titleInput).toHaveValue('Keep refreshed product draft');
      await expect(priceInput).toHaveValue('19000');
      expect(
        await page
          .locator('[data-slot="list-page"]')
          .evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      const axe = await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze();
      expect(axe.violations).toEqual([]);
      if (locale === 'fa')
        await page.screenshot({
          path: `/tmp/barghsa-catalogue-${type}-fa-${testInfo.project.name}.png`,
          fullPage: true,
        });
      holdList = true;
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      await expect(titleInput).toHaveValue('Keep refreshed product draft');
      if (type === 'saving_plan')
        await expect(page.getByRole('button', { name: label('save'), exact: true })).toBeEnabled();
      await page.getByRole('button', { name: label('save'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await held!.fulfill({ status: 403, json: {} });
      await expect(content.getByRole('alert')).toContainText(label('denied'));
      await expect(content.getByRole('button')).toHaveCount(0);
      await expect(titleInput).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(writes).toBe(0);
    });
  }
