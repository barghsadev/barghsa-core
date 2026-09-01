/**
 * Real-PostgreSQL integration tests for the wallet reconciliation
 * scanner (T-04.2.01.08).
 *
 * Fake-pool unit tests cannot prove FILTER/HAVING bigint comparison or
 * the finance-queue insert against `reconciliation_exceptions`. This
 * suite applies the migrated wallet + exception schema and runs a full
 * `reconcileWalletBalances` pass against Testcontainers PostgreSQL 17.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { WALLET_MISMATCH_EXCEPTION_TYPE } from '@barghsa/shared/finance'
import { reconcileWalletBalances } from './reconciliation-scanner.js'

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const WALLET_TX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0068_create_wallet_transactions.sql',
)
const WALLET_CHECK_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0069_wallet_available_balance_check.sql',
)

const WALLET_OK = '11111111-1111-7111-8111-111111111111'
const WALLET_POSTED_DRIFT = '22222222-2222-7222-8222-222222222222'
const WALLET_RESERVED_DRIFT = '33333333-3333-7333-8333-333333333333'
const WALLET_PENDING_ONLY = '44444444-4444-7444-8444-444444444444'

describe('wallet reconciliation — real PostgreSQL (T-04.2.01.08)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
    )`)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(WALLET_CHECK_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        exception_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        description TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        assigned_to_id TEXT,
        resolved_by_id TEXT,
        resolution_note TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_rex_type
          CHECK (exception_type IN ('wallet_mismatch', 'payment_mismatch')),
        CONSTRAINT chk_rex_severity
          CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        CONSTRAINT chk_rex_status
          CHECK (status IN ('open', 'investigating', 'resolved', 'closed'))
      )
    `)
    await ctx.pool.query(
      `INSERT INTO profiles (id) VALUES ($1), ($2), ($3), ($4)`,
      [WALLET_OK, WALLET_POSTED_DRIFT, WALLET_RESERVED_DRIFT, WALLET_PENDING_ONLY],
    )
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM reconciliation_exceptions')
    await ctx.pool.query('DELETE FROM wallet_transactions')
    await ctx.pool.query('DELETE FROM wallets')
    await ctx.pool.query(
      `INSERT INTO wallets (profile_id, posted_balance, reserved_balance, version)
       VALUES
         ($1, 250000, 0, 2),
         ($2, 500000, 0, 1),
         ($3, 1000000, 200000, 3),
         ($4, 0, 0, 0)`,
      [WALLET_OK, WALLET_POSTED_DRIFT, WALLET_RESERVED_DRIFT, WALLET_PENDING_ONLY],
    )
    await ctx.pool.query(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key)
       VALUES
         ($1, 'topup', 300000, 'Completed', 'ok-credit'),
         ($1, 'payment', -50000, 'Completed', 'ok-debit'),
         ($2, 'topup', 400000, 'Completed', 'posted-drift-credit'),
         ($3, 'topup', 1000000, 'Completed', 'reserved-credit'),
         ($3, 'reservation', 100000, 'Released', 'reserved-released'),
         ($4, 'topup', 75000, 'Pending', 'pending-only')`,
      [WALLET_OK, WALLET_POSTED_DRIFT, WALLET_RESERVED_DRIFT, WALLET_PENDING_ONLY],
    )
  })

  async function exceptions() {
    const result = await ctx.pool.query<{
      exception_type: string
      severity: string
      status: string
      description: string
      details: { walletId?: string; postedDelta?: string; reservedDelta?: string }
    }>(
      `SELECT exception_type, severity, status, description, details
       FROM reconciliation_exceptions
       ORDER BY details->>'walletId'`,
    )
    return result.rows
  }

  it('reports posted and reserved cache drift and ignores matching / pending-only wallets', async () => {
    const result = await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 })

    expect(result.errors).toEqual([])
    expect(result.reported).toBe(2)
    expect(result.scanned).toBe(2)

    const rows = await exceptions()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.exception_type === WALLET_MISMATCH_EXCEPTION_TYPE)).toBe(true)
    expect(rows.every((r) => r.status === 'open')).toBe(true)
    expect(rows.every((r) => r.severity === 'high')).toBe(true)

    const posted = rows.find((r) => r.details.walletId === WALLET_POSTED_DRIFT)
    expect(posted).toBeDefined()
    expect(posted!.details.postedDelta).toBe('100000')
    expect(posted!.description).toContain(WALLET_POSTED_DRIFT)

    const reserved = rows.find((r) => r.details.walletId === WALLET_RESERVED_DRIFT)
    expect(reserved).toBeDefined()
    expect(reserved!.details.reservedDelta).toBe('200000')
    expect(reserved!.details.postedDelta).toBe('0')

    expect(rows.some((r) => r.details.walletId === WALLET_OK)).toBe(false)
    expect(rows.some((r) => r.details.walletId === WALLET_PENDING_ONLY)).toBe(false)
  })

  it('does not duplicate an open finance-queue row on a second tick', async () => {
    const first = await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 })
    expect(first.reported).toBe(2)

    const second = await reconcileWalletBalances({ pool: ctx.pool, batchSize: 50 })
    expect(second.reported).toBe(0)
    expect(second.scanned).toBe(0)

    const rows = await exceptions()
    expect(rows).toHaveLength(2)
  })
})
