import { afterEach, expect, it, vi } from 'vitest';
import { loadInvoiceBankReceiptSubmissionReview } from './invoice-bank-receipt-review-action.js';
import {
  fetchActiveProfileId,
  mapInvoiceReceiptSubmitError,
  normalizeIrrAmountDigits,
  submitInvoiceBankReceipt,
  uploadInvoiceReceiptAttachment,
} from './invoice-bank-receipt-upload.js';

afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const receipt = {
  invoiceId: 'invoice-1',
  amountIrR: 9_007_199_254_740_993n,
  paymentDate: '2026-09-01',
  payerReference: 'bank-ref',
  attachmentKey: 'receipt/key.pdf',
  expectedReviewHash: 'a'.repeat(64),
};
const reviewed = {
  invoiceId: '11111111-1111-4111-8111-111111111111',
  profileId: '22222222-2222-4222-8222-222222222222',
  amountIrR: '9007199254740993',
  paymentDate: '2026-09-01',
  payerReference: 'bank-ref',
  bankName: null,
  attachmentKey: 'receipt/key.pdf',
  customerNote: null,
};
function snapshot(values = reviewed) {
  return {
    schemaVersion: 1,
    scope: {
      action: 'invoice.bank-receipt-submission',
      profileId: values.profileId,
      resourceId: values.invoiceId,
    },
    data: {
      ...values,
      invoiceState: 'Unpaid',
      invoiceTotalIrR: '9007199254740993',
      invoicePaidIrR: '0',
      invoiceRemainingIrR: '9007199254740993',
      fileName: 'key.pdf',
      fileSizeBytes: null,
      stateAfterSubmission: 'Submitted',
      settlementRule: 'after_finance_confirmation',
      excessRule: 'confirmed_excess_to_wallet',
    },
    hash: 'a'.repeat(64),
  };
}

it('binds the response to the active profile without sending a profile selector', async () => {
  const fetch = vi.fn().mockResolvedValue(json(snapshot()));
  vi.stubGlobal('fetch', fetch);
  const { signal } = new AbortController();
  await expect(loadInvoiceBankReceiptSubmissionReview(reviewed, signal)).resolves.toEqual({
    kind: 'success',
    review: snapshot(),
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![0]).toBe(`/api/invoices/${reviewed.invoiceId}/bank-receipts/review`);
  const request = fetch.mock.calls[0]![1] as RequestInit;
  expect(request).toMatchObject({ method: 'POST', credentials: 'include', signal });
  expect(JSON.parse(String(request.body))).toEqual({
    amount: reviewed.amountIrR,
    paymentDate: reviewed.paymentDate,
    payerReference: reviewed.payerReference,
    attachmentKey: reviewed.attachmentKey,
  });
});

it.each([
  ['invoiceId', '33333333-3333-4333-8333-333333333333'],
  ['profileId', '33333333-3333-4333-8333-333333333333'],
  ['amountIrR', '9007199254740994'],
  ['paymentDate', '2026-09-02'],
  ['payerReference', 'other-reference'],
  ['bankName', 'Other bank'],
  ['attachmentKey', 'receipt/other.pdf'],
  ['customerNote', 'Other note'],
] as const)('rejects a valid-looking preview with a mismatched %s', async (field, value) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(json(snapshot({ ...reviewed, [field]: value })))
  );
  await expect(
    loadInvoiceBankReceiptSubmissionReview(reviewed, new AbortController().signal)
  ).resolves.toEqual({ kind: 'error', status: 409 });
});

it('rejects malformed reviews and preserves recognized validation fields', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json(null))
    .mockResolvedValueOnce(
      json(
        {
          error: { code: 'VALIDATION:INPUT:INVALID', fields: ['payerReference'] },
        },
        400
      )
    );
  vi.stubGlobal('fetch', fetch);
  const { signal } = new AbortController();
  await expect(loadInvoiceBankReceiptSubmissionReview(reviewed, signal)).resolves.toEqual({
    kind: 'error',
    status: 409,
  });
  await expect(loadInvoiceBankReceiptSubmissionReview(reviewed, signal)).resolves.toEqual({
    kind: 'error',
    status: 400,
    fields: ['payerReference'],
  });
});

it('preserves Arabic-Indic IRR digits and maps an unavailable service to a generic localized error', () => {
  expect(normalizeIrrAmountDigits('١٢٣٬٤٥٦')).toBe('123456');
  expect(mapInvoiceReceiptSubmitError(502)).toBe('generic');
});

it.each(['put', 'record'])(
  'never returns a usable attachment after the %s step fails',
  async (phase) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({ key: 'receipt/key.pdf', presignedUrl: 'https://storage.example.test/object' })
      );
    fetch.mockResolvedValueOnce(json({}, phase === 'put' ? 503 : 200));
    if (phase === 'record')
      fetch
        .mockResolvedValueOnce(json({ status: 'confirmed' }))
        .mockResolvedValueOnce(json({}, 503));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadInvoiceReceiptAttachment(
        new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }),
        'profile-1'
      )
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(phase === 'put' ? 2 : 4);
  }
);

it.each([null, [], 'unexpected', {}].map((body) => ({ body })))(
  'rejects malformed receipt acknowledgement $body without throwing',
  async ({ body }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)));
    await expect(submitInvoiceBankReceipt(receipt)).resolves.toEqual({ ok: false, status: 200 });
  }
);

it.each(
  [null, [], 'unexpected', {}, { activeProfileId: '' }, { activeProfileId: 42 }].map((body) => ({
    body,
  }))
)('rejects malformed active-profile response $body', async ({ body }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)));
  await expect(fetchActiveProfileId()).rejects.toThrow('Invalid active profile response');
});

it('distinguishes an empty profile selection from an unavailable profile service', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ activeProfileId: null }))
    .mockResolvedValueOnce(json({}, 503));
  vi.stubGlobal('fetch', fetch);
  const { signal } = new AbortController();
  await expect(fetchActiveProfileId(signal)).resolves.toBeNull();
  await expect(fetchActiveProfileId(signal)).rejects.toThrow('Active profile unavailable');
  expect(fetch).toHaveBeenCalledWith('/api/profiles', { credentials: 'include', signal });
});

it.each(['presign', 'verify'] as const)('stops the upload at a null %s response', async (phase) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      json(
        phase === 'presign'
          ? null
          : { key: 'receipt/key.pdf', presignedUrl: 'https://storage.example.test/object' }
      )
    );
  if (phase === 'verify') fetch.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(null));
  vi.stubGlobal('fetch', fetch);
  await expect(
    uploadInvoiceReceiptAttachment(
      new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }),
      'profile-1'
    )
  ).resolves.toBeNull();
  expect(fetch).toHaveBeenCalledTimes(phase === 'presign' ? 1 : 3);
});

it('preserves int8 IRR digits in the request and accepts only the same confirmed amount', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ state: 'Submitted', amount: receipt.amountIrR.toString() }))
    .mockResolvedValueOnce(json({ state: 'Submitted', amount: '9007199254740992' }));
  vi.stubGlobal('fetch', fetch);
  await expect(submitInvoiceBankReceipt(receipt)).resolves.toEqual({
    ok: true,
    state: 'Submitted',
    amount: receipt.amountIrR,
  });
  const [, init] = fetch.mock.calls[0]!;
  expect(JSON.parse(init.body)).toMatchObject({
    amount: '9007199254740993',
    attachmentKey: receipt.attachmentKey,
    expectedReviewHash: receipt.expectedReviewHash,
  });
  await expect(submitInvoiceBankReceipt(receipt)).resolves.toEqual({ ok: false, status: 200 });
});

it.each([400, 404, 409, 500])(
  'does not accept a success-shaped receipt response with HTTP %i',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ state: 'Submitted', amount: receipt.amountIrR.toString() }, status)
        )
    );
    await expect(submitInvoiceBankReceipt(receipt)).resolves.toEqual({ ok: false, status });
  }
);
