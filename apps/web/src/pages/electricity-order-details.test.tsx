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
    expect(container.textContent).toContain('Commercial status');
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
