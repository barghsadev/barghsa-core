import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type Route } from './coverage-fixture';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { tWalletReceipts as walletText } from '@barghsa/i18n/wallet-receipts';
import { bankReceiptReview } from '../src/test/bank-receipt-review-fixture';
import {
  receiptId,
  paymentInvoiceId,
  paymentReceipt,
  reconciliationItem,
} from '../src/test/payment-review-fixtures';

test.use({ viewport: { width: 390, height: 844 } });
const base = '/api/admin/wallet/bank-receipt-top-ups';
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
  await page.route('**/api/admin/config/wallet-top-up-limit', (route) =>
    route.fulfill({ json: { limitIrR: 2000000, version: 0 } })
  );
}
async function inspect(page: Page, label: string, locale: string, project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-payment-review-${label}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  const w = (key: string) => walletText(`admin.walletReceipts.${key}`, locale);
  const r = (key: string) => adminText(`admin.reconciliation.${key}`, locale);
  test(`receipt queue recovery retains invoice and customer-visible note (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let queueStatus = 200,
      detailReads = 0,
      reviewReads = 0;
    await page.route(`**${base}`, (route) =>
      queueStatus === 200
        ? route.fulfill({ json: { items: [paymentReceipt] } })
        : route.fulfill({ status: queueStatus, json: {} })
    );
    await page.route(`**${base}/${receiptId}`, (route) => {
      ++detailReads;
      return route.fulfill({ json: paymentReceipt });
    });
    await page.route(`**${base}/${receiptId}/review**`, (route) => {
      ++reviewReads;
      return route.fulfill({
        json: bankReceiptReview(
          receiptId,
          new URL(route.request().url()).searchParams.get('invoiceId')
        ),
      });
    });
    await page.goto('/admin/wallet-receipts');
    const confirm = page.getByTestId('wallet-receipt-confirm');
    await expect(confirm).toBeEnabled();
    await page.locator('input[name="invoiceId"]').fill(paymentInvoiceId);
    await expect(confirm).toBeEnabled();
    await page.locator('#reject-reason').fill('Keep bank review');
    const reads = [detailReads, reviewReads];
    queueStatus = 503;
    await page.getByRole('button', { name: w('queue.refresh'), exact: true }).click();
    await expect(page.getByRole('button', { name: w('queue.retry'), exact: true })).toBeVisible();
    await expect(confirm).toBeDisabled();
    await expect(page.locator('#reject-reason')).toHaveValue('Keep bank review');
    queueStatus = 200;
    await page.getByRole('button', { name: w('queue.retry'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    await expect(page.locator('input[name="invoiceId"]')).toHaveValue(paymentInvoiceId);
    expect([detailReads, reviewReads]).toEqual(reads);
    await page.locator('#reject-reason').scrollIntoViewIfNeeded();
    await inspect(page, 'receipt-queue', locale, info.project.name);
    queueStatus = 403;
    await page.getByRole('button', { name: w('queue.refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(w('queue.forbidden'));
    await expect(page.locator('#reject-reason')).toHaveCount(0);
  });
  test(`receipt detail and financial retries preserve draft and confirm the recovered review (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let detailStatus = 503,
      reviewStatus = 200;
    await page.route(`**${base}`, (route) => route.fulfill({ json: { items: [paymentReceipt] } }));
    await page.route(`**${base}/${receiptId}`, (route) =>
      detailStatus === 200
        ? route.fulfill({ json: paymentReceipt })
        : route.fulfill({ status: detailStatus, json: {} })
    );
    await page.route(`**${base}/${receiptId}/review**`, (route) =>
      reviewStatus === 200
        ? route.fulfill({
            json: bankReceiptReview(
              receiptId,
              new URL(route.request().url()).searchParams.get('invoiceId')
            ),
          })
        : route.fulfill({ status: reviewStatus, json: {} })
    );
    const bodies: unknown[] = [];
    await page.route(`**${base}/${receiptId}/confirm`, (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          ...paymentReceipt,
          state: 'Released',
          canDecide: false,
          reviewHash: 'a'.repeat(64),
        },
      });
    });
    await page.goto('/admin/wallet-receipts');
    const confirm = page.getByTestId('wallet-receipt-confirm');
    await expect(page.getByRole('button', { name: w('detail.retry'), exact: true })).toBeVisible();
    await page.locator('#reject-reason').fill('Keep detail review');
    await expect(confirm).toBeDisabled();
    detailStatus = 200;
    await page.getByRole('button', { name: w('detail.retry'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    await page.locator('input[name="invoiceId"]').fill(paymentInvoiceId);
    await expect(confirm).toBeEnabled();
    reviewStatus = 503;
    await page.getByRole('button', { name: w('review.refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(w('error.allocation'));
    await expect(confirm).toBeDisabled();
    await expect(page.locator('#reject-reason')).toHaveValue('Keep detail review');
    reviewStatus = 200;
    await page.getByRole('button', { name: w('review.refresh'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(confirm).toHaveCount(0);
    expect(bodies).toEqual([{ invoiceId: paymentInvoiceId, expectedReviewHash: 'a'.repeat(64) }]);
  });
  test(`reconciliation retry preserves an open investigation and invalidates changed work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let hold = false,
      held: Route | undefined;
    const queries: string[] = [];
    let accessReads = 0;
    await page.route('**/api/admin/reconciliation/items/access', (route) => {
      ++accessReads;
      return route.fulfill({ json: { canView: true, canResolve: true } });
    });
    await page.route('**/api/admin/reconciliation/items?*', (route) => {
      queries.push(new URL(route.request().url()).search);
      if (hold) {
        held = route;
        return;
      }
      return route.fulfill({ json: [reconciliationItem] });
    });
    await page.goto('/admin/reconciliation');
    await expect(
      page.getByRole('button', { name: reconciliationItem.description, exact: true })
    ).toBeVisible();
    await page.setViewportSize({ width: 900, height: 844 });
    const tableViewport = page.getByRole('region', { name: r('tableTitle'), exact: true });
    await tableViewport.focus();
    await tableViewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect(tableViewport).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await inspect(page, 'reconciliation', locale, info.project.name);
    hold = true;
    await page.getByRole('button', { name: r('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await page.getByRole('button', { name: reconciliationItem.description, exact: true }).click();
    await page.locator('#rex-note').fill('Keep ledger review');
    await held!.fulfill({ status: 503, json: {} });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('alert')).toBeVisible();
    const failedQuery = queries.at(-1),
      permissionReads = accessReads;
    hold = false;
    await dialog.getByRole('button', { name: r('retry'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('#rex-note')).toHaveValue('Keep ledger review');
    expect(queries.at(-1)).toBe(failedQuery);
    expect(accessReads).toBe(permissionReads);
    await dialog.getByRole('button', { name: r('dismiss'), exact: true }).click();
    held = undefined;
    hold = true;
    await page.getByRole('button', { name: r('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await page.getByRole('button', { name: reconciliationItem.description, exact: true }).click();
    await page.locator('#rex-note').fill('Old state');
    await held!.fulfill({
      json: [{ ...reconciliationItem, status: 'resolved', resolutionNote: 'Handled' }],
    });
    await expect(dialog).toHaveCount(0);
  });
  test(`reconciliation access failure preserves note until permission denial (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let hold = false,
      held: Route | undefined,
      denied = false;
    await page.route('**/api/admin/reconciliation/items/access', (route) => {
      if (hold) {
        held = route;
        return;
      }
      return denied
        ? route.fulfill({ status: 403, json: {} })
        : route.fulfill({ json: { canView: true, canResolve: true } });
    });
    await page.route('**/api/admin/reconciliation/items?*', (route) =>
      route.fulfill({ json: [reconciliationItem] })
    );
    await page.goto('/admin/reconciliation');
    await expect(
      page.getByRole('button', { name: reconciliationItem.description, exact: true })
    ).toBeVisible();
    hold = true;
    await page.getByRole('button', { name: r('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await page.getByRole('button', { name: reconciliationItem.description, exact: true }).click();
    await page.locator('#rex-note').fill('Retained permission draft');
    await held!.fulfill({ status: 503, json: {} });
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(r('accessError'));
    await expect(page.locator('#rex-note')).toHaveValue('Retained permission draft');
    hold = false;
    denied = true;
    await page
      .getByRole('dialog')
      .getByRole('button', { name: r('accessRetry'), exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(r('forbidden'));
  });
}
