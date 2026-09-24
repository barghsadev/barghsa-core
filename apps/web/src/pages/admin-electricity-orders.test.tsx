import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AdminElectricityOrdersPage from './AdminElectricityOrdersPage.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));

it('shows the staff queue, order financial facts, product lines and decisions', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const previousUrl = window.location.href;
  const order = {
    orderId: 'order-1',
    contractId: '22222222-2222-7222-8222-222222222222',
    contractState: 'AwaitingCustomerAcceptance',
    invoiceId: '11111111-1111-7111-8111-111111111111',
    invoiceState: 'Unpaid',
    customerName: 'Electricity Buyer',
    commercialStatus: 'awaiting_staff_review',
    financialStatus: 'unpaid',
    nextAction: 'review_order',
    submittedAt: '2026-09-23T22:00:00Z',
    periodStart: '2026-09-23T00:00:00Z',
    periodEnd: '2026-09-30T20:30:00Z',
    totalKwh: '10',
    pricingSnapshot: {
      lines: [
        {
          systemKey: 'thermal',
          quantityKwh: '10',
          unitPriceIrR: '100',
          netIrR: '1000',
          vatIrR: '0',
        },
      ],
    },
    settingsSnapshot: { green: false },
    fullAddress: 'Electricity Street',
    contractSnapshot: {
      orderId: 'order-1',
      template: {
        templateId: 'template-1',
        versionId: 'template-version-2',
        versionNumber: 2,
        name: 'Electricity supply terms',
        text: 'Supply starts after payment.\nCustomer: Electricity Buyer',
      },
    },
    versionId: 'version-1',
    totalIrR: '1000',
    paidIrR: '0',
    revisionReview: {
      versionNumber: 2,
      staffReason: 'Increase quantity',
      customerResponse: 'Quantity updated',
      before: {
        periodStart: '2026-09-23T00:00:00Z',
        periodEnd: '2026-09-30T20:30:00Z',
        totalKwh: '8',
        totalIrR: '800',
        fullAddress: 'Old Street',
        invoiceId: 'invoice-1',
        lines: [{ systemKey: 'thermal', quantityKwh: '8' }],
      },
      after: {
        periodStart: '2026-09-23T00:00:00Z',
        periodEnd: '2026-09-30T20:30:00Z',
        totalKwh: '10',
        totalIrR: '1000',
        fullAddress: 'Electricity Street',
        invoiceId: 'invoice-2',
        lines: [{ systemKey: 'thermal', quantityKwh: '10' }],
      },
    },
    ageHours: 12,
    priority: 'normal',
    timeline: [
      {
        id: 'event-0',
        event: 'order_created',
        at: '2026-09-22T00:00:00Z',
        actor: 'buyer',
        reason: null,
        comment: null,
      },
      {
        id: 'event-1',
        event: 'electricity.order_review.request-changes',
        at: '2026-09-23T00:00:00Z',
        actor: 'staff-1',
        reason: 'Increase quantity',
        comment: null,
      },
    ],
  };
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === '/api/user/settings/timezone'
            ? { timezone: 'Asia/Tehran' }
            : url.includes('/comments')
              ? {
                  comments: [
                    {
                      id: 'comment-1',
                      authorName: 'Electricity Buyer',
                      authorRole: 'customer',
                      visibility: 'public',
                      body: 'Please confirm delivery.',
                      createdAt: '2026-09-23T00:00:00Z',
                    },
                  ],
                  nextBefore: null,
                }
              : url.endsWith('/order-1')
                ? order
                : url.includes('/conversations')
                  ? {
                      orders: [{ ...order, latestCommentAt: '2026-09-23T00:00:00Z' }],
                      nextAfter: null,
                    }
                  : url.includes('?after=')
                    ? {
                        orders: [{ ...order, orderId: 'order-2', customerName: 'Later Buyer' }],
                        nextAfter: null,
                      }
                    : { orders: [order], nextAfter: 'order-1' }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminElectricityOrdersPage />));
    expect(container.textContent).toContain('Electricity Buyer');
    const queueButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Electricity Buyer')
    );
    expect(queueButton).toBeDefined();
    await act(async () => queueButton!.click());
    expect(new URLSearchParams(window.location.search).get('orderId')).toBe('order-1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/electricity/orders/order-1',
      expect.any(Object)
    );
    const statusLabels = [...container.querySelectorAll('dl dt')].map((item) => item.textContent);
    expect(statusLabels.slice(0, 2)).toEqual(['Order status', 'Financial status']);
    const statusValues = [...container.querySelectorAll('dl dd')].map((item) => item.textContent);
    expect(statusValues.slice(0, 2)).toEqual(['Awaiting staff review', 'Unpaid']);
    expect(container.textContent).toContain('Thermal electricity');
    const contractPreview = container.querySelector(
      '[aria-label="Preliminary contract for review"]'
    );
    expect(contractPreview?.textContent).toContain('Electricity supply terms · Template version 2');
    expect(contractPreview?.textContent).toContain('Supply starts after payment.');
    expect(contractPreview?.querySelector('[dir="auto"]')?.textContent).toContain(
      'Customer: Electricity Buyer'
    );
    expect(
      container.querySelector(
        'a[href="/admin/invoices?invoiceId=11111111-1111-7111-8111-111111111111"]'
      )?.textContent
    ).toBe('Open invoice');
    expect(
      container.querySelector(
        'a[href="/admin/contracts?contractId=22222222-2222-7222-8222-222222222222"]'
      )?.textContent
    ).toBe('Open contract');
    expect(container.textContent).toContain('Review order changes');
    expect(container.textContent).toContain('Order timeline');
    expect(container.textContent).toContain('Order submitted');
    expect(container.textContent).toContain('Changes requested');
    expect(container.querySelector('ol[aria-label="Order timeline"]')?.textContent).toContain(
      'Increase quantity'
    );
    expect(container.textContent).toContain('Increase quantity');
    expect(container.textContent).toContain('Quantity updated');
    expect(container.textContent).toContain('Old Street');
    expect(container.textContent).toContain('invoice-2');
    expect(container.textContent).toContain('Sep 24, 2026');
    expect(container.textContent).toContain('09/30/2026');
    expect(container.textContent).not.toContain('10/01/2026');
    expect(container.textContent).toContain('Approve order');
    expect(container.textContent).toContain('Request changes');
    expect(container.textContent).toContain('Reject order');
    const more = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'More orders'
    );
    expect(more).toBeDefined();
    await act(async () => more!.click());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/electricity/orders?after=order-1',
      expect.any(Object)
    );
    expect(container.textContent).toContain('Electricity Buyer');
    expect(container.textContent).toContain('Later Buyer');
    const conversations = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Order conversations'
    );
    expect(conversations).toBeDefined();
    await act(async () => conversations!.click());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/electricity/orders/conversations',
      expect.any(Object)
    );
    const conversationOrder = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Electricity Buyer')
    );
    await act(async () => conversationOrder!.click());
    expect(container.textContent).toContain('Please confirm delivery.');
    expect(container.textContent).toContain('Visible to');
    expect(container.querySelector('select')?.value).toBe('');
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Send message'
      )?.disabled
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState({}, '', previousUrl);
    vi.unstubAllGlobals();
  }
});

it('opens a linked order directly even when it is no longer in the review queue', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const orderId = '55555555-5555-4555-8555-555555555555';
  const otherOrderId = '88888888-8888-4888-8888-888888888888';
  const missingOrderId = '99999999-9999-4999-8999-999999999999';
  const contractId = '66666666-6666-4666-8666-666666666666';
  const previousUrl = window.location.href;
  let missingAvailable = false;
  window.history.replaceState({}, '', `/admin/electricity-orders?orderId=${orderId}`);
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === '/api/user/settings/timezone'
            ? { timezone: 'Asia/Tehran' }
            : url === `/api/staff/electricity/orders/${orderId}` ||
                url === `/api/staff/electricity/orders/${otherOrderId}` ||
                (url === `/api/staff/electricity/orders/${missingOrderId}` && missingAvailable)
              ? {
                  orderId: url.endsWith(otherOrderId)
                    ? otherOrderId
                    : url.endsWith(missingOrderId)
                      ? missingOrderId
                      : orderId,
                  contractId,
                  contractState: 'Active',
                  invoiceId: '77777777-7777-4777-8777-777777777777',
                  customerName: 'Electricity Buyer',
                  commercialStatus: 'approved',
                  financialStatus: 'paid',
                  submittedAt: '2026-09-23T22:00:00Z',
                  periodStart: '2026-09-23T00:00:00Z',
                  periodEnd: '2026-09-30T20:30:00Z',
                  totalKwh: '10',
                  totalIrR: '1000',
                  paidIrR: '1000',
                  fullAddress: 'Electricity Street',
                  pricingSnapshot: { lines: [] },
                  settingsSnapshot: {},
                  contractSnapshot: {},
                  revisionReview: null,
                  timeline: [
                    {
                      id: 'event-2',
                      event: 'contract.activated',
                      at: '2026-09-24T00:00:00Z',
                      actor: null,
                      reason: null,
                      comment: null,
                    },
                  ],
                }
              : url.includes('/comments')
                ? { comments: [], nextBefore: null }
                : { orders: [], nextAfter: null }
        ),
        {
          status:
            url === `/api/staff/electricity/orders/${missingOrderId}` && !missingAvailable
              ? 404
              : 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminElectricityOrdersPage />));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/staff/electricity/orders/${orderId}`,
      expect.any(Object)
    );
    expect(container.textContent).toContain('Electricity Buyer');
    expect(container.textContent).not.toContain('No orders await review.');
    expect(container.textContent).toContain('Contract and order activated');
    expect(container.textContent).toContain('No text template is attached.');
    expect(
      container.querySelector(`a[href="/admin/contracts?contractId=${contractId}"]`)?.textContent
    ).toBe('Open contract');
    const lookup = container.querySelector<HTMLInputElement>('#electricity-order-lookup')!;
    const form = lookup.closest('form')!;
    async function submitLookup(id: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(lookup, id);
        lookup.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    }
    await submitLookup('invalid');
    expect(container.textContent).toContain('Enter a valid order ID.');
    expect(new URLSearchParams(window.location.search).get('orderId')).toBe(orderId);
    await submitLookup(otherOrderId);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/staff/electricity/orders/${otherOrderId}`,
      expect.any(Object)
    );
    expect(new URLSearchParams(window.location.search).get('orderId')).toBe(otherOrderId);
    expect(container.textContent).toContain('Electricity Buyer');
    await submitLookup(missingOrderId);
    expect(container.textContent).toContain('Order details were not found or are unavailable.');
    expect(container.textContent).not.toContain('Loading detail…');
    missingAvailable = true;
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry'
    );
    await act(async () => retry!.click());
    expect(container.textContent).toContain('Electricity Buyer');
    expect(container.textContent).not.toContain('Order details were not found or are unavailable.');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState({}, '', previousUrl);
    vi.unstubAllGlobals();
  }
});
