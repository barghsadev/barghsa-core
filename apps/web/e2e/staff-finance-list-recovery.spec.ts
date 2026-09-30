import { test, expect, type Page } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';

const first = '82000000-0000-4000-8000-000000000001';
const older = '82000000-0000-4000-8000-000000000002';
const profile = '82000000-0000-4000-8000-000000000003';
const stamp = '2026-09-01T00:00:00.123456Z';
const amount = '9007199254740993';
const invoice = (invoiceId: string) => ({
  invoiceId,
  profileId: profile,
  orderId: null,
  type: 'manual',
  state: 'Paid',
  totalAmount: amount,
  paidAmount: amount,
  refundedAmount: '0',
  issuedAt: stamp,
  dueAt: stamp,
  createdAt: stamp,
});
const receipt = (receiptId: string) => ({
  receiptId,
  invoiceId: first,
  profileId: profile,
  amount,
  state: 'Submitted',
  paymentDate: '2026-09-01',
  payerReference: 'TRK-exact',
  bankName: 'Bank Mellat',
  submittedAt: stamp,
  attachmentUrl: null,
  canConfirm: false,
  canReject: true,
  rejectionReason: null,
  customerNote: null,
  invoiceAllocation: null,
  walletCreditAmount: null,
  confirmedAt: null,
  dualApprovalPending: false,
  requiresDualApproval: false,
});
async function shell(page: Page, locale: 'en' | 'fa') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'finance-list-staff',
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
}
for (const locale of ['en', 'fa'] as const) {
  const ledgerWord = (key: string) => adminText(`admin.invoices.ledger.${key}`, locale);
  const receiptWord = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  test(`staff ledger retains details and rows when retrying a failed page (${locale})`, async ({
    page,
  }, testInfo) => {
    await shell(page, locale);
    let held: Route | undefined,
      fail = true,
      detailReads = 0;
    const queries: string[] = [];
    await page.route(/\/api\/admin\/invoices\/ledger(?:\?|$)/, (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query.toString());
      if (query.has('beforeAt') && fail) {
        held = route;
        return;
      }
      return route.fulfill({
        json: {
          items: [invoice(query.has('beforeAt') ? older : first)],
          nextCursor: query.has('beforeAt') ? null : { beforeAt: stamp, beforeId: first },
        },
      });
    });
    await page.route(`**/api/admin/invoices/ledger/${first}`, (route) => {
      detailReads++;
      return route.fulfill({
        json: {
          ...invoice(first),
          lines: [],
          activity: { payments: [], bankReceipts: [], refunds: [] },
        },
      });
    });
    await page.goto('/admin/invoices');
    const ledger = page.getByRole('region', { name: ledgerWord('title'), exact: true });
    await ledger
      .getByRole('button', { name: `${ledgerWord('detail')}: ${first}`, exact: true })
      .click();
    const detail = ledger.getByRole('region', { name: ledgerWord('detail'), exact: true });
    await expect(detail.getByText(first, { exact: true })).toBeVisible();
    const content = ledger.locator('[data-slot="list-content"]');
    const more = ledger.getByRole('button', { name: ledgerWord('more'), exact: true });
    await more.click();
    await expect.poll(() => !!held).toBe(true);
    await expect(content).toHaveAttribute('aria-busy', 'true');
    await expect(content.locator('tbody tr')).toHaveCount(1);
    await expect(more).toBeDisabled();
    await expect(detail.getByText(first, { exact: true })).toBeVisible();
    await held!.fulfill({ status: 503, json: {} });
    const retry = content.getByRole('button', { name: ledgerWord('retry'), exact: true });
    await expect(retry).toBeVisible();
    const failed = queries.at(-1);
    fail = false;
    await retry.click();
    await expect(content.locator('tbody tr')).toHaveCount(2);
    expect(queries.at(-1)).toBe(failed);
    expect(new URLSearchParams(failed).get('beforeAt')).toBe(stamp);
    expect(detailReads).toBe(1);
    const scroll = detail.locator('[data-slot="scroll-area-viewport"]');
    await scroll.focus();
    await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect.poll(() => scroll.evaluate((el) => Math.abs(el.scrollLeft))).toBeGreaterThan(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-labelledby="invoice-ledger-title"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(
      await ledger
        .locator('[data-slot="list-page"]')
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);
    if (locale === 'fa') {
      await ledger.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `/tmp/barghsa-staff-finance-ledger-fa-${testInfo.project.name}.png`,
      });
    }
  });
  test(`staff receipt history retries exact pages and returns to the first page (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/admin/invoices/bank-receipts', (route) =>
      route.fulfill({ json: { items: [] } })
    );
    let held: Route | undefined,
      fail = true;
    const queries: string[] = [];
    await page.route(/\/api\/admin\/invoices\/bank-receipts\/history(?:\?|$)/, (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query.toString());
      if (query.has('beforeAt') && fail) {
        held = route;
        return;
      }
      return route.fulfill({
        json: {
          items: [{ ...receipt(query.has('beforeAt') ? older : first), state: 'Confirmed' }],
          nextCursor: query.has('beforeAt') ? null : { beforeAt: stamp, beforeId: first },
        },
      });
    });
    await page.goto('/admin/invoices');
    await page
      .locator('#invoice-receipt-panel')
      .getByRole('button', { name: receiptWord('title'), exact: true })
      .click();
    const queue = page.getByRole('region', { name: receiptWord('title'), exact: true });
    await queue.getByRole('button', { name: receiptWord('historyTitle'), exact: true }).click();
    const history = queue.getByRole('region', { name: receiptWord('historyTitle'), exact: true });
    await history
      .getByRole('combobox', { name: receiptWord('historyState'), exact: true })
      .selectOption('Confirmed');
    const content = history.locator('[data-slot="list-content"]');
    await expect(content.getByText(first, { exact: true })).toHaveCount(2);
    const nav = history.getByRole('navigation', { name: receiptWord('historyPages'), exact: true });
    await nav.getByRole('button', { name: receiptWord('historyNext'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await expect(content).toHaveAttribute('aria-busy', 'true');
    await expect(
      nav.getByRole('button', { name: receiptWord('historyNext'), exact: true })
    ).toBeDisabled();
    await expect(
      nav.getByRole('button', { name: receiptWord('historyPrevious'), exact: true })
    ).toBeDisabled();
    await expect(content.getByText(first, { exact: true })).toHaveCount(2);
    await held!.fulfill({ status: 503, json: {} });
    const retry = content.getByRole('button', {
      name: appText('historyPagination.retry', locale),
      exact: true,
    });
    await expect(retry).toBeVisible();
    const failed = queries.at(-1);
    fail = false;
    await retry.click();
    await expect(content.getByText(older, { exact: true })).toBeVisible();
    expect(queries.at(-1)).toBe(failed);
    expect(new URLSearchParams(failed).get('beforeAt')).toBe(stamp);
    expect(new URLSearchParams(failed).get('state')).toBe('Confirmed');
    await expect(
      nav.getByRole('button', { name: receiptWord('historyNext'), exact: true })
    ).toBeDisabled();
    await nav.getByRole('button', { name: receiptWord('historyPrevious'), exact: true }).click();
    await expect(content.getByText(older, { exact: true })).toHaveCount(0);
    await expect(content.getByText(first, { exact: true })).toHaveCount(2);
    expect(new URLSearchParams(queries.at(-1)).has('beforeAt')).toBe(false);
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-label="' + receiptWord('historyTitle') + '"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(
      await history
        .locator('[data-slot="list-page"]')
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);
  });
  test(`staff queue retry preserves a receipt draft and permission denial removes it (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let listStatus = 200,
      detailReads = 0,
      allocationReads = 0;
    await page.route('**/api/admin/invoices/bank-receipts', (route) =>
      listStatus === 200
        ? route.fulfill({ json: { items: [receipt(first)] } })
        : route.fulfill({ status: listStatus, json: {} })
    );
    await page.route(`**/api/admin/invoices/bank-receipts/${first}`, (route) => {
      detailReads++;
      return route.fulfill({ json: receipt(first) });
    });
    await page.route(`**/api/admin/invoices/bank-receipts/${first}/allocation`, (route) => {
      allocationReads++;
      return route.fulfill({
        json: {
          receiptId: first,
          invoiceId: first,
          invoiceState: 'Unpaid',
          receiptAmount: amount,
          remaining: amount,
          invoiceAllocation: amount,
          walletCreditAmount: '0',
        },
      });
    });
    await page.goto('/admin/invoices');
    await page
      .locator('#invoice-receipt-panel')
      .getByRole('button', { name: receiptWord('title'), exact: true })
      .click();
    const queue = page.getByRole('region', { name: receiptWord('title'), exact: true });
    const content = queue.locator('[data-slot="list-content"]').first();
    await content.getByRole('button', { name: receiptWord('open'), exact: true }).click();
    const detail = queue.getByRole('region', { name: receiptWord('detail'), exact: true });
    await expect(detail.getByText(first, { exact: true })).toHaveCount(2);
    listStatus = 503;
    await queue.getByRole('button', { name: receiptWord('refresh'), exact: true }).click();
    const retry = content.getByRole('button', {
      name: appText('historyPagination.retry', locale),
      exact: true,
    });
    await expect(retry).toBeVisible();
    const reason = detail.getByRole('textbox');
    await reason.fill('Keep this rejection explanation');
    const reads = [detailReads, allocationReads];
    listStatus = 200;
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(reason).toHaveValue('Keep this rejection explanation');
    expect([detailReads, allocationReads]).toEqual(reads);
    listStatus = 403;
    await queue.getByRole('button', { name: receiptWord('refresh'), exact: true }).click();
    await expect(content.getByRole('alert')).toHaveText(receiptWord('forbidden'));
    await expect(detail).toHaveCount(0);
    await expect(content.locator('ul')).toHaveCount(0);
  });
}
