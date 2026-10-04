import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ElectricityOrderDetailsPage } from './ElectricityOrderDetailsPage.js';

it('reviews the exact cancellation refund before submitting its hash', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const orderId = '11111111-1111-7111-8111-111111111111';
  const profileId = '22222222-2222-7222-8222-222222222222';
  const contractId = '33333333-3333-7333-8333-333333333333';
  const versionId = '44444444-4444-7444-8444-444444444444';
  const invoiceId = '55555555-5555-7555-8555-555555555555';
  const periodStart = '2026-09-23T00:00:00.000Z';
  const periodEnd = '2026-09-30T00:00:00.000Z';
  const detail = {
    orderId,
    profileId,
    profileName: 'Buyer Company',
    mode: 'simple',
    commercialStatus: 'PENDING',
    electricityStatus: 'awaiting_staff_review',
    financialStatus: 'partially_funded',
    nextAction: 'await_review',
    periodStart,
    periodEnd,
    totalKwh: '10',
    fullAddress: 'Electricity Street',
    postalCode: '1234567890',
    provinceId: '66666666-6666-7666-8666-666666666666',
    cityId: '77777777-7777-7777-8777-777777777777',
    contractId,
    contractState: 'AwaitingStaffReview',
    versionId,
    invoiceId,
    invoiceState: 'PartiallyFunded',
    totalIrR: '1000',
    paidIrR: '500',
    refundedIrR: '0',
    lines: [],
  };
  const review = {
    schemaVersion: 1,
    scope: { action: 'electricity.customer-cancel', profileId, resourceId: orderId },
    data: {
      reason: 'No longer needed',
      profileName: 'Buyer Company',
      commercialStatus: 'awaiting_staff_review',
      contractId,
      contractState: 'AwaitingStaffReview',
      versionId,
      contractSnapshot: {},
      invoiceId,
      invoiceState: 'PartiallyFunded',
      invoiceTotal: '1000',
      paidAmount: '500',
      refundedAmount: '0',
      pendingRefundAmount: '0',
      periodStart,
      periodEnd,
      totalKwh: '10',
      pricingSnapshot: { lines: [] },
      outcome: 'refund_obligation',
      refundAmount: '500',
      releasesGiftCode: false,
    },
    hash: 'c'.repeat(64),
  };
  const fetchMock = vi.fn(
    async (url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify(
          url === '/api/user/settings/timezone'
            ? { timezone: 'Asia/Tehran' }
            : url.endsWith('/cancel-review')
              ? review
              : url.endsWith('/cancel')
                ? { status: 'cancelled' }
                : url.includes('/comments')
                  ? { comments: [], nextBefore: null }
                  : detail
        ),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ElectricityOrderDetailsPage orderId={orderId} />));
    const reason = [...container.querySelectorAll('textarea')].find((item) =>
      item.closest('label')?.textContent?.includes('Cancellation reason')
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        reason,
        'No longer needed'
      );
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      reason
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/electricity/orders/${orderId}/cancel-review`,
      expect.objectContaining({ body: JSON.stringify({ reason: 'No longer needed' }) })
    );
    expect(document.body.textContent).toContain('Start wallet refund');
    expect(document.body.textContent).toContain('500');
    const confirm = [...document.body.querySelectorAll('button')].find(
      (button) => button.closest('[role="dialog"]') && button.textContent === 'Cancel order'
    );
    await act(async () => confirm!.click());
    const mutation = fetchMock.mock.calls.find(([url]) => url.endsWith('/cancel'));
    expect(mutation).toBeDefined();
    expect(JSON.parse((mutation![1] as RequestInit).body as string)).toMatchObject({
      expectedReviewHash: review.hash,
      expectedVersionId: versionId,
      reason: 'No longer needed',
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (value, [key, param]) => value.replace(`$${key}`, encodeURIComponent(param)),
      to
    );
    const query = search ? `?${new URLSearchParams(search)}` : '';
    return (
      <a href={`${path}${query}`} {...rest}>
        {children}
      </a>
    );
  },
}));

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, irrDigits: String }),
}));

it('loads an order confirmation with its invoice and contract references', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('/comments')
            ? {
                comments: [
                  {
                    id: 'comment-1',
                    authorName: 'Reviewer',
                    authorRole: 'staff',
                    visibility: 'public',
                    body: 'We are checking delivery.',
                    createdAt: '2026-09-23T00:00:00Z',
                  },
                ],
                nextBefore: null,
              }
            : {
                orderId: '11111111-1111-7111-8111-111111111111',
                profileId: '22222222-2222-7222-8222-222222222222',
                profileName: 'Customer Company',
                mode: 'simple',
                submittedAt: '2026-09-23T08:30:00Z',
                commercialStatus: 'PENDING',
                electricityStatus: 'awaiting_staff_review',
                financialStatus: 'unpaid',
                nextAction: 'await_review',
                periodStart: '2026-09-23T00:00:00Z',
                periodEnd: '2026-09-30T00:00:00Z',
                totalKwh: '10',
                fullAddress: 'Electricity Street',
                postalCode: '1234567890',
                contractId: '33333333-3333-7333-8333-333333333333',
                contractState: 'AwaitingStaffReview',
                versionId: '44444444-4444-7444-8444-444444444444',
                invoiceId: '55555555-5555-7555-8555-555555555555',
                invoiceState: 'Unpaid',
                totalIrR: '2500000',
                paidIrR: '0',
                refundedIrR: '0',
                lines: [
                  {
                    productId: '88888888-8888-7888-8888-888888888888',
                    systemKey: 'thermal',
                    title: { en: 'Thermal' },
                    quantityKwh: '10',
                    unitPriceIrR: '250000',
                    lineTotalIrR: '2500000',
                  },
                ],
                timeline: [
                  {
                    id: 'event-1',
                    event: 'electricity.order_submitted',
                    at: '2026-09-23T00:00:00Z',
                    actor: 'buyer',
                    reason: null,
                    comment: null,
                  },
                ],
              }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  vi.stubGlobal('fetch', request);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityOrderDetailsPage orderId="11111111-1111-7111-8111-111111111111" />)
    );
    expect(request).toHaveBeenCalledWith(
      '/api/electricity/orders/11111111-1111-7111-8111-111111111111',
      expect.any(Object)
    );
    expect(container.textContent).toContain('2500000');
    expect(container.textContent).toContain('Awaiting staff review');
    expect(container.textContent).toContain('Current status');
    expect(container.textContent).toContain('Who acts next');
    expect(container.textContent).toContain('Financial status');
    expect(container.textContent).toContain('Order method');
    expect(container.textContent).toContain('Simple');
    expect(container.textContent).toContain('Submitted');
    expect(container.textContent).toContain('Customer Company');
    expect(container.textContent).toContain('Postal Code');
    expect(container.textContent).toContain('1234567890');
    expect(container.querySelector('time[datetime="2026-09-23T08:30:00Z"]')).not.toBeNull();
    const statuses = [...container.querySelectorAll('dl')].find(
      (item) => item.querySelector('dt')?.textContent === 'Commercial status'
    );
    expect([...statuses!.querySelectorAll('dt')].map((item) => item.textContent)).toEqual([
      'Commercial status',
      'Financial status',
    ]);
    expect([...statuses!.querySelectorAll('dd')].map((item) => item.textContent)).toEqual([
      'Awaiting staff review',
      'Unpaid',
    ]);
    expect(container.textContent).toContain('Contract draft awaiting publication');
    expect(container.textContent).toContain('Energy mix and price');
    expect(container.textContent).toContain('Order submitted');
    expect(container.textContent).toContain('We are checking delivery.');
    expect(container.querySelector('a[href="/tickets"]')).not.toBeNull();
    expect(container.querySelector('a[href="/contracts"]')).toBeNull();
    expect(
      container.querySelector('a[href="/invoices/55555555-5555-7555-8555-555555555555"]')
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([
  {
    status: 'cancelled',
    paidIrR: '600000',
    refundedIrR: '200000',
    financiallyClosed: false,
    expected: 'Refund remaining400000',
    settlement: 'Financial settlement remains open until the refund completes.',
  },
  {
    status: 'rejected',
    paidIrR: '600000',
    refundedIrR: '600000',
    financiallyClosed: true,
    expected: 'Financial settlement completed.',
    settlement: 'Financial settlement completed.',
  },
  {
    status: 'cancelled',
    paidIrR: '0',
    refundedIrR: '0',
    financiallyClosed: true,
    expected: 'No payment was collected; no refund is due.',
    settlement: 'No payment was collected; no refund is due.',
  },
])(
  'shows the correct financial outcome for a $status order with $paidIrR paid',
  async ({ status, paidIrR, refundedIrR, financiallyClosed, expected, settlement }) => {
    document.documentElement.lang = 'en';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              orderId: '11111111-1111-7111-8111-111111111111',
              profileId: '22222222-2222-7222-8222-222222222222',
              electricityStatus: status,
              financialStatus: financiallyClosed ? 'refunded' : 'refund_pending',
              nextAction: financiallyClosed ? 'none' : 'await_refund',
              periodStart: '2026-09-23T00:00:00Z',
              periodEnd: '2026-09-30T00:00:00Z',
              totalKwh: '10',
              fullAddress: 'Electricity Street',
              contractId: '33333333-3333-7333-8333-333333333333',
              contractState: 'Cancelled',
              versionId: '44444444-4444-7444-8444-444444444444',
              invoiceId: '55555555-5555-7555-8555-555555555555',
              totalIrR: '2500000',
              paidIrR,
              refundedIrR,
              financiallyClosed,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<ElectricityOrderDetailsPage orderId="11111111-1111-7111-8111-111111111111" />)
      );
      expect(container.textContent).toContain(expected);
      expect(container.textContent).toContain(settlement);
      expect(container.textContent).not.toContain('Amount remaining');
      if (refundedIrR === paidIrR) expect(container.textContent).not.toContain('Refund remaining');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  }
);

it.each([
  {
    action: 'pay_invoice',
    status: 'approved',
    financialStatus: 'unpaid',
    contractState: 'AwaitingCustomerAcceptance',
    href: '/invoices/55555555-5555-7555-8555-555555555555',
    message: 'Review and pay',
  },
  {
    action: 'accept_contract',
    status: 'approved',
    financialStatus: 'paid',
    contractState: 'AwaitingCustomerAcceptance',
    href: '/contracts?contractId=33333333-3333-7333-8333-333333333333',
    message: 'Review and accept',
  },
  {
    action: 'await_payment_review',
    status: 'approved',
    financialStatus: 'payment_under_review',
    contractState: 'AwaitingCustomerAcceptance',
    href: '/invoices/55555555-5555-7555-8555-555555555555',
    message: 'payment is under review',
  },
  {
    action: 'await_refund',
    status: 'rejected',
    financialStatus: 'refund_pending',
    contractState: 'Rejected',
    href: '/invoices/55555555-5555-7555-8555-555555555555',
    message: 'refund is being processed',
  },
  {
    action: 'resubmit_changes',
    status: 'changes_requested',
    financialStatus: 'unpaid',
    contractState: 'ChangesRequested',
    href: '#electricity-order-correction',
    message: 'resubmit your order',
  },
])(
  'links the $action callout to the relevant next step',
  async ({ action, status, financialStatus, contractState, href, message }) => {
    document.documentElement.lang = 'en';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              orderId: '11111111-1111-7111-8111-111111111111',
              profileId: '22222222-2222-7222-8222-222222222222',
              electricityStatus: status,
              financialStatus,
              nextAction: action,
              periodStart: '2026-09-23T00:00:00Z',
              periodEnd: '2026-09-30T00:00:00Z',
              totalKwh: '10',
              fullAddress: 'Electricity Street',
              postalCode: '1234567890',
              contractId: '33333333-3333-7333-8333-333333333333',
              contractState,
              versionId: '44444444-4444-7444-8444-444444444444',
              invoiceId: '55555555-5555-7555-8555-555555555555',
              invoiceState: 'Unpaid',
              totalIrR: '2500000',
              paidIrR: '0',
              refundedIrR: '0',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<ElectricityOrderDetailsPage orderId="11111111-1111-7111-8111-111111111111" />)
      );
      const actionLink = Array.from(container.querySelectorAll('a')).find((link) =>
        link.textContent?.includes(message)
      );
      expect(actionLink?.getAttribute('href')).toBe(href);
      if (action === 'resubmit_changes')
        expect(container.querySelector('#electricity-order-correction')).not.toBeNull();
      else if (status === 'approved')
        expect(
          container.querySelector(
            'a[href="/contracts?contractId=33333333-3333-7333-8333-333333333333"]'
          )
        ).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  }
);

it('reviews amended electricity terms before submitting a replacement invoice', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let revised = false;
  const revisionQuote = {
    reviewDigest: 'a'.repeat(64),
    periodStart: '2026-09-23T00:00:00Z',
    periodEnd: '2026-09-30T00:00:00Z',
    durationHours: '168',
    averagePowerKw: '0.071428571',
    greenRuleApplies: false,
    totalKwh: '12',
    subtotalIrR: '3000000',
    discountIrR: '0',
    vatIrR: '0',
    totalIrR: '3000000',
    lines: [
      {
        productId: '88888888-8888-7888-8888-888888888888',
        systemKey: 'thermal',
        quantityKwh: '12',
        unitPriceIrR: '250000',
        subtotalIrR: '3000000',
        discountIrR: '0',
        vatRateBasisPoints: 0,
        vatIrR: '0',
        totalIrR: '3000000',
      },
    ],
  };
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      requests.push({ url, ...(body ? { body } : {}) });
      if (url === '/api/geography/provinces')
        return new Response(
          JSON.stringify([
            { id: '66666666-6666-7666-8666-666666666666', nameFa: 'استان', nameEn: 'Province' },
          ]),
          { status: 200 }
        );
      if (url === '/api/geography/provinces/66666666-6666-7666-8666-666666666666/cities')
        return new Response(
          JSON.stringify([
            {
              id: '77777777-7777-7777-8777-777777777777',
              provinceId: '66666666-6666-7666-8666-666666666666',
              nameFa: 'شهر یک',
              nameEn: 'City one',
            },
            {
              id: '77777777-7777-7777-8777-777777777778',
              provinceId: '66666666-6666-7666-8666-666666666666',
              nameFa: 'شهر دو',
              nameEn: 'City two',
            },
          ]),
          { status: 200 }
        );
      if (url.endsWith('/periods/simple'))
        return new Response(
          JSON.stringify({
            periods: [
              { key: 'next_week', start: '2026-09-23T00:00:00Z', end: '2026-09-30T00:00:00Z' },
            ],
          }),
          { status: 200 }
        );
      if (url.endsWith('/revision-preview'))
        return new Response(
          JSON.stringify({
            ...revisionQuote,
          }),
          { status: 200 }
        );
      if (url.endsWith('/resubmit')) {
        revised = true;
        return Response.json({
          orderId: '11111111-1111-7111-8111-111111111111',
          contractId: '33333333-3333-7333-8333-333333333333',
          versionId: '44444444-4444-7444-8444-444444444445',
          invoiceId: '55555555-5555-7555-8555-555555555556',
          status: 'awaiting_staff_review',
          ...revisionQuote,
        });
      }
      if (url.includes('/comments'))
        return new Response(JSON.stringify({ comments: [], nextBefore: null }), { status: 200 });
      return new Response(
        JSON.stringify({
          orderId: '11111111-1111-7111-8111-111111111111',
          profileId: '22222222-2222-7222-8222-222222222222',
          mode: 'simple',
          electricityStatus: revised ? 'awaiting_staff_review' : 'changes_requested',
          financialStatus: 'unpaid',
          nextAction: revised ? 'await_review' : 'resubmit_changes',
          periodStart: '2026-09-23T00:00:00Z',
          periodEnd: '2026-09-30T00:00:00Z',
          totalKwh: '10',
          fullAddress: 'Electricity Street',
          postalCode: '1234567890',
          provinceId: '66666666-6666-7666-8666-666666666666',
          cityId: '77777777-7777-7777-8777-777777777777',
          contractId: '33333333-3333-7333-8333-333333333333',
          contractState: revised ? 'AwaitingStaffReview' : 'ChangesRequested',
          versionId: revised
            ? '44444444-4444-7444-8444-444444444445'
            : '44444444-4444-7444-8444-444444444444',
          invoiceId: revised
            ? '55555555-5555-7555-8555-555555555556'
            : '55555555-5555-7555-8555-555555555555',
          invoiceState: 'Unpaid',
          totalIrR: revised ? '3000000' : '2500000',
          paidIrR: '0',
          refundedIrR: '0',
          lines: [
            {
              systemKey: 'thermal',
              title: { en: 'Thermal' },
              quantityKwh: '10',
              productId: '88888888-8888-7888-8888-888888888888',
              unitPriceIrR: '250000',
              lineTotalIrR: '2500000',
            },
          ],
        }),
        { status: 200 }
      );
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await import('./ElectricityOrderRevisionForm.js');
    await act(async () =>
      root.render(<ElectricityOrderDetailsPage orderId="11111111-1111-7111-8111-111111111111" />)
    );
    await vi.waitFor(
      () => expect(container.textContent).toContain('Change period, quantity or price'),
      { timeout: 5000 }
    );
    const section = container.querySelector('#electricity-order-correction section')!;
    const form = section.querySelector('form')!;
    const quantity = form.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    const note = form.querySelector('textarea') as HTMLTextAreaElement;
    const city = form.querySelectorAll('select')[2]!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        quantity,
        '12'
      );
      quantity.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        note,
        'Quantity corrected'
      );
      note.dispatchEvent(new Event('input', { bubbles: true }));
      city.value = '77777777-7777-7777-8777-777777777778';
      city.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await vi.waitFor(() =>
      expect(requests.find((request) => request.url.endsWith('/revision-preview'))).toBeDefined()
    );
    await vi.waitFor(() => expect(section.textContent).toContain('3000000'));
    expect(
      requests.find((request) => request.url.endsWith('/revision-preview'))?.body
    ).toMatchObject({
      profileId: '22222222-2222-7222-8222-222222222222',
      period: 'next_week',
      totalKwh: '12',
      expectedVersionId: '44444444-4444-7444-8444-444444444444',
    });
    expect(section.textContent).toContain('3000000');
    const submit = Array.from(section.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Resubmit for review')
    )!;
    await act(async () => submit.click());
    expect(requests.find((request) => request.url.endsWith('/resubmit'))?.body).toMatchObject({
      totalKwh: '12',
      expectedQuoteDigest: 'a'.repeat(64),
      address: {
        provinceId: '66666666-6666-7666-8666-666666666666',
        cityId: '77777777-7777-7777-8777-777777777778',
      },
      responseNote: 'Quantity corrected',
    });
    expect(revised).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
