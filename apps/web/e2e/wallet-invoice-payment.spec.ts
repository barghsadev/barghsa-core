import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { ErrorCodes } from '@barghsa/shared/errors';
import { createHash } from 'node:crypto';
import type { WalletPaymentReview, WalletPaymentReviewData } from '@barghsa/shared/finance';
const invoiceId = '11111111-1111-7111-8111-111111111111',
  profileId = '22222222-2222-7222-8222-222222222222',
  transactionId = '33333333-3333-7333-8333-333333333333';
function financialReview(
  amount: string,
  balance: string,
  paid = '0',
  ruleRevision = 1
): WalletPaymentReview {
  const remaining = (BigInt(amount) - BigInt(paid)).toString();
  const data: WalletPaymentReviewData = {
    currency: 'IRR',
    profile: { id: profileId, title: 'Customer profile', type: 'LEGAL' },
    invoice: {
      id: invoiceId,
      state: paid === amount ? 'Paid' : 'Unpaid',
      orderId: null,
      serviceType: 'electricity',
      issuedAt: '2026-09-01T10:00:00.000Z',
      payableFrom: '2026-09-01T10:00:00.000Z',
      dueAt: '2026-09-25T09:00:00.000Z',
      totalAmount: amount,
      paidAmount: paid,
      remainingAmount: remaining,
    },
    lines: [
      {
        id: transactionId,
        description: 'Electricity',
        quantity: 1,
        unitPrice: amount,
        discount: '0',
        subtotal: amount,
        vatRate: 0,
        vatAmount: '0',
        taxable: false,
      },
    ],
    totals: { subtotal: amount, discount: '0', vat: '0' },
    payment: {
      source: 'wallet',
      availableBefore: balance,
      availableAfter: (BigInt(balance) - BigInt(remaining)).toString(),
    },
    contracts: [
      {
        id: profileId,
        versionId: transactionId,
        state: 'Accepted',
        serviceType: 'electricity',
        ruleRevision,
        signatureRequired: false,
        paymentRequired: true,
        initialInvoice: true,
        serviceStartRequired: false,
        serviceStartsAt: null,
        serviceEndsAt: null,
        cancellationRefund: 'full_wallet',
      },
    ],
    cancellation: 'separate_review_required',
  };
  return {
    schemaVersion: 1,
    scope: { action: 'invoice.wallet-payment', profileId, resourceId: invoiceId },
    data,
    hash: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}
async function shell(
  page: Page,
  locale: 'fa' | 'en',
  darkMode: boolean,
  amount: string,
  readPaid: () => string
) {
  await page.addInitScript((locale) => {
    const apply = () => {
      if (document.documentElement.lang !== locale) document.documentElement.lang = locale;
      const direction = locale === 'fa' ? 'rtl' : 'ltr';
      if (document.documentElement.dir !== direction) document.documentElement.dir = direction;
    };
    if (document.documentElement) apply();
    new MutationObserver(apply).observe(document, {
      childList: true,
      attributes: true,
      attributeFilter: ['lang', 'dir'],
      subtree: true,
    });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Finance',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
        numberStyle: locale === 'fa' ? 'persian' : 'western',
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route(`**/api/invoices/${invoiceId}`, (route) => {
    const paid = readPaid();
    const invoice = {
      invoiceId,
      role: 'original',
      state: paid === amount ? 'Paid' : paid === '0' ? 'Unpaid' : 'PartiallyFunded',
      totalAmount: amount,
      paidAmount: paid,
      refundedAmount: '0',
      accountingAmount: amount,
      adjustmentKind: null,
      issuedAt: '2026-09-01T10:00:00.000Z',
      payableFrom: '2026-09-01T10:00:00.000Z',
      dueAt: '2026-09-25T09:00:00.000Z',
      cancelledAt: null,
      createdAt: '2026-09-01T10:00:00.000Z',
      replacesInvoiceId: null,
      adjustmentForInvoiceId: null,
      explanation: null,
      lines: [
        {
          description: 'Electricity',
          quantity: 1,
          unitPrice: amount,
          lineTotal: amount,
          vatRate: 0,
          vatAmount: '0',
          isTaxable: false,
        },
      ],
    };
    return route.fulfill({
      json: { viewedInvoiceId: invoiceId, originalInvoiceId: invoiceId, invoice, chain: [invoice] },
    });
  });
}
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`wallet payment keeps exact confirmation across verification and ambiguous retry (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      const fa = locale === 'fa',
        amount = '10000000000000001',
        balance = '10000000000010001';
      let paid = '0';
      await shell(page, locale, darkMode, amount, () => paid);
      const requests: Array<Record<string, unknown>> = [];
      let quoteStage: 'error' | 'insufficient' | 'funded' = 'error';
      let verifications = 0;
      await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, async (route) => {
        if (route.request().method() === 'GET') {
          if (quoteStage === 'error') return route.fulfill({ status: 503, json: {} });
          const available = quoteStage === 'insufficient' ? '500' : balance;
          return route.fulfill({
            json: {
              invoiceId,
              profileId,
              remainingAmount: amount,
              availableBalance: available,
              canPay: quoteStage === 'funded',
              review: financialReview(amount, available),
            },
          });
        }
        expect(route.request().headers()['x-csrf-token']).toBe('wallet-payment-csrf');
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        if (requests.length === 1)
          return route.fulfill({
            status: 403,
            json: { error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
          });
        if (requests.length === 2 && !darkMode) return route.fulfill({ status: 503, json: {} });
        if (requests.length >= 3) paid = amount;
        return route.fulfill({
          json: {
            ...body,
            invoiceId,
            profileId,
            state: 'Paid',
            amount: requests.length === 2 ? '999' : amount,
            walletTransactionId: transactionId,
            reviewHash: body.expectedReviewHash,
          },
        });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verifications++;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto(`/invoices/${invoiceId}`);
      await page
        .context()
        .addCookies([
          { name: 'barghsa_csrf', value: 'wallet-payment-csrf', url: new URL(page.url()).origin },
        ]);
      const panel = page.locator('#wallet-invoice-payment');
      const summary = page.locator('#invoice-payment-summary');
      const money = formatCurrencyIrr(amount, locale, { numberStyle: fa ? 'persian' : 'western' });
      await expect(panel.getByRole('alert')).toBeVisible();
      await expect(summary.locator('dl').first()).toContainText(money);
      await expect(summary.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
      const refresh = panel.getByRole('button', {
        name: fa ? 'بررسی مبلغ فعلی' : 'Review latest amount',
        exact: true,
        includeHidden: true,
      });
      const pay = panel.getByRole('button', {
        name: fa ? 'بررسی پرداخت از کیف پول' : 'Review wallet payment',
        exact: true,
      });
      quoteStage = 'insufficient';
      await refresh.click();
      await expect(pay).toBeDisabled();
      await expect(panel).toContainText(fa ? 'در حال حاضر پرداخت' : 'cannot be paid');
      const addFunds = panel.getByRole('link', {
        name: fa ? 'رفتن به کیف پول' : 'Open wallet',
      });
      await expect(addFunds).toHaveAttribute('href', `/wallet?returnInvoiceId=${invoiceId}`);
      await expect(panel).toContainText(
        formatCurrencyIrr((BigInt(amount) - 500n).toString(), locale, {
          numberStyle: fa ? 'persian' : 'western',
        })
      );
      quoteStage = 'funded';
      await refresh.click();
      await expect(pay).toBeEnabled();
      await expect(addFunds).toHaveCount(0);
      await expect(panel).toContainText(money);
      await pay.hover();
      await pay.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((a) => a.finished.catch(() => {})));
      });
      expect(
        (
          await new AxeBuilder({ page })
            .include('#invoice-payment-summary')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await pay.click();
      let dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(money);
      await expect(dialog).toContainText(invoiceId);
      if (fa && !darkMode && ['chromium', 'mobile-chrome'].includes(test.info().project.name))
        await page.screenshot({
          path: `/tmp/barghsa-financial-review-${test.info().project.name}.png`,
        });
      await expect(dialog).toContainText('Customer profile');
      await expect(dialog).toContainText(fa ? 'مالیات بر ارزش افزوده' : 'VAT');
      const reviewViewport = dialog.locator('[data-slot="scroll-area-viewport"]');
      await reviewViewport.focus();
      await expect(reviewViewport).toBeFocused();
      await reviewViewport.press('End');
      await expect(
        dialog.getByText(
          fa
            ? 'لغو و استرداد وجه به بررسی جداگانه نیاز دارند.'
            : 'Cancellation and refunds require a separate review.',
          { exact: false }
        )
      ).toBeInViewport();
      await expect(dialog).toContainText(
        fa ? 'موجودی قابل استفاده پس از پرداخت' : 'Available balance after payment'
      );
      await expect(refresh).toBeDisabled();
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      const password = dialog.getByLabel(
        fa ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password'
      );
      await expect(password).toBeFocused();
      await password.fill('test-only');
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await panel
        .getByRole('button', {
          name: fa ? 'تلاش مجدد برای همین پرداخت' : 'Retry this payment',
          exact: true,
        })
        .click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(panel.getByRole('status')).toContainText(transactionId);
      await expect(panel.getByRole('status')).toContainText(money);
      await expect(page.getByTestId(`invoice-card-${invoiceId}`)).toContainText(
        fa ? 'پرداخت‌شده' : 'Paid'
      );
      await expect(summary.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
      expect(requests).toHaveLength(3);
      expect(requests[1]).toEqual(requests[0]);
      expect(requests[2]).toEqual(requests[0]);
      expect(Object.keys(requests[0]!).sort()).toEqual([
        'expectedRemainingAmount',
        'expectedReviewHash',
        'idempotencyKey',
      ]);
      expect(requests[0]!.expectedRemainingAmount).toBe(amount);
      expect(requests[0]!.expectedReviewHash).toBe(financialReview(amount, balance).hash);
      expect(verifications).toBe(1);
    });

test('a changed invoice amount needs a new review and a newly captured request', async ({
  page,
}) => {
  let paid = '0';
  await shell(page, 'en', false, '100000', () => paid);
  const requests: Array<Record<string, unknown>> = [];
  await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          invoiceId,
          profileId,
          remainingAmount: (100000n - BigInt(paid)).toString(),
          availableBalance: '150000',
          canPay: paid !== '100000',
          review: financialReview('100000', '150000', paid),
        },
      });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (requests.length === 1) {
      paid = '20000';
      return route.fulfill({ status: 409, json: {} });
    }
    paid = '100000';
    return route.fulfill({
      json: {
        ...body,
        invoiceId,
        profileId,
        state: 'Paid',
        amount: '80000',
        walletTransactionId: transactionId,
        reviewHash: body.expectedReviewHash,
      },
    });
  });
  await page.goto(`/invoices/${invoiceId}`);
  const panel = page.locator('#wallet-invoice-payment');
  await panel.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'review the latest amount'
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.getByRole('button', { name: 'Review latest amount', exact: true }).click();
  await expect(panel).toContainText('IRR 80,000');
  await panel.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('IRR 80,000');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('IRR 80,000');
  expect(requests[1]!.expectedRemainingAmount).toBe('80000');
  expect(requests[1]!.idempotencyKey).not.toBe(requests[0]!.idempotencyKey);
});

test('changed contract conditions require a new review even when the amount is unchanged', async ({
  page,
}) => {
  await shell(page, 'en', false, '100000', () => '0');
  let revision = 1;
  const requests: Array<Record<string, unknown>> = [];
  await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
    const review = financialReview('100000', '150000', '0', revision);
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          invoiceId,
          profileId,
          remainingAmount: '100000',
          availableBalance: '150000',
          canPay: true,
          review,
        },
      });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (requests.length === 1) {
      revision = 2;
      return route.fulfill({ status: 409, json: {} });
    }
    expect(body.expectedReviewHash).toBe(review.hash);
    return route.fulfill({
      json: {
        ...body,
        invoiceId,
        profileId,
        state: 'Paid',
        amount: '100000',
        walletTransactionId: transactionId,
        reviewHash: review.hash,
      },
    });
  });
  await page.goto(`/invoices/${invoiceId}`);
  const panel = page.locator('#wallet-invoice-payment');
  await panel.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.getByRole('button', { name: 'Review latest amount', exact: true }).click();
  await panel.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText(transactionId);
  expect(requests[1]!.expectedRemainingAmount).toBe(requests[0]!.expectedRemainingAmount);
  expect(requests[1]!.expectedReviewHash).not.toBe(requests[0]!.expectedReviewHash);
  expect(requests[1]!.idempotencyKey).not.toBe(requests[0]!.idempotencyKey);
});

test('wallet confirmation shares loaded dates and blocks payment while timezone recovery is needed', async ({
  page,
}) => {
  await shell(page, 'en', false, '100000', () => '0');
  let timezoneFails = true,
    timezoneReads = 0,
    payments = 0;
  await page.route('**/api/user/settings/timezone', (route) => {
    timezoneReads++;
    return route.fulfill({
      status: timezoneFails ? 503 : 200,
      json: timezoneFails ? {} : { timezone: 'Asia/Tehran' },
    });
  });
  const review = financialReview('100000', '150000');
  await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          invoiceId,
          profileId,
          remainingAmount: '100000',
          availableBalance: '150000',
          canPay: true,
          review,
        },
      });
    payments++;
    return route.fulfill({
      json: {
        ...route.request().postDataJSON(),
        invoiceId,
        profileId,
        state: 'Paid',
        amount: '100000',
        walletTransactionId: transactionId,
        reviewHash: review.hash,
      },
    });
  });
  await page.goto(`/invoices/${invoiceId}`);
  const panel = page.locator('#wallet-invoice-payment');
  const open = panel.getByRole('button', { name: 'Review wallet payment', exact: true });
  await expect(panel.getByRole('alert')).toContainText('Failed to load timezone');
  await expect(open).toBeDisabled();
  timezoneFails = false;
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(open).toBeEnabled();
  const readsBeforeDialog = timezoneReads;
  await open.click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeEnabled();
  await expect(dialog).not.toContainText('Time unavailable');
  expect(timezoneReads).toBe(readsBeforeDialog);
  timezoneFails = true;
  await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
  await expect(dialog.getByRole('alert')).toContainText('Failed to load timezone');
  await expect(confirm).toBeDisabled();
  await dialog.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(payments).toBe(0);
  timezoneFails = false;
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(confirm).toBeEnabled();
  await expect(dialog).not.toContainText('Time unavailable');
  await confirm.click();
  await expect(panel.getByRole('status')).toContainText(transactionId);
  expect(payments).toBe(1);
});

test('an incomplete or foreign financial review cannot enable payment', async ({ page }) => {
  await shell(page, 'en', false, '100000', () => '0');
  let foreign = false;
  await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
    expect(route.request().method()).toBe('GET');
    const review = financialReview('100000', '150000');
    if (foreign) review.scope.profileId = transactionId;
    return route.fulfill({
      json: {
        invoiceId,
        profileId,
        remainingAmount: '100000',
        availableBalance: '150000',
        canPay: true,
        ...(foreign ? { review } : {}),
      },
    });
  });
  await page.goto(`/invoices/${invoiceId}`);
  const panel = page.locator('#wallet-invoice-payment');
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Review wallet payment', exact: true })
  ).toBeDisabled();
  foreign = true;
  await panel.getByRole('button', { name: 'Review latest amount', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Review wallet payment', exact: true })
  ).toBeDisabled();
});

test('legacy invoice reviews disclose missing breakdowns and remaining contract prerequisites', async ({
  page,
}) => {
  await shell(page, 'en', false, '100000', () => '0');
  const review = financialReview('100000', '150000');
  review.data.lines = [];
  review.data.totals = null;
  review.data.profile.title = '';
  review.data.invoice.serviceType = null;
  Object.assign(review.data.contracts[0]!, {
    serviceType: 'solar',
    state: 'Signed',
    initialInvoice: false,
    paymentRequired: false,
    signatureRequired: true,
    serviceStartRequired: true,
    serviceStartsAt: '2026-10-01T00:00:00.000Z',
    serviceEndsAt: '2027-10-01T00:00:00.000Z',
    cancellationRefund: 'staff_decision',
  });
  review.hash = createHash('sha256').update(JSON.stringify(review.data)).digest('hex');
  await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          invoiceId,
          profileId,
          remainingAmount: '100000',
          availableBalance: '150000',
          canPay: true,
          review,
        },
      });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedReviewHash).toBe(review.hash);
    return route.fulfill({
      json: {
        ...body,
        invoiceId,
        profileId,
        state: 'Paid',
        amount: '100000',
        walletTransactionId: transactionId,
        reviewHash: review.hash,
      },
    });
  });
  await page.goto(`/invoices/${invoiceId}`);
  const panel = page.locator('#wallet-invoice-payment');
  await expect(panel).toContainText('no stored item breakdown');
  await panel.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('no stored item breakdown');
  await expect(dialog).toContainText('Signature is required');
  await expect(dialog).toContainText('start date must be reached');
  await expect(dialog).toContainText('Refunds on cancellation require a staff decision');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText(transactionId);
});
