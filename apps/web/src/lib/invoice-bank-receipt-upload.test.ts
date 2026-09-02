import { describe, expect, it } from 'vitest'
import {
  INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES,
  evaluateInvoiceBankReceiptClientFile,
} from '@barghsa/shared/finance'
import {
  isAllowedInvoiceReceiptFile,
  mapInvoiceReceiptSubmitError,
  normalizeIrrAmountDigits,
} from './invoice-bank-receipt-upload.js'

describe('invoice bank receipt upload helpers (T-04.3.01.02)', () => {
  it('normalizes Persian digits to ASCII IRR amounts', () => {
    expect(normalizeIrrAmountDigits('۲۵۰۰۰۰')).toBe('250000')
    expect(normalizeIrrAmountDigits('250,000')).toBe('250000')
  })

  it('accepts a PDF under the document cap and rejects oversize or exe files', () => {
    const pdf = new File(['%PDF'], 'slip.pdf', { type: 'application/pdf' })
    expect(isAllowedInvoiceReceiptFile(pdf)).toBe(true)
    expect(
      evaluateInvoiceBankReceiptClientFile({
        name: 'slip.pdf',
        type: 'application/pdf',
        size: INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES + 1,
      }).ok,
    ).toBe(false)
    const exe = new File(['MZ'], 'slip.exe', { type: 'application/octet-stream' })
    expect(isAllowedInvoiceReceiptFile(exe)).toBe(false)
  })

  it('maps HTTP statuses to receipt error keys', () => {
    expect(mapInvoiceReceiptSubmitError(409)).toBe('conflict')
    expect(mapInvoiceReceiptSubmitError(404)).toBe('no-profile')
    expect(mapInvoiceReceiptSubmitError(400)).toBe('generic')
  })
})
