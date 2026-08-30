import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { invoiceReminderSchedule } from './invoice-reminder-schedule.js'
import { invoices } from './invoices.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0060_create_invoice_reminder_schedule.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')

async function retryOnDeadlock<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if ((err as { code?: string }).code !== '40P01' || attempt === 7) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt))
    }
  }
  throw lastError
}

/**
 * Drift guard + real-PostgreSQL enforcement for invoice_reminder_schedule
 * (T-04.1.04.01).
 *
 * CHECKs, the sent_at/status pairing, lookup indexes, and the `updated_at`
 * trigger live in the hand-written migration 0060 (Drizzle v0.40's column
 * builder has no `.check()` on createTable). This file asserts the
 * migration still declares them, that the drizzle schema matches the
 * S-04.1.04 column set, and that PostgreSQL actually enforces the
 * invariants.
 */
describe('invoice_reminder_schedule schema (T-04.1.04.01)', () => {
  it('declares the domain columns expected by the reminder workers', () => {
    const columns = Object.keys(invoiceReminderSchedule)
    for (const column of ['invoiceId', 'offset', 'channel', 'scheduledAt', 'sentAt', 'status']) {
      expect(columns).toContain(column)
    }
  })

  it('Drizzle schema mirrors the SQL column set', () => {
    const names = getTableConfig(invoiceReminderSchedule).columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'invoice_id',
        'offset',
        'channel',
        'scheduled_at',
        'sent_at',
        'status',
        'created_at',
        'updated_at',
      ]),
    )
  })

  it('invoice_id references invoices with CASCADE', () => {
    const fks = getTableConfig(invoiceReminderSchedule).foreignKeys
    const invoiceFk = fks.find((fk) => fk.reference().foreignTable === invoices)
    expect(invoiceFk).toBeDefined()
    expect(invoiceFk!.onDelete).toBe('cascade')
  })

  it('migration 0060 still declares the constraints the table relies on', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS invoice_reminder_schedule')
    expect(MIGRATION).toContain('CHECK ("offset" IN (-7, -3, -1, 0, 1, 7))')
    expect(MIGRATION).toContain("CHECK (channel IN ('in_app', 'email', 'sms'))")
    expect(MIGRATION).toContain("CHECK (status IN ('scheduled', 'sent', 'cancelled'))")
    expect(MIGRATION).toContain("status = 'sent' AND sent_at IS NOT NULL")
    expect(MIGRATION).toContain("status <> 'sent' AND sent_at IS NULL")
    expect(MIGRATION).toContain('REFERENCES invoices(id) ON DELETE CASCADE')
    expect(MIGRATION).toContain('trg_invoice_reminder_schedule_updated_at')
    expect(MIGRATION).toContain('idx_invoice_reminder_schedule_invoice_id')
    expect(MIGRATION).toContain('idx_invoice_reminder_schedule_due')
    expect(MIGRATION).toContain("WHERE status = 'scheduled'")
  })

  it('migration 0060 does not create the T-04.1.04.04 unique index', () => {
    expect(MIGRATION).not.toMatch(/CREATE\s+UNIQUE\s+INDEX/i)
    expect(MIGRATION).not.toMatch(/UNIQUE\s*\(\s*invoice_id/i)
    expect(MIGRATION).toContain('T-04.1.04.04')
  })

  it('migration 0060 is idempotent (matching sibling migrations)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS invoice_reminder_schedule')
    expect(MIGRATION).toContain(
      'DROP TRIGGER IF EXISTS trg_invoice_reminder_schedule_updated_at',
    )
    expect(MIGRATION).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_invoice_id',
    )
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_due')
  })

  it('migration 0060 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0060_create_invoice_reminder_schedule',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(60)
    const prior = journal.entries.find((row) => row.tag === '0059_create_service_due_periods')
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('invoice_reminder_schedule PostgreSQL enforcement (T-04.1.04.01)', () => {
  let ctx: IsolatedTestDb
  let invoiceId: string

  async function insertSchedule(opts: {
    invoiceId?: string
    offset?: number
    channel?: string
    scheduledAt?: string
    sentAt?: string | null
    status?: string
  } = {}): Promise<string> {
    const result = await ctx.pool.query<{ id: string }>(
      `INSERT INTO invoice_reminder_schedule
         (invoice_id, "offset", channel, scheduled_at, sent_at, status)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6)
       RETURNING id`,
      [
        opts.invoiceId ?? invoiceId,
        opts.offset ?? -7,
        opts.channel ?? 'in_app',
        opts.scheduledAt ?? '2026-09-01T09:00:00.000Z',
        opts.sentAt === undefined ? null : opts.sentAt,
        opts.status ?? 'scheduled',
      ],
    )
    return result.rows[0]!.id
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TYPE invoice_state AS ENUM (
        'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
        'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
      )
    `)
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.db.execute(sql`
      INSERT INTO profiles (id) VALUES (uuid_generate_v7())
    `)

    const invoicesSql = readFileSync(INVOICES_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(invoicesSql)

    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  beforeEach(async () => {
    await retryOnDeadlock(() =>
      ctx.db.execute(sql`TRUNCATE invoice_reminder_schedule, invoices CASCADE`),
    )
    const inserted = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (profile_id, total_amount)
      VALUES ((SELECT id FROM profiles LIMIT 1), 1000000)
      RETURNING id
    `)
    invoiceId = inserted.rows[0]!.id
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('accepts a valid scheduled in-app reminder 7 days before due', async () => {
    const id = await insertSchedule()
    const row = await ctx.db.execute<{
      offset: number
      channel: string
      status: string
      sent_at: Date | null
    }>(sql`
      SELECT "offset", channel, status, sent_at
      FROM invoice_reminder_schedule
      WHERE id = ${id}
    `)
    expect(row.rows[0]).toMatchObject({
      offset: -7,
      channel: 'in_app',
      status: 'scheduled',
      sent_at: null,
    })
  })

  it('accepts every canonical offset and channel', async () => {
    for (const offset of [-7, -3, -1, 0, 1, 7] as const) {
      await expect(insertSchedule({ offset, channel: 'email' })).resolves.toBeTruthy()
    }
    await expect(insertSchedule({ offset: 0, channel: 'sms' })).resolves.toBeTruthy()
  })

  it('defaults status to scheduled when omitted', async () => {
    const result = await ctx.pool.query<{ status: string; sent_at: Date | null }>(
      `INSERT INTO invoice_reminder_schedule
         (invoice_id, "offset", channel, scheduled_at)
       VALUES ($1, -1, 'in_app', '2026-09-07T09:00:00.000Z')
       RETURNING status, sent_at`,
      [invoiceId],
    )
    expect(result.rows[0]).toMatchObject({ status: 'scheduled', sent_at: null })
  })

  it('accepts a sent row with sent_at set', async () => {
    await expect(
      insertSchedule({
        offset: 0,
        channel: 'email',
        status: 'sent',
        sentAt: '2026-09-08T09:05:00.000Z',
      }),
    ).resolves.toBeTruthy()
  })

  it('rejects an offset outside the canonical set', async () => {
    await expect(insertSchedule({ offset: -14 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_invoice_reminder_schedule_offset'),
    })
    await expect(insertSchedule({ offset: 2 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_invoice_reminder_schedule_offset'),
    })
  })

  it('rejects an unknown channel', async () => {
    await expect(insertSchedule({ channel: 'push' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_invoice_reminder_schedule_channel'),
    })
  })

  it('rejects an unknown status', async () => {
    await expect(insertSchedule({ status: 'failed' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_invoice_reminder_schedule_status'),
    })
  })

  it('rejects sent without sent_at and scheduled/cancelled with sent_at', async () => {
    await expect(insertSchedule({ status: 'sent', sentAt: null })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_invoice_reminder_schedule_sent_at'),
    })
    await expect(
      insertSchedule({ status: 'scheduled', sentAt: '2026-09-01T09:00:00.000Z' }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_invoice_reminder_schedule_sent_at'),
    })
    await expect(
      insertSchedule({ status: 'cancelled', sentAt: '2026-09-01T09:00:00.000Z' }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_invoice_reminder_schedule_sent_at'),
    })
  })

  it('rejects a missing invoice (FK)', async () => {
    await expect(
      insertSchedule({ invoiceId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('cascades deletes from invoices to schedule rows', async () => {
    await insertSchedule({ offset: -3, channel: 'sms' })
    await ctx.db.execute(sql`DELETE FROM invoices WHERE id = ${invoiceId}`)
    const remaining = await ctx.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM invoice_reminder_schedule
    `)
    expect(remaining.rows[0]!.count).toBe('0')
  })

  it('allows duplicate (invoice, offset, channel) until T-04.1.04.04', async () => {
    await insertSchedule({ offset: -7, channel: 'in_app' })
    await expect(insertSchedule({ offset: -7, channel: 'in_app' })).resolves.toBeTruthy()
  })

  it('creates the lookup indexes and updated_at trigger', async () => {
    const indexes = await ctx.db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = ${ctx.schemaName}
        AND indexname IN (
          'idx_invoice_reminder_schedule_invoice_id',
          'idx_invoice_reminder_schedule_due'
        )
      ORDER BY indexname
    `)
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'idx_invoice_reminder_schedule_due',
      'idx_invoice_reminder_schedule_invoice_id',
    ])

    const id = await insertSchedule({ offset: 1, channel: 'in_app' })
    const before = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM invoice_reminder_schedule WHERE id = ${id}
    `)
    await ctx.db.execute(sql`
      UPDATE invoice_reminder_schedule SET status = 'cancelled' WHERE id = ${id}
    `)
    const after = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM invoice_reminder_schedule WHERE id = ${id}
    `)
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.rows[0]!.updated_at).getTime(),
    )
  })

  it('migration 0060 is idempotent — re-running keeps enforcement', async () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    await expect(insertSchedule({ offset: 14 })).rejects.toMatchObject({
      code: '23514',
    })
  })
})
