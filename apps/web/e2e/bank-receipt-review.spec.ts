import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { bankReceiptReview } from './bank-receipt-review-fixture';

const receiptId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const profileId = '11111111-1111-7111-8111-111111111111';
const invoiceId = '22222222-2222-7222-8222-222222222222';
const base = '/api/admin/wallet/bank-receipt-top-ups';
const receipt = {
  transactionId: receiptId,
  walletId: profileId,
  amount: '250000',
  currency: 'IRR',
  state: 'Pending',
  paymentDate: '2026-08-15',
  payerReference: 'TRK',
  attachmentKey: null,
  attachmentUrl: null,
  customerNote: null,
  submittedAt: '2026-09-01T10:00:00.000Z',
  canDecide: true,
  staffDecision: null,
  creditTransactionId: null,
};
async function shell(page: Page, locale: 'en' | 'fa') {
  await page.addInitScript((locale) => {
    const apply = () => {
      if (!document.documentElement) return;
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/config/wallet-top-up-limit', (route) =>
    route.fulfill({ json: { limitIrR: 2000000, version: 0 } })
  );
  await page.route(`**${base}`, (route) => route.fulfill({ json: { items: [receipt] } }));
  await page.route(`**${base}/${receiptId}`, (route) => route.fulfill({ json: receipt }));
}
for (const locale of ['en', 'fa'] as const) {
  test(`receipt review rejects changed details, refreshes and confirms the displayed allocation (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let hash = 'a'.repeat(64);
    await page.route(`**${base}/${receiptId}/review**`, (route) => {
      const id = new URL(route.request().url()).searchParams.get('invoiceId');
      const review = bankReceiptReview(receiptId, id);
      review.hash = hash;
      return route.fulfill({ json: review });
    });
    const bodies: unknown[] = [];
    await page.route(`**${base}/${receiptId}/confirm`, (route) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        hash = 'b'.repeat(64);
        return route.fulfill({ status: 409, json: { message: 'Changed' } });
      }
      return route.fulfill({
        json: { ...receipt, state: 'Released', canDecide: false, reviewHash: hash },
      });
    });
    await page.goto('/admin/wallet-receipts');
    const confirm = page.getByTestId('wallet-receipt-confirm');
    await expect(confirm).toBeEnabled();
    await page.locator('input[name="invoiceId"]').fill(invoiceId);
    await expect(confirm).toBeEnabled();
    await expect(page.getByTestId('admin-wallet-receipts-page')).toHaveAttribute(
      'dir',
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    await expect(page.getByText('Customer profile')).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="admin-wallet-receipts-page"]')
          .analyze()
      ).violations
    ).toEqual([]);
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText(locale === 'en' ? 'changed' : 'تغییر');
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Review latest details' : 'بررسی آخرین اطلاعات',
      })
      .click();
    await expect(confirm).toBeEnabled();
    await page.locator('input[name="invoiceId"]').fill(invoiceId);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(confirm).toHaveCount(0);
    expect(bodies).toEqual([
      { invoiceId, expectedReviewHash: 'a'.repeat(64) },
      { invoiceId, expectedReviewHash: 'b'.repeat(64) },
    ]);
  });
}
test('malformed receipt reviews cannot enable confirmation', async ({ page }) => {
  await shell(page, 'en');
  let valid = false;
  await page.route(`**${base}/${receiptId}/review`, (route) => {
    const review = bankReceiptReview(receiptId);
    if (!valid) review.data.wallet.availableAfter = '999';
    return route.fulfill({ json: review });
  });
  await page.goto('/admin/wallet-receipts');
  const confirm = page.getByTestId('wallet-receipt-confirm');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(confirm).toBeDisabled();
  valid = true;
  await page.getByRole('button', { name: 'Review latest details' }).click();
  await expect(confirm).toBeEnabled();
});
