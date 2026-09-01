import { describe, it, expect } from 'vitest'
import {
  WALLET_LEDGER_POSTED_STATE,
  WALLET_LEDGER_RESERVED_STATE,
  WALLET_MISMATCH_CRITICAL_ABS_IRR,
  WALLET_MISMATCH_EXCEPTION_TYPE,
  WALLET_RECONCILIATION_SOURCE,
  describeWalletMismatch,
  diffWalletAgainstLedger,
  parseLedgerAmount,
  walletMatchesLedger,
  walletMismatchDetails,
  walletMismatchSeverity,
} from './wallet-reconciliation.js'

const WALLET = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

function snapshot(
  overrides: Partial<{
    postedBalance: bigint
    reservedBalance: bigint
    ledgerPostedSum: bigint
    ledgerReservedSum: bigint
  }> = {},
) {
  return {
    walletId: WALLET,
    postedBalance: 0n,
    reservedBalance: 0n,
    ledgerPostedSum: 0n,
    ledgerReservedSum: 0n,
    ...overrides,
  }
}

describe('wallet ledger reconciliation contract (T-04.2.01.08)', () => {
  it('pins the ledger states and finance-queue type the worker writes', () => {
    expect(WALLET_LEDGER_POSTED_STATE).toBe('Completed')
    expect(WALLET_LEDGER_RESERVED_STATE).toBe('Reserved')
    expect(WALLET_MISMATCH_EXCEPTION_TYPE).toBe('wallet_mismatch')
    expect(WALLET_RECONCILIATION_SOURCE).toBe('wallet_reconciliation_scan')
  })

  it('treats equal posted and reserved sums as a match', () => {
    const snap = snapshot({
      postedBalance: 250_000n,
      reservedBalance: 40_000n,
      ledgerPostedSum: 250_000n,
      ledgerReservedSum: 40_000n,
    })
    expect(walletMatchesLedger(snap)).toBe(true)
    expect(diffWalletAgainstLedger(snap)).toBeNull()
  })

  it('detects a posted-balance drift (wallet cache ahead of ledger)', () => {
    const mismatch = diffWalletAgainstLedger(
      snapshot({
        postedBalance: 500_000n,
        ledgerPostedSum: 400_000n,
      }),
    )
    expect(mismatch).not.toBeNull()
    expect(mismatch!.postedDelta).toBe(100_000n)
    expect(mismatch!.reservedDelta).toBe(0n)
    expect(walletMatchesLedger(mismatch!)).toBe(false)
  })

  it('detects a reserved-balance drift (live holds vs Reserved rows)', () => {
    const mismatch = diffWalletAgainstLedger(
      snapshot({
        postedBalance: 1_000_000n,
        reservedBalance: 200_000n,
        ledgerPostedSum: 1_000_000n,
        ledgerReservedSum: 0n,
      }),
    )
    expect(mismatch!.reservedDelta).toBe(200_000n)
    expect(mismatch!.postedDelta).toBe(0n)
  })

  it('treats Completed credits minus Completed debits as the posted ledger sum', () => {
    // 300_000 topup + (-50_000) payment = 250_000 posted.
    const snap = snapshot({
      postedBalance: 250_000n,
      ledgerPostedSum: 300_000n + -50_000n,
    })
    expect(walletMatchesLedger(snap)).toBe(true)
  })

  it('classifies ordinary drift as high and large drift as critical', () => {
    const ordinary = diffWalletAgainstLedger(
      snapshot({ postedBalance: 1n, ledgerPostedSum: 0n }),
    )!
    expect(walletMismatchSeverity(ordinary)).toBe('high')

    const critical = diffWalletAgainstLedger(
      snapshot({
        postedBalance: WALLET_MISMATCH_CRITICAL_ABS_IRR,
        ledgerPostedSum: 0n,
      }),
    )!
    expect(walletMismatchSeverity(critical)).toBe('critical')
  })

  it('builds a finance-queue description and JSONB details payload', () => {
    const mismatch = diffWalletAgainstLedger(
      snapshot({
        postedBalance: 100n,
        reservedBalance: 20n,
        ledgerPostedSum: 90n,
        ledgerReservedSum: 10n,
      }),
    )!
    expect(describeWalletMismatch(mismatch)).toBe(
      `Wallet ledger mismatch for ${WALLET}: ` +
        'posted wallet=100 ledger=90 (delta=10); ' +
        'reserved wallet=20 ledger=10 (delta=10)',
    )
    expect(walletMismatchDetails(mismatch)).toEqual({
      walletId: WALLET,
      postedBalance: '100',
      reservedBalance: '20',
      ledgerPostedSum: '90',
      ledgerReservedSum: '10',
      postedDelta: '10',
      reservedDelta: '10',
      source: WALLET_RECONCILIATION_SOURCE,
    })
  })

  describe('parseLedgerAmount', () => {
    it('parses bigint, integer number, and integer string', () => {
      expect(parseLedgerAmount(12n)).toBe(12n)
      expect(parseLedgerAmount(-3)).toBe(-3n)
      expect(parseLedgerAmount('250000')).toBe(250_000n)
    })

    it('parses numeric SUM strings that carry a trailing .0', () => {
      expect(parseLedgerAmount('1000.00')).toBe(1000n)
      expect(parseLedgerAmount('-40.0')).toBe(-40n)
    })

    it('returns 0n for unusable driver values so a scan cannot throw', () => {
      expect(parseLedgerAmount(null)).toBe(0n)
      expect(parseLedgerAmount(undefined)).toBe(0n)
      expect(parseLedgerAmount('')).toBe(0n)
      expect(parseLedgerAmount('1.5')).toBe(0n)
      expect(parseLedgerAmount(1.5)).toBe(0n)
    })
  })
})
