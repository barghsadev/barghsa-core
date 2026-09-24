import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ElectricityOrderDetailsPage } from './ElectricityOrderDetailsPage.js';

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
                orderId: 'order-1',
                profileId: 'profile-1',
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
                contractId: 'contract-1',
                contractState: 'AwaitingStaffReview',
                versionId: 'version-1',
                invoiceId: 'invoice-1',
                invoiceState: 'Unpaid',
                totalIrR: '2500000',
                paidIrR: '0',
                refundedIrR: '0',
                lines: [
                  {
                    productId: 'thermal-1',
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
    await act(async () => root.render(<ElectricityOrderDetailsPage orderId="order-1" />));
    expect(request).toHaveBeenCalledWith('/api/electricity/orders/order-1', expect.any(Object));
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
    expect(container.querySelector('a[href="/invoices/invoice-1"]')).not.toBeNull();
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
              orderId: 'order-1',
              profileId: 'profile-1',
              electricityStatus: status,
              financialStatus: financiallyClosed ? 'refunded' : 'refund_pending',
              nextAction: financiallyClosed ? 'none' : 'await_refund',
              periodStart: '2026-09-23T00:00:00Z',
              periodEnd: '2026-09-30T00:00:00Z',
              totalKwh: '10',
              fullAddress: 'Electricity Street',
              contractId: 'contract-1',
              contractState: 'Cancelled',
              versionId: 'version-1',
              invoiceId: 'invoice-1',
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
      await act(async () => root.render(<ElectricityOrderDetailsPage orderId="order-1" />));
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
    href: '/invoices/invoice-1',
    message: 'Review and pay',
  },
  {
    action: 'accept_contract',
    status: 'approved',
    financialStatus: 'paid',
    contractState: 'AwaitingCustomerAcceptance',
    href: '/contracts?contractId=contract-1',
    message: 'Review and accept',
  },
  {
    action: 'await_payment_review',
    status: 'approved',
    financialStatus: 'payment_under_review',
    contractState: 'AwaitingCustomerAcceptance',
    href: '/invoices/invoice-1',
    message: 'payment is under review',
  },
  {
    action: 'await_refund',
    status: 'rejected',
    financialStatus: 'refund_pending',
    contractState: 'Rejected',
    href: '/invoices/invoice-1',
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
              orderId: 'order-1',
              profileId: 'profile-1',
              electricityStatus: status,
              financialStatus,
              nextAction: action,
              periodStart: '2026-09-23T00:00:00Z',
              periodEnd: '2026-09-30T00:00:00Z',
              totalKwh: '10',
              fullAddress: 'Electricity Street',
              postalCode: '1234567890',
              contractId: 'contract-1',
              contractState,
              versionId: 'version-1',
              invoiceId: 'invoice-1',
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
      await act(async () => root.render(<ElectricityOrderDetailsPage orderId="order-1" />));
      const actionLink = Array.from(container.querySelectorAll('a')).find((link) =>
        link.textContent?.includes(message)
      );
      expect(actionLink?.getAttribute('href')).toBe(href);
      if (action === 'resubmit_changes')
        expect(container.querySelector('#electricity-order-correction')).not.toBeNull();
      else if (status === 'approved')
        expect(
          container.querySelector('a[href="/contracts?contractId=contract-1"]')
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
          JSON.stringify([{ id: 'province-1', nameFa: 'استان', nameEn: 'Province' }]),
          { status: 200 }
        );
      if (url === '/api/geography/provinces/province-1/cities')
        return new Response(
          JSON.stringify([
            { id: 'city-1', provinceId: 'province-1', nameFa: 'شهر یک', nameEn: 'City one' },
            { id: 'city-2', provinceId: 'province-1', nameFa: 'شهر دو', nameEn: 'City two' },
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
            reviewDigest: 'a'.repeat(64),
            totalIrR: '3000000',
            totalKwh: '12',
            subtotalIrR: '3000000',
            discountIrR: '0',
            vatIrR: '0',
            lines: [],
          }),
          { status: 200 }
        );
      if (url.endsWith('/resubmit')) {
        revised = true;
        return new Response(JSON.stringify({ status: 'awaiting_staff_review' }), { status: 200 });
      }
      if (url.includes('/comments'))
        return new Response(JSON.stringify({ comments: [], nextBefore: null }), { status: 200 });
      return new Response(
        JSON.stringify({
          orderId: 'order-1',
          profileId: 'profile-1',
          mode: 'simple',
          electricityStatus: revised ? 'awaiting_staff_review' : 'changes_requested',
          financialStatus: 'unpaid',
          nextAction: revised ? 'await_review' : 'resubmit_changes',
          periodStart: '2026-09-23T00:00:00Z',
          periodEnd: '2026-09-30T00:00:00Z',
          totalKwh: '10',
          fullAddress: 'Electricity Street',
          postalCode: '1234567890',
          provinceId: 'province-1',
          cityId: 'city-1',
          contractId: 'contract-1',
          contractState: revised ? 'AwaitingStaffReview' : 'ChangesRequested',
          versionId: revised ? 'version-2' : 'version-1',
          invoiceId: revised ? 'invoice-2' : 'invoice-1',
          invoiceState: 'Unpaid',
          totalIrR: revised ? '3000000' : '2500000',
          paidIrR: '0',
          refundedIrR: '0',
          lines: [
            {
              systemKey: 'thermal',
              title: { en: 'Thermal' },
              quantityKwh: '10',
              productId: 'thermal-1',
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
    await act(async () => root.render(<ElectricityOrderDetailsPage orderId="order-1" />));
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
      city.value = 'city-2';
      city.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(
      requests.find((request) => request.url.endsWith('/revision-preview'))?.body
    ).toMatchObject({
      profileId: 'profile-1',
      period: 'next_week',
      totalKwh: '12',
      expectedVersionId: 'version-1',
    });
    expect(section.textContent).toContain('3000000');
    const submit = Array.from(section.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Resubmit for review')
    )!;
    await act(async () => submit.click());
    expect(requests.find((request) => request.url.endsWith('/resubmit'))?.body).toMatchObject({
      totalKwh: '12',
      expectedQuoteDigest: 'a'.repeat(64),
      address: { provinceId: 'province-1', cityId: 'city-2' },
      responseNote: 'Quantity corrected',
    });
    expect(revised).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
