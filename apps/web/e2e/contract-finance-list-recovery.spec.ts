import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { en, fa } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/admin-ui';
import {
  financeContractId,
  financeCursor,
  cancellationRow,
  obligationRow,
  approvalRow,
  financeContract,
  financeVersion,
} from '../src/test/contract-finance-list-fixtures.js';

test.use({ viewport: { width: 390, height: 844 } });

async function shell(page: Page, locale: 'en' | 'fa') {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'finance',
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
  await page.route('**/api/admin/contracts?*', (route) =>
    route.fulfill({ json: { contracts: [], nextBefore: null } })
  );
}
async function inspect(page: Page, label: string, locale: string, project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: '/tmp/barghsa-contract-finance-' + label + '-fa-mobile-safari.png',
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  test(`cancellation queue retry preserves open detail and exact cursor (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    const w = locale === 'fa' ? fa : en;
    let status = 503;
    const queries: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/admin/contract-cancellation-requests',
      (route) => {
        queries.push(new URL(route.request().url()).search);
        return status === 200
          ? route.fulfill({ json: { requests: [cancellationRow], nextBefore: financeCursor } })
          : route.fulfill({ status, json: {} });
      }
    );
    await page.route(`**/api/admin/contracts/${financeContractId}`, (route) =>
      route.fulfill({ json: financeContract })
    );
    await page.route(`**/api/admin/contracts/${financeContractId}/versions*`, (route) =>
      route.fulfill({ json: { versions: [financeVersion], nextBefore: null } })
    );
    await page.route(`**/api/admin/contracts/${financeContractId}/activation*`, (route) =>
      route.fulfill({
        json: { checks: [], isCurrent: true, ready: false, evaluatedAt: '2026-10-01T00:00:00Z' },
      })
    );
    await page.route(`**/api/admin/contracts/${financeContractId}/cancellation-requests`, (route) =>
      route.fulfill({ json: { request: cancellationRow, canRequest: false } })
    );
    await page.route(`**/api/admin/contracts/${financeContractId}/cancellation-status`, (route) =>
      route.fulfill({
        json: {
          contractId: financeContractId,
          state: 'Active',
          cancelledAt: null,
          financialStatus: 'not_cancelled',
          financiallyClosed: false,
          refundAmount: '0',
          returnedAmount: '0',
          refunds: [],
          canCancel: true,
          canChooseRefund: true,
        },
      })
    );
    await page.goto('/admin/contracts');
    const queue = page.getByRole('region', { name: w.cancellationRequestQueue, exact: true });
    const content = queue.locator(':scope > [data-slot="list-page"] > [data-slot="list-content"]');
    await expect(content.getByRole('alert')).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: w.retry, exact: true }).click();
    await queue.getByRole('button', { name: w.cancellationRequestOpen, exact: true }).click();
    const draft = page.locator('#request-reason-' + financeContractId);
    await draft.fill('Retained staff explanation');
    status = 503;
    await queue.getByRole('button', { name: w.next, exact: true }).click();
    await expect(content.getByRole('alert')).toBeVisible();
    const failed = queries.at(-1);
    expect(new URLSearchParams(failed).get('before')).toBe(financeCursor);
    await expect(draft).toHaveValue('Retained staff explanation');
    status = 200;
    await content.getByRole('button', { name: w.retry, exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await expect(draft).toHaveValue('Retained staff explanation');
    await inspect(page, 'cancellation', locale, info.project.name);
    status = 401;
    await queue.getByRole('button', { name: w.refresh, exact: true }).first().click();
    await expect(queue).toHaveCount(0);
    await expect(draft).toHaveCount(0);
  });
  test(`refund recovery retains bank draft until fresh eligibility changes (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    const w = locale === 'fa' ? fa : en;
    let status = 503,
      processed = false;
    const queries: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/admin/wallet-refunds/contract-obligations',
      (route) => {
        queries.push(new URL(route.request().url()).search);
        return status === 200
          ? route.fulfill({
              json: {
                obligations: [
                  {
                    ...obligationRow,
                    ...(processed ? { state: 'Processing', bankReference: 'BANK-FINAL' } : {}),
                  },
                ],
                nextBefore: financeCursor,
              },
            })
          : route.fulfill({ status, json: {} });
      }
    );
    await page.goto('/admin/contracts');
    const queue = page.getByRole('region', { name: w.cancellationQueue, exact: true });
    const content = queue.locator('[data-slot="list-content"]');
    await expect(content.getByRole('alert')).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: w.retry, exact: true }).click();
    const draft = queue.getByLabel(w.cancellationBankReference, { exact: true });
    await draft.fill('BANK-DRAFT');
    status = 503;
    await queue.getByRole('button', { name: w.next, exact: true }).click();
    await expect(content.getByRole('alert')).toBeVisible();
    await expect(
      queue.getByRole('button', { name: w['cancellation.queue.record-transfer'], exact: true })
    ).toBeDisabled();
    const failed = queries.at(-1);
    expect(new URLSearchParams(failed).get('before')).toBe(financeCursor);
    await expect(draft).toHaveValue('BANK-DRAFT');
    status = 200;
    await content.getByRole('button', { name: w.retry, exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await queue.getByRole('button', { name: w.refresh, exact: true }).click();
    await expect(draft).toHaveValue('BANK-DRAFT');
    await inspect(page, 'refund', locale, info.project.name);
    processed = true;
    await queue.getByRole('button', { name: w.refresh, exact: true }).click();
    await expect(draft).toHaveCount(0);
    await expect(queue.getByText('BANK-FINAL', { exact: true })).toBeVisible();
    status = 403;
    await queue.getByRole('button', { name: w.refresh, exact: true }).click();
    await expect(queue).toHaveCount(0);
  });
  test(`approval page retry retains rejection reasons and exact offset (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    const copy = (key: string) => t('admin.approvals.' + key, locale);
    let status = 503;
    const queries: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/admin/approval-requests',
      (route) => {
        queries.push(new URL(route.request().url()).search);
        return status === 200
          ? route.fulfill({
              json: Array.from({ length: 26 }, (_, n) => ({
                ...approvalRow,
                id: n ? approvalRow.id + '-' + n : approvalRow.id,
              })),
            })
          : route.fulfill({ status, json: {} });
      }
    );
    await page.goto('/admin/approval-requests');
    const queue = page.getByRole('region', { name: copy('listTitle'), exact: true });
    const content = queue.locator('[data-slot="list-content"]');
    await expect(content.getByRole('alert')).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: copy('retry'), exact: true }).click();
    const draft = page.locator('#reason-' + approvalRow.id);
    await draft.fill('Retained evidence explanation');
    status = 503;
    await queue.getByRole('button', { name: copy('next'), exact: true }).click();
    await expect(content.getByRole('alert')).toBeVisible();
    const failed = queries.at(-1);
    expect(new URLSearchParams(failed).get('offset')).toBe('25');
    await expect(draft).toHaveValue('Retained evidence explanation');
    await draft.fill('Edited during recovery');
    status = 200;
    await content.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await expect(draft).toHaveValue('Edited during recovery');
    await inspect(page, 'approval', locale, info.project.name);
    status = 401;
    await queue.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(content.getByRole('alert')).toContainText(copy('loadForbidden'));
    await expect(draft).toHaveCount(0);
    await expect(content.getByRole('button', { name: copy('retry'), exact: true })).toHaveCount(0);
  });
}
