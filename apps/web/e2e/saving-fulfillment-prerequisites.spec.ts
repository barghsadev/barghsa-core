import { expect, test } from './coverage-fixture';

const orderId = '66666666-6666-4666-8666-666666666666';
const invoiceId = '88888888-8888-4888-8888-888888888888';
const stages = [
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
];

test('staff delivery and completion controls explain current prerequisites', async ({ page }) => {
  let currentStage = 'product_delivery';
  let contractState = 'AwaitingCustomerAcceptance';
  let upgradePending = true;
  const order = () => ({
    id: orderId,
    orderId,
    profileId: '11111111-1111-4111-8111-111111111111',
    customerName: 'Buyer',
    status: 'in_progress',
    financialStatus: 'paid',
    submittedAt: '2026-09-23T10:00:00.000Z',
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Saving Street' },
    installationAddressId: '44444444-4444-4444-8444-444444444444',
    hardwareProductId: '33333333-3333-4333-8333-333333333333',
    hardwareTitle: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
    pricingSnapshot: { plan: { title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' } } },
    versionId: '55555555-5555-4555-8555-555555555555',
    invoiceState: 'Paid',
    contractState,
    totalIrR: '300000',
    paidIrR: '300000',
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/staff/saving/orders?*', (route) =>
    route.fulfill({ json: { orders: [order()], nextAfter: null } })
  );
  await page.route(`**/api/staff/saving/orders/${orderId}`, (route) =>
    route.fulfill({
      json: {
        ...order(),
        stages: stages.map((stage, index) => ({
          stage,
          status:
            index < stages.indexOf(currentStage)
              ? 'completed'
              : stage === currentStage
                ? 'in_progress'
                : 'pending',
          completed_at: null,
          explanation: null,
          handover_description: null,
        })),
        events: [],
        revisions: [],
        addressAmendments: [],
        hardwareAmendments: [],
        hardwareUpgrades: upgradePending
          ? [
              {
                id: '77777777-7777-4777-8777-777777777777',
                status: 'awaiting_payment',
                createdAt: '2026-09-23T11:00:00.000Z',
                reason: 'Customer upgrade',
                priceDeltaIrR: '50000',
                adjustmentInvoiceId: invoiceId,
                invoiceState: 'Unpaid',
                paidIrR: '0',
                previousTitle: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
                hardwareTitle: { en: 'Premium device', fa: 'دستگاه پیشرفته' },
              },
            ]
          : [],
        addressOptions: [],
        hardwareOptions: [],
        canAmendAddress: false,
        canAmendHardware: false,
      },
    })
  );

  await page.goto('/admin/saving-orders');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await page.getByRole('button', { name: 'Fulfillment', exact: true }).click();
  await page.getByRole('button', { name: /Buyer.*Home saving plan/ }).click();
  await page.getByRole('textbox', { name: 'Reason or progress note' }).fill('Ready to advance');
  await expect(
    page.getByText('Resolve the pending equipment upgrade charge before delivery.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete stage' })).toBeDisabled();

  upgradePending = false;
  currentStage = 'process_completion';
  await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
  await expect(
    page.getByText('An active contract is required before process completion.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete stage' })).toBeDisabled();

  contractState = 'Active';
  await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Complete stage' })).toBeEnabled();
});
