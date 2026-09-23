import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ElectricityOrderDetailsPage } from './ElectricityOrderDetailsPage.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String }),
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
          periodStart: '2026-09-23T00:00:00Z',
          periodEnd: '2026-09-30T00:00:00Z',
          totalKwh: '10',
          fullAddress: 'Electricity Street',
          contractId: 'contract-1',
          contractState: 'AwaitingStaffReview',
          invoiceId: 'invoice-1',
          invoiceState: 'Unpaid',
          totalIrR: '2500000',
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
    expect(container.querySelector('a[href="/contracts"]')).not.toBeNull();
    expect(container.querySelector('a[href="/invoices/invoice-1"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
