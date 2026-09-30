import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AdminSavingOrdersPage from './AdminSavingOrdersPage.js';

vi.mock('../components/ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('../components/SavingOrderDocuments.js', () => ({ SavingOrderDocuments: () => null }));
vi.mock('../components/SavingOrderComments.js', () => ({ SavingOrderComments: () => null }));
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
    id,
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
              : { orders: [order('first-review')], nextAfter: 'first-review' }
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
    expect(calls).toContain('/api/staff/saving/orders?lane=review&after=first-review');
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

it('confirms the exact hardware charge before requesting the swap', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const id = '11111111-1111-7111-8111-111111111111';
  const profileId = '22222222-2222-7222-8222-222222222222';
  const currentHardwareId = '33333333-3333-7333-8333-333333333333';
  const targetHardwareId = '44444444-4444-7444-8444-444444444444';
  const versionId = '55555555-5555-7555-8555-555555555555';
  const detail = {
    id,
    orderId: id,
    profileId,
    customerName: 'Buyer Company',
    status: 'approved',
    financialStatus: 'paid',
    submittedAt: '2026-09-30T00:00:00.000Z',
    billIdentifier: '1234567890123',
    addressSnapshot: { full_address: 'Installation address' },
    installationAddressId: '66666666-6666-7666-8666-666666666666',
    hardwareProductId: currentHardwareId,
    hardwareTitle: { fa: 'دستگاه', en: 'Current device' },
    pricingSnapshot: { plan: { title: { fa: 'طرح', en: 'Saving plan' } } },
    versionId,
    invoiceState: 'Paid',
    contractState: 'Active',
    totalIrR: '300000',
    paidIrR: '300000',
    stages: [],
    events: [],
    revisions: [],
    addressAmendments: [],
    hardwareAmendments: [],
    hardwareUpgrades: [],
    addressOptions: [],
    hardwareOptions: [
      {
        id: targetHardwareId,
        title: { fa: 'جایگزین', en: 'Replacement device' },
        priceDeltaIrR: '50000',
      },
    ],
    canAmendAddress: false,
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
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const data =
      url === '/api/user/settings/timezone'
        ? { timezone: 'Asia/Tehran' }
        : url.endsWith('/amend-hardware-review')
          ? review
          : url.endsWith('/amend-hardware')
            ? { status: 'awaiting_payment' }
            : url === `/api/staff/saving/orders/${id}`
              ? detail
              : { orders: [detail], nextAfter: null };
    return Response.json(data);
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
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
