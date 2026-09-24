import { test, expect } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const hardwareId = '33333333-3333-4333-8333-333333333333';
const addressId = '44444444-4444-4444-8444-444444444444';
const agreementVersionId = '55555555-5555-4555-8555-555555555555';
const savingOrderId = '66666666-6666-4666-8666-666666666666';
const olderOrderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const parentOrderId = '77777777-7777-4777-8777-777777777777';
const invoiceId = '88888888-8888-4888-8888-888888888888';
const contractId = '99999999-9999-4999-8999-999999999999';
const submittedAt = '2026-09-23T10:00:00.000Z';
const stageNames = [
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
];

test('customer saves a saving order, submits the reviewed quote, and tracks fulfillment', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const drafts: Array<Record<string, unknown>> = [];
  const submissions: Array<Record<string, unknown>> = [];
  const staffActions: Array<{ path: string; body: Record<string, unknown> }> = [];
  let approved = false;
  let stageIndex = -1;

  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'buyer', requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Buyer' }],
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
    route.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
  );
  await page.route('**/api/saving/plans', (route) =>
    route.fulfill({
      json: {
        plans: [
          {
            id: planId,
            title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
            description: null,
            price: '100000',
            status: 'active',
            available: true,
            hardware: [
              {
                id: hardwareId,
                title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
                description: null,
                price: '200000',
                status: 'active',
              },
            ],
            agreement: {
              versionId: agreementVersionId,
              title: 'Accepted terms',
              body: 'The customer accepts this plan.',
            },
          },
        ],
      },
    })
  );
  await page.route(`**/api/profiles/${profileId}/addresses`, (route) =>
    route.fulfill({
      json: {
        addresses: [
          {
            id: addressId,
            fullAddress: 'Saving Street',
            postalCode: '1234567890',
            mainAddress: true,
          },
        ],
      },
    })
  );
  await page.route('**/api/saving/orders/draft?*', (route) => {
    if (route.request().method() === 'PUT') {
      drafts.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { ...drafts.at(-1), updatedAt: submittedAt } });
    }
    return route.fulfill({ json: { currentStep: 1, data: null, updatedAt: null } });
  });
  await page.route('**/api/saving/orders/duplicate', (route) =>
    route.fulfill({ json: { duplicate: false, existingOrderId: null } })
  );
  await page.route('**/api/saving/orders/verify-bill', (route) =>
    route.fulfill({ json: { status: 'verified' } })
  );
  await page.route('**/api/saving/orders/quote', (route) =>
    route.fulfill({
      json: {
        reviewDigest: 'a'.repeat(64),
        subtotalIrR: '300000',
        discountIrR: '0',
        vatIrR: '0',
        totalIrR: '300000',
        lines: [
          {
            type: 'plan',
            title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
            amountIrR: '100000',
            discountIrR: '0',
            vatIrR: '0',
          },
          {
            type: 'hardware',
            title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
            amountIrR: '200000',
            discountIrR: '0',
            vatIrR: '0',
          },
        ],
      },
    })
  );
  await page.route(`**/api/wallet/${profileId}`, (route) =>
    route.fulfill({ json: { availableBalance: '500000' } })
  );
  await page.route('**/api/saving/orders', (route) => {
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201, json: { savingOrderId } });
  });
  await page.route('**/api/saving/orders?*', (route) => {
    const before = new URL(route.request().url()).searchParams.get('before');
    return route.fulfill({
      json: before
        ? {
            orders: [
              {
                id: olderOrderId,
                status: 'awaiting_staff_review',
                financial_status: 'unpaid',
                invoice_id: null,
                invoice_state: 'Unpaid',
                contract_id: null,
                contract_state: 'AwaitingStaffReview',
                cancellation_pending: false,
                bill_identifier: '9876543210123',
                submitted_at: '2026-09-22T10:00:00.000Z',
                plan_title: { en: 'Older saving plan', fa: 'طرح قدیمی' },
                hardware_title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
                total_amount: '200000',
              },
            ],
            nextBefore: null,
          }
        : {
            orders: [
              {
                id: savingOrderId,
                status: approved ? 'approved' : 'awaiting_staff_review',
                financial_status: 'unpaid',
                invoice_id: invoiceId,
                invoice_state: 'Unpaid',
                contract_id: null,
                contract_state: 'AwaitingStaffReview',
                cancellation_pending: false,
                bill_identifier: '1234567890123',
                submitted_at: submittedAt,
                plan_title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
                hardware_title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
                total_amount: '300000',
              },
            ],
            nextBefore: savingOrderId,
          },
    });
  });
  await page.route(`**/api/saving/orders/${savingOrderId}`, (route) =>
    route.fulfill({
      json: {
        id: savingOrderId,
        order_id: parentOrderId,
        profile_id: profileId,
        saving_plan_id: planId,
        hardware_product_id: hardwareId,
        current_hardware_title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
        installation_address_id: addressId,
        can_edit: false,
        status: approved ? 'approved' : 'awaiting_staff_review',
        financial_status: 'unpaid',
        bill_identifier: '1234567890123',
        submitted_at: submittedAt,
        address_snapshot: { full_address: 'Saving Street', postal_code: '1234567890' },
        pricing_snapshot: {
          plan: { title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' } },
          hardware: { title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' } },
          subtotalIrR: '300000',
          discountIrR: '0',
          vatIrR: '0',
          totalIrR: '300000',
        },
        verification_result: { status: 'verified' },
        agreement_snapshot: 'Accepted terms\nThe customer accepts this plan.',
        agreement_updated: false,
        contract_version_id: null,
        contract_id: approved ? contractId : null,
        contract_state: approved ? 'AwaitingCustomerAcceptance' : 'AwaitingStaffReview',
        invoice_id: invoiceId,
        invoice_state: 'Unpaid',
        cancellation_pending: false,
        stages: stageNames.map((stage, index) => ({
          stage,
          status: approved
            ? index < stageIndex
              ? 'completed'
              : index === stageIndex
                ? 'in_progress'
                : 'pending'
            : 'pending',
          completed_at: approved && index < stageIndex ? submittedAt : null,
          explanation: null,
          handover_description: null,
        })),
        revisions: [],
        addressAmendments: [],
        hardwareAmendments: [],
        hardwareUpgrades: [],
      },
    })
  );
  const staffOrder = () => ({
    id: savingOrderId,
    orderId: parentOrderId,
    profileId,
    customerName: 'Buyer',
    status: approved ? 'approved' : 'awaiting_staff_review',
    financialStatus: 'unpaid',
    submittedAt,
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Saving Street' },
    installationAddressId: addressId,
    hardwareProductId: hardwareId,
    hardwareTitle: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
    pricingSnapshot: { plan: { title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' } } },
    versionId: agreementVersionId,
    invoiceState: 'Unpaid',
    contractState: approved ? 'AwaitingCustomerAcceptance' : 'AwaitingStaffReview',
    totalIrR: '300000',
    paidIrR: '0',
  });
  await page.route('**/api/staff/saving/orders?*', (route) => {
    const lane = new URL(route.request().url()).searchParams.get('lane');
    return route.fulfill({
      json: {
        orders: lane === (approved ? 'fulfillment' : 'review') ? [staffOrder()] : [],
        nextAfter: null,
      },
    });
  });
  await page.route(`**/api/staff/saving/orders/${savingOrderId}`, (route) =>
    route.fulfill({
      json: {
        ...staffOrder(),
        stages: stageNames.map((stage, index) => ({
          stage,
          status: approved
            ? index < stageIndex
              ? 'completed'
              : index === stageIndex
                ? 'in_progress'
                : 'pending'
            : 'pending',
          completed_at: index < stageIndex ? submittedAt : null,
          explanation: null,
          handover_description: null,
        })),
        events: [],
        revisions: [],
        addressAmendments: [],
        hardwareAmendments: [],
        hardwareUpgrades: [],
        addressOptions: [],
        hardwareOptions: [],
        canAmendAddress: false,
        canAmendHardware: false,
      },
    })
  );
  await page.route(`**/api/staff/saving/orders/${savingOrderId}/approve`, (route) => {
    staffActions.push({
      path: 'approve',
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    approved = true;
    stageIndex = 1;
    return route.fulfill({ json: { status: 'approved' } });
  });
  const invoice = {
    invoiceId,
    role: 'original',
    state: 'Unpaid',
    totalAmount: '300000',
    paidAmount: '0',
    refundedAmount: '0',
    accountingAmount: '300000',
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
  await page.route(`**/api/invoices/${invoiceId}`, (route) =>
    route.fulfill({
      json: {
        viewedInvoiceId: invoiceId,
        originalInvoiceId: invoiceId,
        savingOrderId,
        invoice,
        chain: [invoice],
        payments: [],
        bankReceipts: [],
        refunds: [],
      },
    })
  );

  await page.goto('/savings');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByRole('heading', { name: 'Home saving plan' })).toBeVisible();
  await page.getByRole('link', { name: 'Start an order' }).click();
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await page.getByRole('radio', { name: /Home saving plan/ }).check();
  await next.click();
  await page.getByRole('radio', { name: /Efficient device/ }).check();
  await page.getByRole('checkbox', { name: 'I confirm this equipment choice' }).check();
  await next.click();
  await page.getByRole('textbox', { name: 'Electricity bill identifier' }).fill('1234567890123');
  await page.getByRole('button', { name: 'Check identifier' }).click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByText('Saving Street')).toBeVisible();
  await next.click();
  await page.getByRole('checkbox', { name: 'I accept this agreement' }).check();
  await next.click();
  await expect(page.getByText(/Wallet balance:/)).toContainText('500,000');
  await page.getByRole('checkbox', { name: 'Submit for staff review' }).check();
  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/savings/orders/${savingOrderId}$`));
  await expect(page.locator(`time[datetime="${submittedAt}"]`).first()).toHaveText('09/24/2026');
  await expect(page.getByRole('heading', { name: 'Fulfillment' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Fulfillment' })).toContainText(
    'Request confirmation'
  );
  expect(drafts).toHaveLength(5);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    profileId,
    savingPlanId: planId,
    hardwareProductId: hardwareId,
    agreementVersionId,
    expectedQuoteDigest: 'a'.repeat(64),
    submitForStaffReview: true,
  });

  await page.goto('/admin/saving-orders');
  await page.getByRole('button', { name: /Buyer.*Home saving plan/ }).click();
  await page.getByRole('button', { name: 'Approve request' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await page.getByRole('button', { name: 'Fulfillment', exact: true }).click();
  await page.getByRole('button', { name: /Buyer.*Home saving plan/ }).click();
  await expect(page.getByText('Product delivery', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Invoice payment is required before this stage can be completed.')
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Reason or progress note' }).fill('Ready to deliver');
  await expect(page.getByRole('button', { name: 'Complete stage' })).toBeDisabled();
  expect(staffActions).toMatchObject([
    { path: 'approve', body: { expectedVersionId: agreementVersionId } },
  ]);
  await page.goto(`/savings/orders/${savingOrderId}`);
  await expect(page.getByRole('list', { name: 'Fulfillment' })).toContainText('Product delivery');
  await expect(page.locator('li[aria-current="step"]')).toContainText('Product delivery');
  await page.getByRole('link', { name: 'My saving orders' }).click();
  await expect(page.getByRole('heading', { name: 'My saving orders' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home saving plan' })).toBeVisible();
  await expect(page.locator(`time[datetime="${submittedAt}"]`).first()).toHaveText('09/24/2026');
  await page.getByRole('button', { name: 'More orders' }).click();
  await expect(page.getByRole('heading', { name: 'Home saving plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Older saving plan' })).toBeVisible();
  await page.getByRole('link', { name: 'Saving order' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/savings/orders/${savingOrderId}$`));
  await page.getByRole('link', { name: 'View invoice and payment options' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice details' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to saving order' }).click();
  await expect(page).toHaveURL(new RegExp(`/savings/orders/${savingOrderId}$`));
  await page.getByRole('link', { name: 'View contract' }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts\\?contractId=${contractId}$`));
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible();
});
