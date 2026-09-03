import { describe, expect, it } from 'vitest'
import { BANK_RECEIPT_TOPUP_CHANNEL } from './wallet-bank-receipt-topup.js'
import {
  BANK_RECEIPT_CONFIRM_ERRORS,
  BANK_RECEIPT_CONFIRM_PERMISSION,
  BANK_RECEIPT_CONFIRMED_EVENT,
  BANK_RECEIPT_CREDIT_DESCRIPTION,
  BANK_RECEIPT_CUSTOMER_WALLET_ROUTE,
  BANK_RECEIPT_NOTIFY_CHANNELS,
  BANK_RECEIPT_REJECTED_EVENT,
  BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
  BANK_RECEIPT_TOPUP_COMPLETED_NOTIFICATION_EVENT_KEY,
  BANK_RECEIPT_TOPUP_FAILED_NOTIFICATION_EVENT_KEY,
  bankReceiptCreditIdempotencyKey,
  bankReceiptCreditMetadata,
  bankReceiptStaffDecisionMetadata,
  bankReceiptTopUpCompletedNotificationIdempotencyKey,
  bankReceiptTopUpFailedNotificationIdempotencyKey,
  buildBankReceiptTopUpCompletedNotificationPayload,
  buildBankReceiptTopUpFailedNotificationPayload,
  isPendingBankReceiptTopUp,
  parseBankReceiptRejectReason,
  readBankReceiptStaffDecision,
} from './wallet-bank-receipt-confirmation.js'

const PENDING_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'

describe('bank receipt staff confirmation contract (T-04.2.02.04)', () => {
  it('uses a finance permission distinct from invoice override', () => {
    expect(BANK_RECEIPT_CONFIRM_PERMISSION).toBe(
      'admin:finance:wallet:bank-receipt-confirm',
    )
  })

  it('derives a stable credit idempotency key from the pending id', () => {
    expect(bankReceiptCreditIdempotencyKey(PENDING_ID)).toBe(
      `wallet-bank-receipt-topup-credit:${PENDING_ID}`,
    )
  })

  it('names audit events for confirm and reject', () => {
    expect(BANK_RECEIPT_CONFIRMED_EVENT).toBe('wallet.bank_receipt.confirmed')
    expect(BANK_RECEIPT_REJECTED_EVENT).toBe('wallet.bank_receipt.rejected')
    expect(BANK_RECEIPT_CREDIT_DESCRIPTION).toBe('Bank receipt wallet top-up')
  })

  it('keys customer notices per pending receipt and deep-links the wallet', () => {
    expect(BANK_RECEIPT_TOPUP_COMPLETED_NOTIFICATION_EVENT_KEY).toBe(
      'payment.wallet_topup_completed',
    )
    expect(BANK_RECEIPT_TOPUP_FAILED_NOTIFICATION_EVENT_KEY).toBe(
      'payment.wallet_topup_failed',
    )
    expect(BANK_RECEIPT_NOTIFY_CHANNELS).toEqual(['in_app', 'email'])
    expect(BANK_RECEIPT_CUSTOMER_WALLET_ROUTE).toBe('/wallet')
    expect(bankReceiptTopUpCompletedNotificationIdempotencyKey(PENDING_ID)).toBe(
      `payment.wallet_topup_completed:${PENDING_ID}`,
    )
    expect(bankReceiptTopUpFailedNotificationIdempotencyKey(PENDING_ID)).toBe(
      `payment.wallet_topup_failed:${PENDING_ID}`,
    )
    expect(
      buildBankReceiptTopUpCompletedNotificationPayload({
        amount: '250000',
        creditTransactionId: 'credit-1',
        pendingTransactionId: PENDING_ID,
      }),
    ).toEqual({
      amount: '250000',
      transactionId: 'credit-1',
      pending_transaction_id: PENDING_ID,
      link_route: '/wallet',
    })
    expect(
      buildBankReceiptTopUpFailedNotificationPayload({
        amount: '250000',
        reason: 'Illegible scan',
        pendingTransactionId: PENDING_ID,
      }),
    ).toEqual({
      amount: '250000',
      reason: 'Illegible scan',
      pending_transaction_id: PENDING_ID,
      link_route: '/wallet',
    })
    expect(BANK_RECEIPT_CONFIRM_ERRORS.OWNER_UNNOTIFIABLE()).toMatch(/cannot be notified/)
  })

  describe('parseBankReceiptRejectReason', () => {
    it('trims a required customer-visible reason', () => {
      const parsed = parseBankReceiptRejectReason({ reason: '  Amount mismatch  ' })
      expect(parsed).toEqual({ ok: true, reason: 'Amount mismatch' })
    })

    it('rejects blank, oversized, non-object, and control-character values', () => {
      expect(parseBankReceiptRejectReason(null).ok).toBe(false)
      expect(parseBankReceiptRejectReason({ reason: '   ' }).ok).toBe(false)
      expect(
        parseBankReceiptRejectReason({
          reason: 'x'.repeat(BANK_RECEIPT_REJECT_REASON_MAX_LENGTH + 1),
        }).ok,
      ).toBe(false)
      expect(parseBankReceiptRejectReason({ reason: 'bad\u0000ref' }).ok).toBe(false)
      expect(parseBankReceiptRejectReason({ reason: 12 }).ok).toBe(false)
      const failed = parseBankReceiptRejectReason({})
      expect(failed.ok).toBe(false)
      if (failed.ok) return
      expect(failed.message).toBe(BANK_RECEIPT_CONFIRM_ERRORS.BAD_REASON())
    })
  })

  describe('isPendingBankReceiptTopUp', () => {
    it('accepts a Pending topup with the bank_receipt channel', () => {
      expect(
        isPendingBankReceiptTopUp({
          type: 'topup',
          state: 'Pending',
          metadata: { channel: BANK_RECEIPT_TOPUP_CHANNEL },
        }),
      ).toBe(true)
    })

    it('rejects online top-ups, completed rows, and non-topups', () => {
      expect(
        isPendingBankReceiptTopUp({
          type: 'topup',
          state: 'Pending',
          metadata: { channel: 'online' },
        }),
      ).toBe(false)
      expect(
        isPendingBankReceiptTopUp({
          type: 'topup',
          state: 'Completed',
          metadata: { channel: BANK_RECEIPT_TOPUP_CHANNEL },
        }),
      ).toBe(false)
      expect(
        isPendingBankReceiptTopUp({
          type: 'refund',
          state: 'Pending',
          metadata: { channel: BANK_RECEIPT_TOPUP_CHANNEL },
        }),
      ).toBe(false)
    })
  })

  describe('staff decision metadata', () => {
    it('round-trips a rejection snapshot as customer-visible', () => {
      const decidedAt = new Date('2026-09-02T08:00:00.000Z')
      const patch = bankReceiptStaffDecisionMetadata({
        decision: 'rejected',
        actorUserId: 'staff-1',
        decidedAt,
        reason: 'Illegible scan',
      })
      const snapshot = readBankReceiptStaffDecision(patch)
      expect(snapshot).toEqual({
        decision: 'rejected',
        actorUserId: 'staff-1',
        decidedAt: decidedAt.toISOString(),
        reason: 'Illegible scan',
        customerVisible: true,
        creditTransactionId: null,
      })
    })

    it('round-trips a confirmation snapshot with the credit row id', () => {
      const decidedAt = new Date('2026-09-02T08:00:00.000Z')
      const patch = bankReceiptStaffDecisionMetadata({
        decision: 'confirmed',
        actorUserId: 'staff-1',
        decidedAt,
        creditTransactionId: 'credit-1',
      })
      expect(readBankReceiptStaffDecision(patch)?.creditTransactionId).toBe('credit-1')
      expect(readBankReceiptStaffDecision(patch)?.customerVisible).toBe(false)
    })
  })

  it('records the pending id on the Completed credit metadata', () => {
    const confirmedAt = new Date('2026-09-02T08:00:00.000Z')
    expect(
      bankReceiptCreditMetadata({
        pendingTransactionId: PENDING_ID,
        confirmedBy: 'staff-1',
        confirmedAt,
        receipt: { payerReference: 'TRK-1' },
      }),
    ).toEqual({
      channel: BANK_RECEIPT_TOPUP_CHANNEL,
      pendingTransactionId: PENDING_ID,
      confirmedBy: 'staff-1',
      confirmedAt: confirmedAt.toISOString(),
      receipt: { payerReference: 'TRK-1' },
    })
  })
})
