import { checkRoutePresentation } from './route-presentation';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as walletText } from '@barghsa/i18n/workspace';
import { formatCurrencyIrr, formatNumber } from '@barghsa/i18n/numbers';
import AxeBuilder from '@axe-core/playwright';
import {
  reconciliationItem,
  paymentProfileId,
  paymentInvoiceId,
} from '../src/test/payment-review-fixtures';

const amount = '9007199254740993';
const bankReceiptId = '44444444-4444-4444-8444-444444444444';
const balance = {
  posted: amount,
  reserved: '0',
  available: amount,
  updatedAt: '2026-09-30T10:00:00Z',
};
const transaction = {
  id: '11111111-1111-7111-8111-111111111112',
  type: 'payment',
  amount: `-${amount}`,
  state: 'Completed',
  refId: paymentInvoiceId,
  description: 'Recorded wallet invoice payment',
  staffSource: 'invoice',
  createdAt: '2026-09-30T09:00:00.123456Z',
};

for (const locale of ['en', 'fa'] as const) {
  test(`reconciliation opens the staff ledger and actual staff invoice (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    const item = {
      ...reconciliationItem,
      details: { walletId: paymentProfileId, invoiceId: paymentInvoiceId, ledger: amount },
    };
    await page.route('**/api/admin/reconciliation/items**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        json: path.endsWith('/access')
          ? { canView: true, canResolve: false }
          : path.endsWith(item.id)
            ? item
            : [item],
      });
    });
    const reads: string[] = [];
    await page.route(
      `**/api/admin/reconciliation/wallets/${paymentProfileId}/transactions?*`,
      (route) => {
        reads.push(route.request().url());
        return route.fulfill({
          json: {
            profileId: paymentProfileId,
            balance,
            transactions: [
              transaction,
              {
                ...transaction,
                id: bankReceiptId,
                type: 'topup',
                amount: '3500000',
                state: 'Pending',
                refId: null,
                description: 'Pending bank receipt',
                staffSource: 'bank_receipt',
                receiptId: bankReceiptId,
              },
            ],
            nextCursor: null,
          },
        });
      }
    );
    const invoice = {
      invoiceId: paymentInvoiceId,
      profileId: paymentProfileId,
      orderId: null,
      type: 'manual',
      state: 'Paid',
      totalAmount: amount,
      paidAmount: amount,
      refundedAmount: '0',
      issuedAt: transaction.createdAt,
      dueAt: null,
      createdAt: transaction.createdAt,
      lines: [],
    };
    await page.route('**/api/admin/invoices/ledger?*', (route) => {
      expect(new URL(route.request().url()).searchParams.get('invoiceId')).toBe(paymentInvoiceId);
      return route.fulfill({ json: { items: [invoice], nextCursor: null } });
    });
    await page.route(`**/api/admin/invoices/ledger/${paymentInvoiceId}`, (route) =>
      route.fulfill({
        json: { ...invoice, activity: { payments: [], bankReceipts: [], refunds: [] } },
      })
    );
    await page.goto('/admin/reconciliation');
    await page.getByRole('link', { name: item.description, exact: true }).click();
    await page
      .getByRole('main')
      .getByRole('link', { name: t('admin.reconciliation.walletLink', locale) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/wallet-ledger/${paymentProfileId}$`));
    await expect(
      page.getByRole('heading', { name: t('admin.walletLedger.title', locale), exact: true })
    ).toBeVisible();
    await expect(page.getByText(transaction.description, { exact: true })).toBeVisible();
    const exact = formatNumber(-BigInt(amount), locale);
    await expect(page.getByText(exact, { exact: true })).toBeVisible();
    await expect(
      page.getByText(walletText('wallet.history.debit', locale), { exact: true })
    ).toBeVisible();
    await expect(page.getByText(walletText('wallet.history.balance.title', locale))).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: walletText('wallet.history.source.bank_receipt', locale),
        exact: true,
      })
    ).toHaveAttribute('href', '/admin/wallet-receipts/' + bankReceiptId);
    await checkRoutePresentation(page, info, locale);
    const section = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: walletText('wallet.history.title', locale),
        exact: true,
      }),
    });
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    const initialReads = reads.length;
    await section
      .getByRole('button', { name: walletText('historyView.table', locale), exact: true })
      .click();
    await expect(section.getByRole('table')).toBeVisible();
    await checkRoutePresentation(page, info, locale);
    await section
      .getByRole('button', { name: walletText('historyView.card', locale), exact: true })
      .click();
    await expect(section.getByRole('table')).toHaveCount(0);
    expect(reads).toHaveLength(initialReads);
    if (locale === 'fa')
      await page.screenshot({
        path: info.outputPath('staff-wallet-ledger-fa.png'),
        fullPage: true,
      });
    await section.getByRole('link', { name: new RegExp(paymentInvoiceId) }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/invoices/${paymentInvoiceId}$`));
    await expect(page.getByText(paymentInvoiceId, { exact: true })).toBeVisible();
    await checkRoutePresentation(page, info, locale);
    await expect(
      page.getByText(formatCurrencyIrr(amount, locale), { exact: true }).first()
    ).toBeVisible();
  });

  test(`staff ledger discards denied history and preserves URL filters (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let denied = false;
    let invalid = false;
    const queries: URLSearchParams[] = [];
    await page.route(
      `**/api/admin/reconciliation/wallets/${paymentProfileId}/transactions?*`,
      (route) => {
        queries.push(new URL(route.request().url()).searchParams);
        return route.fulfill({
          status: denied ? 403 : 200,
          json: denied
            ? {}
            : {
                profileId: paymentProfileId,
                balance,
                transactions: [invalid ? { ...transaction, amount: '1.50' } : transaction],
                nextCursor: null,
              },
        });
      }
    );
    await page.goto(
      `/admin/wallet-ledger/${paymentProfileId}?history_q=Recorded&history_type=payment&history_min=${encodeURIComponent(JSON.stringify(amount))}`
    );
    await expect(page.getByText(transaction.description, { exact: true })).toBeVisible();
    expect(queries[0]!.get('q')).toBe('Recorded');
    expect(queries[0]!.get('type')).toBe('payment');
    expect(queries[0]!.get('min')).toBe(amount);
    denied = true;
    await page.reload();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: walletText('historyPagination.accessDenied', locale) })
    ).toBeVisible();
    await expect(page.getByText(transaction.description, { exact: true })).toHaveCount(0);
    await expect(page.getByText(walletText('wallet.history.balance.title', locale))).toHaveCount(0);
    await expect(page.getByRole('link', { name: new RegExp(paymentInvoiceId) })).toHaveCount(0);
    expect(queries.at(-1)!.get('min')).toBe(amount);

    const retry = page.getByRole('button', { name: walletText('wallet.history.retry', locale) });
    denied = false;
    invalid = true;
    await retry.click();
    await expect(
      page.getByRole('alert').filter({ hasText: walletText('wallet.history.error', locale) })
    ).toBeVisible();
    await expect(page.getByText(transaction.description, { exact: true })).toHaveCount(0);
    const failedQuery = queries.at(-1)!.toString();
    invalid = false;
    await retry.click();
    await expect(page.getByText(transaction.description, { exact: true })).toBeVisible();
    expect(queries.at(-1)!.toString()).toBe(failedQuery);
  });
}
