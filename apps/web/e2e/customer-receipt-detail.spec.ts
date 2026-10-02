import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';

const invoice = '72000000-0000-4000-8000-000000000001';
const receipt = '72000000-0000-4000-8000-000000000002';
const other = '72000000-0000-4000-8000-000000000003';
const amount = '9007199254740993';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQMgn7DwAClAGcHVtGXwAAAABJRU5ErkJggg==',
  'base64'
);
for (const locale of ['en', 'fa'] as const) {
  test(`receipt history opens its private preview, metadata and verification timeline (${locale})`, async ({
    page,
  }) => {
    const copy = (key: string) => t(`invoices.activity.${key}`, locale);
    await page.addInitScript((locale) => localStorage.setItem('barghsa.locale', locale), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'receipt-customer',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          activeProfileId: invoice,
          profiles: [
            {
              id: invoice,
              profileType: 'INDIVIDUAL',
              firstName: 'Test',
              lastName: 'Customer',
              status: 'ACTIVE',
            },
          ],
        },
      })
    );
    await page.route('**/api/profiles/verification-status', (route) =>
      route.fulfill({ json: { activeProfileId: invoice } })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/invoices/bank-receipts**', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              receiptId: receipt,
              invoiceId: invoice,
              amount,
              state: 'Rejected',
              bankName: 'Bank Mellat',
              paymentDate: '2026-09-01',
              submittedAt: '2026-09-01T12:00:00Z',
            },
          ],
          nextCursor: null,
        },
      })
    );
    const node = {
      invoiceId: invoice,
      role: 'original',
      state: 'Paid',
      totalAmount: '1000',
      paidAmount: '1000',
      refundedAmount: '0',
      accountingAmount: '1000',
      adjustmentKind: null,
      createdAt: '2026-09-01T12:00:00Z',
      issuedAt: '2026-09-01T12:00:00Z',
      payableFrom: '2026-09-01T12:00:00Z',
      dueAt: null,
      cancelledAt: null,
      replacesInvoiceId: null,
      adjustmentForInvoiceId: null,
      explanation: null,
      lines: [],
    };
    let sharePaymentNames = true;
    const row = (id: string) => ({
      id,
      amount,
      state: 'Rejected',
      paymentDate: '2026-09-01',
      payerReference: '<img src=x>',
      bankName: 'Bank Mellat',
      customerNote: 'Customer note',
      rejectionReason: 'Unreadable slip',
      confirmedAt: null,
      createdAt: '2026-09-01T12:00:00Z',
      statusHistory: [
        {
          state: 'Submitted',
          occurredAt: '2026-09-01T12:00:00Z',
          backfilled: false,
          actorType: 'customer',
          actorName: sharePaymentNames ? 'آرش Customer' : null,
          reason: 'Customer note <script>',
        },
        { state: 'UnderReview', occurredAt: '2026-09-02T12:00:00Z', backfilled: true },
        {
          state: 'Rejected',
          occurredAt: '2026-09-03T12:00:00Z',
          backfilled: false,
          actorType: 'staff',
          actorName: sharePaymentNames ? 'Reviewer <img src=x>' : null,
          reason: 'Recorded mismatch <img src=x>',
        },
      ],
    });
    await page.route(`**/api/invoices/${invoice}`, (route) =>
      route.fulfill({
        json: {
          viewedInvoiceId: invoice,
          originalInvoiceId: invoice,
          invoice: node,
          chain: [node],
          payments: [],
          refunds: [],
          bankReceipts: [row(receipt), row(other)],
        },
      })
    );
    let requests = 0;
    await page.route(`**/api/invoices/${invoice}/bank-receipts/${receipt}/preview?*`, (route) => {
      requests++;
      return requests === 1
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ contentType: 'image/png', body: image });
    });
    let otherRequests = 0;
    await page.route(`**/api/invoices/${invoice}/bank-receipts/${other}/preview?*`, (route) => {
      otherRequests++;
      return route.fulfill({ contentType: 'image/png', body: image });
    });
    await page.goto('/invoices/receipts');
    await page
      .getByRole('main')
      .locator(`a[href="/invoices/${invoice}#bank-receipt-${receipt}"]`)
      .click();
    const detail = page.locator(`#bank-receipt-${receipt}`);
    await expect(detail.getByText(copy('previewUnavailable'), { exact: true })).toBeVisible();
    await expect(
      detail.getByText(formatCurrencyIrr(amount, locale), { exact: true })
    ).toBeVisible();
    await expect(detail.getByText('Bank Mellat', { exact: false })).toBeVisible();
    await expect(detail.getByText('<img src=x>', { exact: true })).toBeVisible();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await expect(detail.getByRole('link', { name: invoice, exact: true })).toHaveAttribute(
      'href',
      `/invoices/${invoice}`
    );
    const attachment = detail.getByRole('link', {
      name: copy('viewReceiptAttachment'),
      exact: true,
    });
    await expect(attachment).toHaveAttribute(
      'href',
      `/api/invoices/${invoice}/bank-receipts/${receipt}/attachment`
    );
    await expect(attachment).toHaveAttribute('rel', 'noopener noreferrer');
    const timeline = detail.getByRole('region', {
      name: `${copy('reviewTimeline')}: ${receipt}`,
      exact: true,
    });
    await expect(timeline.getByRole('listitem')).toHaveCount(3);
    await expect(timeline.getByText(copy('historicalTime'), { exact: true })).toBeVisible();
    await expect(timeline.locator('bdi').nth(0)).toHaveText(
      `آرش Customer · ${copy('actor.customer')}`
    );
    await expect(timeline.locator('bdi').nth(1)).toHaveText(copy('actor.unknown'));
    await expect(timeline.locator('bdi').nth(2)).toHaveText(
      `Reviewer <img src=x> · ${copy('actor.staff')}`
    );
    await expect(timeline).toContainText('Customer note <script>');
    await expect(timeline).toContainText('Recorded mismatch <img src=x>');
    expect(await timeline.locator('img,script').count()).toBe(0);
    await detail.getByRole('button', { name: copy('retry'), exact: true }).click();
    const preview = detail.getByRole('img', {
      name: copy('receiptPreviewAlt').replace('{receipt}', receipt),
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1);
    await expect(detail.getByText(copy('previewUnavailable'), { exact: true })).toHaveCount(0);
    expect(otherRequests).toBe(0);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="invoice-activity"]').analyze())
        .violations
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await preview.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({
      path: `/tmp/barghsa-receipt-detail-${locale}-${test.info().project.name}.png`,
    });
    await page.locator(`#bank-receipt-${other} summary`).click();
    await expect.poll(() => otherRequests).toBe(1);
    sharePaymentNames = false;
    await page.reload();
    await expect(timeline.locator('bdi').nth(0)).toHaveText(copy('actor.customer'));
    await expect(timeline.locator('bdi').nth(2)).toHaveText(copy('actor.staff'));
    await expect(timeline).not.toContainText('Reviewer <img src=x>');
    await expect(timeline).toContainText('Recorded mismatch <img src=x>');
  });
}
