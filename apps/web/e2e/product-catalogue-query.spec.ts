import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import {
  catalogueBase as base,
  catalogueProduct,
  catalogueDetail,
  catalogueReferences,
} from '../src/test/catalogue-fixtures';

for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`product query applies bounded criteria, preserves drafts and restores pages (${locale}, dark=${dark})`, async ({
      page,
    }, info) => {
      const copy = (key: string) => tCatalogue(key, locale);
      await setupCatalogueForms(page, locale, dark, {
        numberStyle: locale === 'fa' ? 'western' : 'persian',
      });
      const rows = Array.from({ length: 56 }, (_, index) => ({
        ...catalogueProduct(
          'hardware',
          `86000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
        ),
        title: { en: `Panel%_ <script> ${index + 1}`, fa: `پنل Panel%_ <script> ${index + 1}` },
        price: String(9007199254740993n + BigInt(index)),
        status: index === 1 ? 'archived' : index % 2 === 0 ? 'active' : 'inactive',
      }));
      const reads: URLSearchParams[] = [],
        detailReads: string[] = [];
      let failed = false,
        denied = false,
        held: Route | null = null;
      await page.route('**/api/admin/catalogue/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === base) {
          reads.push(url.searchParams);
          if (url.searchParams.get('search') === 'hold') {
            held = route;
            return;
          }
          if (denied) return route.fulfill({ status: 403, json: {} });
          if (failed) return route.fulfill({ status: 503, json: {} });
          const search = url.searchParams.get('search') || '';
          const status = url.searchParams.get('status') || '';
          let accepted = rows.filter(
            (row) =>
              (!status || row.status === status) &&
              (!search ||
                search === 'latest' ||
                Object.values(row.title).some((title) =>
                  title.toLowerCase().includes(search.toLowerCase())
                ))
          );
          if (search === 'latest') accepted = accepted.slice(0, 3);
          const asc = url.searchParams.get('order') === 'asc';
          if (url.searchParams.get('sort') === 'price')
            accepted.sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1) * (asc ? 1 : -1));
          else accepted = asc ? accepted : accepted.slice().reverse();
          const limit = Number(url.searchParams.get('limit') || 25),
            page = Number(url.searchParams.get('page') || 1);
          const offset = (page - 1) * limit;
          return route.fulfill({
            json: accepted.slice(offset, offset + limit),
            headers: { 'X-Has-Next-Page': String(offset + limit < accepted.length) },
          });
        }
        if (url.pathname.endsWith('/rule-references'))
          return route.fulfill({ json: catalogueReferences });
        const id = url.pathname.slice(base.length + 1);
        const row = rows.find((row) => row.id === id);
        if (row) {
          detailReads.push(id);
          return route.fulfill({ json: { ...catalogueDetail('hardware', id), ...row } });
        }
        if (url.pathname.endsWith('/inventory'))
          return route.fulfill({
            json: {
              hardwareId: url.pathname.split('/').at(-2),
              stockTracking: false,
              stockCount: 0,
              reservedCount: 0,
              reservationMinutes: 1440,
            },
          });
        return route.fulfill({ status: 404, json: {} });
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/admin/catalogue?type=hardware');
      const content = page.locator('[data-slot=list-content]');
      const records = content.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2)'
      );
      const filters = page.getByRole('form', { name: copy('listFilters'), exact: true });
      const search = filters.getByLabel(copy('search'), { exact: true });
      const apply = filters.getByRole('button', { name: copy('applyFilters'), exact: true });
      const next = page.getByRole('button', { name: copy('nextPage'), exact: true });
      const previous = page.getByRole('button', { name: copy('previousPage'), exact: true });
      await expect(records).toHaveCount(25);
      expect(reads[0]!.get('limit')).toBe('25');
      const initialReads = reads.length;
      await search.fill('Unapplied search draft');
      await filters.getByRole('button', { name: copy('clearFilters'), exact: true }).click();
      await expect(search).toHaveValue('');
      expect(reads).toHaveLength(initialReads);
      await records.first().getByRole('button').click();
      const title = page.locator('#catalogue-titleEn');
      await expect(title).toHaveValue(rows[55]!.title.en);
      await title.fill('  Retained out-of-filter product draft  ');
      const selectedReads = detailReads.length;
      await next.click();
      await expect(page).toHaveURL(/page=2/);
      await expect(records).toHaveCount(25);
      await expect(title).toHaveValue('  Retained out-of-filter product draft  ');
      await search.fill('  Panel%_  ');
      await filters.getByLabel(copy('filter_status')).selectOption('active');
      await filters.getByLabel(copy('filter_sort')).selectOption('price');
      await filters.getByLabel(copy('filter_order')).selectOption('asc');
      const before = reads.length;
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(search).toHaveValue('  Panel%_  ');
      await expect.poll(() => reads.length).toBe(before);
      await apply.click();
      await expect(page).toHaveURL(/q=Panel/);
      await expect(page).not.toHaveURL(/page=2/);
      await expect(records).toHaveCount(25);
      expect(reads.at(-1)!.get('search')).toBe('Panel%_');
      expect(reads.at(-1)!.get('status')).toBe('active');
      expect(reads.at(-1)!.get('sort')).toBe('price');
      expect(reads.at(-1)!.get('order')).toBe('asc');
      await expect(records.first()).toContainText(rows[0]!.title[locale]);
      await expect(title).toHaveValue('  Retained out-of-filter product draft  ');
      expect(detailReads).toHaveLength(selectedReads);
      await next.click();
      await expect(page).toHaveURL(/page=2/);
      await expect(records).toHaveCount(3);
      await expect(next).toBeDisabled();
      await expect(records.first()).toContainText(rows[50]!.title[locale]);
      await expect(previous).toBeEnabled();
      expect(
        (
          await new AxeBuilder({ page })
            .include('main')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (
        locale === 'fa' &&
        info.project.name === 'mobile-safari' &&
        process.env.BARGHSA_SCREENSHOT_DIR
      ) {
        await page
          .getByRole('form', { name: copy('editor'), exact: true })
          .getByRole('button', { name: copy('cancel'), exact: true })
          .click();
        await page.setViewportSize({ width: 390, height: 2400 });
        await page
          .getByRole('heading', { name: copy('title'), exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${process.env.BARGHSA_SCREENSHOT_DIR}/product-query-fa-${dark ? 'dark' : 'light'}.png`,
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await page.goBack();
      await expect(records).toHaveCount(25);
      await expect(page).not.toHaveURL(/page=2/);
      await page.goForward();
      await expect(records).toHaveCount(3);
      await expect(page).toHaveURL(/page=2/);
      await page.reload();
      await expect(records).toHaveCount(3);
      await expect(search).toHaveValue('Panel%_');
      await expect(filters.getByLabel(copy('filter_status'))).toHaveValue('active');
      await expect(filters.getByLabel(copy('filter_sort'))).toHaveValue('price');
      await search.fill('x'.repeat(201));
      await apply.click();
      await expect(search).toHaveAttribute('aria-invalid', 'true');
      const error = await search.getAttribute('aria-describedby');
      expect(error).toBeTruthy();
      await expect(page.locator(`[id="${error}"]`)).toHaveText(copy('invalidSearch'));
      await search.fill('hold');
      await search.press('Enter');
      await expect.poll(() => held !== null).toBe(true);
      await search.fill('latest');
      await apply.click();
      await expect(records).toHaveCount(3);
      await held!.fulfill({ status: 403, json: {} });
      await expect(records).toHaveCount(3);
      await expect(content.getByText(copy('denied'))).toHaveCount(0);
      await filters.getByRole('button', { name: copy('clearFilters'), exact: true }).click();
      await expect(page).toHaveURL(/type=hardware/);
      await expect(page).not.toHaveURL(/q=|status=|sort=|page=/);
      await expect(records).toHaveCount(25);
      failed = true;
      await page
        .getByRole('button', { name: copy('refresh'), exact: true })
        .first()
        .click();
      const retry = content.getByRole('button', { name: copy('retry'), exact: true });
      await expect(retry).toBeVisible();
      await expect(records).toHaveCount(25);
      failed = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      denied = true;
      await page
        .getByRole('button', { name: copy('refresh'), exact: true })
        .first()
        .click();
      await expect(content.getByText(copy('denied'))).toBeVisible();
      await expect(records).toHaveCount(0);
    });
  }
