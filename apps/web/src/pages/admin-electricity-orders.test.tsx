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
  const order = {
    orderId: 'order-1',
    customerName: 'Electricity Buyer',
    commercialStatus: 'awaiting_staff_review',
    financialStatus: 'unpaid',
    nextAction: 'review_order',
    submittedAt: '2026-09-23T00:00:00Z',
    periodStart: '2026-09-23T00:00:00Z',
    periodEnd: '2026-09-30T00:00:00Z',
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
    contractSnapshot: { orderId: 'order-1' },
    versionId: 'version-1',
    totalIrR: '1000',
    paidIrR: '0',
    ageHours: 12,
    priority: 'normal',
  };
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify(url.endsWith('/order-1') ? order : { orders: [order] }), {
        headers: { 'Content-Type': 'application/json' },
      })
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
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/electricity/orders/order-1',
      expect.any(Object)
    );
    expect(container.textContent).toContain('Thermal electricity');
    expect(container.textContent).toContain('Approve order');
    expect(container.textContent).toContain('Request changes');
    expect(container.textContent).toContain('Reject order');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
