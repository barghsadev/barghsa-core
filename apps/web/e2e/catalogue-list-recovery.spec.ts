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
      let timezoneReads = 0;
      await page.route('**/api/user/settings/timezone', (route) => {
        timezoneReads++;
        return route.fulfill({ json: { timezone: 'Asia/Tehran' } });
      });
      let held: Route | undefined,
        holdDetail = false,
        detailFail = true,
        hardwareFail = type === 'saving_plan',
        hardwareReads = 0,
        writes = 0;
      const listReads: string[] = [];
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
          return route.fulfill({ json: [catalogueProduct(queried)] });
        }
        if (url.pathname === `${base}/${id}`) {
          if (holdDetail) {
            held = route;
            return;
          }
          return detailFail
            ? route.fulfill({ status: 503, json: {} })
            : route.fulfill({ json: catalogueDetail(type) });
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
      await page.goto('/admin/catalogue');
      const panel = (category: CatalogueType) =>
        page.getByRole('tabpanel', { name: label(category), exact: true });
      await expect(
        panel('consultation').locator('[data-slot="list-content"]').getByRole('link').first()
      ).toBeVisible();
      if (type !== 'consultation') {
        await page.getByRole('tab', { name: label(type), exact: true }).click();
      }
      const content = panel(type).locator('[data-slot="list-content"]');
      await expect(content.getByRole('link').first()).toBeVisible();
      const accountTimeReads = timezoneReads;
      const productTitle = catalogueProduct(type).title[locale];
      await content
        .getByRole('link', { name: `${label('edit')} ${productTitle}`, exact: true })
        .click();
      const detailError = page.getByRole('alert').filter({ hasText: label('detailError') });
      await expect(detailError).toBeVisible();
      await expect(content).toHaveCount(0);
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
      expect(timezoneReads).toBe(accountTimeReads);
      holdDetail = true;
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      await expect(titleInput).toHaveValue('Keep product draft');
      await titleInput.fill('Keep refreshed product draft');
      await held!.fulfill({ status: 503, json: {} });
      await expect(detailError).toBeVisible();
      await expect(page.getByRole('button', { name: label('save'), exact: true })).toBeDisabled();
      expect(listReads).toHaveLength(initialLists);
      holdDetail = false;
      await detailError.getByRole('button', { name: label('retry'), exact: true }).click();
      await expect(detailError).toHaveCount(0);
      await expect(titleInput).toHaveValue('Keep refreshed product draft');
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      if (locale === 'fa')
        await page.screenshot({
          path: `/tmp/barghsa-catalogue-${type}-fa-${testInfo.project.name}.png`,
          fullPage: true,
        });
      holdDetail = true;
      held = undefined;
      await page.getByRole('button', { name: label('refresh'), exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      await held!.fulfill({ status: 403, json: {} });
      await expect(page.getByRole('main').getByRole('alert')).toContainText(label('denied'));
      await expect(titleInput).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(listReads).toHaveLength(initialLists);
      expect(writes).toBe(0);
    });
  }
