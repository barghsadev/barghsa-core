import { describe, expect, it } from 'vitest'
import {
  REVERSIBLE_WALLET_LEDGER_STATE,
  REVERSIBLE_WALLET_LEDGER_TYPES,
  WALLET_REVERSAL_ERRORS,
  WALLET_REVERSAL_POSTED_STATE,
  WALLET_REVERSAL_TYPE,
  WALLET_TX_REVERSAL_ORIGINAL_CONSTRAINT,
  WALLET_TX_REVERSES_CONSTRAINT,
  availableCoversReversal,
  availableRequiredForReversal,
  isMatchingReversalReplay,
  isReversibleWalletLedgerState,
  isReversibleWalletLedgerType,
  isWalletTransactionUuid,
  reversalAmount,
  reversalDebitsPostedBalance,
  walletReversalMetadata,
} from './wallet-reversal.js'

const ORIGINAL_ID = '11111111-1111-7111-8111-111111111111'
const WALLET_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

describe('wallet reversal helpers (T-04.2.04.01)', () => {
  it('names the reversal ledger type, posted state, and unique index', () => {
    expect(WALLET_REVERSAL_TYPE).toBe('reversal')
    expect(WALLET_REVERSAL_POSTED_STATE).toBe('Completed')
    expect(REVERSIBLE_WALLET_LEDGER_STATE).toBe('Completed')
    expect(WALLET_TX_REVERSES_CONSTRAINT).toBe('uq_wallet_tx_reverses_transaction')
    expect(WALLET_TX_REVERSAL_ORIGINAL_CONSTRAINT).toBe(
      'chk_wallet_tx_reversal_original',
    )
    expect(REVERSIBLE_WALLET_LEDGER_TYPES).toEqual([
      'topup',
      'payment',
      'refund',
      'compensating',
    ])
  })

  it('accepts posted money-moving types and refuses holds and reversals', () => {
    expect(isReversibleWalletLedgerType('topup')).toBe(true)
    expect(isReversibleWalletLedgerType('payment')).toBe(true)
    expect(isReversibleWalletLedgerType('refund')).toBe(true)
    expect(isReversibleWalletLedgerType('compensating')).toBe(true)
    expect(isReversibleWalletLedgerType('reservation')).toBe(false)
    expect(isReversibleWalletLedgerType('release')).toBe(false)
    expect(isReversibleWalletLedgerType('reversal')).toBe(false)
  })

  it('only treats Completed as reversible', () => {
    expect(isReversibleWalletLedgerState('Completed')).toBe(true)
    for (const state of [
      'Pending',
      'Reserved',
      'Failed',
      'Rejected',
      'Released',
      'Reversed',
    ]) {
      expect(isReversibleWalletLedgerState(state)).toBe(false)
    }
  })

  it('posts the opposite signed amount of the original', () => {
    expect(reversalAmount(250_000n)).toBe(-250_000n)
    expect(reversalAmount(-250_000n)).toBe(250_000n)
    expect(reversalDebitsPostedBalance(250_000n)).toBe(true)
    expect(reversalDebitsPostedBalance(-250_000n)).toBe(false)
  })

  it('requires available balance only when reversing a credit', () => {
    expect(availableRequiredForReversal(100_000n)).toBe(100_000n)
    expect(availableRequiredForReversal(-100_000n)).toBe(0n)
    expect(availableCoversReversal(100_000n, 100_000n)).toBe(true)
    expect(availableCoversReversal(99_999n, 100_000n)).toBe(false)
    expect(availableCoversReversal(0n, -100_000n)).toBe(true)
  })

  it('validates original transaction ids as UUIDs', () => {
    expect(isWalletTransactionUuid(ORIGINAL_ID)).toBe(true)
    expect(isWalletTransactionUuid(ORIGINAL_ID.toUpperCase())).toBe(true)
    expect(isWalletTransactionUuid('not-a-uuid')).toBe(false)
    expect(isWalletTransactionUuid('')).toBe(false)
  })

  it('records original identity and reason on reversal metadata', () => {
    expect(
      walletReversalMetadata({
        originalTransactionId: ORIGINAL_ID,
        originalType: 'topup',
        originalAmount: 250_000n,
        originalRefId: 'provider-evt-1',
        reason: 'provider chargeback',
      }),
    ).toEqual({
      originalTransactionId: ORIGINAL_ID,
      originalType: 'topup',
      originalAmount: '250000',
      originalRefId: 'provider-evt-1',
      reason: 'provider chargeback',
    })
  })

  it('accepts a matching Completed reversal replay and rejects collisions', () => {
    const matching = {
      walletId: WALLET_ID,
      type: 'reversal',
      amount: -250_000n,
      state: 'Completed',
      reversesTransactionId: ORIGINAL_ID,
      description: 'provider chargeback',
    }
    const expected = {
      walletId: WALLET_ID,
      originalTransactionId: ORIGINAL_ID,
      originalAmount: 250_000n,
      reason: 'provider chargeback',
    }
    expect(isMatchingReversalReplay(matching, expected)).toBe(true)
    expect(
      isMatchingReversalReplay({ ...matching, amount: -100n }, expected),
    ).toBe(false)
    expect(
      isMatchingReversalReplay({ ...matching, type: 'compensating' }, expected),
    ).toBe(false)
    expect(
      isMatchingReversalReplay({ ...matching, description: 'other' }, expected),
    ).toBe(false)
    expect(
      isMatchingReversalReplay(
        { ...matching, reversesTransactionId: WALLET_ID },
        expected,
      ),
    ).toBe(false)
  })

  it('formats operator-facing error messages', () => {
    expect(WALLET_REVERSAL_ERRORS.ORIGINAL_ID_REQUIRED()).toMatch(/UUID/)
    expect(WALLET_REVERSAL_ERRORS.ALREADY_REVERSED(ORIGINAL_ID)).toContain(
      ORIGINAL_ID,
    )
    expect(WALLET_REVERSAL_ERRORS.INSUFFICIENT_BALANCE(1n, 2n)).toBe(
      'Insufficient balance: available=1, required=2',
    )
    expect(WALLET_REVERSAL_ERRORS.USE_REVERSE_TRANSACTION()).toMatch(
      /reverseTransaction/,
    )
  })
})
