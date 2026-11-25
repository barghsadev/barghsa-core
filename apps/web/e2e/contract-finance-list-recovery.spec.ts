import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { en, fa } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/admin-ui';
import {
  financeContractId,
  financeVersionId,
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
  test(`cancellation queue retries the exact cursor and opens the request page (${locale})`, async ({
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
        json: {
          contractId: financeContractId,
          versionId: financeVersionId,
          state: 'Active',
          checks: [
            'staffApproval',
            'customerAcceptance',
            'signature',
            'initialPayment',
            'serviceStart',
          ].map((key) => ({ key, required: false, status: 'not_required' })),
          isCurrent: true,
          ready: true,
          ruleRevision: 1,
          initialInvoiceId: null,
          serviceStartsAt: null,
          serviceEndsAt: null,
          evaluatedAt: '2026-10-01T00:00:00Z',
        },
      })
    );
    await page.route(`**/api/admin/contracts/${financeContractId}/signature?*`, (route) =>
      route.fulfill({
        json: {
          contractId: financeContractId,
          versionId: financeVersionId,
          state: 'Active',
          isCurrent: true,
          isAmendment: false,
          canRequest: false,
          canRecord: false,
          request: null,
          signature: null,
        },
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
    const open = queue.getByText(w.cancellationRequestOpen, { exact: true });
    await expect(open).toBeVisible();
    status = 503;
    await queue.getByRole('button', { name: w.next, exact: true }).click();
    await expect(content.getByRole('alert')).toBeVisible();
    const failed = queries.at(-1);
    expect(new URLSearchParams(failed).get('before')).toBe(financeCursor);
    await expect(open).toHaveAttribute('aria-disabled', 'true');
    status = 200;
    await content.getByRole('button', { name: w.retry, exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await inspect(page, 'cancellation', locale, info.project.name);
    await open.click();
    await expect(page).toHaveURL(
      `/admin/contracts/${financeContractId}/review-cancellation/${cancellationRow.id}`
    );
    await expect(
      page
        .getByRole('region', { name: w.cancellationRequestTitle, exact: true })
        .getByText(cancellationRow.reason, { exact: true })
    ).toBeVisible();
    status = 401;
    await page.goto('/admin/contracts');
    await expect(queue).toHaveCount(0);
  });
  test(`refund queue retains results while retrying and updates the available action (${locale})`, async ({
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
    await page.goto('/admin/contracts/refunds');
    const queue = page.getByRole('region', { name: w.cancellationQueue, exact: true });
    const content = queue.locator('[data-slot="list-content"]');
    const recordTransfer = queue.getByText(w['cancellation.queue.record-transfer'], {
      exact: true,
    });
    const refresh = page.getByRole('button', { name: w.refresh, exact: true });
    await expect(content.getByRole('alert')).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: w.retry, exact: true }).click();
    await expect(recordTransfer).toBeVisible();
    status = 503;
    await queue.getByRole('button', { name: w.next, exact: true }).click();
    await expect(content.getByRole('alert')).toBeVisible();
    await expect(recordTransfer).toHaveAttribute('aria-disabled', 'true');
    const failed = queries.at(-1);
    expect(new URLSearchParams(failed).get('before')).toBe(financeCursor);
    status = 200;
    await content.getByRole('button', { name: w.retry, exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await expect(
      queue.getByRole('link', { name: w['cancellation.queue.record-transfer'], exact: true })
    ).toBeVisible();
    await inspect(page, 'refund', locale, info.project.name);
    processed = true;
    await refresh.click();
    await expect(recordTransfer).toHaveCount(0);
    await expect(queue.getByText('BANK-FINAL', { exact: true })).toBeVisible();
    await expect(
      queue.getByRole('link', { name: w['cancellation.queue.reconcile'], exact: true })
    ).toBeVisible();
    status = 403;
    await refresh.click();
    await expect(queue).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(w.denied);
  });
  test(`approval page retry retains queue rows and exact offset (${locale})`, async ({
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
                id: n ? `79ac0000-0000-4000-8000-${String(n).padStart(12, '0')}` : approvalRow.id,
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
    const row = queue.getByRole('link', {
      name: `${copy('openRequest')} · ${approvalRow.id}`,
      exact: true,
    });
    await expect(row).toBeVisible();
    status = 503;
    await queue.getByRole('button', { name: copy('next'), exact: true }).click();
    await expect(content.getByRole('alert')).toBeVisible();
    const failed = queries.at(-1);
    expect(new URLSearchParams(failed).get('offset')).toBe('25');
    await expect(row).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await expect(row).toBeVisible();
    await inspect(page, 'approval', locale, info.project.name);
    status = 401;
    await queue.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(content.getByRole('alert')).toContainText(copy('loadForbidden'));
    await expect(row).toHaveCount(0);
    await expect(content.getByRole('button', { name: copy('retry'), exact: true })).toHaveCount(0);
  });
}
