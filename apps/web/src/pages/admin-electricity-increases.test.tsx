import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AdminElectricityIncreasesPage from './AdminElectricityIncreasesPage.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String, number: String }),
}));

afterEach(() => vi.unstubAllGlobals());

it('shows expired finance cases in the staff queue without review actions', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify({
          requests: path.includes('status=expired')
            ? [
                {
                  requestId: 'request-1',
                  contractId: 'contract-1',
                  orderId: 'order-1',
                  originalKwh: '10',
                  requestedKwh: '12',
                  effectiveFrom: '2026-09-01T00:00:00Z',
                  periodEnd: '2026-09-08T00:00:00Z',
                  contractState: 'Active',
                  adjustmentInvoiceId: 'invoice-1',
                  adjustmentInvoiceState: 'Paid',
                  adjustmentPaidAmount: '200000',
                  financialFollowUp: true,
                },
              ]
            : [],
          nextBefore: null,
        })
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminElectricityIncreasesPage />));
    const expired = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Expired')
    );
    await act(async () => expired?.click());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/electricity/increase-requests?status=expired',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(container.textContent).toContain('Finance must resolve this payment or receipt.');
    expect(container.textContent).toContain('Paid');
    expect(container.textContent).not.toContain('Approve increase');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
