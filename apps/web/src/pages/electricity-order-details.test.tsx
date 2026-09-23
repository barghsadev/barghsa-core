import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ElectricityOrderDetailsPage } from './ElectricityOrderDetailsPage.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, irrDigits: String }),
}));

it('loads an order confirmation with its invoice and contract references', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          orderId: 'order-1',
          profileId: 'profile-1',
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
        }),
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
    expect(container.textContent).toContain('Contract draft awaiting publication');
    expect(container.textContent).toContain('Energy mix and price');
    expect(container.textContent).toContain('Order submitted');
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
