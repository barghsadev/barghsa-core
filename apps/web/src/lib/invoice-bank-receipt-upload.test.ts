import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES,
  evaluateInvoiceBankReceiptClientFile,
  parseInvoiceBankReceiptAmountIrR,
} from '@barghsa/shared/finance';
import {
  isAllowedInvoiceReceiptFile,
  mapInvoiceReceiptSubmitError,
  normalizeIrrAmountDigits,
  uploadInvoiceReceiptAttachment,
  uploadVerificationEvidence,
  uploadTicketAttachment,
  uploadLegalProfileDocument,
} from './invoice-bank-receipt-upload.js';

describe('invoice bank receipt upload helpers (T-04.3.01.02)', () => {
  it('maps localized digits and strips only well-formed thousands grouping', () => {
    expect(normalizeIrrAmountDigits('۲۵۰۰۰۰')).toBe('250000');
    expect(normalizeIrrAmountDigits('250,000')).toBe('250000');
    expect(normalizeIrrAmountDigits('۲۵۰٬۰۰۰')).toBe('250000');
    expect(normalizeIrrAmountDigits(' 1,234,567 ')).toBe('1234567');
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('۲۵۰٬۰۰۰'))).toBe(250_000n);
  });

  it('preserves decimals, signs, exponents, and letters so amount parse fails', () => {
    expect(normalizeIrrAmountDigits('12.5')).toBe('12.5');
    expect(normalizeIrrAmountDigits('12٫5')).toBe('12٫5');
    expect(normalizeIrrAmountDigits('12,5')).toBe('12,5');
    expect(normalizeIrrAmountDigits('-100')).toBe('-100');
    expect(normalizeIrrAmountDigits('+100')).toBe('+100');
    expect(normalizeIrrAmountDigits('1e3')).toBe('1e3');
    expect(normalizeIrrAmountDigits('1.5e2')).toBe('1.5e2');
    expect(normalizeIrrAmountDigits('abc12')).toBe('abc12');
    expect(normalizeIrrAmountDigits('12abc34')).toBe('12abc34');
    expect(normalizeIrrAmountDigits('IRR 250000')).toBe('IRR 250000');

    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('12.5'))).toBeNull();
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('1e3'))).toBeNull();
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('-100'))).toBeNull();
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('abc12'))).toBeNull();
  });

  it('accepts a PDF under the document cap and rejects oversize or exe files', () => {
    const pdf = new File(['%PDF'], 'slip.pdf', { type: 'application/pdf' });
    expect(isAllowedInvoiceReceiptFile(pdf)).toBe(true);
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'slip.pdf',
        type: 'application/pdf',
        size: INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES + 1,
      }).ok
    ).toBe(false);
    const exe = new File(['MZ'], 'slip.exe', { type: 'application/octet-stream' });
    expect(isAllowedInvoiceReceiptFile(exe)).toBe(false);
  });

  it('maps HTTP statuses to receipt error keys', () => {
    expect(mapInvoiceReceiptSubmitError(409)).toBe('conflict');
    expect(mapInvoiceReceiptSubmitError(404)).toBe('no-profile');
    expect(mapInvoiceReceiptSubmitError(400)).toBe('generic');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
for (const upload of [
  uploadInvoiceReceiptAttachment,
  uploadVerificationEvidence,
  uploadTicketAttachment,
  uploadLegalProfileDocument,
]) {
  it(`${upload.name} rejects a contradictory file before contacting storage`, async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    expect(
      await upload(new File(['fixture'], 'receipt.pdf', { type: 'image/jpeg' }), 'profile')
    ).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
}
for (const [extension, contentType] of [
  ['pdf', 'application/pdf'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]) {
  it(`presigns ${extension} with the correct MIME when the browser omits it`, async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal('fetch', request);
    expect(
      await uploadInvoiceReceiptAttachment(
        new File(['fixture'], `receipt.${extension}`, { type: '' }),
        'profile'
      )
    ).toBeNull();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]![0]).toBe('/api/upload/presigned-url');
    expect(JSON.parse(request.mock.calls[0]![1].body)).toMatchObject({ contentType });
  });
}

it('uses the same detected-name MIME for presign and object PUT when browser MIME is empty', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        key: 'uploads/image/fixture.png',
        presignedUrl: 'https://storage.example.test/fixture',
      })
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(Response.json({ status: 'confirmed' }))
    .mockResolvedValueOnce(Response.json({ id: 'record' }));
  vi.stubGlobal('fetch', request);
  expect(
    await uploadInvoiceReceiptAttachment(
      new File(['fixture'], 'receipt.png', { type: '' }),
      'profile'
    )
  ).toBe('uploads/image/fixture.png');
  expect(JSON.parse(request.mock.calls[0]![1].body)).toMatchObject({
    contentType: 'image/png',
    purpose: 'bank_receipt',
    profileId: 'profile',
  });
  expect(request.mock.calls[1]![1].headers).toEqual({
    'Content-Type': 'image/png',
    'If-None-Match': '*',
  });
  expect(JSON.parse(request.mock.calls[3]![1].body).contentType).toBe('image/png');
});

it('omits profileId for account-level ticket attachments, matching the upload API contract', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        key: 'uploads/document/ticket.pdf',
        presignedUrl: 'https://storage.example.test/ticket',
      })
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(Response.json({ status: 'confirmed' }))
    .mockImplementationOnce(async (_path, init) => {
      const body = JSON.parse(init.body);
      return Response.json(
        { status: 'recorded' },
        { status: body.profileId === undefined ? 200 : 400 }
      );
    });
  vi.stubGlobal('fetch', request);
  expect(
    await uploadTicketAttachment(
      new File(['%PDF'], 'ticket.pdf', { type: 'application/pdf' }),
      null
    )
  ).toBe('uploads/document/ticket.pdf');
  expect(JSON.parse(request.mock.calls[3]![1].body)).not.toHaveProperty('profileId');
});

const receiptFile = () => new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' });
const reservedUpload = () =>
  Response.json({
    key: 'uploads/document/receipt.pdf',
    presignedUrl: 'https://storage.example.test/receipt',
    expiresIn: 60,
  });

it.each([
  { step: 'reservation receipt', index: 0, milliseconds: 15_000 },
  { step: 'file transfer', index: 1, milliseconds: 60_000 },
  { step: 'verification receipt', index: 2, milliseconds: 15_000 },
  { step: 'storage record', index: 3, milliseconds: 15_000 },
])(
  'stops after a stalled $step without advancing or replaying the upload',
  async ({ index, milliseconds }) => {
    vi.useFakeTimers();
    const replies = [
      reservedUpload(),
      new Response(null, { status: 200 }),
      Response.json({ status: 'confirmed' }),
      Response.json({ status: 'recorded' }),
    ];
    let finish!: () => void;
    const request = vi.fn(async (_url: string, _options: RequestInit): Promise<Response> => {
      const step = request.mock.calls.length - 1;
      const reply = replies[step]!;
      if (step !== index) return reply;
      if (index === 0 || index === 2) {
        const body = await reply.json();
        return Object.assign(reply, {
          json: () =>
            new Promise<unknown>((resolve) => {
              finish = () => resolve(body);
            }),
        });
      }
      return new Promise((resolve) => {
        finish = () => resolve(reply);
      });
    });
    vi.stubGlobal('fetch', request);
    const pending = uploadInvoiceReceiptAttachment(receiptFile(), 'profile');
    const failure = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(milliseconds - 1);
    expect(request).toHaveBeenCalledTimes(index + 1);
    expect(request.mock.calls[index]![1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(request.mock.calls[index]![1].signal?.aborted).toBe(true);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(index + 1);
  }
);

it('accepts a file transfer longer than the metadata deadline and honors owner cancellation', async () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  let finish!: (response: Response) => void;
  const request = vi
    .fn<(path: string, options: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(reservedUpload())
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockResolvedValueOnce(Response.json({ status: 'confirmed' }))
    .mockResolvedValueOnce(Response.json({ status: 'recorded' }))
    .mockResolvedValueOnce(reservedUpload())
    .mockImplementationOnce(() => new Promise(() => {}));
  vi.stubGlobal('fetch', request);
  const slow = uploadInvoiceReceiptAttachment(receiptFile(), 'profile', owner.signal);
  await vi.advanceTimersByTimeAsync(16_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]![1].signal?.aborted).toBe(false);
  finish(new Response(null, { status: 200 }));
  await expect(slow).resolves.toBe('uploads/document/receipt.pdf');
  const pending = uploadInvoiceReceiptAttachment(receiptFile(), 'profile', owner.signal);
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledTimes(6);
  owner.abort();
  await cancelled;
  expect(request.mock.calls[5]![1].signal?.aborted).toBe(true);
  expect(request).toHaveBeenCalledTimes(6);
});
