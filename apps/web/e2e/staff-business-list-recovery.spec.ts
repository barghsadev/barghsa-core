import { test, expect, type Page } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tConsultation } from '@barghsa/i18n/consultation';
import {
  firstWork,
  olderWork,
  electricityWork,
  savingWork,
  consultationWork,
} from '../src/test/staff-business-fixtures';

async function shell(page: Page, locale: 'en' | 'fa') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'business-queue-staff',
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
  await page.route('**/api/admin/contract-cancellation-requests?*', (route) =>
    route.fulfill({ json: { requests: [], nextBefore: null } })
  );
  await page.route('**/api/admin/consultations/teams', (route) =>
    route.fulfill({ json: { teams: [] } })
  );
  await page.route('**/api/staff/saving/orders/*/comments', (route) =>
    route.fulfill({ json: { comments: [] } })
  );
  await page.route('**/api/staff/electricity/orders/*/comments', (route) =>
    route.fulfill({ json: { comments: [] } })
  );
}
const cases = [
  {
    name: 'electricity',
    path: '/admin/electricity-orders',
    base: '/api/staff/electricity/orders',
    row: electricityWork,
    key: 'orders',
    draft: '#electricity-review-reason',
  },
  {
    name: 'saving',
    path: '/admin/saving-orders',
    base: '/api/staff/saving/orders',
    row: savingWork,
    key: 'orders',
    draft: '#saving-staff-note',
  },
  {
    name: 'consultation',
    path: '/admin/consultations',
    base: '/api/admin/consultations/requests',
    row: consultationWork,
    key: 'requests',
    draft: '#consultation-reason',
  },
];
for (const locale of ['en', 'fa'] as const) {
  for (const { name, path, base, row, key, draft } of cases) {
    test(`${name} queue retries preserve work and permission denial clears it (${locale})`, async ({
      page,
    }, testInfo) => {
      await shell(page, locale);
      let detailFail = true,
        pageFail = true,
        denied = false,
        detailReads = 0;
      let held: Route | undefined;
      const queries: string[] = [];
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          const query = new URL(route.request().url()).searchParams;
          queries.push(query.toString());
          if (denied) return route.fulfill({ status: 403, json: {} });
          if (query.has('after') && pageFail) {
            held = route;
            return;
          }
          return route.fulfill({
            json: {
              [key]: [row(query.has('after') ? olderWork : firstWork)],
              nextAfter: query.has('after') ? olderWork : firstWork,
            },
          });
        }
      );
      await page.route(`**${base}/${firstWork}`, (route) => {
        detailReads++;
        return detailFail
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({
              json:
                name === 'consultation'
                  ? {
                      request: row(),
                      history: [
                        {
                          status: 'under_review',
                          actor_type: 'staff',
                          actor_name: 'Chosen consultation staff نام <name>',
                          reason: 'Recorded staff note',
                          created_at: '2026-10-01T00:00:00Z',
                        },
                      ],
                    }
                  : row(),
            });
      });
      await page.goto(path);
      const list = page.locator('[data-slot="list-page"]').first();
      const content =
        name === 'saving'
          ? list
              .getByLabel(tSaving('staffQueue', locale), { exact: true })
              .filter({ has: page.locator('[data-slot="list-content"]') })
              .locator('[data-slot="list-content"]')
              .first()
          : list.locator('[data-slot="list-content"]').first();
      await content.getByRole('button', { name: /First buyer/ }).click();
      const retryWord =
        name === 'consultation'
          ? tConsultation('retry', locale)
          : appText('historyPagination.retry', locale);
      const retry = list.getByRole('button', { name: retryWord, exact: true });
      await expect(retry).toBeVisible();
      const initialQueueReads = queries.length;
      expect(initialQueueReads).toBeGreaterThan(0);
      detailFail = false;
      await retry.click();
      const input = page.locator(draft);
      await expect(input).toBeVisible();
      expect(queries).toHaveLength(initialQueueReads);
      expect(detailReads).toBe(2);
      if (name === 'consultation') {
        await expect(
          list.locator('bdi').filter({ hasText: 'Chosen consultation staff نام <name>' })
        ).toBeVisible();
        await expect(list.locator('script')).toHaveCount(0);
      }
      await input.fill('Preserve this staff draft');
      const moreWord =
        name === 'electricity'
          ? adminText('admin.electricityOrders.more', locale)
          : name === 'saving'
            ? tSaving('staffMoreOrders', locale)
            : tConsultation('moreWork', locale);
      const more = list.getByRole('button', { name: moreWord, exact: true });
      await more.click();
      await expect.poll(() => !!held).toBe(true);
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(more).toBeDisabled();
      await expect(content.getByRole('button', { name: /First buyer/ })).toBeVisible();
      await held!.fulfill({ status: 503, json: {} });
      await expect(content.getByRole('button', { name: retryWord, exact: true })).toBeVisible();
      const failed = queries.at(-1);
      pageFail = false;
      await content.getByRole('button', { name: retryWord, exact: true }).click();
      await expect(content.getByRole('button', { name: /Older buyer/ })).toBeVisible();
      expect(queries.at(-1)).toBe(failed);
      expect(new URLSearchParams(failed).get('after')).toBe(firstWork);
      expect(detailReads).toBe(2);
      await expect(input).toHaveValue('Preserve this staff draft');
      expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (name === 'electricity') {
        const scroll = list
          .getByRole('region', {
            name: adminText('admin.electricityOrders.products', locale),
            exact: true,
          })
          .locator('[data-slot="scroll-area-viewport"]');
        await scroll.focus();
        await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
        await expect
          .poll(() => scroll.evaluate((el) => Math.abs(el.scrollLeft)))
          .toBeGreaterThan(0);
      }
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze()).violations
      ).toEqual([]);
      if (locale === 'fa') {
        await input.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/barghsa-staff-business-${name}-fa-${testInfo.project.name}.png`,
        });
      }
      denied = true;
      await more.click();
      await expect(content.getByRole('alert')).toBeVisible();
      if (name === 'consultation')
        await expect(list).not.toContainText('Chosen consultation staff نام <name>');
      await expect(content.getByRole('button')).toHaveCount(0);
      await expect(input).toHaveCount(0);
    });
  }
}
