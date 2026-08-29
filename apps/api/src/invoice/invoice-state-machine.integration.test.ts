/**
 * Real-PostgreSQL integration tests for InvoiceStateMachineService
 * (T-04.1.01.06).
 *
 * Unlike the unit tests (which mock the pg client and therefore cannot see
 * real SQL behaviour), this suite runs the actual service code against a
 * Testcontainers-managed PostgreSQL 17 instance:
 *
 *   1. All happy-path transitions — every (from → to) pair in
 *      ALLOWED_TRANSITIONS is applied to a real invoice row and the new
 *      state, side-effect timestamps (issued_at, cancelled_at, paid_at,
 *      overdue_at) and the canonical `invoice.<label>` audit row are
 *      verified in the database.
 *   2. Every forbidden transition — each structural pair NOT in
 *      ALLOWED_TRANSITIONS is rejected with BadRequestException, leaves
 *      the stored state untouched, and writes no audit row.
 *   3. Amount-guarded rejections — the S-04.1.01 money rules (cannot
 *      reach Paid under-funded, cannot over-refund, etc.).
 *   4. Concurrent state change rejection — the `SELECT ... FOR UPDATE`
 *      row lock serializes racing transitions: exactly one wins and the
 *      other is rejected with a state-conflict error.
 *   5. Robustness — NotFound on a missing invoice and atomic rollback
 *      (the audit insert failure rolls back the state change).
 *
 * Wiring: only `getDbPool()` is stubbed (via vi.mock), handing the service
 * the schema-scoped pool of the isolated Testcontainers schema. Every SQL
 * statement, transaction, row lock, FK check and CHECK constraint runs
 * against real PostgreSQL.
 *
 * The integration run surfaced a real defect: the service emits `paid_at` /
 * `overdue_at` column updates that did not exist in the schema
 * (`column "paid_at" does not exist`, SQLSTATE 42703). Migration 0053 adds
 * the missing columns; the happy-path Paid/Overdue assertions below guard
 * the fix.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import {
  ALLOWED_TRANSITIONS,
  INVOICE_STATES,
  TRANSITION_LABELS,
  transitionName,
  type InvoiceState,
  type TransitionContext,
} from './invoice-state.model.js'

// ---- Real-DB wiring ------------------------------------------------------
// The only mock: @barghsa/db's pool getter, pointed at the schema-scoped
// Testcontainers pool. Everything below it is genuine PostgreSQL.
const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first')
    }
    return poolHolder.pool
  },
}))

// ---- Migrations / DDL -----------------------------------------------------
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
const ACTOR_USER_ID = 'actor-integration-test'

const TOTAL = 1_000_000n

/** Financial context + matching stored row amounts for each target state. */
function financialsFor(to: InvoiceState): TransitionContext | undefined {
  switch (to) {
    case 'Paid':
      return { paidAmount: TOTAL, totalAmount: TOTAL, refundedAmount: 0n }
    case 'Refunded':
      return { paidAmount: TOTAL, totalAmount: TOTAL, refundedAmount: TOTAL }
    case 'PartiallyFunded':
      return { paidAmount: TOTAL / 2n, totalAmount: TOTAL, refundedAmount: 0n }
    case 'PartiallyRefunded':
      return { paidAmount: TOTAL, totalAmount: TOTAL, refundedAmount: TOTAL / 5n }
    default:
      return undefined
  }
}

function transitionOpts(extra: { financials?: TransitionContext } = {}) {
  return {
    actorUserId: ACTOR_USER_ID,
    correlationId: 'corr-integration-01',
    ip: '10.0.0.1',
    reason: 'integration test',
    now: NOW,
    ...(extra.financials ? { financials: extra.financials } : {}),
  }
}

interface InvoiceRow {
  state: string
  issued_at: Date | null
  payable_from: Date | null
  cancelled_at: Date | null
  paid_at: Date | null
  overdue_at: Date | null
}

const NOW = new Date('2026-08-01T10:00:00.000Z')

describe('InvoiceStateMachineService — real PostgreSQL integration (T-04.1.01.06)', () => {
  let ctx: IsolatedTestDb
  let service: InvoiceStateMachineService

  beforeAll(async () => {
    // 4 connections so the concurrency tests can hold parallel transactions.
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    service = new InvoiceStateMachineService(new InvoiceAuditRepository())

    // --- DDL: uuid v7 fn, enum, minimal FK targets, then migrations in
    // production order (0052 → 0053) plus the audit_log table.
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

    // --- Seed data: one profile + one actor.
    await ctx.db.execute(
      `INSERT INTO profiles (id) VALUES ('${PROFILE_ID}')
       ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO users (user_id) VALUES ('${ACTOR_USER_ID}')
       ON CONFLICT (user_id) DO NOTHING`,
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  // ---- Helpers ------------------------------------------------------------

  async function insertInvoice(overrides: {
    state?: InvoiceState
    total?: bigint
    paid?: bigint
    refunded?: bigint
  } = {}): Promise<string> {
    const id = uuidv7()
    const state = overrides.state ?? 'Draft'
    const total = String(overrides.total ?? 0n)
    const paid = String(overrides.paid ?? 0n)
    const refunded = String(overrides.refunded ?? 0n)
    await ctx.db.execute(
      `INSERT INTO invoices (id, profile_id, state, total_amount, paid_amount, refunded_amount)
       VALUES ('${id}', '${PROFILE_ID}', '${state}', ${total}, ${paid}, ${refunded})`,
    )
    return id
  }

  async function fetchInvoice(invoiceId: string): Promise<InvoiceRow> {
    const result = await ctx.db.execute(
      `SELECT state, issued_at, payable_from, cancelled_at, paid_at, overdue_at
       FROM invoices WHERE id = '${invoiceId}'`,
    )
    const row = result.rows[0]
    if (!row) throw new Error(`invoice not found: ${invoiceId}`)
    return row as unknown as InvoiceRow
  }

  async function auditRows(invoiceId: string): Promise<Array<Record<string, unknown>>> {
    const result = await ctx.db.execute(
      `SELECT id, user_id, event, metadata, correlation_id, ip, created_at
       FROM audit_log
       WHERE metadata::jsonb ->> 'invoiceId' = '${invoiceId}'
       ORDER BY created_at ASC, id ASC`,
    )
    return result.rows as Array<Record<string, unknown>>
  }

  function ts(value: Date | string | null): string | null {
    if (!value) return null
    return new Date(value).toISOString()
  }

  /** Side-effect timestamps the service should have written for a pair. */
  function expectedTimestamps(transition: string, to: InvoiceState) {
    return {
      issued_at: transition === 'Issue' ? NOW : null,
      payable_from: transition === 'Issue' ? NOW : null,
      cancelled_at: transition === 'Cancel' ? NOW : null,
      paid_at: to === 'Paid' ? NOW : null,
      overdue_at: transition === 'MarkOverdue' ? NOW : null,
    }
  }

  // ---- 1. Happy-path transitions -------------------------------------------

  ;(Object.keys(ALLOWED_TRANSITIONS) as InvoiceState[]).forEach((from) => {
    for (const to of ALLOWED_TRANSITIONS[from]) {
      it(`happy-path: ${from} → ${to} commits state, timestamps and audit row`, async () => {
        const name = transitionName(from, to)!
        const fin = financialsFor(to)
        const invoiceId = await insertInvoice({
          state: from,
          ...(fin
            ? { total: fin.totalAmount, paid: fin.paidAmount, refunded: fin.refundedAmount }
            : {}),
        })
        const opts = fin ? transitionOpts({ financials: fin }) : transitionOpts()

        const result = await service.transition(invoiceId, from, to, opts)

        expect(result).toMatchObject({
          invoiceId,
          fromState: from,
          toState: to,
          transition: name,
        })
        expect(result.auditId).toBeTruthy()

        // Stored state + side-effect timestamps exactly as the service set them.
        const row = await fetchInvoice(invoiceId)
        expect(row.state).toBe(to)
        const expected = expectedTimestamps(name, to)
        expect(ts(row.issued_at)).toBe(ts(expected.issued_at))
        expect(ts(row.payable_from)).toBe(ts(expected.payable_from))
        expect(ts(row.cancelled_at)).toBe(ts(expected.cancelled_at))
        expect(ts(row.paid_at)).toBe(ts(expected.paid_at))
        expect(ts(row.overdue_at)).toBe(ts(expected.overdue_at))

        // Exactly one canonical audit row, committed in the same transaction.
        const audits = await auditRows(invoiceId)
        expect(audits).toHaveLength(1)
        expect(audits[0]!.user_id).toBe(ACTOR_USER_ID)
        expect(audits[0]!.event).toBe(`invoice.${TRANSITION_LABELS[name]}`)
        const metadata = JSON.parse(audits[0]!.metadata as string) as Record<string, unknown>
        expect(metadata).toMatchObject({
          invoiceId,
          fromState: from,
          toState: to,
          transition: TRANSITION_LABELS[name],
          reason: 'integration test',
        })
        expect(audits[0]!.correlation_id).toBe('corr-integration-01')
        expect(audits[0]!.ip).toBe('10.0.0.1')
        expect(new Date(audits[0]!.created_at as string).toISOString()).toBe(NOW.toISOString())
      })
    }
  })

  // ---- 2. Every forbidden transition ---------------------------------------

  it('rejects every structural-forbidden transition, leaves state untouched, writes no audit row', async () => {
    for (const from of INVOICE_STATES) {
      const forbidden = INVOICE_STATES.filter((s) => !ALLOWED_TRANSITIONS[from].includes(s))
      for (const to of forbidden) {
        const invoiceId = await insertInvoice({ state: from })

        try {
          await service.transition(invoiceId, from, to, transitionOpts())
          throw new Error(`expected ${from} → ${to} to be rejected`)
        } catch (err) {
          expect(err, `${from} → ${to} should throw BadRequestException`).toBeInstanceOf(
            BadRequestException,
          )
          expect(String((err as Error).message)).toContain(
            `Illegal transition from '${from}' to '${to}'`,
          )
        }

        // State unchanged, no side-effect timestamps, no audit side effects.
        const row = await fetchInvoice(invoiceId)
        expect(row.state, `${from} → ${to} must not change state`).toBe(from)
        expect(row.issued_at).toBeNull()
        expect(row.cancelled_at).toBeNull()
        expect(row.paid_at).toBeNull()
        expect(row.overdue_at).toBeNull()
        expect(await auditRows(invoiceId)).toHaveLength(0)
      }
    }
  })

  // ---- 3. Amount-guarded rejections (S-04.1.01 money rules) ----------------

  it('rejects reaching Paid while confirmed amount is below total', async () => {
    const invoiceId = await insertInvoice({ state: 'Unpaid', total: TOTAL })
    await expect(
      service.transition(
        invoiceId,
        'Unpaid',
        'Paid',
        transitionOpts({
          financials: { paidAmount: TOTAL / 2n, totalAmount: TOTAL, refundedAmount: 0n },
        }),
      ),
    ).rejects.toMatchObject({
      message: 'Cannot reach Paid: confirmed amount 500000 is less than total 1000000',
    })
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(await auditRows(invoiceId)).toHaveLength(0)
  })

  it('rejects entering PartiallyFunded with zero confirmed amount', async () => {
    const invoiceId = await insertInvoice({ state: 'PaymentUnderReview', total: TOTAL })
    await expect(
      service.transition(
        invoiceId,
        'PaymentUnderReview',
        'PartiallyFunded',
        transitionOpts({
          financials: { paidAmount: 0n, totalAmount: TOTAL, refundedAmount: 0n },
        }),
      ),
    ).rejects.toMatchObject({ message: 'Cannot enter PartiallyFunded with zero confirmed amount' })
    expect((await fetchInvoice(invoiceId)).state).toBe('PaymentUnderReview')
    expect(await auditRows(invoiceId)).toHaveLength(0)
  })

  it('rejects entering PartiallyFunded when the amount already covers the total', async () => {
    const invoiceId = await insertInvoice({ state: 'PaymentUnderReview', total: TOTAL })
    await expect(
      service.transition(
        invoiceId,
        'PaymentUnderReview',
        'PartiallyFunded',
        transitionOpts({
          financials: { paidAmount: TOTAL, totalAmount: TOTAL, refundedAmount: 0n },
        }),
      ),
    ).rejects.toMatchObject({
      message: 'Cannot enter PartiallyFunded: confirmed amount 1000000 already covers total 1000000',
    })
    expect((await fetchInvoice(invoiceId)).state).toBe('PaymentUnderReview')
    expect(await auditRows(invoiceId)).toHaveLength(0)
  })

  it('rejects a full refund unless refunded equals paid', async () => {
    const invoiceId = await insertInvoice({ state: 'Paid', total: TOTAL, paid: TOTAL })
    await expect(
      service.transition(
        invoiceId,
        'Paid',
        'Refunded',
        transitionOpts({
          financials: { paidAmount: TOTAL, totalAmount: TOTAL, refundedAmount: TOTAL / 2n },
        }),
      ),
    ).rejects.toMatchObject({
      message: 'Cannot reach Refunded: refunded 500000 does not equal paid 1000000',
    })
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
    expect(await auditRows(invoiceId)).toHaveLength(0)
  })

  it('rejects a partial refund that would exceed the paid amount', async () => {
    const invoiceId = await insertInvoice({ state: 'Paid', total: TOTAL, paid: TOTAL })
    await expect(
      service.transition(
        invoiceId,
        'Paid',
        'PartiallyRefunded',
        transitionOpts({
          financials: { paidAmount: TOTAL, totalAmount: TOTAL, refundedAmount: TOTAL + 1n },
        }),
      ),
    ).rejects.toMatchObject({
      message: 'Partial refund would make refunded 1000001 exceed paid 1000000',
    })
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
    expect(await auditRows(invoiceId)).toHaveLength(0)
  })

  // ---- 4. Concurrent state change rejection ---------------------------------

  it('lets exactly one of two racing transitions win; the other is rejected with a state conflict', async () => {
    const invoiceId = await insertInvoice({ state: 'Unpaid', total: TOTAL, paid: TOTAL })
    const opts = transitionOpts({ financials: { paidAmount: TOTAL, totalAmount: TOTAL, refundedAmount: 0n } })

    const results = await Promise.allSettled([
      service.transition(invoiceId, 'Unpaid', 'Paid', opts),
      service.transition(invoiceId, 'Unpaid', 'Paid', opts),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const reason = (rejected[0] as PromiseRejectedResult).reason as Error
    expect(reason).toBeInstanceOf(BadRequestException)
    expect(String(reason.message)).toContain('state conflict')

    // Exactly one winner, exactly one audit row; state is Paid.
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
    const audits = await auditRows(invoiceId)
    expect(audits).toHaveLength(1)
    expect(audits[0]!.event).toBe('invoice.pay_from_wallet')
  })

  it('rejects a transition whose caller passes a stale from-state', async () => {
    const invoiceId = await insertInvoice({ state: 'Unpaid' })

    // Caller still believes the invoice is Draft.
    const err = await service
      .transition(invoiceId, 'Draft', 'Unpaid', transitionOpts())
      .then(
        () => {
          throw new Error('expected state conflict')
        },
        (e: unknown) => e,
      )

    expect(err).toBeInstanceOf(BadRequestException)
    expect(String((err as Error).message)).toContain(
      `state conflict: expected 'Draft', current 'Unpaid'`,
    )
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(await auditRows(invoiceId)).toHaveLength(0)
  })

  // ---- 5. Robustness --------------------------------------------------------

  it('throws NotFoundException for a missing invoice and writes nothing', async () => {
    await expect(
      service.transition(uuidv7(), 'Draft', 'Unpaid', transitionOpts()),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rolls back the state change atomically when the audit insert fails', async () => {
    const invoiceId = await insertInvoice({ state: 'Draft' })

    await expect(
      service.transition(invoiceId, 'Draft', 'Unpaid', {
        actorUserId: 'ghost-user-not-in-users-table',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException)

    // The row lock, UPDATE and audit INSERT all rolled back together.
    expect((await fetchInvoice(invoiceId)).state).toBe('Draft')
    expect(await auditRows(invoiceId)).toHaveLength(0)
  })
})