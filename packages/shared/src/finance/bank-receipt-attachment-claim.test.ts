import { describe, expect, it } from 'vitest'
import {
  BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES,
  BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE,
  bankReceiptAttachmentAdvisoryLockKeys,
  evaluateBankReceiptAttachmentClaim,
} from './bank-receipt-attachment-claim.js'

const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'

describe('bank-receipt attachment claim contract (T-04.3.01.02)', () => {
  it('enumerates wallet top-up and invoice receipt as the only claim types', () => {
    expect(BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES).toEqual(['wallet_topup', 'invoice_receipt'])
  })

  it('uses one advisory-lock namespace for both upload flows', () => {
    expect(BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE).toBe('bank-receipt-attachment')
  })

  it('derives a stable lock pair so wallet and invoice serialize on the same key', () => {
    const wallet = bankReceiptAttachmentAdvisoryLockKeys(ATTACHMENT)
    const invoice = bankReceiptAttachmentAdvisoryLockKeys(ATTACHMENT)
    expect(wallet).toEqual(invoice)
    expect(wallet).toHaveLength(2)
    expect(Number.isInteger(wallet[0])).toBe(true)
    expect(Number.isInteger(wallet[1])).toBe(true)
  })

  it('does not collide lock pairs across different attachment keys', () => {
    const other = 'uploads/document/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf'
    expect(bankReceiptAttachmentAdvisoryLockKeys(ATTACHMENT)).not.toEqual(
      bankReceiptAttachmentAdvisoryLockKeys(other),
    )
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
