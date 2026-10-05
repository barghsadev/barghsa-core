import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AdminElectricityIncreasesPage from './AdminElectricityIncreasesPage.js';
import { increaseDecisionFixture } from '../test/electricity-increase-decision-fixtures.js';

vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'Asia/Tehran',
    format: String,
    notice: null,
  }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    irrDigits: String,
    number: String,
    money: String,
    numberStyle: 'western',
  }),
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
    expect(container.querySelector('a[href="/admin/invoices?invoiceId=invoice-1"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Approve increase');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shows each staff increase decision review and submits its exact hash', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const requestId = '11111111-1111-7111-8111-111111111111';
  const profileId = '22222222-2222-7222-8222-222222222222';
  const contractId = '33333333-3333-7333-8333-333333333333';
  const orderId = '44444444-4444-7444-8444-444444444444';
  const versionId = '55555555-5555-7555-8555-555555555555';
  const invoiceId = '66666666-6666-7666-8666-666666666666';
  const effectiveFrom = '2026-10-01T00:00:00.000Z';
  const request = {
    requestId,
    profileId,
    contractId,
    orderId,
    versionId,
    originalKwh: '10',
    requestedKwh: '12',
    maxPercentage: 20,
    effectiveFrom,
    periodEnd: '2026-10-15T00:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z',
    contractState: 'Active',
    status: 'pending',
    adjustmentInvoiceId: null,
    adjustmentInvoiceState: null,
    adjustmentPaidAmount: null,
    financialFollowUp: false,
  };
  const decisionReview = (action: 'approve' | 'reject') => ({
    schemaVersion: 1,
    scope: {
      action: 'electricity.quantity-increase-staff-decision',
      profileId,
      resourceId: requestId,
    },
    data: {
      action,
      reason: action === 'reject' ? 'Outside capacity plan' : '',
      requestId,
      contractId,
      orderId,
      profileId,
      versionId,
      contractState: 'Active',
      electricityStatus: 'active',
      originalKwh: '10',
      requestedKwh: '12',
      incrementalKwh: '2',
      maxPercentageAtRequest: 20,
      maxPercentageAtDecision: action === 'approve' ? 20 : null,
      requestedEffectiveFrom: effectiveFrom,
      effectiveFrom: action === 'approve' ? effectiveFrom : null,
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: request.periodEnd,
      originalInvoiceId: invoiceId,
      originalInvoiceState: 'Paid',
      originalInvoiceTotalIrR: '100000',
      originalInvoicePaidIrR: '100000',
      originalInvoiceRefundedIrR: '0',
      outcome:
        action === 'approve'
          ? 'publish_amendment_for_customer_signature'
          : 'reject_without_adjustment',
      adjustmentRule: 'prorated_at_customer_signature',
    },
    hash: (action === 'approve' ? 'a' : 'b').repeat(64),
  });
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith('/approve/review')) return Response.json(decisionReview('approve'));
    if (path.endsWith('/reject/review')) return Response.json(decisionReview('reject'));
    if (path.endsWith('/approve') || path.endsWith('/reject'))
      return Response.json(
        await increaseDecisionFixture().receipt(path.endsWith('/approve') ? 'approve' : 'reject'),
        { status: 201 }
      );
    return Response.json({ requests: [request], nextBefore: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label
    );
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    });
  };
  const confirm = async () => {
    const button = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((item) => item.textContent?.includes('Confirm'));
    expect(button).toBeDefined();
    await act(async () => button!.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(container.querySelector('[id^="increase-reason-"]')).not.toBeNull();
    });
  };
  try {
    await act(async () => root.render(<AdminElectricityIncreasesPage />));
    await click('Approve and issue amendment');
    expect(document.body.textContent).toContain('Publish amendment for customer signature');
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/approve'))).toBe(false);
    await confirm();
    const approval = fetchMock.mock.calls.find(([path]) => path.endsWith('/approve'))!;
    expect(JSON.parse((approval[1] as RequestInit).body as string)).toMatchObject({
      effectiveFrom,
      expectedReviewHash: 'a'.repeat(64),
    });
    const reason = container.querySelector<HTMLInputElement>(`#increase-reason-${requestId}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        reason,
        'Outside capacity plan'
      );
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Decline request');
    expect(document.body.textContent).toContain('Decline request; no invoice or quantity change');
    await confirm();
    const rejection = fetchMock.mock.calls.find(([path]) => path.endsWith('/reject'))!;
    expect(JSON.parse((rejection[1] as RequestInit).body as string)).toMatchObject({
      reason: 'Outside capacity plan',
      expectedReviewHash: 'b'.repeat(64),
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
