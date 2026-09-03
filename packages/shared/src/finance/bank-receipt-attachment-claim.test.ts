import { describe, expect, it } from 'vitest'
import {
  BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES,
  BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE,
  evaluateBankReceiptAttachmentClaim,
} from './bank-receipt-attachment-claim.js'

describe('bank-receipt attachment claim contract (T-04.3.01.02)', () => {
  it('enumerates wallet top-up and invoice receipt as the only claim types', () => {
    expect(BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES).toEqual(['wallet_topup', 'invoice_receipt'])
  })

  it('uses one advisory-lock namespace for both upload flows', () => {
    expect(BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE).toBe('bank-receipt-attachment')
  })
})

describe('evaluateBankReceiptAttachmentClaim (T-04.3.01.02)', () => {
  it('allows a same-flow retry', () => {
    expect(evaluateBankReceiptAttachmentClaim('wallet_topup', 'wallet_topup')).toEqual({
      ok: true,
    })
    expect(evaluateBankReceiptAttachmentClaim('invoice_receipt', 'invoice_receipt')).toEqual({
      ok: true,
    })
  })

  it('rejects a claim owned by the other flow', () => {
    expect(evaluateBankReceiptAttachmentClaim('wallet_topup', 'invoice_receipt')).toEqual({
      ok: false,
      reason: 'other_flow',
    })
    expect(evaluateBankReceiptAttachmentClaim('invoice_receipt', 'wallet_topup')).toEqual({
      ok: false,
      reason: 'other_flow',
    })
  })

  it('fails closed when the claim row is missing', () => {
    expect(evaluateBankReceiptAttachmentClaim(null, 'invoice_receipt')).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(evaluateBankReceiptAttachmentClaim(undefined, 'wallet_topup')).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(evaluateBankReceiptAttachmentClaim('', 'wallet_topup')).toEqual({
      ok: false,
      reason: 'missing',
    })
  })
})
