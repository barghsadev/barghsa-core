import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { invoiceReminderSchedule } from './invoice-reminder-schedule.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const TABLE_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0060_create_invoice_reminder_schedule.sql',
)
const IDEMPOTENCY_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0061_add_invoice_reminder_schedule_idempotency.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(IDEMPOTENCY_MIGRATION, 'utf8')

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
 * Drift guard + real-PostgreSQL enforcement for the reminder-schedule
 * idempotency unique index (T-04.1.04.04).
 *
 * Migration 0060 intentionally omitted UNIQUE (invoice_id, offset,
 * channel). This file asserts migration 0061 still declares that index,
 * that the Drizzle schema matches, and that PostgreSQL actually refuses
 * a second row for the same triple.
 */
describe('invoice_reminder_schedule unique index schema (T-04.1.04.04)', () => {
  it('Drizzle schema declares the unique (invoiceId, offset, channel) index', () => {
    const { indexes } = getTableConfig(invoiceReminderSchedule)
    const unique = indexes.find(
      (idx) => idx.config.name === 'uq_invoice_reminder_schedule_invoice_offset_channel',
    )
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
  })

  it('migration 0061 still declares the unique index on (invoice_id, offset, channel)', () => {
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_reminder_schedule_invoice_offset_channel',
    )
    expect(MIGRATION).toMatch(
      /ON invoice_reminder_schedule \(invoice_id, "offset", channel\)/,
    )
  })

  it('migration 0061 collapses pre-existing duplicates before indexing', () => {
    expect(MIGRATION).toContain('PARTITION BY invoice_id, "offset", channel')
    expect(MIGRATION).toContain("WHEN 'sent' THEN 0")
    expect(MIGRATION).toContain("WHEN 'scheduled' THEN 1")
  })

  it('migration 0061 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0061_add_invoice_reminder_schedule_idempotency',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(61)
    const prior = journal.entries.find(
      (row) => row.tag === '0060_create_invoice_reminder_schedule',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('invoice_reminder_schedule unique index PostgreSQL enforcement (T-04.1.04.04)', () => {
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

    const tableSql = readFileSync(TABLE_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(tableSql)

    const migrationSql = readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim()
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

  it('creates the unique index', async () => {
    const idx = await ctx.db.execute<{ index_name: string }>(sql`
      SELECT indexname AS index_name FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'invoice_reminder_schedule'
        AND indexname = 'uq_invoice_reminder_schedule_invoice_offset_channel'
    `)
    expect(idx.rows).toHaveLength(1)
  })

  it('rejects a second row for the same (invoice, offset, channel)', async () => {
    await expect(insertSchedule({ offset: -7, channel: 'in_app' })).resolves.toBeTruthy()
    await expect(insertSchedule({ offset: -7, channel: 'in_app' })).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('allows the same offset on a different channel', async () => {
    await expect(insertSchedule({ offset: 0, channel: 'in_app' })).resolves.toBeTruthy()
    await expect(insertSchedule({ offset: 0, channel: 'email' })).resolves.toBeTruthy()
    await expect(insertSchedule({ offset: 0, channel: 'sms' })).resolves.toBeTruthy()
  })

  it('allows the same channel on a different offset', async () => {
    await expect(insertSchedule({ offset: -7, channel: 'email' })).resolves.toBeTruthy()
    await expect(insertSchedule({ offset: -3, channel: 'email' })).resolves.toBeTruthy()
  })

  it('allows the same (offset, channel) on a different invoice', async () => {
    const other = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (profile_id, total_amount)
      VALUES ((SELECT id FROM profiles LIMIT 1), 500000)
      RETURNING id
    `)
    await expect(insertSchedule({ offset: 1, channel: 'sms' })).resolves.toBeTruthy()
    await expect(
      insertSchedule({ invoiceId: other.rows[0]!.id, offset: 1, channel: 'sms' }),
    ).resolves.toBeTruthy()
  })

  it('migration 0061 is idempotent — re-running is a no-op', async () => {
    const migrationSql = readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    const idx = await ctx.db.execute<{ index_name: string }>(sql`
      SELECT indexname AS index_name FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'invoice_reminder_schedule'
        AND indexname = 'uq_invoice_reminder_schedule_invoice_offset_channel'
    `)
    expect(idx.rows).toHaveLength(1)

    await insertSchedule({ offset: 7, channel: 'in_app' })
    await expect(insertSchedule({ offset: 7, channel: 'in_app' })).rejects.toMatchObject({
      code: '23505',
    })
  })
})

describe('invoice_reminder_schedule unique index duplicate collapse (T-04.1.04.04)', () => {
  let ctx: IsolatedTestDb
  let invoiceId: string

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

    const tableSql = readFileSync(TABLE_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(tableSql)

    const inserted = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (profile_id, total_amount)
      VALUES ((SELECT id FROM profiles LIMIT 1), 1000000)
      RETURNING id
    `)
    invoiceId = inserted.rows[0]!.id

    // Pre-0061 duplicates: a sent row plus a later scheduled twin, and two
    // scheduled twins. Collapse must keep `sent` and the earliest scheduled.
    await ctx.pool.query(
      `INSERT INTO invoice_reminder_schedule
         (invoice_id, "offset", channel, scheduled_at, sent_at, status)
       VALUES
         ($1, -7, 'in_app', '2026-09-01T09:00:00.000Z', '2026-09-01T09:05:00.000Z', 'sent'),
         ($1, -7, 'in_app', '2026-09-01T09:00:00.000Z', NULL, 'scheduled'),
         ($1, -3, 'email', '2026-09-04T09:00:00.000Z', NULL, 'scheduled'),
         ($1, -3, 'email', '2026-09-04T10:00:00.000Z', NULL, 'scheduled')`,
      [invoiceId],
    )

    const migrationSql = readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('keeps the sent row when a scheduled duplicate exists', async () => {
    const rows = await ctx.db.execute<{
      offset: number
      channel: string
      status: string
      sent_at: Date | null
    }>(sql`
      SELECT "offset", channel, status, sent_at
      FROM invoice_reminder_schedule
      WHERE invoice_id = ${invoiceId} AND "offset" = -7 AND channel = 'in_app'
    `)
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({
      offset: -7,
      channel: 'in_app',
      status: 'sent',
    })
    expect(rows.rows[0]!.sent_at).not.toBeNull()
  })

  it('keeps a single scheduled row for a scheduled-only duplicate set', async () => {
    const rows = await ctx.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM invoice_reminder_schedule
      WHERE invoice_id = ${invoiceId} AND "offset" = -3 AND channel = 'email'
    `)
    expect(rows.rows[0]!.count).toBe('1')
  })

  it('leaves at most one row per (invoice, offset, channel)', async () => {
    const dups = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM (
        SELECT invoice_id, "offset", channel
        FROM invoice_reminder_schedule
        GROUP BY invoice_id, "offset", channel
        HAVING COUNT(*) > 1
      ) d
    `)
    expect(dups.rows[0]!.c).toBe('0')
  })
})
