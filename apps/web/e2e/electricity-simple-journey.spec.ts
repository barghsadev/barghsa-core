import { t as appCopy } from '@barghsa/i18n/app';
import { t as adminCopy } from '@barghsa/i18n/admin-ui';
import { tWalletInvoicePayment as walletCopy } from '@barghsa/i18n/wallet-invoice-payment';
import { contractText as contractCopy } from '@barghsa/i18n/contracts';
import { test, expect } from './coverage-fixture';
import { electricityPaymentReview } from './electricity-payment-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const invoiceId = '33333333-3333-4333-8333-333333333333';
const contractId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const transactionId = '66666666-6666-4666-8666-666666666666';
const amount = '1250000';
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
      discountIrR: '50000',
      vatIrR: '100000',
      totalIrR: '1050000',
    },
    {
      productId: green.id,
      systemKey: 'green',
      quantityKwh: '1',
      unitPriceIrR: '200000',
      subtotalIrR: '200000',
      discountIrR: '0',
      vatIrR: '0',
      totalIrR: '200000',
    },
  ],
  subtotalIrR: '1200000',
  discountIrR: '50000',
  vatIrR: '100000',
  totalIrR: amount,
};

function paymentReview() {
  return electricityPaymentReview({
    profileId,
    orderId,
    invoiceId,
    contractId,
    versionId,
    transactionId,
    amount,
    availableBalance: '2000000',
    submittedAt,
  });
}

for (const locale of ['en', 'fa'] as const)
  test(`simple electricity order moves from reviewed quote through payment and contract activation (${locale})`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.clock.install({ time: new Date(submittedAt) });
    let reviewComplete = false;
    let paid = false;
    let accepted = false;
    let billAvailable = false;
    const orderSubmissions: Array<Record<string, unknown>> = [];
    const payments: Array<Record<string, unknown>> = [];
    const contractAcceptances: Array<Record<string, unknown>> = [];
    const staffApprovals: Array<Record<string, unknown>> = [];
    const contractState = () => (accepted ? 'Active' : 'AwaitingCustomerAcceptance');
    let operatingContext: 'customer' | 'staff' = 'customer';

    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          isStaff: true,
          userId: 'buyer',
          operatingContext,
          canSwitchContext: true,
          requiresTosAcceptance: false,
        },
      })
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
          activeProfileName: 'Buyer Legal Ltd',
          profileStatus: 'ACTIVE',
          verificationRequired: true,
          isVerified: true,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/New_York' } })
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
      route.fulfill({
        json: billAvailable
          ? {
              available: true,
              suggestedKwh: '24',
              dataSource: 'configured_bill_provider',
              dataPeriod: { start: '2026-09-20T00:00:00Z', end: '2026-09-21T00:00:00Z' },
              dataTimestamp: '2026-09-20T23:00:00Z',
              coverage: 0.75,
              manualEntryAllowed: true,
            }
          : { available: false, reason: 'unconfigured', manualEntryAllowed: true },
      })
    );
    await page.route(`**/api/wallet/${profileId}`, (route) =>
      route.fulfill({ json: { balance: '2000000', currency: 'IRR' } })
    );
    await page.route('**/api/electricity/preview/simple', (route) =>
      route.fulfill({ json: quote })
    );
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
          electricityStatus: accepted
            ? 'active'
            : reviewComplete
              ? 'approved'
              : 'awaiting_staff_review',
          financialStatus: paid ? 'paid' : 'unpaid',
          nextAction: accepted
            ? 'await_delivery'
            : paid
              ? 'accept_contract'
              : reviewComplete
                ? 'pay_invoice'
                : 'await_review',
          periodStart,
          periodEnd,
          totalKwh: '11',
          fullAddress: address.fullAddress,
          postalCode: address.postalCode,
          contractId,
          contractState: paid ? contractState() : 'AwaitingPayment',
          versionId,
          invoiceId,
          invoiceState: paid ? 'Paid' : 'Unpaid',
          totalIrR: amount,
          paidIrR: paid ? amount : '0',
          refundedIrR: '0',
          pricingSnapshot: {
            subtotalIrR: quote.subtotalIrR,
            discountIrR: quote.discountIrR,
            vatIrR: quote.vatIrR,
            lines: quote.lines.map((line) => ({
              productId: line.productId,
              subtotalIrR: line.subtotalIrR,
              discountIrR: line.discountIrR,
              netIrR: (BigInt(line.subtotalIrR) - BigInt(line.discountIrR)).toString(),
              vatIrR: line.vatIrR,
            })),
          },
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
    const staffOrder = () => ({
      orderId,
      profileId,
      contractId,
      contractState: reviewComplete ? 'AwaitingPayment' : 'AwaitingStaffReview',
      invoiceId,
      invoiceState: 'Unpaid',
      customerName: 'Buyer',
      commercialStatus: reviewComplete ? 'approved' : 'awaiting_staff_review',
      financialStatus: 'unpaid',
      nextAction: reviewComplete ? 'await_payment' : 'review_order',
      submittedAt,
      periodStart,
      periodEnd,
      totalKwh: '11',
      pricingSnapshot: {
        lines: quote.lines.map((line) => ({
          systemKey: line.systemKey,
          quantityKwh: line.quantityKwh,
          unitPriceIrR: line.unitPriceIrR,
          subtotalIrR: line.subtotalIrR,
          discountIrR: line.discountIrR,
          netIrR: (BigInt(line.subtotalIrR) - BigInt(line.discountIrR)).toString(),
          vatIrR: line.vatIrR,
        })),
      },
      settingsSnapshot: { simpleGreenRuleEnabled: true },
      fullAddress: address.fullAddress,
      contractSnapshot: {
        orderId,
        template: {
          versionNumber: 1,
          name: 'Electricity supply terms',
          text: 'Supply begins after invoice payment and customer acceptance.',
        },
      },
      versionId,
      totalIrR: amount,
      paidIrR: '0',
      ageHours: 1,
      priority: 'normal',
      timeline: [],
    });
    await page.route('**/api/staff/electricity/orders', (route) =>
      route.fulfill({ json: { orders: reviewComplete ? [] : [staffOrder()], nextAfter: null } })
    );
    await page.route(`**/api/staff/electricity/orders/${orderId}/financial-review`, (route) =>
      route.fulfill({
        json: {
          schemaVersion: 1,
          scope: { action: 'electricity.staff-review.approve', profileId, resourceId: orderId },
          data: {
            action: 'approve',
            reason: '',
            customerName: 'Buyer',
            contractId,
            contractState: 'AwaitingStaffReview',
            commercialStatus: 'awaiting_staff_review',
            versionId,
            versionNumber: 1,
            contractSnapshot: staffOrder().contractSnapshot,
            invoiceId,
            invoiceState: 'Unpaid',
            invoiceTotal: amount,
            paidAmount: '0',
            refundedAmount: '0',
            pendingRefundAmount: '0',
            periodStart,
            periodEnd,
            totalKwh: '11',
            pricingSnapshot: staffOrder().pricingSnapshot,
            outcome: 'publish_contract',
            refundAmount: '0',
            releasesGiftCode: false,
          },
          hash: 'b'.repeat(64),
        },
      })
    );
    await page.route(`**/api/staff/electricity/orders/${orderId}/approve`, (route) => {
      staffApprovals.push(route.request().postDataJSON() as Record<string, unknown>);
      reviewComplete = true;
      return route.fulfill({
        json: { orderId, status: 'approved', contractId, invoiceId, refundId: null },
      });
    });
    await page.route(`**/api/staff/electricity/orders/${orderId}`, (route) =>
      route.fulfill({ json: staffOrder() })
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
          contractId,
          contractState: contractState(),
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
    const contractVersion = () => ({
      id: versionId,
      versionNumber: 1,
      content: { text: 'Published electricity terms', price: amount },
      changeDescription: 'Initial electricity contract',
      createdAt: submittedAt,
      publishedAt: submittedAt,
      acceptedAt: accepted ? submittedAt : null,
    });
    const paymentFacts = paymentReview().data;
    const { payment: _walletPayment, ...initialInvoiceFacts } = paymentFacts;
    const financialReview = {
      schemaVersion: 1,
      hash: 'c'.repeat(64),
      scope: { action: 'contract.acceptance', profileId, resourceId: contractId },
      data: {
        currency: 'IRR',
        profile: paymentFacts.profile,
        contract: {
          id: contractId,
          versionId,
          versionNumber: 1,
          serviceType: 'electricity',
          state: 'AwaitingCustomerAcceptance',
          publishedAt: submittedAt,
          content: contractVersion().content,
        },
        activation: {
          ruleRevision: 1,
          signatureRequired: false,
          paymentRequired: true,
          serviceStartRequired: true,
          serviceStartsAt: periodStart,
          serviceEndsAt: periodEnd,
          initialInvoiceId: invoiceId,
        },
        initialInvoice: {
          ...initialInvoiceFacts,
          invoice: {
            ...paymentFacts.invoice,
            state: 'Paid',
            paidAmount: amount,
            remainingAmount: '0',
          },
        },
        payment: { source: 'none', amount: '0' },
        cancellationRefund: 'full_wallet',
        signature: null,
      },
    };
    await page.route('**/api/contracts?*', (route) =>
      route.fulfill({
        json: {
          contracts: [
            {
              id: contractId,
              orderId,
              serviceType: 'electricity',
              state: contractState(),
              versionId,
              versionNumber: 1,
              initialInvoiceId: invoiceId,
              initialInvoiceState: 'Paid',
            },
          ],
          nextBefore: null,
        },
      })
    );
    await page.route(`**/api/contracts/${contractId}/accept`, (route) => {
      contractAcceptances.push(route.request().postDataJSON() as Record<string, unknown>);
      accepted = true;
      return route.fulfill({ json: { id: contractId, state: contractState(), financialReview } });
    });
    await page.route(`**/api/contracts/${contractId}/acceptance-review?*`, (route) =>
      route.fulfill({ json: financialReview })
    );
    await page.route(`**/api/contracts/${contractId}/versions`, (route) =>
      route.fulfill({ json: { versions: [contractVersion()], nextBefore: null } })
    );
    await page.route(`**/api/contracts/${contractId}/activation?*`, (route) =>
      route.fulfill({
        json: {
          contractId,
          versionId,
          state: contractState(),
          isCurrent: true,
          ready: accepted,
          ruleRevision: 1,
          initialInvoiceId: invoiceId,
          serviceStartsAt: periodStart,
          serviceEndsAt: periodEnd,
          evaluatedAt: submittedAt,
          checks: [
            { key: 'staffApproval', required: true, status: 'met' },
            { key: 'customerAcceptance', required: true, status: accepted ? 'met' : 'unmet' },
            { key: 'signature', required: false, status: 'not_required' },
            { key: 'initialPayment', required: true, status: 'met' },
            { key: 'serviceStart', required: true, status: 'met' },
          ],
        },
      })
    );
    await page.route(`**/api/contracts/${contractId}/signature?*`, (route) =>
      route.fulfill({
        json: { canRequest: false, canRecord: false, request: null, signature: null },
      })
    );
    await page.route(`**/api/contracts/${contractId}`, (route) =>
      route.fulfill({
        json: {
          id: contractId,
          profileId,
          orderId,
          serviceType: 'electricity',
          state: contractState(),
          version: contractVersion(),
          canAccept: !accepted,
          initialInvoiceId: invoiceId,
          initialInvoiceState: 'Paid',
        },
      })
    );
    await page.route('**/api/documents?*', (route) =>
      route.fulfill({ json: { documents: [], nextBefore: null } })
    );

    await page.goto('/electricity');
    await page
      .getByRole('link', {
        name: appCopy('electricity.catalogue.createDraft', locale),
        exact: true,
      })
      .click();
    await expect(page.locator('#electricity-period option[value="current_month"]')).toContainText(
      locale === 'fa'
        ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
            timeZone: 'Asia/Tehran',
            month: 'long',
            year: 'numeric',
          }).format(new Date(submittedAt))
        : 'Sep 23, 2026 – Oct 2, 2026'
    );
    await page.locator('#electricity-period-type').selectOption('weekly');
    await page.locator('#electricity-period').selectOption('next_week');
    const next = page.getByRole('button', {
      name: appCopy('electricity.order.next', locale),
      exact: true,
    });
    await next.click();
    await expect(page.getByText(appCopy('electricity.order.manualQuantity', locale))).toBeVisible();
    await page.locator('#electricity-kwh').fill('10');
    billAvailable = true;
    await page
      .getByRole('button', {
        name: appCopy('electricity.order.retryBillData', locale),
        exact: true,
      })
      .click();
    const expectedTimestamp = await page.evaluate(
      (language) =>
        new Intl.DateTimeFormat(language, {
          timeZone: 'America/New_York',
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date('2026-09-20T23:00:00Z')),
      locale
    );
    await expect(page.locator('time[datetime="2026-09-20T23:00:00Z"]')).toHaveText(
      expectedTimestamp
    );
    await expect(page.locator('#electricity-kwh')).toHaveValue('10');
    await next.click();
    await expect(page.locator('main')).toContainText(
      appCopy('electricity.order.revision.green', locale)
    );
    await expect(page.locator('main')).toContainText(new Intl.NumberFormat(locale).format(1250000));
    await expect(page.locator('main')).toContainText(
      `${appCopy('electricity.order.lineTotal', locale)}: ${new Intl.NumberFormat(locale, { style: 'currency', currency: 'IRR', currencyDisplay: locale === 'fa' ? 'symbol' : 'code', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(1050000)}`
    );
    await next.click();
    await next.click();
    await expect(page.getByText('Buyer Legal Ltd', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: appCopy('electricity.order.submit', locale), exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/electricity/orders/${orderId}$`));
    await expect(page.getByText(appCopy('electricity.order.success.create', locale))).toBeVisible();
    expect(orderSubmissions).toHaveLength(1);
    expect(orderSubmissions[0]).toMatchObject({
      profileId,
      period: 'next_week',
      totalKwh: '10',
      expectedQuoteDigest: quote.reviewDigest,
    });
    await expect(page.getByText(appCopy('electricity.order.revision.green', locale))).toBeVisible();
    await expect(
      page
        .getByRole('heading', { name: appCopy('electricity.order.detail.lines', locale) })
        .locator('..')
    ).toContainText(
      `${appCopy('electricity.order.lineTotal', locale)}: ${new Intl.NumberFormat(locale, { style: 'currency', currency: 'IRR', currencyDisplay: locale === 'fa' ? 'symbol' : 'code', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(1050000)}`
    );
    await expect(
      page.getByRole('region', { name: appCopy('workflow.summary', locale) })
    ).toContainText(appCopy('electricity.order.nextAction.await_review', locale));
    const statusPair = page.locator('dl').filter({
      has: page.getByText(appCopy('electricity.order.commercialStatus', locale), { exact: true }),
    });
    await expect(statusPair.locator('dt')).toHaveText([
      appCopy('electricity.order.commercialStatus', locale),
      appCopy('electricity.order.financialStatus', locale),
    ]);
    await expect(statusPair.locator('dd')).toHaveText([
      appCopy('electricity.order.status.awaiting_staff_review', locale),
      appCopy('electricity.order.financial.unpaid', locale),
    ]);

    operatingContext = 'staff';
    await page.goto('/admin/electricity-orders');
    await page.getByRole('button', { name: new RegExp(`Buyer.*${orderId}`) }).click();
    const staffProducts = page
      .getByRole('heading', { name: adminCopy('admin.electricityOrders.products', locale) })
      .locator('..')
      .getByRole('table');
    await expect(staffProducts.getByRole('columnheader')).toContainText([
      appCopy('electricity.order.step1', locale),
      adminCopy('admin.electricityOrders.quantity', locale),
      appCopy('electricity.order.detail.unitPrice', locale),
      adminCopy('admin.electricityOrders.subtotal', locale),
      appCopy('electricity.order.detail.cancelReviewDiscount', locale),
      adminCopy('admin.electricityOrders.lineTotal', locale),
      appCopy('electricity.order.detail.cancelReviewVat', locale),
    ]);
    const thermalCells = staffProducts
      .getByRole('row', { name: new RegExp(thermal.title[locale]) })
      .getByRole('cell');
    await expect(thermalCells.nth(3)).toContainText(new Intl.NumberFormat(locale).format(1000000));
    await expect(thermalCells.nth(4)).toContainText(new Intl.NumberFormat(locale).format(50000));
    await expect(thermalCells.nth(5)).toContainText(new Intl.NumberFormat(locale).format(950000));
    await expect(thermalCells.nth(6)).toContainText(new Intl.NumberFormat(locale).format(100000));
    await expect(
      page.getByRole('region', {
        name: adminCopy('admin.electricityOrders.contractPreview', locale),
      })
    ).toContainText('Supply begins after invoice payment and customer acceptance.');
    await expect(staffProducts).toContainText(appCopy('electricity.order.revision.green', locale));
    await page
      .getByRole('button', { name: adminCopy('admin.electricityOrders.approve', locale) })
      .click();
    await expect(
      page.getByRole('region', { name: adminCopy('admin.electricityOrders.reviewTitle', locale) })
    ).toContainText(new Intl.NumberFormat(locale).format(1250000));
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appCopy('team.confirm', locale) })
      .click();
    expect(staffApprovals).toHaveLength(1);
    expect(staffApprovals[0]).toMatchObject({
      expectedVersionId: versionId,
      expectedReviewHash: 'b'.repeat(64),
    });
    operatingContext = 'customer';
    await page.goto(`/electricity/orders/${orderId}`);
    await expect(
      page.getByRole('region', { name: appCopy('workflow.summary', locale) })
    ).toContainText(appCopy('electricity.order.nextAction.pay_invoice', locale));
    await page.getByRole('link', { name: new RegExp(invoiceId) }).click();
    await expect(
      page.getByRole('link', { name: appCopy('invoices.details.openContract', locale) })
    ).toHaveAttribute('href', `/contracts?contractId=${contractId}`);
    const wallet = page.locator('#wallet-invoice-payment');
    await wallet.getByRole('button', { name: walletCopy('pay', locale), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appCopy('team.confirm', locale), exact: true })
      .click();
    await expect(wallet.getByRole('status')).toContainText(transactionId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      expectedRemainingAmount: amount,
      expectedReviewHash: paymentReview().hash,
    });
    await page
      .getByRole('link', { name: appCopy('invoices.details.backToElectricityOrder', locale) })
      .click();
    await expect(statusPair.locator('dd')).toHaveText([
      appCopy('electricity.order.status.approved', locale),
      appCopy('electricity.order.financial.paid', locale),
    ]);
    await expect(
      page.getByRole('region', { name: appCopy('workflow.summary', locale) })
    ).toContainText(appCopy('electricity.order.nextAction.accept_contract', locale));
    await page
      .getByRole('link', { name: appCopy('electricity.order.nextAction.accept_contract', locale) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/contracts\\?contractId=${contractId}$`));
    await expect(page.getByRole('heading', { name: contractCopy('title', locale) })).toBeVisible();
    await page
      .getByRole('button', {
        name: `${locale === 'fa' ? 'تأمین برق' : 'Electricity supply'} · ${contractCopy('version', locale)} ${new Intl.NumberFormat(locale).format(1)}`,
      })
      .click();
    const activation = page.getByRole('region', { name: contractCopy('activationTitle', locale) });
    await expect(activation).toContainText(contractCopy('prerequisite.customerAcceptance', locale));
    await expect(activation).toContainText(contractCopy('prerequisite.initialPayment', locale));
    await expect(
      page.getByRole('region', { name: appCopy('workflow.summary', locale) })
    ).toContainText(contractCopy('accept', locale));
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: contractCopy('accept', locale) }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appCopy('team.confirm', locale) })
      .click();
    await expect(activation).toContainText(contractCopy('prerequisitesReady', locale));
    expect(contractAcceptances).toHaveLength(1);
    expect(contractAcceptances[0]).toMatchObject({ expectedVersionId: versionId });
    expect(contractAcceptances[0]).toMatchObject({ expectedReviewHash: financialReview.hash });
    await page
      .getByRole('region', { name: contractCopy('terms', locale) })
      .getByRole('link', { name: contractCopy('openLinkedOrder', locale) })
      .click();
    await expect(statusPair.locator('dd')).toHaveText([
      appCopy('electricity.order.status.active', locale),
      appCopy('electricity.order.financial.paid', locale),
    ]);
    await expect(
      page
        .getByText(appCopy('electricity.order.contractStatus', locale), { exact: true })
        .locator('..')
    ).toContainText(appCopy('electricity.order.status.active', locale));
  });
