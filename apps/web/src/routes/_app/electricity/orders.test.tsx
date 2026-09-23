import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ElectricityOrdersPage } from './orders.index.js';

vi.mock('../../../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, irrDigits: String }),
}));

it('shows the active profile order with both statuses and a next action', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === '/api/profiles/verification-status'
            ? { activeProfileId: 'profile-1' }
            : {
                orders: [
                  {
                    orderId: 'order-1',
                    electricityStatus: 'awaiting_staff_review',
                    financialStatus: 'unpaid',
                    nextAction: 'await_review',
                    submittedAt: '2026-09-23T00:00:00Z',
                    periodStart: '2026-09-24T00:00:00Z',
                    periodEnd: '2026-09-30T00:00:00Z',
                    totalKwh: '10',
                    totalIrR: '2500000',
                  },
                ],
                nextBefore: null,
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
    await act(async () => root.render(<ElectricityOrdersPage />));
    expect(request).toHaveBeenCalledWith(
      '/api/electricity/orders?profileId=profile-1',
      expect.any(Object)
    );
    expect(container.textContent).toContain('Awaiting staff review');
    expect(container.textContent).toContain('Unpaid');
    expect(container.textContent).toContain('2500000');
    expect(container.textContent).toContain('order-1');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
