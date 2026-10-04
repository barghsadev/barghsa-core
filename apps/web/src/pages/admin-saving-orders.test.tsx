import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AdminSavingOrdersPage from './AdminSavingOrdersPage.js';

vi.mock('../components/ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('../components/SavingOrderDocuments.js', () => ({ SavingOrderDocuments: () => null }));
vi.mock('../components/SavingOrderComments.js', () => ({ SavingOrderComments: () => null }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params?: { invoiceId: string } }) => (
    <a href={`/invoices/${params?.invoiceId ?? ''}`}>{children}</a>
  ),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => value, number: String }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});

it('loads older review orders and keeps fulfillment separate', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const order = (id: string) => ({
    id:
      id === 'first-review'
        ? '85000000-0000-4000-8000-000000000001'
        : id === 'older-review'
          ? '85000000-0000-4000-8000-000000000002'
          : '85000000-0000-4000-8000-000000000003',
    customerName: id,
    status: 'awaiting_staff_review',
    billIdentifier: id,
    pricingSnapshot: { plan: { title: { en: 'Saving plan', fa: 'طرح صرفه‌جویی' } } },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/user/settings/timezone') return Response.json({ timezone: 'Asia/Tehran' });
      const query = new URL(url, 'http://localhost').searchParams;
      const lane = query.get('lane');
      const after = query.get('after');
      return new Response(
        JSON.stringify(
          lane === 'fulfillment'
            ? { orders: [order('fulfillment-order')], nextAfter: null }
            : after
              ? { orders: [order('older-review')], nextAfter: null }
              : {
                  orders: [order('first-review')],
                  nextAfter: '85000000-0000-4000-8000-000000000001',
                }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === label
    );
    expect(button, label).toBeDefined();
    await act(async () => button?.click());
  };
  try {
    await act(async () => root.render(<AdminSavingOrdersPage />));
    expect(container.textContent).toContain('first-review');
    await click('More orders');
    expect(container.textContent).toContain('first-review');
    expect(container.textContent).toContain('older-review');
    expect(calls).toContain(
      '/api/staff/saving/orders?lane=review&after=85000000-0000-4000-8000-000000000001'
    );
    await click('Fulfillment');
    expect(container.textContent).toContain('fulfillment-order');
    expect(container.textContent).not.toContain('first-review');
    expect(calls).toContain('/api/staff/saving/orders?lane=fulfillment');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shows the locked saving decision and submits its exact review hash', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const id = '11111111-1111-7111-8111-111111111111';
  const profileId = '22222222-2222-7222-8222-222222222222';
  const versionId = '33333333-3333-7333-8333-333333333333';
  const contractId = '44444444-4444-7444-8444-444444444444';
  const invoiceId = '55555555-5555-7555-8555-555555555555';
  const order = {
    id,
    orderId: id,
    profileId,
    customerName: 'Buyer Company',
    status: 'awaiting_staff_review',
    financialStatus: 'unpaid',
    submittedAt: '2026-09-30T00:00:00.000Z',
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Installation address' },
    installationAddressId: '66666666-6666-7666-8666-666666666666',
    hardwareProductId: '77777777-7777-7777-8777-777777777777',
    hardwareTitle: { fa: 'دستگاه', en: 'Device' },
    pricingSnapshot: { plan: { title: { fa: 'طرح', en: 'Saving plan' } } },
    versionId,
    invoiceState: 'Unpaid',
    contractState: 'AwaitingStaffReview',
    totalIrR: '300',
    paidIrR: '0',
    stages: [],
    events: [],
    revisions: [],
    addressAmendments: [],
    hardwareAmendments: [],
    hardwareUpgrades: [],
    addressOptions: [],
    hardwareOptions: [],
    canAmendAddress: false,
    canAmendHardware: false,
  };
  const financialReview = {
    schemaVersion: 1,
    scope: { action: 'saving.staff-review.approve', profileId, resourceId: id },
    data: {
      action: 'approve',
      reason: '',
      customerName: 'Buyer Company',
      profileName: 'Buyer Company',
      billIdentifier: order.billIdentifier,
      hardwareTitle: order.hardwareTitle,
      addressSnapshot: order.addressSnapshot,
      pricingSnapshot: {
        lines: [
          {
            title: { fa: 'طرح', en: 'Saving plan' },
            amountIrR: '300',
            discountIrR: '0',
            netIrR: '300',
            vatIrR: '0',
          },
        ],
      },
      agreementSnapshot: 'Agreement text',
      contractId,
      contractState: 'AwaitingStaffReview',
      versionId,
      versionNumber: 1,
      contractSnapshot: {},
      invoiceId,
      invoiceState: 'Unpaid',
      invoiceTotal: '300',
      paidAmount: '0',
      refundedAmount: '0',
      pendingRefundAmount: '0',
      outcome: 'publish_contract',
      refundAmount: '0',
      releasesGiftCode: false,
    },
    hash: 'a'.repeat(64),
  };
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const data =
      url === '/api/user/settings/timezone'
        ? { timezone: 'Asia/Tehran' }
        : url.endsWith('/financial-review')
          ? financialReview
          : url.endsWith('/approve')
            ? { status: 'approved' }
            : url === `/api/staff/saving/orders/${id}`
              ? order
              : { orders: [order], nextAfter: null };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminSavingOrdersPage />));
    const item = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Buyer Company')
    );
    await act(async () => item!.click());
    const approve = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Approve request'
    );
    await act(async () => approve!.click());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/staff/saving/orders/${id}/financial-review`,
      expect.objectContaining({ body: JSON.stringify({ action: 'approve', reason: '' }) })
    );
    expect(document.body.textContent).toContain('Publish contract for customer acceptance');
    expect(document.body.textContent).toContain('Agreement text');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/approve'))).toBe(false);
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.includes('Confirm'));
    await act(async () => confirm!.click());
    const mutation = fetchMock.mock.calls.find(([url]) => url.endsWith('/approve'));
    expect(mutation).toBeDefined();
    expect(JSON.parse((mutation![1] as RequestInit).body as string)).toMatchObject({
      expectedVersionId: versionId,
      expectedReviewHash: financialReview.hash,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('previews a fulfillment transition and submits its exact review hash', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const id = '11111111-1111-7111-8111-111111111111';
  const profileId = '22222222-2222-7222-8222-222222222222';
  const contractId = '33333333-3333-7333-8333-333333333333';
  const versionId = '44444444-4444-7444-8444-444444444444';
  const invoiceId = '55555555-5555-7555-8555-555555555555';
  const path = `/api/staff/saving/orders/${id}/stages/product_delivery/complete`;
  const stages = [
    { stage: 'request_confirmation', status: 'completed' },
    { stage: 'product_delivery', status: 'in_progress' },
    { stage: 'installation_and_document_upload', status: 'pending' },
    { stage: 'equipment_handover', status: 'pending' },
    { stage: 'process_completion', status: 'pending' },
  ];
  const order = {
    id,
    orderId: id,
    profileId,
    customerName: 'Buyer Company',
    status: 'in_progress',
    financialStatus: 'paid',
    submittedAt: '2026-09-30T00:00:00.000Z',
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Installation address' },
    installationAddressId: '66666666-6666-7666-8666-666666666666',
    hardwareProductId: '77777777-7777-7777-8777-777777777777',
    hardwareTitle: { fa: 'دستگاه', en: 'Device' },
    pricingSnapshot: { plan: { title: { fa: 'طرح', en: 'Saving plan' } } },
    versionId,
    invoiceState: 'Paid',
    contractState: 'Active',
    totalIrR: '300',
    paidIrR: '300',
    stages,
    events: [],
    revisions: [],
    addressAmendments: [],
    hardwareAmendments: [],
    hardwareUpgrades: [],
    addressOptions: [],
    hardwareOptions: [],
    canAmendAddress: false,
    canAmendHardware: false,
  };
  const financialReview = {
    schemaVersion: 1,
    scope: { action: 'saving.staff-fulfillment-stage-transition', profileId, resourceId: id },
    data: {
      customerName: order.customerName,
      profileName: order.customerName,
      billIdentifier: order.billIdentifier,
      addressSnapshot: order.addressSnapshot,
      hardwareTitle: order.hardwareTitle,
      pricingSnapshot: order.pricingSnapshot,
      agreementSnapshot: 'Agreement text',
      contractId,
      contractState: 'Active',
      versionId,
      versionNumber: 1,
      contractSnapshot: {},
      invoiceId,
      invoiceState: 'Paid',
      invoiceTotalIrR: '300',
      paidAmountIrR: '300',
      refundedAmountIrR: '0',
      pendingRefundAmountIrR: '0',
      orderStatus: 'in_progress',
      stages,
      hasPendingUpgrade: false,
      stage: 'product_delivery',
      action: 'complete',
      currentStatus: 'in_progress',
      nextStatus: 'completed',
      nextStage: 'installation_and_document_upload',
      commercialStatus: 'in_progress',
      explanation: 'Delivered to customer',
      handoverDescription: null,
    },
    hash: 'b'.repeat(64),
  };
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const data =
      url === '/api/user/settings/timezone'
        ? { timezone: 'Asia/Tehran' }
        : url === `${path}/review`
          ? financialReview
          : url === path
            ? { status: 'in_progress' }
            : url === `/api/staff/saving/orders/${id}`
              ? order
              : { orders: [order], nextAfter: null };
    return Response.json(data, { status: url.endsWith('/amend-address') ? 201 : 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminSavingOrdersPage />));
    const item = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Buyer Company')
    );
    await act(async () => item!.click());
    const note = container.querySelector<HTMLInputElement>('#saving-staff-note')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        note,
        'Delivered to customer'
      );
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const complete = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Complete stage'
    );
    await act(async () => complete!.click());
    expect(document.body.textContent).toContain('Installation and document upload');
    expect(document.body.textContent).toContain('Agreement text');
    expect(fetchMock.mock.calls.some(([url]) => url === path)).toBe(false);
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.includes('Confirm'));
    await act(async () => confirm!.click());
    const mutation = fetchMock.mock.calls.find(([url]) => url === path);
    expect(mutation).toBeDefined();
    expect(JSON.parse((mutation![1] as RequestInit).body as string)).toMatchObject({
      expectedReviewHash: financialReview.hash,
      explanation: 'Delivered to customer',
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('confirms exact saving amendments and unpaid upgrade cancellation', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const id = '11111111-1111-7111-8111-111111111111';
  const profileId = '22222222-2222-7222-8222-222222222222';
  const currentHardwareId = '33333333-3333-7333-8333-333333333333';
  const targetHardwareId = '44444444-4444-7444-8444-444444444444';
  const versionId = '55555555-5555-7555-8555-555555555555';
  const upgradeId = '99999999-9999-7999-8999-999999999999';
  const upgradeInvoiceId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
  const targetAddressId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
  const upgrade = {
    id: upgradeId,
    status: 'awaiting_payment',
    createdAt: '2026-09-30T00:00:00.000Z',
    reason: 'Customer requested the upgrade',
    priceDeltaIrR: '50000',
    adjustmentInvoiceId: upgradeInvoiceId,
    invoiceState: 'Unpaid',
    paidIrR: '0',
    previousTitle: { fa: 'دستگاه', en: 'Current device' },
    hardwareTitle: { fa: 'جایگزین', en: 'Replacement device' },
  };
  const pendingUpgrades: Array<typeof upgrade> = [];
  const detail = {
    id,
    orderId: id,
    profileId,
    customerName: 'Buyer Company',
    agreementSnapshot: 'Accepted agreement',
    refundedIrR: '0',
    pendingRefundIrR: '0',
    status: 'approved',
    financialStatus: 'paid',
    submittedAt: '2026-09-30T00:00:00.000Z',
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Installation address', postal_code: '1234567890' },
    installationAddressId: '66666666-6666-7666-8666-666666666666',
    hardwareProductId: currentHardwareId,
    hardwareTitle: { fa: 'دستگاه', en: 'Current device' },
    pricingSnapshot: { plan: { title: { fa: 'طرح', en: 'Saving plan' } } },
    versionId,
    invoiceId: '88888888-8888-7888-8888-888888888888',
    invoiceState: 'Paid',
    contractId: '77777777-7777-7777-8777-777777777777',
    contractState: 'Active',
    totalIrR: '300000',
    paidIrR: '300000',
    stages: [],
    events: [],
    revisions: [],
    addressAmendments: [],
    hardwareAmendments: [],
    hardwareUpgrades: pendingUpgrades,
    addressOptions: [
      {
        id: '66666666-6666-7666-8666-666666666666',
        fullAddress: 'Installation address',
        postalCode: '1234567890',
      },
      { id: targetAddressId, fullAddress: 'Replacement address', postalCode: '9876543210' },
    ],
    hardwareOptions: [
      {
        id: targetHardwareId,
        title: { fa: 'جایگزین', en: 'Replacement device' },
        priceDeltaIrR: '50000',
        priceIrR: '250000',
        vatRateBps: 0,
        totalIrR: '350000',
        stockTracking: true,
        availableCount: 2,
      },
    ],
    canAmendAddress: true,
    canAmendHardware: true,
  };
  const review = {
    schemaVersion: 1,
    scope: { action: 'saving.staff-hardware-amendment', profileId, resourceId: id },
    data: {
      reason: 'Customer requested the upgrade',
      customerName: 'Buyer Company',
      profileName: 'Buyer Company',
      billIdentifier: detail.billIdentifier,
      addressSnapshot: detail.addressSnapshot,
      agreementSnapshot: 'Accepted agreement',
      contractId: '77777777-7777-7777-8777-777777777777',
      contractState: 'Active',
      versionId,
      versionNumber: 1,
      contractSnapshot: {},
      invoiceId: '88888888-8888-7888-8888-888888888888',
      invoiceState: 'Paid',
      invoiceTotal: '300000',
      paidAmount: '300000',
      refundedAmount: '0',
      pendingRefundAmount: '0',
      currentHardwareId,
      currentHardwareTitle: detail.hardwareTitle,
      currentHardwarePriceIrR: '200000',
      currentHardwareVatRateBps: 0,
      currentOrderTotalIrR: '300000',
      targetHardwareId,
      targetHardwareTitle: { fa: 'جایگزین', en: 'Replacement device' },
      targetHardwarePriceIrR: '250000',
      targetHardwareVatRateBps: 0,
      targetOrderTotalIrR: '350000',
      priceDeltaIrR: '50000',
      targetStockTracking: true,
      targetAvailableCount: 2,
      outcome: 'additional_charge',
    },
    hash: 'b'.repeat(64),
  };
  const cancellationReview = {
    schemaVersion: 1,
    scope: { action: 'saving.staff-hardware-upgrade-cancellation', profileId, resourceId: id },
    data: {
      reason: 'Customer changed their mind',
      customerName: 'Buyer Company',
      profileName: 'Buyer Company',
      billIdentifier: detail.billIdentifier,
      addressSnapshot: detail.addressSnapshot,
      agreementSnapshot: 'Accepted agreement',
      contractId: '77777777-7777-7777-8777-777777777777',
      contractState: 'Active',
      versionId,
      versionNumber: 1,
      contractSnapshot: {},
      upgradeVersionId: versionId,
      upgradeId,
      previousHardware: { title: upgrade.previousTitle },
      replacementHardware: { title: upgrade.hardwareTitle },
      stockReserved: true,
      adjustmentInvoiceId: upgradeInvoiceId,
      adjustmentInvoiceState: 'Unpaid',
      additionalChargeIrR: '50000',
      invoiceTotalIrR: '50000',
      invoicePaidIrR: '0',
      outcome: 'cancel_unpaid_charge_and_release_reservation',
    },
    hash: 'c'.repeat(64),
  };
  const addressReview = {
    schemaVersion: 1,
    scope: { action: 'saving.staff-address-amendment', profileId, resourceId: id },
    data: {
      reason: 'Customer confirmed the correction',
      customerName: 'Buyer Company',
      profileName: 'Buyer Company',
      billIdentifier: detail.billIdentifier,
      orderId: id,
      hardwareTitle: detail.hardwareTitle,
      pricingSnapshot: detail.pricingSnapshot,
      agreementSnapshot: 'Accepted agreement',
      contractId: '77777777-7777-7777-8777-777777777777',
      contractState: 'Active',
      versionId,
      versionNumber: 1,
      contractSnapshot: {},
      invoiceId: '88888888-8888-7888-8888-888888888888',
      invoiceState: 'Paid',
      invoiceTotalIrR: '300000',
      paidAmountIrR: '300000',
      refundedAmountIrR: '0',
      pendingRefundAmountIrR: '0',
      previousAddressId: detail.installationAddressId,
      previousAddress: { full_address: 'Installation address', postal_code: '1234567890' },
      replacementAddressId: targetAddressId,
      replacementAddress: {
        id: targetAddressId,
        province_id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        city_id: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
        full_address: 'Replacement address',
        postal_code: '9876543210',
      },
      outcome: 'update_installation_address_without_repricing',
    },
    hash: 'd'.repeat(64),
  };
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/amend-hardware')) {
      detail.hardwareUpgrades = [upgrade];
      detail.canAmendHardware = false;
    } else if (url.endsWith('/cancel-hardware-upgrade')) {
      detail.hardwareUpgrades = [{ ...upgrade, status: 'cancelled' }];
      detail.canAmendHardware = true;
    }
    const data =
      url === '/api/user/settings/timezone'
        ? { timezone: 'Asia/Tehran' }
        : url.endsWith('/cancel-hardware-upgrade-review')
          ? cancellationReview
          : url.endsWith('/cancel-hardware-upgrade')
            ? { savingOrderId: id, upgradeId, status: 'cancelled' }
            : url.endsWith('/amend-address-review')
              ? addressReview
              : url.endsWith('/amend-address')
                ? {
                    amendmentId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
                    savingOrderId: id,
                    address: addressReview.data.replacementAddress,
                  }
                : url.endsWith('/amend-hardware-review')
                  ? review
                  : url.endsWith('/amend-hardware')
                    ? {
                        upgradeId,
                        savingOrderId: id,
                        hardwareProductId: targetHardwareId,
                        priceDeltaIrR: '50000',
                        adjustmentInvoiceId: upgradeInvoiceId,
                        status: 'awaiting_payment',
                      }
                    : url === `/api/staff/saving/orders/${id}`
                      ? detail
                      : { orders: [detail], nextAfter: null };
    return Response.json(data, {
      status: url.endsWith('/amend-address') || url.endsWith('/amend-hardware') ? 201 : 200,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminSavingOrdersPage />));
    const item = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Buyer Company')
    );
    await act(async () => item!.click());
    const reason = container.querySelector<HTMLInputElement>('#saving-amend-hardware-reason')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        reason,
        'Customer requested the upgrade'
      );
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const swap = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Swap hardware'
    );
    await act(async () => swap!.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/staff/saving/orders/${id}/amend-hardware-review`,
      expect.objectContaining({
        body: JSON.stringify({
          expectedVersionId: versionId,
          expectedHardwareId: currentHardwareId,
          hardwareProductId: targetHardwareId,
          reason: 'Customer requested the upgrade',
        }),
      })
    );
    expect(document.body.textContent).toContain('Reserve device and invoice difference');
    expect(document.body.textContent).toContain('Accepted agreement');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/amend-hardware'))).toBe(false);
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.includes('Confirm'));
    await act(async () => confirm!.click());
    const mutation = fetchMock.mock.calls.find(([url]) => url.endsWith('/amend-hardware'));
    expect(mutation).toBeDefined();
    expect(JSON.parse((mutation![1] as RequestInit).body as string)).toMatchObject({
      expectedVersionId: versionId,
      expectedReviewHash: review.hash,
      expectedHardwareId: currentHardwareId,
      hardwareProductId: targetHardwareId,
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    const cancelReason = container.querySelector<HTMLInputElement>(
      `#saving-upgrade-cancel-${upgradeId}`
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        cancelReason,
        'Customer changed their mind'
      );
      cancelReason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel upgrade'
    );
    await act(async () => cancel!.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/staff/saving/orders/${id}/cancel-hardware-upgrade-review`,
      expect.objectContaining({
        body: JSON.stringify({ upgradeId, reason: 'Customer changed their mind' }),
      })
    );
    expect(document.body.textContent).toContain('The unpaid invoice will be cancelled.');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/cancel-hardware-upgrade'))).toBe(
      false
    );
    const confirmCancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.includes('Confirm'));
    await act(async () => confirmCancel!.click());
    const cancellationMutation = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/cancel-hardware-upgrade')
    );
    expect(JSON.parse((cancellationMutation![1] as RequestInit).body as string)).toMatchObject({
      upgradeId,
      expectedReviewHash: cancellationReview.hash,
      reason: 'Customer changed their mind',
    });
    const addressSelect = container.querySelector<HTMLSelectElement>('#saving-amend-address')!;
    await act(async () => {
      addressSelect.value = targetAddressId;
      addressSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const addressReason = container.querySelector<HTMLInputElement>('#saving-amend-reason')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        addressReason,
        'Customer confirmed the correction'
      );
      addressReason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const amendAddress = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Amend installation address'
    );
    await act(async () => amendAddress!.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/amend-address-review'))).toBe(
        true
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/staff/saving/orders/${id}/amend-address-review`,
      expect.objectContaining({
        body: JSON.stringify({
          expectedVersionId: versionId,
          expectedAddressId: detail.installationAddressId,
          addressId: targetAddressId,
          reason: 'Customer confirmed the correction',
        }),
      })
    );
    expect(document.body.textContent).toContain('Replacement address');
    expect(document.body.textContent).toContain('The paid invoice and contract remain as issued.');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/amend-address'))).toBe(false);
    const confirmAddress = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.includes('Confirm'));
    await act(async () => confirmAddress!.click());
    const addressMutation = fetchMock.mock.calls.find(([url]) => url.endsWith('/amend-address'));
    expect(JSON.parse((addressMutation![1] as RequestInit).body as string)).toMatchObject({
      expectedReviewHash: addressReview.hash,
      expectedVersionId: versionId,
      expectedAddressId: detail.installationAddressId,
      addressId: targetAddressId,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
