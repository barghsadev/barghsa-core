import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as walletText } from '@barghsa/i18n/app';
import { formatCurrencyIrr, formatNumber } from '@barghsa/i18n/numbers';
import AxeBuilder from '@axe-core/playwright';
import {
  reconciliationItem,
  paymentProfileId,
  paymentInvoiceId,
} from '../src/test/payment-review-fixtures';

const amount = '9007199254740993';
const transaction = {
  id: '11111111-1111-7111-8111-111111111112',
  type: 'payment',
  amount: `-${amount}`,
  state: 'Completed',
  refId: paymentInvoiceId,
  description: 'Recorded wallet invoice payment',
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
          json: { profileId: paymentProfileId, transactions: [transaction], nextCursor: null },
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
    await page.getByRole('button', { name: item.description, exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('link', { name: t('admin.reconciliation.walletLink', locale) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/wallet-ledger/${paymentProfileId}$`));
    await expect(
      page.getByRole('heading', { name: t('admin.walletLedger.title', locale), exact: true })
    ).toBeVisible();
    await expect(page.getByText(transaction.description, { exact: true })).toBeVisible();
    const exact = formatNumber(-BigInt(amount), locale);
    await expect(page.getByText(exact, { exact: true })).toBeVisible();
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
    await section
      .getByRole('button', { name: walletText('historyView.card', locale), exact: true })
      .click();
    await expect(section.getByRole('table')).toHaveCount(0);
    expect(reads).toHaveLength(initialReads);
    if (locale === 'fa')
      await page.screenshot({
        path: `/Users/majid/.local/state/barghsa-manual-batches/financial-operations-promotion/staff-wallet-ledger-${info.project.name}-fa.png`,
        fullPage: true,
      });
    await section.getByRole('link', { name: new RegExp(paymentInvoiceId) }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/invoices\\?invoiceId=${paymentInvoiceId}$`));
    await page
      .getByRole('button', {
        name: `${t('admin.invoices.ledger.detail', locale)}: ${paymentInvoiceId}`,
        exact: true,
      })
      .click();
    await expect(page.getByText(paymentInvoiceId, { exact: true })).toBeVisible();
    await expect(
      page.getByText(formatCurrencyIrr(amount, locale), { exact: true }).first()
    ).toBeVisible();
  });

  test(`staff ledger discards denied history and preserves URL filters (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let denied = false;
    const queries: URLSearchParams[] = [];
    await page.route(
      `**/api/admin/reconciliation/wallets/${paymentProfileId}/transactions?*`,
      (route) => {
        queries.push(new URL(route.request().url()).searchParams);
        return route.fulfill({
          status: denied ? 403 : 200,
          json: denied
            ? {}
            : { profileId: paymentProfileId, transactions: [transaction], nextCursor: null },
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
    await expect(page.getByRole('link', { name: new RegExp(paymentInvoiceId) })).toHaveCount(0);
    expect(queries.at(-1)!.get('min')).toBe(amount);
  });
}
