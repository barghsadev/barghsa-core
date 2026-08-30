/**
 * Real-PostgreSQL integration tests for the overdue scanner candidate
 * query (T-04.1.03.04).
 *
 * Fake-pool unit tests only inspect SQL strings and cannot see the
 * production failure: `invoices.state` is type `invoice_state`, so
 * `state = ANY($1::text[])` raises an operator-mismatch error on every
 * scan. This suite applies the migrated invoice schema and runs the
 * production candidate SQL (and a full `scanOverdueInvoices` pass)
 * against Testcontainers PostgreSQL 17.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { OVERDUE_ELIGIBLE_STATES } from '@barghsa/shared/finance'
import {
  FIND_OVERDUE_CANDIDATES_SQL,
  scanOverdueInvoices,
} from './overdue-scanner.js'

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const PAID_OVERDUE_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0053_add_invoice_paid_overdue_timestamps.sql',
)
const AUDIT_LOG_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0005_create_audit_log.sql',
)

const PROFILE_ID = '11111111-1111-7111-8111-111111111111'
const ACTOR_USER_ID = 'overdue-scanner-actor'
const NOW = new Date('2026-08-30T12:00:00.000Z')
const PAST_EARLY = new Date('2026-08-20T12:00:00.000Z')
const PAST_LATE = new Date('2026-08-25T12:00:00.000Z')
const FUTURE = new Date('2026-09-15T12:00:00.000Z')

const BROKEN_TEXT_ARRAY_SQL = `SELECT id, state, due_at
        FROM invoices
        WHERE state = ANY($1::text[])
          AND due_at IS NOT NULL
          AND due_at < $2
        ORDER BY due_at ASC, id ASC
        LIMIT $3`

describe('overdue scanner — real PostgreSQL (T-04.1.03.04)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
    )`)
    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(PAID_OVERDUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(
      `INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [PROFILE_ID],
    )
    await ctx.pool.query(
      `INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [ACTOR_USER_ID],
    )
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM audit_log')
    await ctx.pool.query('DELETE FROM invoices')
  })

  async function insertInvoice(opts: {
    state: string
    dueAt: Date | null
    paidAmount?: number
  }): Promise<string> {
    const id = randomUUID()
    const paid = opts.paidAmount ?? (opts.state === 'PartiallyFunded' ? 400_000 : 0)
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, due_at)
       VALUES ($1, $2, $3::invoice_state, 1000000, $4, $5)`,
      [id, PROFILE_ID, opts.state, paid, opts.dueAt],
    )
    return id
  }

  it('rejects text[] comparison against invoice_state (the production failure)', async () => {
    await expect(
      ctx.pool.query(BROKEN_TEXT_ARRAY_SQL, [
        [...OVERDUE_ELIGIBLE_STATES],
        NOW,
        200,
      ]),
    ).rejects.toMatchObject({
      code: '42883',
    })
  })

  it('runs the candidate query against invoice_state and returns only past-due Unpaid/PartiallyFunded', async () => {
    const unpaidEarly = await insertInvoice({ state: 'Unpaid', dueAt: PAST_EARLY })
    const partialLate = await insertInvoice({
      state: 'PartiallyFunded',
      dueAt: PAST_LATE,
    })
    const unpaidFuture = await insertInvoice({ state: 'Unpaid', dueAt: FUTURE })
    const unpaidNullDue = await insertInvoice({ state: 'Unpaid', dueAt: null })
    await insertInvoice({ state: 'Draft', dueAt: PAST_EARLY })
    await insertInvoice({ state: 'PaymentUnderReview', dueAt: PAST_EARLY })
    await insertInvoice({ state: 'Paid', dueAt: PAST_EARLY, paidAmount: 1_000_000 })
    await insertInvoice({ state: 'Overdue', dueAt: PAST_EARLY })
    await insertInvoice({ state: 'Cancelled', dueAt: PAST_EARLY })

    const result = await ctx.pool.query<{ id: string; state: string }>(
      FIND_OVERDUE_CANDIDATES_SQL,
      [[...OVERDUE_ELIGIBLE_STATES], NOW, 200],
    )

    expect(result.rows.map((row) => row.id)).toEqual([unpaidEarly, partialLate])
    expect(result.rows.map((row) => row.state)).toEqual(['Unpaid', 'PartiallyFunded'])
    expect(result.rows.some((row) => row.id === unpaidFuture)).toBe(false)
    expect(result.rows.some((row) => row.id === unpaidNullDue)).toBe(false)
  })

  it('honours LIMIT and oldest-due ordering on the migrated schema', async () => {
    const first = await insertInvoice({ state: 'Unpaid', dueAt: PAST_EARLY })
    await insertInvoice({ state: 'Unpaid', dueAt: PAST_LATE })

    const result = await ctx.pool.query<{ id: string }>(FIND_OVERDUE_CANDIDATES_SQL, [
      [...OVERDUE_ELIGIBLE_STATES],
      NOW,
      1,
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.id).toBe(first)
  })

  it('marks eligible invoices Overdue, stamps overdue_at, and writes audit', async () => {
    const unpaidId = await insertInvoice({ state: 'Unpaid', dueAt: PAST_EARLY })
    const paidId = await insertInvoice({
      state: 'Paid',
      dueAt: PAST_EARLY,
      paidAmount: 1_000_000,
    })

    const scan = await scanOverdueInvoices({
      pool: ctx.pool,
      now: () => NOW,
      actorUserId: ACTOR_USER_ID,
      correlationId: 'corr-overdue-pg',
      batchSize: 50,
    })

    expect(scan.errors).toEqual([])
    expect(scan).toMatchObject({ scanned: 1, marked: 1, skipped: 0 })

    const overdue = await ctx.pool.query<{
      state: string
      overdue_at: Date | null
    }>(`SELECT state, overdue_at FROM invoices WHERE id = $1`, [unpaidId])
    expect(overdue.rows[0]?.state).toBe('Overdue')
    expect(overdue.rows[0]?.overdue_at).toEqual(NOW)

    const paid = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM invoices WHERE id = $1`,
      [paidId],
    )
    expect(paid.rows[0]?.state).toBe('Paid')

    const audit = await ctx.pool.query<{ event: string; metadata: string }>(
      `SELECT event, metadata FROM audit_log WHERE metadata LIKE $1`,
      [`%${unpaidId}%`],
    )
    expect(audit.rows[0]?.event).toBe('invoice.mark_overdue')
    expect(JSON.parse(audit.rows[0]!.metadata)).toMatchObject({
      invoiceId: unpaidId,
      fromState: 'Unpaid',
      toState: 'Overdue',
    })
  })
})
