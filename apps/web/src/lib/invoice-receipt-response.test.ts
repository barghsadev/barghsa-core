import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchActiveProfileId,
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
};

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
)('treats malformed active-profile response $body as unavailable', async ({ body }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)));
  await expect(fetchActiveProfileId()).resolves.toBeNull();
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
