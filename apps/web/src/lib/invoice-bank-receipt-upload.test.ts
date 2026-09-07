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

afterEach(() => vi.unstubAllGlobals());
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
  expect(JSON.parse(request.mock.calls[0]![1].body).contentType).toBe('image/png');
  expect(request.mock.calls[1]![1].headers).toEqual({ 'Content-Type': 'image/png' });
  expect(JSON.parse(request.mock.calls[3]![1].body).contentType).toBe('image/png');
});
