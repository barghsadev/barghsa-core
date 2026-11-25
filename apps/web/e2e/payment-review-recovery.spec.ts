import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type Route } from './coverage-fixture';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { tWalletReceipts as walletText } from '@barghsa/i18n/wallet-receipts';
import { bankReceiptReview } from '../src/test/bank-receipt-review-fixture';
import { confirmFinancialReview } from './confirmation-fixture';
import { receiptEditorMessages } from '@barghsa/i18n/receipt-editor';
import type { ReconciliationItem } from '../src/lib/reconciliation-form';
import {
  enterWalletReceiptInvoiceId,
  openWalletReceiptAction,
} from './wallet-receipt-action-navigation';
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
    const row = page.locator(`main a[href="/admin/wallet-receipts/${receiptId}"]`);
    await expect(row).toBeVisible();
    expect([detailReads, reviewReads]).toEqual([0, 0]);
    queueStatus = 503;
    await page.getByRole('button', { name: w('queue.refresh'), exact: true }).click();
    const retry = page.getByRole('button', { name: w('queue.retry'), exact: true });
    await expect(retry).toBeVisible();
    await expect(page.locator('#reject-reason')).toHaveCount(0);
    queueStatus = 200;
    await retry.click();
    await expect(row).toBeVisible();
    expect([detailReads, reviewReads]).toEqual([0, 0]);
    await inspect(page, 'receipt-queue', locale, info.project.name);
    queueStatus = 403;
    await page.getByRole('button', { name: w('queue.refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(w('queue.forbidden'));
    await expect(row).toHaveCount(0);
  });
  test(`receipt detail and financial retries preserve draft and confirm the recovered review (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let detailStatus = 200,
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
    await page.goto(`/admin/wallet-receipts/${receiptId}`);
    await openWalletReceiptAction(page, 'reject');
    await page.locator('#reject-reason').fill('Keep detail review');
    await openWalletReceiptAction(page, 'confirm');
    await enterWalletReceiptInvoiceId(page, locale);
    const confirm = page.getByTestId('wallet-receipt-confirm');
    await expect(confirm).toBeEnabled();
    detailStatus = 503;
    await page
      .getByRole('button', { name: receiptEditorMessages[locale].refreshReceipt, exact: true })
      .click();
    await expect(page.getByRole('button', { name: w('detail.retry'), exact: true })).toBeVisible();
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
    reviewStatus = 200;
    await page.getByRole('button', { name: w('review.refresh'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    await openWalletReceiptAction(page, 'reject');
    await expect(page.locator('#reject-reason')).toHaveValue('Keep detail review');
    await openWalletReceiptAction(page, 'confirm');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await confirmFinancialReview(page, locale);
    await expect(confirm).toHaveCount(0);
    expect(bodies).toEqual([{ invoiceId: paymentInvoiceId, expectedReviewHash: 'a'.repeat(64) }]);
  });
  test(`reconciliation retry preserves an open investigation and invalidates changed work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    let hold = false,
      malformed = false,
      held: Route | undefined;
    let currentItem: ReconciliationItem = reconciliationItem;
    const queries: string[] = [];
    let accessReads = 0;
    await page.route('**/api/admin/reconciliation/items/access', (route) => {
      ++accessReads;
      return route.fulfill({ json: { canView: true, canResolve: true } });
    });
    let queueReads = 0;
    await page.route('**/api/admin/reconciliation/items?*', (route) => {
      queueReads++;
      return route.fulfill({ json: [reconciliationItem] });
    });
    await page.route(`**/api/admin/reconciliation/items/${reconciliationItem.id}`, (route) => {
      queries.push(new URL(route.request().url()).pathname);
      if (hold) {
        held = route;
        return;
      }
      return route.fulfill({
        json: malformed ? { ...reconciliationItem, description: { invalid: true } } : currentItem,
      });
    });
    await page.goto('/admin/reconciliation');
    await expect(
      page.getByRole('link', { name: reconciliationItem.description, exact: true })
    ).toBeVisible();
    await page.setViewportSize({ width: 900, height: 844 });
    const tableViewport = page.getByRole('region', { name: r('tableTitle'), exact: true });
    await tableViewport.focus();
    await tableViewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect(tableViewport).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await inspect(page, 'reconciliation', locale, info.project.name);
    const queueBefore = queueReads;
    await page.getByRole('link', { name: reconciliationItem.description, exact: true }).click();
    const record = page.getByTestId('reconciliation-record');
    await record.getByRole('link', { name: r('resolve'), exact: true }).click();
    const note = page.locator('#rex-note');
    await note.fill('Keep ledger review');
    hold = true;
    await record.getByRole('button', { name: r('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await held!.fulfill({ status: 503, json: {} });
    await expect(record.getByRole('alert')).toBeVisible();
    const failedQuery = queries.at(-1),
      permissionReads = accessReads;
    hold = false;
    malformed = true;
    await record.getByRole('button', { name: r('retry'), exact: true }).click();
    await expect(record.getByRole('alert')).toBeVisible();
    await expect(note).toHaveValue('Keep ledger review');
    expect(queries.at(-1)).toBe(failedQuery);
    malformed = false;
    await record.getByRole('button', { name: r('retry'), exact: true }).click();
    await expect(record.getByRole('alert')).toHaveCount(0);
    await expect(note).toHaveValue('Keep ledger review');
    expect(queries.at(-1)).toBe(failedQuery);
    expect(accessReads).toBe(permissionReads);
    expect(queueReads).toBe(queueBefore);
    held = undefined;
    hold = true;
    await record.getByRole('button', { name: r('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    currentItem = { ...reconciliationItem, status: 'resolved', resolutionNote: 'Handled' };
    await held!.fulfill({ json: currentItem });
    await expect(record.getByText('Handled', { exact: true })).toBeVisible();
    await expect(note).toHaveCount(0);
    hold = false;
    await record.getByRole('link', { name: r('close'), exact: true }).click();
    await expect(page.locator('#rex-note')).toHaveValue('');
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
    await page.route(`**/api/admin/reconciliation/items/${reconciliationItem.id}`, (route) =>
      route.fulfill({ json: reconciliationItem })
    );
    await page.goto('/admin/reconciliation');
    await page.getByRole('link', { name: reconciliationItem.description, exact: true }).click();
    const record = page.getByTestId('reconciliation-record');
    await record.getByRole('link', { name: r('resolve'), exact: true }).click();
    await page.locator('#rex-note').fill('Retained permission draft');
    hold = true;
    await record.getByRole('button', { name: r('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await held!.fulfill({ status: 503, json: {} });
    await expect(record.getByRole('alert')).toContainText(r('accessError'));
    await expect(page.locator('#rex-note')).toHaveValue('Retained permission draft');
    hold = false;
    denied = true;
    await record.getByRole('button', { name: r('accessRetry'), exact: true }).click();
    await expect(record).toHaveCount(0);
    await expect(page.locator('#rex-note')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(r('forbidden'));
  });
}
