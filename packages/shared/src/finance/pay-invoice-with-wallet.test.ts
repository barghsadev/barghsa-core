import { describe, expect, it } from 'vitest'
import {
  IDEMPOTENCY_KEY_TTL_MS,
  INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
  PAY_INVOICE_WITH_WALLET_DESCRIPTION,
  PAY_INVOICE_WITH_WALLET_ERRORS,
  WALLET_INVOICE_PAYMENT_EVENT,
  WALLET_PAYABLE_INVOICE_STATES,
  availableCoversRemaining,
  cachedWalletPaymentMatchesRequest,
  idempotencyKeyExpiresAt,
  isExpiredInFlightIdempotencyClaim,
  isExactRemainingWalletDebit,
  isMatchingWalletInvoicePayment,
  isWalletDebitIdempotencyCollision,
  isWalletPayableInvoiceState,
  parsePayInvoiceWithWalletCache,
  parsePayInvoiceWithWalletIds,
  payInvoiceWithWalletAuditMetadata,
  payInvoiceWithWalletMetadata,
  remainingForWalletPayment,
  serializePayInvoiceWithWalletCache,
  walletAvailableBalance,
} from './pay-invoice-with-wallet.js'

const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

describe('pay invoice with wallet helpers (T-04.2.03.01 / T-04.2.03.02)', () => {
  describe('isWalletPayableInvoiceState', () => {
    it('allows Unpaid and PartiallyFunded only', () => {
      expect(WALLET_PAYABLE_INVOICE_STATES).toEqual(['Unpaid', 'PartiallyFunded'])
      expect(isWalletPayableInvoiceState('Unpaid')).toBe(true)
      expect(isWalletPayableInvoiceState('PartiallyFunded')).toBe(true)
      expect(isWalletPayableInvoiceState('Overdue')).toBe(false)
      expect(isWalletPayableInvoiceState('Paid')).toBe(false)
      expect(isWalletPayableInvoiceState('Draft')).toBe(false)
      expect(isWalletPayableInvoiceState('PaymentUnderReview')).toBe(false)
    })
  })

  describe('remainingForWalletPayment', () => {
    it('returns remaining for Unpaid and PartiallyFunded', () => {
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Unpaid',
        }),
      ).toBe(1_000_000n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 250_000n,
          state: 'PartiallyFunded',
        }),
      ).toBe(750_000n)
    })

    it('returns 0 for non-payable states, credit notes, and fully paid rows', () => {
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Overdue',
        }),
      ).toBe(0n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 1_000_000n,
          state: 'Paid',
        }),
      ).toBe(0n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Unpaid',
          adjustmentKind: 'credit',
        }),
      ).toBe(0n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 1_000_000n,
          state: 'Unpaid',
        }),
      ).toBe(0n)
    })
  })

  describe('walletAvailableBalance / availableCoversRemaining', () => {
    it('derives posted minus reserved and gates the remaining debit', () => {
      expect(walletAvailableBalance(1_000_000n, 250_000n)).toBe(750_000n)
      expect(walletAvailableBalance(1_000_000n, 0n)).toBe(1_000_000n)
      expect(availableCoversRemaining(1_000_000n, 1_000_000n)).toBe(true)
      expect(availableCoversRemaining(1_000_001n, 1_000_000n)).toBe(true)
      expect(availableCoversRemaining(999_999n, 1_000_000n)).toBe(false)
      expect(availableCoversRemaining(1_000_000n, 0n)).toBe(false)
      expect(availableCoversRemaining(0n, 1n)).toBe(false)
    })
  })

  describe('parsePayInvoiceWithWalletIds', () => {
    it('canonicalizes valid UUIDs', () => {
      const parsed = parsePayInvoiceWithWalletIds(
        INVOICE_ID.toUpperCase(),
        ` ${PROFILE_ID.toUpperCase()} `,
      )
      expect(parsed).toEqual({
        ok: true,
        invoiceId: INVOICE_ID,
        profileId: PROFILE_ID,
      })
    })

    it('rejects invalid ids', () => {
      expect(parsePayInvoiceWithWalletIds('not-a-uuid', PROFILE_ID)).toEqual({
        ok: false,
        message: PAY_INVOICE_WITH_WALLET_ERRORS.BAD_INVOICE_ID(),
      })
      expect(parsePayInvoiceWithWalletIds(INVOICE_ID, '')).toEqual({
        ok: false,
        message: PAY_INVOICE_WITH_WALLET_ERRORS.BAD_PROFILE_ID(),
      })
    })
  })

  describe('payInvoiceWithWalletMetadata', () => {
    it('serializes remaining and paid amounts as strings', () => {
      expect(
        payInvoiceWithWalletMetadata({
          invoiceId: INVOICE_ID,
          remainingBefore: 750_000n,
          paidAmountAfter: 1_000_000n,
        }),
      ).toEqual({
        purpose: 'invoice_payment',
        invoiceId: INVOICE_ID,
        remainingBefore: '750000',
        paidAmountAfter: '1000000',
      })
      expect(PAY_INVOICE_WITH_WALLET_DESCRIPTION).toContain('Wallet payment')
    })
  })

  describe('payInvoiceWithWalletAuditMetadata', () => {
    it('serializes locked balances and the debit as decimal strings', () => {
      expect(WALLET_INVOICE_PAYMENT_EVENT).toBe('wallet.invoice_payment')
      expect(
        payInvoiceWithWalletAuditMetadata({
          invoiceId: INVOICE_ID,
          profileId: PROFILE_ID,
          walletTransactionId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
          remainingPaid: 400_000n,
          postedBalanceBefore: 1_500_000n,
          postedBalanceAfter: 1_100_000n,
          reservedBalance: 0n,
          availableBalance: 1_500_000n,
          fromState: 'PartiallyFunded',
        }),
      ).toEqual({
        entityType: 'wallet',
        entityId: PROFILE_ID,
        invoiceId: INVOICE_ID,
        walletTransactionId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        remainingPaid: '400000',
        postedBalanceBefore: '1500000',
        postedBalanceAfter: '1100000',
        reservedBalance: '0',
        availableBalance: '1500000',
        previousState: 'PartiallyFunded',
        newState: 'Paid',
      })
    })
  })

  describe('isExactRemainingWalletDebit', () => {
    const base = {
      walletId: PROFILE_ID,
      expectedWalletId: PROFILE_ID,
      invoiceId: INVOICE_ID,
      type: 'payment',
      state: 'Completed',
      refId: INVOICE_ID,
      amount: -750_000n,
      remaining: 750_000n,
    }

    it('accepts only a Completed payment debit of the exact remaining amount', () => {
      expect(isExactRemainingWalletDebit(base)).toBe(true)
      expect(isExactRemainingWalletDebit({ ...base, amount: -749_999n })).toBe(false)
      expect(isExactRemainingWalletDebit({ ...base, amount: -750_001n })).toBe(false)
      expect(isExactRemainingWalletDebit({ ...base, remaining: 0n })).toBe(false)
      expect(isExactRemainingWalletDebit({ ...base, type: 'topup', amount: 750_000n })).toBe(
        false,
      )
    })
  })

  describe('isWalletDebitIdempotencyCollision', () => {
    it('matches WalletService.debit collision messages', () => {
      expect(
        isWalletDebitIdempotencyCollision(
          'Idempotency key already used for a different wallet operation',
        ),
      ).toBe(true)
      expect(
        isWalletDebitIdempotencyCollision('Idempotency key already used for a different wallet'),
      ).toBe(true)
      expect(isWalletDebitIdempotencyCollision(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())).toBe(
        true,
      )
      expect(isWalletDebitIdempotencyCollision('Insufficient balance')).toBe(false)
    })
  })

  describe('isMatchingWalletInvoicePayment', () => {
    it('accepts a Completed payment debit for the invoice', () => {
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Completed',
          refId: INVOICE_ID,
          amount: -750_000n,
        }),
      ).toBe(true)
    })

    it('rejects credits, other invoices, other wallets, and pending rows', () => {
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'topup',
          state: 'Completed',
          refId: INVOICE_ID,
          amount: 750_000n,
        }),
      ).toBe(false)
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Completed',
          refId: '22222222-2222-7222-8222-222222222222',
          amount: -750_000n,
        }),
      ).toBe(false)
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Pending',
          refId: INVOICE_ID,
          amount: -750_000n,
        }),
      ).toBe(false)
      expect(
        isMatchingWalletInvoicePayment({
          walletId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Completed',
          refId: INVOICE_ID,
          amount: -750_000n,
        }),
      ).toBe(false)
    })
  })

  describe('idempotency cache snapshot (T-04.2.03.03)', () => {
    const now = new Date('2026-09-02T08:00:00.000Z')
    const snapshot = serializePayInvoiceWithWalletCache({
      invoiceId: INVOICE_ID,
      profileId: PROFILE_ID,
      fromState: 'Unpaid',
      remainingPaid: 1_000_000n,
      auditId: 'audit-1',
      walletTransaction: {
        id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        walletId: PROFILE_ID,
        type: 'payment',
        amount: -1_000_000n,
        state: 'Completed',
        idempotencyKey: 'pay-1',
        refId: INVOICE_ID,
        description: PAY_INVOICE_WITH_WALLET_DESCRIPTION,
        metadata: { purpose: 'invoice_payment' },
        createdAt: now,
        updatedAt: now,
      },
    })

    it('round-trips bigint amounts and Date fields as strings', () => {
      expect(INVOICE_WALLET_PAYMENT_ENTITY_TYPE).toBe('invoice_wallet_payment')
      expect(snapshot.remainingPaid).toBe('1000000')
      expect(snapshot.walletTransaction.amount).toBe('-1000000')
      expect(snapshot.walletTransaction.createdAt).toBe(now.toISOString())
      expect(parsePayInvoiceWithWalletCache(snapshot)).toEqual(snapshot)
      expect(parsePayInvoiceWithWalletCache(JSON.stringify(snapshot))).toEqual(snapshot)
      expect(parsePayInvoiceWithWalletCache('not-json')).toBeNull()
      expect(parsePayInvoiceWithWalletCache(null)).toBeNull()
      expect(parsePayInvoiceWithWalletCache({ invoiceId: INVOICE_ID })).toBeNull()
    })

    it('matches only the original invoice and profile', () => {
      expect(cachedWalletPaymentMatchesRequest(snapshot, INVOICE_ID, PROFILE_ID)).toBe(true)
      expect(
        cachedWalletPaymentMatchesRequest(
          snapshot,
          INVOICE_ID.toUpperCase(),
          PROFILE_ID.toUpperCase(),
        ),
      ).toBe(true)
      expect(
        cachedWalletPaymentMatchesRequest(
          snapshot,
          '22222222-2222-7222-8222-222222222222',
          PROFILE_ID,
        ),
      ).toBe(false)
    })

    it('computes a 24h expiresAt from now', () => {
      expect(idempotencyKeyExpiresAt(now).getTime() - now.getTime()).toBe(IDEMPOTENCY_KEY_TTL_MS)
    })

    it('reclaims only in-flight rows whose expiresAt has passed', () => {
      expect(
        isExpiredInFlightIdempotencyClaim({
          response: null,
          expiresAt: new Date(now.getTime() - 1),
          now,
        }),
      ).toBe(true)
      expect(
        isExpiredInFlightIdempotencyClaim({
          response: null,
          expiresAt: now,
          now,
        }),
      ).toBe(true)
      expect(
        isExpiredInFlightIdempotencyClaim({
          response: null,
          expiresAt: new Date(now.getTime() + 1),
          now,
        }),
      ).toBe(false)
      expect(
        isExpiredInFlightIdempotencyClaim({
          response: snapshot,
          expiresAt: new Date(now.getTime() - 1),
          now,
        }),
      ).toBe(false)
      expect(
        isExpiredInFlightIdempotencyClaim({
          response: null,
          expiresAt: null,
          now,
        }),
      ).toBe(false)
    })
  })
})
