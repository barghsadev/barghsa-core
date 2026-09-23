import { createHash } from 'node:crypto';
import { test, expect } from './coverage-fixture';
import type { WalletPaymentReviewData } from '@barghsa/shared/finance';

const profileId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const invoiceId = '33333333-3333-4333-8333-333333333333';
const contractId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const transactionId = '66666666-6666-4666-8666-666666666666';
const amount = '1200000';
const submittedAt = '2026-09-23T10:00:00.000Z';
const periodStart = '2026-09-25T20:30:00.000Z';
const periodEnd = '2026-10-02T20:30:00.000Z';
const address = {
  id: '77777777-7777-4777-8777-777777777777',
  profileId,
  provinceId: '88888888-8888-4888-8888-888888888888',
  cityId: '99999999-9999-4999-8999-999999999999',
  fullAddress: 'Electricity Street',
  postalCode: '1234567890',
  mainAddress: true,
};
const thermal = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  systemKey: 'thermal',
  title: { en: 'Thermal electricity', fa: 'برق حرارتی' },
  description: null,
  status: 'active',
  price: '100000',
  orderable: true,
  simpleOrderable: true,
  simpleOrderBlockReasons: [],
  limits: { minKwh: '0', maxKwh: '10000' },
};
const green = {
  ...thermal,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  systemKey: 'green',
  title: { en: 'Green electricity', fa: 'برق سبز' },
  price: '200000',
  simpleOrderable: false,
};
const products = [
  thermal,
  green,
  {
    ...thermal,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    systemKey: 'free_market',
    simpleOrderable: false,
  },
  {
    ...thermal,
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    systemKey: 'energy_saving',
    simpleOrderable: false,
  },
];
const quote = {
  reviewDigest: 'a'.repeat(64),
  periodStart,
  periodEnd,
  durationHours: '168',
  totalKwh: '11',
  averagePowerKw: '0.06547619',
  greenRuleApplies: true,
  walletBalanceIrR: '2000000',
  lines: [
    {
      productId: thermal.id,
      systemKey: 'thermal',
      quantityKwh: '10',
      unitPriceIrR: '100000',
      subtotalIrR: '1000000',
      discountIrR: '0',
      vatIrR: '0',
    },
    {
      productId: green.id,
      systemKey: 'green',
      quantityKwh: '1',
      unitPriceIrR: '200000',
      subtotalIrR: '200000',
      discountIrR: '0',
      vatIrR: '0',
    },
  ],
  subtotalIrR: amount,
  discountIrR: '0',
  vatIrR: '0',
  totalIrR: amount,
};

function paymentReview() {
  const data: WalletPaymentReviewData = {
    currency: 'IRR',
    profile: { id: profileId, title: 'Buyer', type: 'LEGAL' },
    invoice: {
      id: invoiceId,
      state: 'Unpaid',
      orderId,
      serviceType: 'electricity',
      issuedAt: submittedAt,
      payableFrom: submittedAt,
      dueAt: '2026-09-30T10:00:00.000Z',
      totalAmount: amount,
      paidAmount: '0',
      remainingAmount: amount,
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
    payment: { source: 'wallet', availableBefore: '2000000', availableAfter: '800000' },
    contracts: [
      {
        id: contractId,
        versionId,
        state: 'AwaitingPayment',
        serviceType: 'electricity',
        ruleRevision: 1,
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
    scope: { action: 'invoice.wallet-payment' as const, profileId, resourceId: invoiceId },
    data,
    hash: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}

test('simple electricity order moves from reviewed quote through wallet payment to contract tracking', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(submittedAt) });
  let reviewComplete = false;
  let paid = false;
  const orderSubmissions: Array<Record<string, unknown>> = [];
  const payments: Array<Record<string, unknown>> = [];

  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'buyer', requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'LEGAL', title: 'Buyer' }],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({
      json: {
        activeProfileId: profileId,
        profileStatus: 'ACTIVE',
        verificationRequired: true,
        isVerified: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/products/electricity', (route) => route.fulfill({ json: products }));
  await page.route(`**/api/profiles/${profileId}/addresses`, (route) =>
    route.fulfill({ json: { addresses: [address] } })
  );
  await page.route('**/api/electricity/periods/simple', (route) =>
    route.fulfill({
      json: {
        periods: [
          { key: 'current_month', start: submittedAt, end: periodEnd },
          { key: 'next_month', start: periodStart, end: periodEnd },
          { key: 'current_week', start: submittedAt, end: periodEnd },
          { key: 'next_week', start: periodStart, end: periodEnd },
          { key: 'week_after_next', start: periodStart, end: periodEnd },
        ],
      },
    })
  );
  await page.route('**/api/electricity/drafts/simple?*', (route) =>
    route.fulfill({ json: { currentStep: 1, data: null, updatedAt: null } })
  );
  await page.route('**/api/electricity/drafts/simple', (route) =>
    route.fulfill({ json: { ...route.request().postDataJSON(), updatedAt: submittedAt } })
  );
  await page.route(`**/api/electricity/bill-data/${profileId}*`, (route) =>
    route.fulfill({ json: { available: false, reason: 'unconfigured', manualEntryAllowed: true } })
  );
  await page.route(`**/api/wallet/${profileId}`, (route) =>
    route.fulfill({ json: { balance: '2000000', currency: 'IRR' } })
  );
  await page.route('**/api/electricity/preview/simple', (route) => route.fulfill({ json: quote }));
  await page.route('**/api/electricity/orders/simple', (route) => {
    orderSubmissions.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201, json: { orderId, contractId, invoiceId, ...quote } });
  });
  await page.route(`**/api/electricity/orders/${orderId}`, (route) =>
    route.fulfill({
      json: {
        orderId,
        profileId,
        commercialStatus: reviewComplete ? 'CONFIRMED' : 'PENDING',
        electricityStatus: reviewComplete ? 'approved' : 'awaiting_staff_review',
        financialStatus: paid ? 'paid' : 'unpaid',
        nextAction: paid ? 'accept_contract' : reviewComplete ? 'pay_invoice' : 'await_review',
        periodStart,
        periodEnd,
        totalKwh: '11',
        fullAddress: address.fullAddress,
        postalCode: address.postalCode,
        contractId,
        contractState: paid ? 'AwaitingCustomerAcceptance' : 'AwaitingPayment',
        versionId,
        invoiceId,
        invoiceState: paid ? 'Paid' : 'Unpaid',
        totalIrR: amount,
        paidIrR: paid ? amount : '0',
        refundedIrR: '0',
        lines: [
          {
            productId: thermal.id,
            systemKey: 'thermal',
            title: thermal.title,
            quantityKwh: '10',
            unitPriceIrR: '100000',
            lineTotalIrR: '1000000',
          },
          {
            productId: green.id,
            systemKey: 'green',
            title: green.title,
            quantityKwh: '1',
            unitPriceIrR: '200000',
            lineTotalIrR: '200000',
          },
        ],
        timeline: [],
      },
    })
  );
  await page.route(`**/api/invoices/${invoiceId}`, (route) => {
    const invoice = {
      invoiceId,
      role: 'original',
      state: paid ? 'Paid' : 'Unpaid',
      totalAmount: amount,
      paidAmount: paid ? amount : '0',
      refundedAmount: '0',
      accountingAmount: amount,
      adjustmentKind: null,
      issuedAt: submittedAt,
      payableFrom: submittedAt,
      dueAt: '2026-09-30T10:00:00.000Z',
      dueAtOverrideReason: null,
      cancelledAt: null,
      createdAt: submittedAt,
      replacesInvoiceId: null,
      adjustmentForInvoiceId: null,
      explanation: null,
      lines: [],
    };
    return route.fulfill({
      json: {
        viewedInvoiceId: invoiceId,
        originalInvoiceId: invoiceId,
        electricityOrderId: orderId,
        consultationId: null,
        invoice,
        chain: [invoice],
        payments: [],
        bankReceipts: [],
        refunds: [],
      },
    });
  });
  await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          invoiceId,
          profileId,
          remainingAmount: amount,
          availableBalance: '2000000',
          canPay: !paid,
          review: paymentReview(),
        },
      });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    payments.push(body);
    paid = true;
    return route.fulfill({
      json: {
        ...body,
        invoiceId,
        profileId,
        state: 'Paid',
        amount,
        walletTransactionId: transactionId,
        reviewHash: paymentReview().hash,
      },
    });
  });

  await page.goto('/electricity');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await page.getByRole('link', { name: 'Order electricity', exact: true }).click();
  await page.locator('#electricity-period-type').selectOption('weekly');
  await page.locator('#electricity-period').selectOption('next_week');
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await next.click();
  await expect(
    page.getByText('Bill data is unavailable. Enter your usage manually.')
  ).toBeVisible();
  await page.locator('#electricity-kwh').fill('10');
  await next.click();
  await expect(page.locator('main')).toContainText('Green electricity');
  await expect(page.locator('main')).toContainText('1,200,000');
  await next.click();
  await next.click();
  await page.getByRole('button', { name: 'Submit Order', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/electricity/orders/${orderId}$`));
  expect(orderSubmissions).toHaveLength(1);
  expect(orderSubmissions[0]).toMatchObject({
    profileId,
    period: 'next_week',
    totalKwh: '10',
    expectedQuoteDigest: quote.reviewDigest,
  });
  await expect(page.getByText('Green electricity')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toContainText(
    'Staff are reviewing your order.'
  );

  // Staff approval is covered by the API suite; the customer resumes after that transition.
  reviewComplete = true;
  await page.reload();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toContainText(
    'Review and pay the linked invoice.'
  );
  await page.getByRole('link', { name: new RegExp(invoiceId) }).click();
  const wallet = page.locator('#wallet-invoice-payment');
  await wallet.getByRole('button', { name: 'Review wallet payment', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(wallet.getByRole('status')).toContainText(transactionId);
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({
    expectedRemainingAmount: amount,
    expectedReviewHash: paymentReview().hash,
  });
  await page.getByRole('link', { name: 'Back to electricity order' }).click();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toContainText(
    'Review and accept the published contract.'
  );
  await page.getByRole('link', { name: 'Review and accept the published contract.' }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts\\?contractId=${contractId}$`));
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible();
});
