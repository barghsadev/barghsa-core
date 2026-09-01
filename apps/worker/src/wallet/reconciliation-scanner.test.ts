import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  WALLET_MISMATCH_EXCEPTION_TYPE,
  WALLET_RECONCILIATION_SOURCE,
  describeWalletMismatch,
  diffWalletAgainstLedger,
  walletMismatchDetails,
  walletMismatchSeverity,
} from '@barghsa/shared/finance'
import {
  DEFAULT_WALLET_RECONCILIATION_BATCH_SIZE,
  FIND_WALLET_MISMATCH_CANDIDATES_SQL,
  WALLET_RECONCILIATION_JOB_TYPE,
  reconcileWalletBalances,
} from './reconciliation-scanner.js'

/**
 * Wallet reconciliation unit tests (S-04.2.01, T-04.2.01.08).
 *
 * `reconcileWalletBalances` is exercised with an injected fake pool so the
 * candidate query, per-row lock + ledger re-sum, and finance-queue insert
 * are covered DB-free.
 */

interface FakeDb {
  pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }
  calls: Array<{ sql: string; params: unknown[] }>
}

function makeFakeDb(
  onSql: (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number },
): FakeDb {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const respond = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    const result = onSql(sql, params)
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 }
  }
  const client = { query: respond, release: vi.fn() }
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: respond,
  }
  return { pool: pool as never, calls }
}

const WALLET_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const WALLET_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'

function mismatchedCandidate(
  id = WALLET_A,
  posted = '500',
  ledgerPosted = '400',
  reserved = '0',
  ledgerReserved = '0',
) {
  return {
    profile_id: id,
    posted_balance: posted,
    reserved_balance: reserved,
    ledger_posted: ledgerPosted,
    ledger_reserved: ledgerReserved,
  }
}

function scanOptions(db: FakeDb, overrides: Record<string, unknown> = {}) {
  const logger = { warn: vi.fn(), info: vi.fn() }
  return {
    pool: db.pool as unknown as Pool,
    logger,
    ...overrides,
  }
}

function defaultHandler(
  candidates: Array<ReturnType<typeof mismatchedCandidate>> = [mismatchedCandidate()],
  locked: Array<{ profile_id: string; posted_balance: string; reserved_balance: string }> | 'match' =
    'match',
  ledger: { ledger_posted: string; ledger_reserved: string } | 'match' = 'match',
  existing: Array<{ id: string }> = [],
) {
  return (sql: string): { rows?: unknown[]; rowCount?: number } => {
    if (sql.includes('FROM wallets w') && sql.includes('HAVING')) {
      return { rows: candidates }
    }
    if (sql.includes('FOR UPDATE SKIP LOCKED')) {
      if (locked === 'match') {
        return {
          rows: candidates.map((c) => ({
            profile_id: c.profile_id,
            posted_balance: c.posted_balance,
            reserved_balance: c.reserved_balance,
          })),
        }
      }
      return { rows: locked }
    }
    if (sql.includes('FROM wallet_transactions') && sql.includes('FILTER')) {
      if (ledger === 'match') {
        return {
          rows: [
            {
              ledger_posted: candidates[0]?.ledger_posted ?? '0',
              ledger_reserved: candidates[0]?.ledger_reserved ?? '0',
            },
          ],
        }
      }
      return { rows: [ledger] }
    }
    if (sql.includes('FROM reconciliation_exceptions') && sql.includes("details->>'walletId'")) {
      return { rows: existing }
    }
    if (sql.includes('INSERT INTO reconciliation_exceptions')) {
      return { rows: [], rowCount: 1 }
    }
    return { rows: [] }
  }
}

describe('reconcileWalletBalances (T-04.2.01.08)', () => {
  it('exposes the background-job type the worker recorder uses', () => {
    expect(WALLET_RECONCILIATION_JOB_TYPE).toBe('wallet_reconciliation_scan')
  })

  it('selects wallets whose posted or reserved cache disagrees with the ledger', () => {
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain("tx.state = 'Completed'")
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain("tx.state = 'Reserved'")
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain('::bigint')
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain('HAVING')
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain("exception_type = 'wallet_mismatch'")
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain("status IN ('open', 'investigating')")
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain("details->>'walletId'")
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain('ORDER BY w.profile_id ASC')
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).toContain('LIMIT $1')
    expect(FIND_WALLET_MISMATCH_CANDIDATES_SQL).not.toContain("state = 'Pending'")
  })

  it('binds the candidate query to the default batch size', async () => {
    const db = makeFakeDb(defaultHandler())
    await reconcileWalletBalances(scanOptions(db))

    const find = db.calls.find((c) => c.sql.includes('HAVING'))
    expect(find).toBeDefined()
    expect(find!.params[0]).toBe(DEFAULT_WALLET_RECONCILIATION_BATCH_SIZE)
  })

  it('reports a posted mismatch to the finance queue as an open wallet_mismatch', async () => {
    const db = makeFakeDb(defaultHandler())
    const result = await reconcileWalletBalances(scanOptions(db))

    expect(result).toMatchObject({
      scanned: 1,
      reported: 1,
      skipped: 0,
      truncated: false,
      errors: [],
    })

    const mismatch = diffWalletAgainstLedger({
      walletId: WALLET_A,
      postedBalance: 500n,
      reservedBalance: 0n,
      ledgerPostedSum: 400n,
      ledgerReservedSum: 0n,
    })!

    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO reconciliation_exceptions'))
    expect(insert).toBeDefined()
    expect(insert!.params[0]).toBe(WALLET_MISMATCH_EXCEPTION_TYPE)
    expect(insert!.params[1]).toBe(walletMismatchSeverity(mismatch))
    expect(insert!.params[2]).toBe(describeWalletMismatch(mismatch))
    expect(JSON.parse(String(insert!.params[3]))).toEqual(walletMismatchDetails(mismatch))
    expect(JSON.parse(String(insert!.params[3])).source).toBe(WALLET_RECONCILIATION_SOURCE)
    expect(db.calls.some((c) => c.sql === 'COMMIT')).toBe(true)
  })

  it('skips a wallet that matches the ledger after lock (in-flight mutation)', async () => {
    const db = makeFakeDb(
      defaultHandler(
        [mismatchedCandidate()],
        'match',
        { ledger_posted: '500', ledger_reserved: '0' },
      ),
    )
    const result = await reconcileWalletBalances(scanOptions(db))

    expect(result).toMatchObject({ scanned: 1, reported: 0, skipped: 1, errors: [] })
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO reconciliation_exceptions'))).toBe(
      false,
    )
    expect(db.calls.some((c) => c.sql === 'ROLLBACK')).toBe(true)
  })

  it('skips when FOR UPDATE SKIP LOCKED returns no row', async () => {
    const db = makeFakeDb(defaultHandler([mismatchedCandidate()], []))
    const result = await reconcileWalletBalances(scanOptions(db))

    expect(result).toMatchObject({ scanned: 1, reported: 0, skipped: 1, errors: [] })
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO reconciliation_exceptions'))).toBe(
      false,
    )
  })

  it('does not insert a second open exception for a wallet already on the queue', async () => {
    const db = makeFakeDb(
      defaultHandler([mismatchedCandidate()], 'match', 'match', [{ id: 'rex-open-1' }]),
    )
    const result = await reconcileWalletBalances(scanOptions(db))

    expect(result).toMatchObject({ scanned: 1, reported: 0, skipped: 1, errors: [] })
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO reconciliation_exceptions'))).toBe(
      false,
    )
  })

  it('isolates one wallet failure and continues the batch', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM wallets w') && sql.includes('HAVING')) {
        return {
          rows: [mismatchedCandidate(WALLET_A), mismatchedCandidate(WALLET_B, '80', '70')],
        }
      }
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        const walletParam = db.calls[db.calls.length - 1]?.params[0]
        if (walletParam === WALLET_A) {
          throw new Error('lock boom')
        }
        return {
          rows: [{ profile_id: WALLET_B, posted_balance: '80', reserved_balance: '0' }],
        }
      }
      if (sql.includes('FROM wallet_transactions') && sql.includes('FILTER')) {
        return { rows: [{ ledger_posted: '70', ledger_reserved: '0' }] }
      }
      if (sql.includes('FROM reconciliation_exceptions') && sql.includes("details->>'walletId'")) {
        return { rows: [] }
      }
      if (sql.includes('INSERT INTO reconciliation_exceptions')) {
        return { rows: [], rowCount: 1 }
      }
      return { rows: [] }
    })

    const result = await reconcileWalletBalances(scanOptions(db))

    expect(result.scanned).toBe(2)
    expect(result.reported).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain(WALLET_A)
    expect(result.errors[0]).toContain('lock boom')
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO reconciliation_exceptions'))).toBe(
      true,
    )
  })

  it('marks truncated when the candidate query hits the batch cap', async () => {
    const db = makeFakeDb(defaultHandler())
    const result = await reconcileWalletBalances(scanOptions(db, { batchSize: 1 }))

    expect(result.truncated).toBe(true)
    expect(result.scanned).toBe(1)
    const find = db.calls.find((c) => c.sql.includes('HAVING'))
    expect(find!.params[0]).toBe(1)
  })
})
