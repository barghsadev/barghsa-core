import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ElectricityPriceAdjustmentsPanel } from './ElectricityPriceAdjustmentsPanel.js';
import AdminElectricityPriceAdjustmentsPage, {
  percentToBps,
} from './AdminElectricityPriceAdjustmentsPage.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String, number: String }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action }: { action: { path: string } }) => <p>{action.path}</p>,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('converts signed staff percentages exactly and refuses zero or a zero-price decrease', () => {
  expect(percentToBps('10.25')).toBe('1025');
  expect(percentToBps('-2.5')).toBe('-250');
  expect(percentToBps('0')).toBeNull();
  expect(percentToBps('-100')).toBeNull();
  expect(percentToBps('1.234')).toBeNull();
});

it.each(['proposed', 'finalized'] as const)(
  'shows the customer the %s price reason, basis and calculation',
  async (status) => {
    document.documentElement.lang = 'en';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              adjustments: [
                {
                  adjustmentId: 'price-1',
                  status,
                  effectiveFrom: '2026-10-02T00:00:00Z',
                  percentageBps: '-1000',
                  reason: 'Published tariff correction',
                  contractualBasis: 'Clause 7',
                  adjustmentAmountIrR: '-50000',
                  adjustmentInvoiceId: status === 'finalized' ? 'credit-1' : null,
                  calculation: {
                    quote: {
                      oldFutureIrR: '500000',
                      newFutureIrR: '450000',
                      components: [
                        {
                          source: 'original_invoice',
                          invoiceId: 'invoice-1',
                          basisIrR: '1000000',
                          oldFutureIrR: '500000',
                          changeIrR: '-50000',
                          eligibleFrom: '2026-10-02T00:00:00Z',
                        },
                      ],
                    },
                  },
                },
              ],
            })
          )
      )
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<ElectricityPriceAdjustmentsPanel contractId="contract-1" />)
      );
      expect(container.textContent).toContain('Published tariff correction');
      expect(container.textContent).toContain('Clause 7');
      expect(container.textContent).toContain('450000');
      expect(container.textContent).toContain('1000000');
      expect(container.textContent).toContain('Credit amount');
      if (status === 'proposed') {
        expect(container.textContent).toContain('Your acceptance is not required');
        expect(container.querySelector('a')).toBeNull();
      } else {
        expect(container.querySelector('a')?.getAttribute('href')).toBe('/invoices/credit-1');
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);

it('opens a disclosed proposal from the staff contract link and starts finalization', async () => {
  document.documentElement.lang = 'en';
  window.history.replaceState({}, '', '/admin/electricity-price-adjustments?contractId=contract-1');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          contractId: 'contract-1',
          versionId: 'version-1',
          periodEnd: '2026-10-11T00:00:00Z',
          canPropose: false,
          blockedByIncrease: false,
          canCancel: true,
          canFinalize: true,
          adjustments: [
            {
              adjustmentId: 'price-1',
              status: 'proposed',
              effectiveFrom: '2026-10-06T00:00:00Z',
              percentageBps: '1000',
              reason: 'Published tariff correction',
              contractualBasis: 'Clause 7',
              adjustmentAmountIrR: '50000',
              calculationSha256: 'a'.repeat(64),
              adjustmentInvoiceId: null,
              calculation: {
                quote: {
                  oldFutureIrR: '500000',
                  newFutureIrR: '550000',
                },
              },
            },
          ],
        })
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/electricity/contracts/contract-1/price-adjustments',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(container.textContent).toContain('Published tariff correction');
    const finalize = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Finalize and issue adjustment')
    );
    await act(async () => finalize?.click());
    expect(container.textContent).toContain(
      '/api/staff/electricity/price-adjustments/price-1/finalize'
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('opens a finalized adjustment invoice in the staff ledger', async () => {
  document.documentElement.lang = 'en';
  window.history.replaceState({}, '', '/admin/electricity-price-adjustments?contractId=contract-1');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            contractId: 'contract-1',
            versionId: 'version-1',
            periodEnd: '2026-10-11T00:00:00Z',
            canPropose: false,
            canCancel: false,
            canFinalize: false,
            blockedByIncrease: false,
            adjustments: [
              {
                adjustmentId: 'price-1',
                status: 'finalized',
                effectiveFrom: '2026-10-06T00:00:00Z',
                percentageBps: '1000',
                reason: 'Tariff',
                contractualBasis: 'Clause 7',
                adjustmentAmountIrR: '50000',
                calculationSha256: 'a'.repeat(64),
                adjustmentInvoiceId: '11111111-1111-7111-8111-111111111111',
                calculation: { quote: { oldFutureIrR: '500000', newFutureIrR: '550000' } },
              },
            ],
          })
        )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
    expect(
      container.querySelector(
        'a[href="/admin/invoices?invoiceId=11111111-1111-7111-8111-111111111111"]'
      )
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
