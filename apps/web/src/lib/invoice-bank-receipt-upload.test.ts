import { describe, expect, it } from 'vitest'
import {
  INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES,
  evaluateInvoiceBankReceiptClientFile,
  parseInvoiceBankReceiptAmountIrR,
} from '@barghsa/shared/finance'
import {
  isAllowedInvoiceReceiptFile,
  mapInvoiceReceiptSubmitError,
  normalizeIrrAmountDigits,
} from './invoice-bank-receipt-upload.js'

describe('invoice bank receipt upload helpers (T-04.3.01.02)', () => {
  it('maps localized digits and strips only well-formed thousands grouping', () => {
    expect(normalizeIrrAmountDigits('۲۵۰۰۰۰')).toBe('250000')
    expect(normalizeIrrAmountDigits('250,000')).toBe('250000')
    expect(normalizeIrrAmountDigits('۲۵۰٬۰۰۰')).toBe('250000')
    expect(normalizeIrrAmountDigits(' 1,234,567 ')).toBe('1234567')
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('۲۵۰٬۰۰۰'))).toBe(250_000n)
  })

  it('preserves decimals, signs, exponents, and letters so amount parse fails', () => {
    expect(normalizeIrrAmountDigits('12.5')).toBe('12.5')
    expect(normalizeIrrAmountDigits('12٫5')).toBe('12٫5')
    expect(normalizeIrrAmountDigits('12,5')).toBe('12,5')
    expect(normalizeIrrAmountDigits('-100')).toBe('-100')
    expect(normalizeIrrAmountDigits('+100')).toBe('+100')
    expect(normalizeIrrAmountDigits('1e3')).toBe('1e3')
    expect(normalizeIrrAmountDigits('1.5e2')).toBe('1.5e2')
    expect(normalizeIrrAmountDigits('abc12')).toBe('abc12')
    expect(normalizeIrrAmountDigits('12abc34')).toBe('12abc34')
    expect(normalizeIrrAmountDigits('IRR 250000')).toBe('IRR 250000')

    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('12.5'))).toBeNull()
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('1e3'))).toBeNull()
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('-100'))).toBeNull()
    expect(parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits('abc12'))).toBeNull()
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
