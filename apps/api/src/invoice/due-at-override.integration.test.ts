/**
 * Real-PostgreSQL integration tests for staff dueAt override (T-04.1.03.03).
 *
 * Proves against actual PostgreSQL:
 *   - due_at is updated
 *   - customer-visible reason is stored in invoice metadata
 *   - an append-only invoice.due_at.override audit row is written
 *   - the two writes commit together (audit failure rolls back due_at)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { DUE_AT_OVERRIDE_EVENT } from '@barghsa/shared/finance'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { DueAtOverrideService } from './due-at-override.service.js'

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first')
    }
    return poolHolder.pool
  },
}))

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
const ACTOR_USER_ID = 'staff-due-at-override'
const ISSUED = new Date('2026-08-01T10:00:00.000Z')
const CURRENT_DUE = new Date('2026-08-08T10:00:00.000Z')
const NEW_DUE = new Date('2026-09-15T08:00:00.000Z')
const NOW = new Date('2026-08-02T12:00:00.000Z')
const REASON = 'Customer requested an extension after a billing delay'

describe('DueAtOverrideService — real PostgreSQL (T-04.1.03.03)', () => {
  let ctx: IsolatedTestDb
  let service: DueAtOverrideService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    service = new DueAtOverrideService(new InvoiceAuditRepository())

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.db.execute(`CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
    )`)
    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(PAID_OVERDUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())

    await ctx.db.execute(
      `INSERT INTO profiles (id) VALUES ('${PROFILE_ID}') ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO users (user_id) VALUES ('${ACTOR_USER_ID}') ON CONFLICT (user_id) DO NOTHING`,
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function insertUnpaidInvoice(): Promise<string> {
    const id = uuidv7()
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, issued_at, payable_from, due_at, metadata)
       VALUES ($1, $2, 'Unpaid', 1000000, $3, $3, $4, $5::jsonb)`,
      [
        id,
        PROFILE_ID,
        ISSUED,
        CURRENT_DUE,
        JSON.stringify({
          due: {
            dueAt: CURRENT_DUE.toISOString(),
            source: 'config',
            configDays: 7,
          },
        }),
      ],
    )
    return id
  }

  it('stores the override on due_at, metadata, and the audit log', async () => {
    const invoiceId = await insertUnpaidInvoice()
    const result = await service.override({
      invoiceId,
      raw: { dueAt: NEW_DUE.toISOString(), reason: REASON },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      correlationId: 'corr-due-at-override',
      now: NOW,
    })

    expect(result.dueAt).toBe(NEW_DUE.toISOString())
    expect(result.dueAtOverride?.reason).toBe(REASON)
    expect(result.dueAtOverride?.customerVisible).toBe(true)
    expect(result.auditId).toBeTruthy()

    const invoice = await ctx.pool.query<{
      due_at: Date
      metadata: Record<string, unknown>
    }>(`SELECT due_at, metadata FROM invoices WHERE id = $1`, [invoiceId])
    expect(invoice.rows[0]!.due_at.toISOString()).toBe(NEW_DUE.toISOString())
    const meta = invoice.rows[0]!.metadata
    expect(meta.dueAtOverride).toMatchObject({
      reason: REASON,
      customerVisible: true,
      dueAt: NEW_DUE.toISOString(),
      previousDueAt: CURRENT_DUE.toISOString(),
      actorUserId: ACTOR_USER_ID,
    })
    expect((meta.due as Record<string, unknown>).source).toBe('staff_override')

    const audit = await ctx.pool.query<{ event: string; metadata: string }>(
      `SELECT event, metadata FROM audit_log
       WHERE event = $1 AND metadata::jsonb ->> 'invoiceId' = $2`,
      [DUE_AT_OVERRIDE_EVENT, invoiceId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.event).toBe(DUE_AT_OVERRIDE_EVENT)
    const auditMeta = JSON.parse(audit.rows[0]!.metadata) as Record<string, unknown>
    expect(auditMeta.reason).toBe(REASON)
    expect(auditMeta.customerVisible).toBe(true)
    expect(auditMeta.newDueAt).toBe(NEW_DUE.toISOString())
    expect(auditMeta.previousDueAt).toBe(CURRENT_DUE.toISOString())
  })

  it('rolls back due_at when the audit insert fails', async () => {
    const invoiceId = await insertUnpaidInvoice()
    // Break the audit FK: actor with no users row fails the insert.
    const rejection = await service
      .override({
        invoiceId,
        raw: { dueAt: NEW_DUE.toISOString(), reason: REASON },
        actorUserId: 'missing-staff',
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((e: unknown) => e)

    expect(rejection).toBeInstanceOf(Error)

    const invoice = await ctx.pool.query<{ due_at: Date }>(
      `SELECT due_at FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    expect(invoice.rows[0]!.due_at.toISOString()).toBe(CURRENT_DUE.toISOString())

    const audit = await ctx.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE metadata::jsonb ->> 'invoiceId' = $1`,
      [invoiceId],
    )
    expect(audit.rows[0]!.n).toBe(0)
  })
})
