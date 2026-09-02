import { describe, expect, it } from 'vitest'
import {
  INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES,
  INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES,
  canCustomerSubmitInvoiceBankReceipt,
  evaluateInvoiceBankReceiptClientFile,
  evaluateInvoiceBankReceiptStoredFile,
  invoiceBankReceiptCategoryFromClientFile,
  parseInvoiceBankReceiptAmountIrR,
  parseInvoiceBankReceiptSubmission,
} from './invoice-bank-receipt-upload.js'
import { parseOnlineTopUpAmountIrR } from './wallet-topup-config.js'

const TODAY = '2026-09-01'
const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
const IMAGE_KEY = 'uploads/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: 250_000,
    paymentDate: '2026-08-15',
    payerReference: 'TRK-998877',
    attachmentKey: ATTACHMENT,
    customerNote: 'Branch transfer',
    ...overrides,
  }
}

describe('parseInvoiceBankReceiptAmountIrR (T-04.3.01.02)', () => {
  it('accepts a positive int8 amount and rejects zero or negative', () => {
    expect(parseInvoiceBankReceiptAmountIrR(1)).toBe(1n)
    expect(parseInvoiceBankReceiptAmountIrR('250000')).toBe(250_000n)
    expect(parseOnlineTopUpAmountIrR(2_000_000_001)).toBe(2_000_000_001n)
    expect(parseInvoiceBankReceiptAmountIrR(2_000_000_001)).toBe(2_000_000_001n)
    expect(parseInvoiceBankReceiptAmountIrR(0)).toBeNull()
    expect(parseInvoiceBankReceiptAmountIrR(-1)).toBeNull()
    expect(parseInvoiceBankReceiptAmountIrR('0')).toBeNull()
  })
})

describe('evaluateInvoiceBankReceiptClientFile (T-04.3.01.02)', () => {
  it('accepts a PDF under the document cap and a JPEG under the image cap', () => {
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'slip.pdf',
        type: 'application/pdf',
        size: 1024,
      }),
    ).toEqual({ ok: true, category: 'document', fileSize: 1024 })
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'slip.jpg',
        type: 'image/jpeg',
        size: INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES,
      }),
    ).toEqual({
      ok: true,
      category: 'image',
      fileSize: INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES,
    })
  })

  it('rejects disallowed types, empty files, and oversize files', () => {
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'virus.exe',
        type: 'application/octet-stream',
        size: 12,
      }),
    ).toEqual({ ok: false, reason: 'type' })
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'clip.mp4',
        type: 'video/mp4',
        size: 12,
      }),
    ).toEqual({ ok: false, reason: 'type' })
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'empty.pdf',
        type: 'application/pdf',
        size: 0,
      }),
    ).toEqual({ ok: false, reason: 'empty' })
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'huge.pdf',
        type: 'application/pdf',
        size: INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: 'size' })
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'huge.png',
        type: 'image/png',
        size: INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: 'size' })
  })
})

describe('evaluateInvoiceBankReceiptStoredFile (T-04.3.01.02)', () => {
  it('accepts a matching PDF storage record', () => {
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 4096,
        contentType: 'application/pdf',
        category: 'document',
        fileName: 'slip.pdf',
      }),
    ).toEqual({ ok: true, category: 'document', fileSize: 4096 })
  })

  it('fails closed on missing or zero size', () => {
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: null,
      }),
    ).toEqual({ ok: false, reason: 'empty' })
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 0,
      }),
    ).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects MIME/category/name that disagree with the key, and oversize', () => {
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 100,
        contentType: 'image/jpeg',
      }),
    ).toEqual({ ok: false, reason: 'type' })
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: 100,
        category: 'image',
      }),
    ).toEqual({ ok: false, reason: 'type' })
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: IMAGE_KEY,
        fileSize: 100,
        fileName: 'not-an-image.pdf',
      }),
    ).toEqual({ ok: false, reason: 'type' })
    expect(
      evaluateInvoiceBankReceiptStoredFile({
        attachmentKey: ATTACHMENT,
        fileSize: INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES + 1,
        contentType: 'application/pdf',
      }),
    ).toEqual({ ok: false, reason: 'size' })
  })
})

describe('canCustomerSubmitInvoiceBankReceipt (T-04.3.01.02)', () => {
  it('allows Unpaid, PaymentUnderReview, and PartiallyFunded charge invoices', () => {
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Unpaid' })).toBe(true)
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'PaymentUnderReview' })).toBe(true)
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'PartiallyFunded' })).toBe(true)
  })

  it('rejects terminal, overdue, draft, and credit-note invoices', () => {
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Paid' })).toBe(false)
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Cancelled' })).toBe(false)
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Overdue' })).toBe(false)
    expect(canCustomerSubmitInvoiceBankReceipt({ state: 'Draft' })).toBe(false)
    expect(
      canCustomerSubmitInvoiceBankReceipt({ state: 'Unpaid', adjustmentKind: 'credit' }),
    ).toBe(false)
  })
})

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
    })
  })

  it('fails closed on zero amount and disallowed attachment extensions', () => {
    expect(parseInvoiceBankReceiptSubmission(validBody({ amount: 0 }), TODAY)).toMatchObject({
      ok: false,
      field: 'amount',
    })
    expect(
      parseInvoiceBankReceiptSubmission(
        validBody({
          attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.exe',
        }),
        TODAY,
      ),
    ).toMatchObject({ ok: false, field: 'attachmentKey' })
  })
})

describe('invoiceBankReceiptCategoryFromClientFile (T-04.3.01.02)', () => {
  it('maps PDF to document and photos to image', () => {
    expect(
      invoiceBankReceiptCategoryFromClientFile({ name: 'a.pdf', type: 'application/pdf' }),
    ).toBe('document')
    expect(
      invoiceBankReceiptCategoryFromClientFile({ name: 'a.webp', type: 'image/webp' }),
    ).toBe('image')
    expect(invoiceBankReceiptCategoryFromClientFile({ name: 'a.gif', type: 'image/gif' })).toBe(
      null,
    )
  })
})
