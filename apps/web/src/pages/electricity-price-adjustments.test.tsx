import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ElectricityPriceAdjustmentsPanel } from './ElectricityPriceAdjustmentsPanel.js';
import AdminElectricityPriceAdjustmentsPage, {
  percentToBps,
} from './AdminElectricityPriceAdjustmentsPage.js';

import {
  priceAdjustmentRow,
  priceContractId,
  priceProfileId,
  priceVersionId,
  priceAdjustmentInvoiceId,
  priceAdjustmentId,
  priceOriginalInvoiceId,
} from '../test/electricity-price-adjustment-fixtures.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    irrDigits: String,
    number: (value: bigint, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', options).format(value),
    money: (value: string) => `${new Intl.NumberFormat('en').format(BigInt(value))} IRR`,
    numberStyle: 'western',
  }),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'Asia/Tehran',
    loading: false,
    error: null,
    retry: vi.fn(),
    format: (value: string) => value,
  }),
}));
const h = vi.hoisted(() => ({ action: null as { path: string; body?: unknown } | null }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    summary,
  }: {
    action: { path: string; body?: unknown };
    summary: ReactNode;
  }) => {
    h.action = action;
    return (
      <div>
        {action.path}
        {summary}
      </div>
    );
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
  h.action = null;
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
              adjustments: [priceAdjustmentRow(status)],
            })
          )
      )
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <ElectricityPriceAdjustmentsPanel
            contractId={priceContractId}
            profileId={priceProfileId}
            versionId={priceVersionId}
          />
        )
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
        expect(container.querySelector('a')?.getAttribute('href')).toBe(
          `/invoices/${priceAdjustmentInvoiceId}`
        );
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);

it('opens a disclosed proposal from the staff contract link and starts finalization', async () => {
  document.documentElement.lang = 'en';
  window.history.replaceState(
    {},
    '',
    '/admin/electricity-price-adjustments?contractId=11111111-1111-4111-8111-111111111111'
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const proposal = priceAdjustmentRow('proposed', 'charge');
  const fetchMock = vi.fn(async () =>
    Response.json({
      contractId: priceContractId,
      profileId: priceProfileId,
      versionId: priceVersionId,
      periodEnd: proposal.periodEnd,
      canPropose: false,
      blockedByIncrease: false,
      canCancel: true,
      canFinalize: true,
      adjustments: [proposal],
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff/electricity/contracts/11111111-1111-4111-8111-111111111111/price-adjustments',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(container.textContent).toContain('Published tariff correction');
    const finalize = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Finalize and issue adjustment')
    );
    await act(async () => finalize?.click());
    expect(container.textContent).toContain(
      `/api/staff/electricity/price-adjustments/${priceAdjustmentId}/finalize`
    );
    expect(container.textContent).toContain('Electricity price financial review');
    expect(container.textContent).toContain('50,000 IRR');
    expect(container.textContent).toContain(priceOriginalInvoiceId);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('reviews the server price before preparing the exact publish command', async () => {
  const contractId = '11111111-1111-4111-8111-111111111111';
  const profileId = '22222222-2222-4222-8222-222222222222';
  const versionId = '33333333-3333-4333-8333-333333333333';
  const invoiceId = '44444444-4444-4444-8444-444444444444';
  const orderId = '55555555-5555-4555-8555-555555555555';
  document.documentElement.lang = 'en';
  window.history.replaceState(
    {},
    '',
    `/admin/electricity-price-adjustments?contractId=${contractId}`
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(async (raw: string, init?: RequestInit) => {
    if (!raw.endsWith('/review'))
      return new Response(
        JSON.stringify({
          contractId,
          profileId,
          versionId,
          periodEnd: '2027-09-01T00:00:00.000Z',
          canPropose: true,
          canFinalize: false,
          canCancel: false,
          blockedByIncrease: false,
          adjustments: [],
        })
      );
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        hash: 'a'.repeat(64),
        scope: {
          action: 'electricity.price-adjustment-proposal',
          profileId,
          resourceId: contractId,
        },
        data: {
          currency: 'IRR',
          profileId,
          orderId,
          periodStart: '2026-09-01T00:00:00.000Z',
          periodEnd: '2027-09-01T00:00:00.000Z',
          calculation: {
            schemaVersion: 1,
            contractId,
            versionId,
            originalInvoiceId: invoiceId,
            reason: body.reason,
            contractualBasis: body.contractualBasis,
            quote: {
              amountIrR: '50000',
              oldFutureIrR: '500000',
              newFutureIrR: '550000',
              kind: 'charge',
              percentageBps: body.percentageBps,
              effectiveFrom: body.effectiveFrom,
              rounding: 'half-up-to-nearest-IRR',
              components: [
                {
                  source: 'original_invoice',
                  invoiceId,
                  basisIrR: '1000000',
                  periodStart: '2026-09-01T00:00:00.000Z',
                  periodEnd: '2027-09-01T00:00:00.000Z',
                  eligibleFrom: body.effectiveFrom,
                  oldFutureIrR: '500000',
                  changeIrR: '50000',
                  newFutureIrR: '550000',
                  remainingMs: '15897600000',
                  periodMs: '31536000000',
                },
              ],
            },
          },
        },
      })
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
    const set = async (selector: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(selector)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await set('#price-percent', '10');
    await set('#price-effective', '2026-10-06T12:00');
    await set('#price-reason', 'Tariff change');
    await set('#price-basis', 'Clause 7');
    await act(async () =>
      container
        .querySelectorAll('form')[1]!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(h.action).not.toBeNull();
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/review'))).toBe(true);
    expect(h.action?.body).toMatchObject({
      expectedReviewHash: 'a'.repeat(64),
      percentageBps: '1000',
    });
    expect(container.textContent).toContain('Electricity price financial review');
    expect(container.textContent).toContain('50,000 IRR');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('opens a finalized adjustment invoice in the staff ledger', async () => {
  document.documentElement.lang = 'en';
  window.history.replaceState(
    {},
    '',
    '/admin/electricity-price-adjustments?contractId=11111111-1111-4111-8111-111111111111'
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const finalized = {
    ...priceAdjustmentRow('finalized', 'charge'),
    adjustmentInvoiceId: '11111111-1111-7111-8111-111111111111',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        contractId: priceContractId,
        profileId: priceProfileId,
        versionId: priceVersionId,
        periodEnd: finalized.periodEnd,
        canPropose: false,
        canCancel: false,
        canFinalize: false,
        blockedByIncrease: false,
        adjustments: [finalized],
      })
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
