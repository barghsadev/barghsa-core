import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ElectricityIncreasePanel } from './ElectricityIncreasePanel.js';

const contractId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const profileId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const invoiceId = '55555555-5555-4555-8555-555555555555';
const orderId = '66666666-6666-4666-8666-666666666666';
const periodStart = '2026-09-01T00:00:00.000Z';
const periodEnd = '2026-10-24T00:00:00.000Z';
const eligibleFrom = '2026-09-24T00:00:00.000Z';

function signingReview() {
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: { action: 'electricity.quantity-increase-sign', profileId, resourceId: contractId },
    data: {
      currency: 'IRR',
      profileId,
      contractId,
      orderId,
      versionId,
      requestId,
      amendmentSha256: 'a'.repeat(64),
      originalInvoiceId: invoiceId,
      originalInvoiceIrR: '1000000',
      originalKwh: '100',
      requestedKwh: '120',
      incrementalKwh: '20',
      effectiveFrom: eligibleFrom,
      eligibleFrom,
      periodStart,
      periodEnd,
      remainingMs: String(Date.parse(periodEnd) - Date.parse(eligibleFrom)),
      periodMs: String(Date.parse(periodEnd) - Date.parse(periodStart)),
      baseShareIrR: '200000',
      priceAdjustments: [],
      adjustmentIrR: '200000',
      activationRule: 'after-signature-full-payment-and-effective-date',
    },
  };
}

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String }),
}));

afterEach(() => vi.unstubAllGlobals());

it('keeps increases hidden while the policy is disabled', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request: null,
            maxPercentage: 0,
            originalKwh: '100',
            canRequest: false,
          })
        )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityIncreasePanel contractId="contract-1" versionId="version-1" />)
    );
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toContain('Request more electricity');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shows the one submitted request without offering a second submission', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request: {
              requestedKwh: '120',
              status: 'pending',
              reviewReason: null,
              createdAt: '2026-09-23T00:00:00Z',
            },
            maxPercentage: 20,
            originalKwh: '100',
            canRequest: false,
          })
        )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityIncreasePanel contractId="contract-1" versionId="version-1" />)
    );
    expect(container.textContent).toContain('Awaiting staff review');
    expect(container.textContent).toContain('120');
    expect(container.querySelector('input')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shows approved amendment terms before the customer signs', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          request: {
            requestId,
            requestedKwh: '120',
            status: 'awaiting_signature',
            reviewReason: null,
            amendmentSha256: 'a'.repeat(64),
            amendmentDocument: {
              originalKwh: '100',
              requestedKwh: '120',
              incrementalKwh: '20',
              earliestEffectiveFrom: eligibleFrom,
              periodEnd,
            },
          },
          maxPercentage: 20,
          originalKwh: '100',
          canRequest: false,
          quote: { adjustmentIrR: '200000', eligibleFrom },
          review: signingReview(),
        })
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityIncreasePanel contractId={contractId} versionId={versionId} />)
    );
    expect(container.textContent).toContain('Quantity increase amendment');
    expect(container.textContent).toContain('Additional quantity: 20 kWh');
    expect(container.textContent).toContain('SHA-256: ' + 'a'.repeat(64));
    expect(container.textContent).toContain('Adjustment invoice amount at signature200000 IRR');
    expect(container.textContent).toContain('Paid price basis1000000 IRR');
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Sign amendment')
    );
    expect(button?.disabled).toBe(true);
    await act(async () => checkbox?.click());
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/electricity/contracts/${contractId}/increase/sign`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"expectedReviewHash":"' + 'b'.repeat(64) + '"'),
      })
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('does not offer signing when the priced review does not reconcile', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const invalid = signingReview();
  invalid.data.baseShareIrR = '200001';
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request: {
              requestId,
              requestedKwh: '120',
              status: 'awaiting_signature',
              amendmentSha256: 'a'.repeat(64),
            },
            maxPercentage: 20,
            originalKwh: '100',
            canRequest: false,
            quote: { adjustmentIrR: '200000', eligibleFrom },
            review: invalid,
          })
        )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityIncreasePanel contractId={contractId} versionId={versionId} />)
    );
    expect(container.textContent).toContain('The financial review is unavailable');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).not.toContain('Sign amendment and issue invoice');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each([
  ['Cancelled', false, 'no payment is due for the expired increase'],
  ['Paid', true, 'finance review'],
] as const)(
  'explains an expired %s adjustment to the customer',
  async (invoiceState, followUp, message) => {
    document.documentElement.lang = 'en';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              request: {
                requestedKwh: '120',
                status: 'expired',
                reviewReason: null,
                adjustmentInvoiceId: 'invoice-1',
                adjustmentInvoiceState: invoiceState,
                financialFollowUp: followUp,
              },
              maxPercentage: 20,
              originalKwh: '100',
              canRequest: false,
            })
          )
      )
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<ElectricityIncreasePanel contractId="contract-1" versionId="version-1" />)
      );
      expect(container.textContent).toContain(message);
      expect(container.querySelector('input')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);
