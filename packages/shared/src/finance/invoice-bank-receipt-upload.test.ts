import { describe, expect, it } from 'vitest';
import {
  INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES,
  INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES,
  canCustomerSubmitInvoiceBankReceipt,
  evaluateInvoiceBankReceiptClientFile,
  evaluateInvoiceBankReceiptStoredFile,
  invoiceBankReceiptAttachmentKeysMatch,
  invoiceBankReceiptCategoryFromClientFile,
  invoiceBankReceiptDetailsMatch,
  parseInvoiceBankReceiptAmountIrR,
  parsePositiveByteCount,
  invoiceBankReceiptLookupKeys,
  invoiceBankReceiptContentTypeFromName,
  parseInvoiceBankReceiptSubmission,
  sealedInvoiceBankReceiptAttachmentKey,
} from './invoice-bank-receipt-upload.js';
import { parseOnlineTopUpAmountIrR } from './wallet-topup-config.js';

const TODAY = '2026-09-01';
const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf';
const IMAGE_KEY = 'uploads/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: 250_000,
    paymentDate: '2026-08-15',
    payerReference: 'TRK-998877',
    attachmentKey: ATTACHMENT,
    customerNote: 'Branch transfer',
    ...overrides,
  };
}

describe('parseInvoiceBankReceiptAmountIrR (T-04.3.01.02)', () => {
  it('accepts a positive int8 amount and rejects zero or negative', () => {
    expect(parseInvoiceBankReceiptAmountIrR(1)).toBe(1n);
    expect(parseInvoiceBankReceiptAmountIrR('250000')).toBe(250_000n);
    expect(parseOnlineTopUpAmountIrR(2_000_000_001)).toBe(2_000_000_001n);
    expect(parseInvoiceBankReceiptAmountIrR(2_000_000_001)).toBe(2_000_000_001n);
    expect(parseInvoiceBankReceiptAmountIrR(0)).toBeNull();
    expect(parseInvoiceBankReceiptAmountIrR(-1)).toBeNull();
    expect(parseInvoiceBankReceiptAmountIrR('0')).toBeNull();
  });
});

describe('evaluateInvoiceBankReceiptClientFile (T-04.3.01.02)', () => {
  it('accepts a PDF under the document cap and a JPEG under the image cap', () => {
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'slip.pdf',
        type: 'application/pdf',
        size: 1024,
      })
    ).toEqual({ ok: true, category: 'document', fileSize: 1024 });
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'slip.jpg',
        type: 'image/jpeg',
        size: INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES,
      })
    ).toEqual({
      ok: true,
      category: 'image',
      fileSize: INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES,
    });
  });

  it('rejects disallowed types, empty files, and oversize files', () => {
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'virus.exe',
        type: 'application/octet-stream',
        size: 12,
      })
    ).toEqual({ ok: false, reason: 'type' });
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'clip.mp4',
        type: 'video/mp4',
        size: 12,
      })
    ).toEqual({ ok: false, reason: 'type' });
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'empty.pdf',
        type: 'application/pdf',
        size: 0,
      })
    ).toEqual({ ok: false, reason: 'empty' });
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'huge.pdf',
        type: 'application/pdf',
        size: INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES + 1,
      })
    ).toEqual({ ok: false, reason: 'size' });
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'huge.png',
        type: 'image/png',
        size: INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES + 1,
      })
    ).toEqual({ ok: false, reason: 'size' });
  });
});

describe('evaluateInvoiceBankReceiptStoredFile (T-04.3.01.02)', () => {
  it('accepts a matching PDF storage record', () => {
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 4096,
        contentType: 'application/pdf',
        category: 'document',
        fileName: 'slip.pdf',
      })
    ).toEqual({ ok: true, category: 'document', fileSize: 4096 });
  });

  it('fails closed on missing or zero size', () => {
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: null,
      })
    ).toEqual({ ok: false, reason: 'empty' });
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 0,
      })
    ).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects MIME/category/name that disagree with the key, and oversize', () => {
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 100,
        contentType: 'image/jpeg',
      })
    ).toEqual({ ok: false, reason: 'type' });
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 100,
        category: 'image',
      })
    ).toEqual({ ok: false, reason: 'type' });
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: IMAGE_KEY,
        fileSize: 100,
        fileName: 'not-an-image.pdf',
      })
    ).toEqual({ ok: false, reason: 'type' });
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES + 1,
        contentType: 'application/pdf',
      })
    ).toEqual({ ok: false, reason: 'size' });
  });
});

describe('canCustomerSubmitInvoiceBankReceipt (T-04.3.01.02)', () => {
  it('allows Unpaid, PaymentUnderReview, and PartiallyFunded charge invoices', () => {
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Unpaid' })).toBe(true);
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'PaymentUnderReview' })).toBe(true);
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'PartiallyFunded' })).toBe(true);
  });

  it('rejects terminal, overdue, draft, and credit-note invoices', () => {
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Paid' })).toBe(false);
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Cancelled' })).toBe(false);
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Overdue' })).toBe(true);
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Draft' })).toBe(false);
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Unpaid', adjustmentKind: 'credit' })).toBe(
      false
    );
  });
});

describe('parseInvoiceBankReceiptSubmission (T-04.3.01.02)', () => {
  it('accepts a complete receipt payload', () => {
    expect(parseInvoiceBankReceiptSubmission(validBody(), TODAY)).toEqual({
      ok: true,
      amountIrR: 250_000n,
      receipt: {
        paymentDate: '2026-08-15',
        payerReference: 'TRK-998877',
        attachmentKey: ATTACHMENT,
        customerNote: 'Branch transfer',
      },
    });
  });

  it('fails closed on zero amount and disallowed attachment extensions', () => {
    expect(parseInvoiceBankReceiptSubmission(validBody({ amount: 0 }), TODAY)).toMatchObject({
      ok: false,
      field: 'amount',
    });
    expect(
      parseInvoiceBankReceiptSubmission(
        validBody({
          attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.exe',
        }),
        TODAY
      )
    ).toMatchObject({ ok: false, field: 'attachmentKey' });
  });
});

describe('invoiceBankReceiptCategoryFromClientFile (T-04.3.01.02)', () => {
  it('maps PDF to document and photos to image', () => {
    expect(
      invoiceBankReceiptCategoryFromClientFile({ name: 'a.pdf', type: 'application/pdf' })
    ).toBe('document');
    expect(invoiceBankReceiptCategoryFromClientFile({ name: 'a.webp', type: 'image/webp' })).toBe(
      'image'
    );
    expect(invoiceBankReceiptCategoryFromClientFile({ name: 'a.gif', type: 'image/gif' })).toBe(
      null
    );
  });
});

describe('sealedInvoiceBankReceiptAttachmentKey (T-04.3.01.02)', () => {
  it('maps a presigned upload key to a server-only submitted prefix', () => {
    expect(sealedInvoiceBankReceiptAttachmentKey(ATTACHMENT)).toBe(
      'receipts/submitted/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
    );
    expect(
      invoiceBankReceiptAttachmentKeysMatch(
        'receipts/submitted/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
        ATTACHMENT
      )
    ).toBe(true);
    expect(sealedInvoiceBankReceiptAttachmentKey('uploads/document/../secret.pdf')).toBeNull();
  });

  it('treats a sealed stored key as the same receipt as the original upload', () => {
    expect(
      invoiceBankReceiptDetailsMatch(
        {
          amount: 250_000,
          paymentDate: '2026-08-15',
          payerReference: 'TRK-998877',
          attachmentKey: 'receipts/submitted/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
          customerNote: 'Branch transfer',
        },
        250_000n,
        {
          paymentDate: '2026-08-15',
          payerReference: 'TRK-998877',
          attachmentKey: ATTACHMENT,
          customerNote: 'Branch transfer',
        }
      )
    ).toBe(true);
  });
});

for (const input of [
  { name: 'receipt.pdf', type: 'image/jpeg' },
  { name: 'receipt.png', type: 'image/jpeg' },
  { name: 'receipt.exe', type: 'application/pdf' },
  { name: 'receipt.pdf', type: 'application/octet-stream' },
  { name: 1, type: 'application/pdf' },
  { name: 'receipt.pdf', type: [] },
]) {
  it(`rejects contradictory client file identity ${JSON.stringify(input)}`, () => {
    expect(evaluateInvoiceBankReceiptClientFile({ ...input, size: 10 })).toEqual({
      ok: false,
      reason: 'type',
    });
  });
}
for (const attachmentKey of [
  'uploads/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
  'uploads/document/not-an-issued-upload.pdf',
]) {
  it(`rejects invalid stored upload identity without optional metadata: ${attachmentKey}`, () => {
    expect(evaluateInvoiceBankReceiptStoredFile({ attachmentKey, fileSize: 10 })).toEqual({
      ok: false,
      reason: 'type',
    });
  });
}
for (const field of ['category', 'contentType', 'fileName'] as const) {
  it(`rejects malformed declared storage ${field}`, () => {
    expect(
      evaluateInvoiceBankReceiptStoredFile({ attachmentKey: ATTACHMENT, fileSize: 10, [field]: 3 })
    ).toEqual({ ok: false, reason: 'type' });
  });
}
for (const [name, type, category] of [
  ['SCAN.PDF', 'APPLICATION/PDF', 'document'],
  ['photo.jpg', 'image/jpeg', 'image'],
  ['photo.jpeg', 'image/jpeg', 'image'],
  ['photo.png', 'image/png', 'image'],
  ['photo.webp', 'image/webp', 'image'],
  ['scan.pdf', '', 'document'],
]) {
  it(`accepts matching supported file ${name} with MIME ${type}`, () => {
    expect(evaluateInvoiceBankReceiptClientFile({ name, type, size: 1 })).toEqual({
      ok: true,
      category,
      fileSize: 1,
    });
  });
}

for (const value of [
  0,
  0n,
  -1,
  -1n,
  1.5,
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
  BigInt(Number.MAX_SAFE_INTEGER) + 1n,
  '9007199254740992',
  '',
  '01',
  '1e3',
  '1.0',
  '-1',
  true,
  null,
  undefined,
  {},
]) {
  it(`rejects unsafe or noncanonical byte count ${String(value)} (${typeof value})`, () => {
    expect(parsePositiveByteCount(value)).toBeNull();
  });
}
for (const value of [
  1,
  1n,
  '1',
  ' 1 ',
  Number.MAX_SAFE_INTEGER,
  BigInt(Number.MAX_SAFE_INTEGER),
  String(Number.MAX_SAFE_INTEGER),
]) {
  it(`preserves positive safe byte count ${String(value)} (${typeof value})`, () => {
    expect(parsePositiveByteCount(value)).toBe(Number(value));
  });
}
for (const [field, value] of [
  ['amount', null],
  ['paymentDate', '2026-09-02'],
  ['payerReference', ''],
  ['attachmentKey', 'uploads/document/../secret.pdf'],
  ['customerNote', 'x'.repeat(2001)],
] as const) {
  it(`reports the invalid submission field ${field}`, () => {
    expect(parseInvoiceBankReceiptSubmission(validBody({ [field]: value }), TODAY)).toMatchObject({
      ok: false,
      field,
    });
  });
}
it('rejects non-object submissions and retains only legitimate receipt lookup identities', () => {
  expect(parseInvoiceBankReceiptSubmission(null, TODAY)).toMatchObject({
    ok: false,
    field: 'amount',
  });
  expect(invoiceBankReceiptLookupKeys(ATTACHMENT)).toEqual([
    ATTACHMENT,
    'receipts/submitted/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  ]);
  expect(invoiceBankReceiptLookupKeys('untrusted')).toEqual(['untrusted']);
});

it('does not infer media types for invalid or unsupported names', () => {
  for (const name of [undefined, 1, '', '.pdf', 'script.js', 'receipt']) {
    expect(invoiceBankReceiptContentTypeFromName(name)).toBeNull();
  }
});
