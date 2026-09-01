import { describe, expect, it } from 'vitest'
import { parseOnlineTopUpAmountIrR } from './wallet-topup-config.js'
import {
  BANK_RECEIPT_STORAGE_PURPOSE,
  BANK_RECEIPT_TOPUP_CHANNEL,
  bankReceiptStorageProvenance,
  bankReceiptTopUpMetadata,
  evaluateBankReceiptStorageMetadata,
  isBankReceiptTopUpMetadata,
  parseBankReceiptAttachmentKey,
  parseBankReceiptCustomerNote,
  parseBankReceiptPaymentDate,
  parseBankReceiptPayerReference,
  parseBankReceiptTopUpAmountIrR,
  parseBankReceiptTopUpSubmission,
  receiptDetailsMatch,
} from './wallet-bank-receipt-topup.js'

const TODAY = '2026-09-01'
const ATTACHMENT =
  'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'

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

describe('parseBankReceiptTopUpAmountIrR (T-04.2.02.03)', () => {
  it('accepts the same positive int8 amounts as the online parser, including above the online limit', () => {
    expect(parseBankReceiptTopUpAmountIrR(2_000_000_001)).toBe(2_000_000_001n)
    expect(parseOnlineTopUpAmountIrR(2_000_000_001)).toBe(2_000_000_001n)
    expect(parseBankReceiptTopUpAmountIrR(0)).toBeNull()
    expect(parseBankReceiptTopUpAmountIrR(-1)).toBeNull()
  })
})

describe('parseBankReceiptPaymentDate (T-04.2.02.03)', () => {
  it('accepts a real calendar date on or before today', () => {
    expect(parseBankReceiptPaymentDate('2026-08-15', TODAY)).toBe('2026-08-15')
    expect(parseBankReceiptPaymentDate('2026-09-01', TODAY)).toBe('2026-09-01')
  })

  it('rejects future dates, impossible days, and non-ISO values', () => {
    expect(parseBankReceiptPaymentDate('2026-09-02', TODAY)).toBeNull()
    expect(parseBankReceiptPaymentDate('2026-02-31', TODAY)).toBeNull()
    expect(parseBankReceiptPaymentDate('15/08/2026', TODAY)).toBeNull()
    expect(parseBankReceiptPaymentDate(20260815, TODAY)).toBeNull()
  })
})

describe('parseBankReceiptPayerReference (T-04.2.02.03)', () => {
  it('trims a non-empty reference', () => {
    expect(parseBankReceiptPayerReference('  TRK-1  ')).toBe('TRK-1')
  })

  it('rejects blank, oversized, or control-character values', () => {
    expect(parseBankReceiptPayerReference('')).toBeNull()
    expect(parseBankReceiptPayerReference('   ')).toBeNull()
    expect(parseBankReceiptPayerReference('x'.repeat(129))).toBeNull()
    expect(parseBankReceiptPayerReference('bad\nref')).toBeNull()
  })
})

describe('parseBankReceiptAttachmentKey (T-04.2.02.03)', () => {
  it('accepts document and image keys with permitted extensions', () => {
    expect(parseBankReceiptAttachmentKey(ATTACHMENT)).toBe(ATTACHMENT)
    expect(
      parseBankReceiptAttachmentKey(
        'uploads/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
      ),
    ).toBe('uploads/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg')
  })

  it('rejects traversal, other categories, and disallowed extensions', () => {
    expect(parseBankReceiptAttachmentKey('uploads/document/../secret.pdf')).toBeNull()
    expect(
      parseBankReceiptAttachmentKey(
        'uploads/video/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      ),
    ).toBeNull()
    expect(
      parseBankReceiptAttachmentKey(
        'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.exe',
      ),
    ).toBeNull()
    expect(parseBankReceiptAttachmentKey('uploads/document/not-a-uuid.pdf')).toBeNull()
  })
})

describe('parseBankReceiptCustomerNote (T-04.2.02.03)', () => {
  it('treats missing or blank notes as null', () => {
    expect(parseBankReceiptCustomerNote(undefined)).toBeNull()
    expect(parseBankReceiptCustomerNote(null)).toBeNull()
    expect(parseBankReceiptCustomerNote('  ')).toBeNull()
    expect(parseBankReceiptCustomerNote('please confirm')).toBe('please confirm')
  })

  it('rejects oversized or non-string notes', () => {
    expect(parseBankReceiptCustomerNote('x'.repeat(2001))).toBeUndefined()
    expect(parseBankReceiptCustomerNote(12)).toBeUndefined()
  })
})

describe('parseBankReceiptTopUpSubmission (T-04.2.02.03)', () => {
  it('accepts a complete receipt payload and does not cap the amount', () => {
    const parsed = parseBankReceiptTopUpSubmission(
      validBody({ amount: 3_000_000_000 }),
      TODAY,
    )
    expect(parsed).toEqual({
      ok: true,
      amountIrR: 3_000_000_000n,
      receipt: {
        paymentDate: '2026-08-15',
        payerReference: 'TRK-998877',
        attachmentKey: ATTACHMENT,
        customerNote: 'Branch transfer',
      },
    })
  })

  it('fails closed on each required field', () => {
    expect(parseBankReceiptTopUpSubmission(validBody({ amount: 0 }), TODAY)).toMatchObject({
      ok: false,
      field: 'amount',
    })
    expect(
      parseBankReceiptTopUpSubmission(validBody({ paymentDate: '2026-09-02' }), TODAY),
    ).toMatchObject({ ok: false, field: 'paymentDate' })
    expect(
      parseBankReceiptTopUpSubmission(validBody({ payerReference: '' }), TODAY),
    ).toMatchObject({ ok: false, field: 'payerReference' })
    expect(
      parseBankReceiptTopUpSubmission(validBody({ attachmentKey: 'nope' }), TODAY),
    ).toMatchObject({ ok: false, field: 'attachmentKey' })
  })
})

describe('bank receipt metadata helpers (T-04.2.02.03)', () => {
  it('round-trips receipt details under the bank_receipt channel', () => {
    const receipt = {
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey: ATTACHMENT,
      customerNote: null,
    }
    const metadata = bankReceiptTopUpMetadata(receipt)
    expect(metadata.channel).toBe(BANK_RECEIPT_TOPUP_CHANNEL)
    expect(isBankReceiptTopUpMetadata(metadata)).toBe(true)
    expect(receiptDetailsMatch(metadata, receipt)).toBe(true)
    expect(
      receiptDetailsMatch(metadata, { ...receipt, payerReference: 'other' }),
    ).toBe(false)
    expect(isBankReceiptTopUpMetadata({ channel: 'online' })).toBe(false)
  })
})

describe('evaluateBankReceiptStorageMetadata (T-04.2.02.03)', () => {
  const actorId = 'user-1'
  const profileId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
  const valid = bankReceiptStorageProvenance({ uploadedBy: actorId, profileId })

  it('accepts a verified receipt owned by the actor', () => {
    expect(evaluateBankReceiptStorageMetadata(valid, actorId, profileId)).toEqual({ ok: true })
  })

  it('accepts a verified receipt bound to the accessible profile', () => {
    expect(
      evaluateBankReceiptStorageMetadata(
        { ...valid, uploadedBy: 'other-user' },
        actorId,
        profileId,
      ),
    ).toEqual({ ok: true })
  })

  it('rejects missing, unverified, wrong-purpose, and wrong-owner metadata', () => {
    expect(evaluateBankReceiptStorageMetadata(null, actorId, profileId)).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(
      evaluateBankReceiptStorageMetadata({ ...valid, verified: false }, actorId, profileId),
    ).toEqual({ ok: false, reason: 'unverified' })
    expect(
      evaluateBankReceiptStorageMetadata({ ...valid, purpose: 'contract' }, actorId, profileId),
    ).toEqual({ ok: false, reason: 'wrong_purpose' })
    expect(
      evaluateBankReceiptStorageMetadata(
        { ...valid, uploadedBy: 'other-user', profileId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb' },
        actorId,
        profileId,
      ),
    ).toEqual({ ok: false, reason: 'wrong_owner' })
  })

  it('uses the bank_receipt storage purpose constant', () => {
    expect(valid.purpose).toBe(BANK_RECEIPT_STORAGE_PURPOSE)
    expect(BANK_RECEIPT_STORAGE_PURPOSE).toBe('bank_receipt')
  })
})
