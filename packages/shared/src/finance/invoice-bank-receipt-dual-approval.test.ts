import { describe, expect, it } from 'vitest'
import { DUAL_APPROVAL_THRESHOLD_CONFIG_KEY } from './dual-approval-config.js'
import { shouldRequireDualApproval } from './approval-request.js'
import {
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REASON,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REJECTED_REASON,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT,
  invoiceBankReceiptDualApprovalDetails,
  invoiceBankReceiptReasonFromDualApprovalRejection,
  invoiceBankReceiptRequiresDualApproval,
  readInvoiceBankReceiptDualApprovalThreshold,
  receiptIdFromInvoiceBankReceiptDualApprovalDetails,
} from './invoice-bank-receipt-dual-approval.js'
import { BANK_RECEIPT_REJECT_REASON_MAX_LENGTH } from './wallet-bank-receipt-confirmation.js'

const RECEIPT_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const THRESHOLD = 100_000_000

describe('invoice bank receipt dual-approval contract (T-04.3.01.05)', () => {
  it('reuses the admin dual-approval threshold config key and bank-payment action', () => {
    expect(DUAL_APPROVAL_THRESHOLD_CONFIG_KEY).toBe('finance.dual_approval_threshold')
    expect(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE).toBe(
      'bank_payment_confirmation',
    )
    expect(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT).toBe(
      'invoice.bank_receipt.dual_approval_requested',
    )
    expect(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REASON).toBe(
      'Invoice bank receipt confirmation',
    )
  })

  it('names fail-closed errors for same-staff completion and corrupt config', () => {
    expect(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.SAME_STAFF()).toContain(
      'second, different finance staff',
    )
    expect(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.CONFIG_CORRUPT()).toContain(
      'invalid',
    )
    expect(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.APPROVAL_REJECTED()).toContain(
      'cannot restart',
    )
  })

  it('maps DualApprovalService review reasons onto a receipt rejection reason', () => {
    expect(invoiceBankReceiptReasonFromDualApprovalRejection(undefined)).toBe(
      INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REJECTED_REASON,
    )
    expect(invoiceBankReceiptReasonFromDualApprovalRejection(null)).toBe(
      INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REJECTED_REASON,
    )
    expect(invoiceBankReceiptReasonFromDualApprovalRejection('   ')).toBe(
      INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REJECTED_REASON,
    )
    expect(invoiceBankReceiptReasonFromDualApprovalRejection('  Payer mismatch  ')).toBe(
      'Payer mismatch',
    )
    const overlong = 'x'.repeat(BANK_RECEIPT_REJECT_REASON_MAX_LENGTH + 12)
    expect(invoiceBankReceiptReasonFromDualApprovalRejection(overlong)).toHaveLength(
      BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
    )
  })

  it('stores a stable details payload keyed by receiptId', () => {
    const details = invoiceBankReceiptDualApprovalDetails({
      receiptId: RECEIPT_ID,
      invoiceId: INVOICE_ID,
      profileId: PROFILE_ID,
    })
    expect(details).toEqual({
      receiptId: RECEIPT_ID,
      invoiceId: INVOICE_ID,
      profileId: PROFILE_ID,
      entityType: 'invoice_bank_receipt',
    })
    expect(receiptIdFromInvoiceBankReceiptDualApprovalDetails(details)).toBe(
      RECEIPT_ID,
    )
    expect(receiptIdFromInvoiceBankReceiptDualApprovalDetails(null)).toBeNull()
    expect(receiptIdFromInvoiceBankReceiptDualApprovalDetails({ invoiceId: INVOICE_ID })).toBeNull()
  })
})

describe('readInvoiceBankReceiptDualApprovalThreshold (T-04.3.01.05)', () => {
  it('treats a missing row as disabled', () => {
    expect(readInvoiceBankReceiptDualApprovalThreshold(undefined)).toEqual({
      status: 'disabled',
      thresholdIrR: 0,
    })
    expect(readInvoiceBankReceiptDualApprovalThreshold(null)).toEqual({
      status: 'disabled',
      thresholdIrR: 0,
    })
  })

  it('treats an explicit 0 as disabled', () => {
    expect(readInvoiceBankReceiptDualApprovalThreshold({ threshold_irr: 0 })).toEqual({
      status: 'disabled',
      thresholdIrR: 0,
    })
    expect(readInvoiceBankReceiptDualApprovalThreshold({ thresholdIrR: 0 })).toEqual({
      status: 'disabled',
      thresholdIrR: 0,
    })
  })

  it('accepts a positive safe-integer threshold', () => {
    expect(
      readInvoiceBankReceiptDualApprovalThreshold({ threshold_irr: THRESHOLD }),
    ).toEqual({ status: 'enabled', thresholdIrR: THRESHOLD })
  })

  it('marks present-but-invalid values corrupt rather than disabled', () => {
    expect(readInvoiceBankReceiptDualApprovalThreshold({ threshold_irr: -1 })).toEqual({
      status: 'corrupt',
    })
    expect(readInvoiceBankReceiptDualApprovalThreshold({ threshold_irr: 1.5 })).toEqual({
      status: 'corrupt',
    })
    expect(readInvoiceBankReceiptDualApprovalThreshold('100')).toEqual({
      status: 'corrupt',
    })
    expect(readInvoiceBankReceiptDualApprovalThreshold({ threshold_irr: '100' })).toEqual({
      status: 'corrupt',
    })
    expect(readInvoiceBankReceiptDualApprovalThreshold([])).toEqual({ status: 'corrupt' })
  })
})

describe('invoiceBankReceiptRequiresDualApproval (T-04.3.01.05)', () => {
  it('never requires approval when disabled', () => {
    expect(
      invoiceBankReceiptRequiresDualApproval(
        { status: 'disabled', thresholdIrR: 0 },
        999_999_999n,
      ),
    ).toBe(false)
  })

  it('requires approval at and above the threshold (unlike the generic > helper)', () => {
    const read = { status: 'enabled' as const, thresholdIrR: THRESHOLD }
    expect(invoiceBankReceiptRequiresDualApproval(read, BigInt(THRESHOLD - 1))).toBe(
      false,
    )
    expect(invoiceBankReceiptRequiresDualApproval(read, BigInt(THRESHOLD))).toBe(true)
    expect(invoiceBankReceiptRequiresDualApproval(read, BigInt(THRESHOLD + 1))).toBe(true)
    expect(shouldRequireDualApproval({ thresholdIrR: THRESHOLD }, THRESHOLD)).toBe(false)
  })

  it('does not require approval for a non-positive amount or a corrupt read', () => {
    const read = { status: 'enabled' as const, thresholdIrR: THRESHOLD }
    expect(invoiceBankReceiptRequiresDualApproval(read, 0n)).toBe(false)
    expect(
      invoiceBankReceiptRequiresDualApproval({ status: 'corrupt' }, BigInt(THRESHOLD)),
    ).toBe(false)
  })
})
