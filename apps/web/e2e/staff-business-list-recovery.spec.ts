import { backToSavingOrder, savingOperationLink } from './saving-operation-navigation';
import { test, expect, type Page } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { tStaffConsultation } from '@barghsa/i18n/consultation-staff';
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
      if (name === 'saving') await page.clock.install();
      let detailFail = true,
        pageFail = true,
        malformedPage = false,
        malformedDetail = false,
        denied = false,
        detailReads = 0;
      let held: Route | undefined;
      let heldMalformedDetail: Route | undefined;
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
              [key]: malformedPage ? [null] : [row(query.has('after') ? olderWork : firstWork)],
              nextAfter: query.has('after') ? olderWork : firstWork,
            },
          });
        }
      );
      await page.route(`**${base}/${firstWork}`, (route) => {
        detailReads++;
        if (name === 'saving' && detailFail) return;
        if (name !== 'consultation' && malformedDetail) {
          heldMalformedDetail = route;
          return;
        }
        return detailFail
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({
              json:
                name === 'consultation'
                  ? {
                      request: malformedDetail ? { ...row(), uncovered_credit: 'invalid' } : row(),
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
      const consultation = name === 'consultation';
      const electricity = name === 'electricity';
      const record = consultation
        ? page.locator('[data-slot="consultation-workspace"]')
        : page.locator(`[data-slot="${name}-staff-order"]`);
      const rowRole = 'link';
      await content.getByRole(rowRole, { name: /First buyer/ }).click();
      const retryWord =
        name === 'consultation'
          ? tStaffConsultation('retry', locale)
          : appText('historyPagination.retry', locale);
      const retry = record.getByRole('button', { name: retryWord, exact: true });
      if (name === 'saving') {
        await expect.poll(() => detailReads).toBe(1);
        await page.clock.fastForward(15_001);
      }
      await expect(retry).toBeVisible();
      const initialQueueReads = queries.length;
      expect(initialQueueReads).toBeGreaterThan(0);
      detailFail = false;
      malformedDetail = true;
      await retry.click();
      await expect.poll(() => detailReads).toBe(2);
      if (name !== 'consultation') {
        await expect(retry).toHaveCount(0);
        await heldMalformedDetail!.fulfill({ json: row(olderWork) });
      }
      await expect(retry).toBeVisible();
      await expect(page.locator(draft)).toHaveCount(0);
      await expect(list.getByText('Older buyer', { exact: true })).toHaveCount(0);
      await expect(list).toHaveCount(0);
      malformedDetail = false;
      await retry.click();
      const input = page.locator(draft);
      if (name === 'consultation') {
        await expect(
          record.locator('bdi').filter({ hasText: 'Chosen consultation staff نام <name>' })
        ).toBeVisible();
        await expect(record.locator('script')).toHaveCount(0);
        await record.locator('a[href*="/decisions/request-info"]').click();
      }
      if (electricity) {
        const scroll = record
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
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-slot="electricity-staff-order"]')
              .analyze()
          ).violations
        ).toEqual([]);
        await record.locator('a[href*="/decisions/request-changes"]').click();
      }
      if (name === 'saving') await savingOperationLink(page, 'reject').click();
      await expect(input).toBeVisible();
      expect(queries).toHaveLength(initialQueueReads);
      expect(detailReads).toBe(3);
      await input.fill('Preserve this staff draft');
      await expect(input).toHaveValue('Preserve this staff draft');
      if (locale === 'fa') {
        await input.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/barghsa-staff-business-${name}-fa-${testInfo.project.name}.png`,
        });
      }
      if (name === 'saving') await backToSavingOrder(page, locale).click();
      if (consultation || electricity)
        await page
          .getByRole('link', {
            name: consultation
              ? tStaffConsultation('backToFeeRequest', locale)
              : adminText('admin.electricityOrders.backToOrder', locale),
            exact: true,
          })
          .click();
      await page
        .getByRole('link', {
          name: consultation
            ? tStaffConsultation('backToStaffRequests', locale)
            : electricity
              ? adminText('admin.electricityOrders.backToQueue', locale)
              : tSavingStaffReview('staffBackToQueue', locale),
          exact: true,
        })
        .click();
      await expect(content.getByRole(rowRole, { name: /First buyer/ })).toBeVisible();
      const moreWord =
        name === 'electricity'
          ? adminText('admin.electricityOrders.more', locale)
          : name === 'saving'
            ? tSaving('staffMoreOrders', locale)
            : tStaffConsultation('moreWork', locale);
      const more = list.getByRole('button', { name: moreWord, exact: true });
      await more.click();
      await expect.poll(() => !!held).toBe(true);
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(more).toBeDisabled();
      await expect(content.getByRole(rowRole, { name: /First buyer/ })).toBeVisible();
      if (name === 'saving') await page.clock.fastForward(15_001);
      else await held!.fulfill({ status: 503, json: {} });
      await expect(content.getByRole('button', { name: retryWord, exact: true })).toBeVisible();
      const failed = queries.at(-1);
      pageFail = false;
      malformedPage = true;
      const previousQueueReads = queries.length;
      await content.getByRole('button', { name: retryWord, exact: true }).click();
      await expect.poll(() => queries.length).toBe(previousQueueReads + 1);
      await expect(content.getByRole('button', { name: retryWord, exact: true })).toBeVisible();
      await expect(content.getByRole(rowRole, { name: /First buyer/ })).toBeVisible();
      expect(queries.at(-1)).toBe(failed);
      malformedPage = false;
      await content.getByRole('button', { name: retryWord, exact: true }).click();
      await expect(content.getByRole(rowRole, { name: /Older buyer/ })).toBeVisible();
      expect(queries.at(-1)).toBe(failed);
      expect(new URLSearchParams(failed).get('after')).toBe(firstWork);
      expect(detailReads).toBe(3);
      await expect(input).toHaveCount(0);
      expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze()).violations
      ).toEqual([]);
      denied = true;
      await more.click();
      await expect(content.getByRole('alert')).toBeVisible();
      if (name === 'consultation')
        await expect(list).not.toContainText('Chosen consultation staff نام <name>');
      await expect(content.getByRole(rowRole)).toHaveCount(0);
      await expect(input).toHaveCount(0);
    });
  }
}

test('saving staff can reopen a canonical order from an uppercase UUID', async ({ page }) => {
  await shell(page, 'en');
  const id = `a${firstWork.slice(1)}`;
  await page.route('**/api/staff/saving/orders?**', (route) =>
    route.fulfill({ json: { orders: [savingWork(id)], nextAfter: null } })
  );
  await page.route(`**/api/staff/saving/orders/${id}`, (route) =>
    route.fulfill({ json: savingWork(id) })
  );
  await page.goto(`/admin/saving-orders?orderId=${id.toUpperCase()}`);
  await expect(page).toHaveURL(`/admin/saving-orders/${id}`);
  await expect(page.getByRole('heading', { name: 'Older buyer', exact: true })).toBeVisible();
  await page.goto(`/admin/saving-orders/${id.toUpperCase()}/reject?lane=review`);
  await expect(page).toHaveURL(`/admin/saving-orders/${id}/reject?lane=review`);
  await expect(page.locator('#saving-staff-note')).toBeVisible();
});

test('electricity staff can reopen a canonical order from an uppercase UUID', async ({ page }) => {
  await shell(page, 'en');
  const id = `a${firstWork.slice(1)}`;
  const base = '/api/staff/electricity/orders';
  const reads: URL[] = [];
  await page.route(
    (url) => url.pathname === base || url.pathname === `${base}/conversations`,
    (route) => {
      reads.push(new URL(route.request().url()));
      return route.fulfill({ json: { orders: [], nextAfter: null } });
    }
  );
  await page.route(`**${base}/${id}`, (route) => route.fulfill({ json: electricityWork(id) }));
  await page.goto(
    `/admin/electricity-orders?orderId=${id.toUpperCase()}&view=conversations&cursor=${firstWork}`
  );
  await expect(page).toHaveURL(
    `/admin/electricity-orders/${id}?view=conversations&cursor=${firstWork}`
  );
  await expect(page.getByText('Older buyer', { exact: true }).first()).toBeVisible();
  const decision = '/decisions/request-changes';
  await page.goto(
    `/admin/electricity-orders/${id.toUpperCase()}${decision}?view=conversations&cursor=${firstWork}`
  );
  await expect(page).toHaveURL(
    `/admin/electricity-orders/${id}${decision}?view=conversations&cursor=${firstWork}`
  );
  await expect(page.locator('#electricity-review-reason')).toBeVisible();
  expect(reads).toHaveLength(0);
  await page.getByRole('link', { name: 'Back to electricity order', exact: true }).click();
  await page.getByRole('link', { name: 'Back to electricity orders', exact: true }).click();
  await expect(page).toHaveURL(`/admin/electricity-orders?view=conversations&cursor=${firstWork}`);
  await expect.poll(() => reads.at(-1)?.searchParams.get('after')).toBe(firstWork);
  expect(reads.at(-1)?.pathname).toBe(`${base}/conversations`);
});
