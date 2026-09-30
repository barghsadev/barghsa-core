import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { documentText } from '@barghsa/i18n/documents';
import { tSolar } from '@barghsa/i18n/solar';
import {
  firstSolar,
  olderSolar,
  solarRequest,
  solarFile,
  solarDocuments,
  solarPostal,
  solarGuidance,
} from '../src/test/solar-staff-fixtures';

const cases = [
  {
    name: 'files',
    path: '/admin/solar-requests',
    base: '/api/admin/solar/document-review-queue',
    key: 'documents',
    row: solarFile,
    slot: 0,
    more: 'moreFiles',
  },
  {
    name: 'requests',
    path: '/admin/solar-requests',
    base: '/api/admin/solar/requests',
    key: 'requests',
    row: solarRequest,
    slot: 1,
    more: 'moreRequests',
  },
  {
    name: 'postal',
    path: '/admin/solar-postal',
    base: '/api/admin/solar/postal-queue',
    key: 'requests',
    row: solarPostal,
    slot: 0,
    more: 'moreRequests',
  },
];
for (const locale of ['en', 'fa'] as const) {
  for (const { name, path, base, key, row, slot, more } of cases) {
    test(`solar ${name} queue preserves staff work through retries and clears denied work (${locale})`, async ({
      page,
    }, testInfo) => {
      const copy = (key: string) => tSolar(key, locale);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'solar-staff',
            isStaff: true,
            operatingContext: 'staff',
            canSwitchContext: true,
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      let guidanceFail = name !== 'files',
        detailFail = name === 'requests',
        detailReads = 0;
      const otherReads: string[] = [],
        queries: string[] = [];
      await page.route('**/api/admin/solar/*-guidance', (route) => {
        otherReads.push(route.request().url());
        return guidanceFail
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({ json: solarGuidance });
      });
      await page.route('**/api/admin/solar/document-review-queue', (route) => {
        otherReads.push(route.request().url());
        return route.fulfill({ json: { documents: [solarFile()], nextBefore: null } });
      });
      await page.route('**/api/admin/solar/requests', (route) => {
        otherReads.push(route.request().url());
        return route.fulfill({ json: { requests: [solarRequest()], nextBefore: null } });
      });
      await page.route(`**/api/admin/solar/requests/${firstSolar}/documents`, (route) => {
        detailReads++;
        return detailFail
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({ json: solarDocuments() });
      });
      let held: Route | undefined,
        fail = true,
        denied = false;
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          const params = new URL(route.request().url()).searchParams;
          queries.push(params.toString());
          if (denied) return route.fulfill({ status: 403, json: {} });
          if (params.has('before') && fail) {
            held = route;
            return;
          }
          return route.fulfill({
            json: {
              [key]: [row(params.has('before') ? olderSolar : firstSolar)],
              nextBefore: params.has('before') ? olderSolar : firstSolar,
            },
          });
        }
      );
      await page.goto(path);
      const lists = page.locator('[data-slot="list-page"]');
      const list = lists.nth(slot),
        content = list.locator('[data-slot="list-content"]');
      await expect(content.getByRole('button').first()).toBeVisible();
      if (guidanceFail) {
        const error = page.getByRole('alert').filter({ hasText: copy('staffGuidanceLoadError') });
        await expect(error).toBeVisible();
        const reads = queries.length;
        guidanceFail = false;
        await error.getByRole('button', { name: copy('retry'), exact: true }).click();
        await expect(
          page.getByRole('heading', {
            name: copy(name === 'postal' ? 'postalGuidance' : 'documentGuidance'),
            exact: true,
          })
        ).toBeVisible();
        expect(queries).toHaveLength(reads);
      }
      await (name === 'files' ? lists.nth(1) : list)
        .getByRole('button', { name: /First solar buyer/ })
        .click();
      if (detailFail) {
        const error = page.getByRole('alert').filter({ hasText: copy('staffDetailLoadError') });
        await expect(error).toBeVisible();
        await list.getByRole('button', { name: /First solar buyer/ }).click();
        await expect(error.getByRole('button', { name: copy('retry'), exact: true })).toBeVisible();
        const reads = queries.length;
        detailFail = false;
        await error.getByRole('button', { name: copy('retry'), exact: true }).click();
        await expect(page.locator('#solar-review-reason')).toBeVisible();
        expect(queries).toHaveLength(reads);
      }
      const note =
        name === 'postal'
          ? page.getByRole('textbox', { name: copy('reason'), exact: true })
          : page.locator('#solar-review-reason');
      if (name !== 'postal') {
        const detail = page
          .getByRole('heading', { name: copy('staffDocuments'), exact: true })
          .locator('..');
        await expect(detail).toContainText(copy('status_documents_under_review'));
        await expect(detail).toContainText(documentText('SubmittedForReview', locale));
        await expect(detail).toContainText(copy('documentReview_pending'));
        await expect(detail).not.toContainText('documents_under_review');
      }
      await note.fill('Keep this solar explanation');
      const guidance = page.locator('form textarea').first();
      await guidance.fill('Keep this guidance draft');
      const reads = otherReads.length,
        details = detailReads;
      const moreButton = list.getByRole('button', { name: copy(more), exact: true });
      await moreButton.click();
      await expect.poll(() => !!held).toBe(true);
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(moreButton).toBeDisabled();
      await expect(content.getByRole('button').first()).toBeVisible();
      await held!.fulfill({ status: 503, json: {} });
      const retry = content.getByRole('button', { name: copy('retry'), exact: true });
      await expect(retry).toBeVisible();
      const failed = queries.at(-1);
      fail = false;
      await retry.click();
      await expect(
        content.getByRole('button', { name: name === 'files' ? /older.pdf/ : /Older solar buyer/ })
      ).toBeVisible();
      expect(queries.at(-1)).toBe(failed);
      expect(new URLSearchParams(failed).get('before')).toBe(firstSolar);
      if (name === 'postal') expect(new URLSearchParams(failed).get('lane')).toBe('needs_staff');
      expect(otherReads).toHaveLength(reads);
      expect(detailReads).toBe(details);
      await expect(note).toHaveValue('Keep this solar explanation');
      await expect(guidance).toHaveValue('Keep this guidance draft');
      expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze()).violations
      ).toEqual([]);
      if (locale === 'fa') {
        await note.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/barghsa-solar-${name}-fa-${testInfo.project.name}.png`,
        });
      }
      denied = true;
      await moreButton.click();
      await expect(content.getByRole('alert')).toHaveText(copy('staffQueueForbidden'));
      await expect(content.getByRole('button')).toHaveCount(0);
      await expect(note).toHaveCount(0);
      await expect(guidance).toHaveValue('Keep this guidance draft');
    });
  }
}
