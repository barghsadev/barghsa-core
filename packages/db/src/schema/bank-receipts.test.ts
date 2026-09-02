import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema, seedBankReceiptsPrerequisites } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { bankReceipts, createBankReceiptsTable } from './bank-receipts.js'
import { createInvoicesTable, invoices } from './invoices.js'
import { profiles } from './profiles.js'
import { users } from './users.js'

function sqlToString(query: { queryChunks: readonly unknown[] }): string {
  return query.queryChunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk
      if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        const value = (chunk as { value: unknown }).value
        if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
          return value.join('')
        }
      }
      return ''
    })
    .join('')
}

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const MIGRATION_PATH = resolve(__dirname, '../../drizzle/0078_create_bank_receipts.sql')
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for bank_receipts
 * (T-04.3.01.01).
 *
 * CHECKs, lookup indexes, the unique attachment index, the
 * composite invoice/profile FK, the `confirmed_by` users FK, and the
 * `updated_at` trigger live in hand-written migration 0078. This file
 * asserts the migration still declares them, that the Drizzle schema
 * matches the S-04.3.01 column set, and that PostgreSQL actually
 * enforces the invariants (including rejecting a mismatched
 * invoice/profile pair).
 */
describe('bank_receipts schema (T-04.3.01.01)', () => {
  it('declares the domain columns expected by later receipt workers', () => {
    const columns = Object.keys(bankReceipts)
    for (const column of [
      'id',
      'invoiceId',
      'profileId',
      'amount',
      'paymentDate',
      'payerReference',
      'attachmentKey',
      'customerNote',
      'state',
      'confirmedBy',
      'confirmedAt',
      'rejectionReason',
      'createdAt',
      'updatedAt',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('Drizzle schema mirrors the SQL column set', () => {
    const names = getTableConfig(bankReceipts).columns.map((c) => c.name)
    expect(names).toEqual([
      'id',
      'created_at',
      'updated_at',
      'invoice_id',
      'profile_id',
      'amount',
      'payment_date',
      'payer_reference',
      'attachment_key',
      'customer_note',
      'state',
      'confirmed_by',
      'confirmed_at',
      'rejection_reason',
    ])
  })

  it('invoice_id+profile_id composite FK binds the receipt to the invoice owner', () => {
    const fks = getTableConfig(bankReceipts).foreignKeys
    const invoiceFk = fks.find((fk) => fk.reference().foreignTable === invoices)
    const profileFk = fks.find((fk) => fk.reference().foreignTable === profiles)
    const userFk = fks.find((fk) => fk.reference().foreignTable === users)
    expect(invoiceFk).toBeDefined()
    expect(invoiceFk!.onDelete).toBe('restrict')
    expect(invoiceFk!.reference().columns.map((c) => c.name)).toEqual([
      'invoice_id',
      'profile_id',
    ])
    expect(invoiceFk!.reference().foreignColumns.map((c) => c.name)).toEqual([
      'id',
      'profile_id',
    ])
    expect(profileFk).toBeDefined()
    expect(profileFk!.onDelete).toBe('restrict')
    expect(userFk).toBeDefined()
    expect(userFk!.onDelete).toBe('restrict')
  })

  it('invoices declares unique (id, profile_id) as the composite FK target', () => {
    const config = getTableConfig(invoices)
    const uniqueConstraint = config.uniqueConstraints.find(
      (constraint) => (constraint.name ?? constraint.getName()) === 'uq_invoices_id_profile_id',
    )
    const uniqueIndex = config.indexes.find(
      (idx) => idx.config.name === 'uq_invoices_id_profile_id',
    )
    expect(uniqueConstraint ?? uniqueIndex).toBeDefined()
    if (uniqueConstraint) {
      expect(uniqueConstraint.columns.map((c) => c.name)).toEqual(['id', 'profile_id'])
    }
  })

  it('Drizzle schema declares the CHECKs and unique attachment index', () => {
    const config = getTableConfig(bankReceipts)
    const checkNames = config.checks.map((c) => String(c.name))
    expect(checkNames).toEqual(
      expect.arrayContaining([
        'chk_bank_receipts_amount_positive',
        'chk_bank_receipts_state',
        'chk_bank_receipts_payer_reference_nonblank',
        'chk_bank_receipts_attachment_key_nonblank',
        'chk_bank_receipts_state_fields',
      ]),
    )
    const unique = config.indexes.find(
      (idx) => idx.config.name === 'uq_bank_receipts_attachment_key',
    )
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
  })

  it('optional confirmation and rejection columns are nullable', () => {
    const byName = Object.fromEntries(
      getTableConfig(bankReceipts).columns.map((column) => [column.name, column]),
    )
    expect(byName.customer_note?.notNull).toBe(false)
    expect(byName.confirmed_by?.notNull).toBe(false)
    expect(byName.confirmed_at?.notNull).toBe(false)
    expect(byName.rejection_reason?.notNull).toBe(false)
    expect(byName.payment_date?.getSQLType()).toBe('date')
    expect(byName.amount?.getSQLType()).toBe('bigint')
  })

  it('migration 0078 still declares the constraints the table relies on', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS bank_receipts')
    expect(MIGRATION).toContain('uq_invoices_id_profile_id UNIQUE (id, profile_id)')
    expect(MIGRATION).toContain('fk_bank_receipts_invoice_profile')
    expect(MIGRATION).toContain(
      'FOREIGN KEY (invoice_id, profile_id)\n    REFERENCES invoices(id, profile_id) ON DELETE RESTRICT',
    )
    expect(MIGRATION).toContain('REFERENCES profiles(id) ON DELETE RESTRICT')
    expect(MIGRATION).toContain('CHECK (amount > 0)')
    expect(MIGRATION).toContain(
      "CHECK (state IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected'))",
    )
    expect(MIGRATION).toContain('chk_bank_receipts_state_fields')
    expect(MIGRATION).toContain("state = 'Confirmed'")
    expect(MIGRATION).toContain("state = 'Rejected'")
    expect(MIGRATION).toContain('fk_bank_receipts_confirmed_by')
    expect(MIGRATION).toContain('REFERENCES users(user_id) ON DELETE RESTRICT')
    expect(MIGRATION).toContain('idx_bank_receipts_invoice_id')
    expect(MIGRATION).toContain('idx_bank_receipts_profile_id')
    expect(MIGRATION).toContain('idx_bank_receipts_state')
    expect(MIGRATION).toContain('uq_bank_receipts_attachment_key')
    expect(MIGRATION).toContain('trg_bank_receipts_updated_at')
    expect(MIGRATION).toContain('payment_date DATE NOT NULL')
  })

  it('migration 0078 is idempotent and fails closed when FK targets are missing', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS bank_receipts')
    expect(MIGRATION).not.toMatch(/to_regclass\('invoices'\)/)
    expect(MIGRATION).not.toMatch(/to_regclass\('profiles'\)/)
    expect(MIGRATION).not.toMatch(/to_regclass\('users'\)/)
    expect(MIGRATION).toContain('uq_invoices_id_profile_id')
    expect(MIGRATION).toContain(
      'FOREIGN KEY (invoice_id, profile_id)\n    REFERENCES invoices(id, profile_id) ON DELETE RESTRICT',
    )
    expect(MIGRATION).toContain('REFERENCES profiles(id) ON DELETE RESTRICT')
    expect(MIGRATION).toContain('REFERENCES users(user_id) ON DELETE RESTRICT')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_bank_receipts_invoice_id')
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_receipts_attachment_key')
    expect(MIGRATION).toContain('DROP TRIGGER IF EXISTS trg_bank_receipts_updated_at')
  })

  it('createBankReceiptsTable adds uq_invoices_id_profile_id before CREATE TABLE', () => {
    const helperSql = sqlToString(createBankReceiptsTable)
    const uniquePos = helperSql.indexOf('uq_invoices_id_profile_id UNIQUE (id, profile_id)')
    const createPos = helperSql.indexOf('CREATE TABLE IF NOT EXISTS bank_receipts')
    expect(uniquePos).toBeGreaterThanOrEqual(0)
    expect(createPos).toBeGreaterThan(uniquePos)
  })

  it('createInvoicesTable declares uq_invoices_id_profile_id', () => {
    expect(sqlToString(createInvoicesTable)).toContain(
      'CONSTRAINT uq_invoices_id_profile_id UNIQUE (id, profile_id)',
    )
  })

  it('migration 0078 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === '0078_create_bank_receipts')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(78)
    const prior = journal.entries.find(
      (row) => row.tag === '0077_wallet_tx_reversal_original_check',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('bank_receipts PostgreSQL enforcement (T-04.3.01.01)', () => {
  let ctx: IsolatedTestDb
  let invoiceId: string
  let profileId: string
  const staffUserId = 'staff-finance-1'

  async function insertReceipt(
    opts: {
      invoiceId?: string
      profileId?: string
      amount?: number
      paymentDate?: string
      payerReference?: string
      attachmentKey?: string
      customerNote?: string | null
      state?: string
      confirmedBy?: string | null
      confirmedAt?: string | null
      rejectionReason?: string | null
    } = {},
  ): Promise<string> {
    const result = await ctx.pool.query<{ id: string }>(
      `INSERT INTO bank_receipts
         (invoice_id, profile_id, amount, payment_date, payer_reference,
          attachment_key, customer_note, state, confirmed_by, confirmed_at,
          rejection_reason)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10::timestamptz, $11)
       RETURNING id`,
      [
        opts.invoiceId ?? invoiceId,
        opts.profileId ?? profileId,
        opts.amount ?? 1_000_000,
        opts.paymentDate ?? '2026-08-15',
        opts.payerReference ?? 'REF-1001',
        opts.attachmentKey ?? `uploads/document/${crypto.randomUUID()}.pdf`,
        opts.customerNote === undefined ? null : opts.customerNote,
        opts.state ?? 'Submitted',
        opts.confirmedBy === undefined ? null : opts.confirmedBy,
        opts.confirmedAt === undefined ? null : opts.confirmedAt,
        opts.rejectionReason === undefined ? null : opts.rejectionReason,
      ],
    )
    return result.rows[0]!.id
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)
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

    const invoicesSql = readFileSync(INVOICES_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(invoicesSql)

    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)

    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1)`, [staffUserId])
  }, 60_000)

  beforeEach(async () => {
    await ctx.db.execute(sql`TRUNCATE bank_receipts, invoices, profiles CASCADE`)
    const profile = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO profiles (id) VALUES (uuid_generate_v7()) RETURNING id
    `)
    profileId = profile.rows[0]!.id
    const invoice = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (profile_id, total_amount)
      VALUES (${profileId}, 5000000)
      RETURNING id
    `)
    invoiceId = invoice.rows[0]!.id
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('accepts a Submitted receipt with the required evidence columns', async () => {
    const id = await insertReceipt({ customerNote: 'wired from Mellat' })
    const row = await ctx.db.execute<{
      amount: string
      payment_date: string
      payer_reference: string
      state: string
      customer_note: string | null
      confirmed_by: string | null
    }>(sql`
      SELECT amount::text AS amount, payment_date::text AS payment_date,
             payer_reference, state, customer_note, confirmed_by
      FROM bank_receipts
      WHERE id = ${id}
    `)
    expect(row.rows[0]).toMatchObject({
      amount: '1000000',
      payment_date: '2026-08-15',
      payer_reference: 'REF-1001',
      state: 'Submitted',
      customer_note: 'wired from Mellat',
      confirmed_by: null,
    })
  })

  it('defaults state to Submitted when omitted', async () => {
    const result = await ctx.pool.query<{ state: string }>(
      `INSERT INTO bank_receipts
         (invoice_id, profile_id, amount, payment_date, payer_reference, attachment_key)
       VALUES ($1, $2, 250000, '2026-08-01', 'REF-DEFAULT', 'uploads/image/default.png')
       RETURNING state`,
      [invoiceId, profileId],
    )
    expect(result.rows[0]?.state).toBe('Submitted')
  })

  it('accepts UnderReview, Confirmed, and Rejected rows that match the pairing rules', async () => {
    await expect(insertReceipt({ state: 'UnderReview' })).resolves.toBeTruthy()
    await expect(
      insertReceipt({
        state: 'Confirmed',
        confirmedBy: staffUserId,
        confirmedAt: '2026-08-16T09:00:00.000Z',
      }),
    ).resolves.toBeTruthy()
    await expect(
      insertReceipt({
        state: 'Rejected',
        rejectionReason: 'Amount does not match the slip',
      }),
    ).resolves.toBeTruthy()
  })

  it('rejects a non-positive amount', async () => {
    await expect(insertReceipt({ amount: 0 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_amount_positive'),
    })
    await expect(insertReceipt({ amount: -100 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_amount_positive'),
    })
  })

  it('rejects an unknown state', async () => {
    await expect(insertReceipt({ state: 'Pending' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_state'),
    })
  })

  it('rejects a blank payer reference or attachment key', async () => {
    await expect(insertReceipt({ payerReference: '   ' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_payer_reference_nonblank'),
    })
    await expect(insertReceipt({ attachmentKey: '' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_attachment_key_nonblank'),
    })
  })

  it('rejects Confirmed without both confirmation columns', async () => {
    await expect(
      insertReceipt({ state: 'Confirmed', confirmedBy: staffUserId }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_state_fields'),
    })
    await expect(
      insertReceipt({
        state: 'Confirmed',
        confirmedAt: '2026-08-16T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_state_fields'),
    })
  })

  it('rejects Confirmed with a rejection reason and Rejected with confirmation columns', async () => {
    await expect(
      insertReceipt({
        state: 'Confirmed',
        confirmedBy: staffUserId,
        confirmedAt: '2026-08-16T09:00:00.000Z',
        rejectionReason: 'should not be set',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_state_fields'),
    })
    await expect(
      insertReceipt({
        state: 'Rejected',
        rejectionReason: 'illegible',
        confirmedBy: staffUserId,
        confirmedAt: '2026-08-16T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_state_fields'),
    })
  })

  it('rejects Rejected with a blank reason and Submitted with confirmation columns', async () => {
    await expect(
      insertReceipt({ state: 'Rejected', rejectionReason: '  ' }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_state_fields'),
    })
    await expect(
      insertReceipt({
        state: 'Submitted',
        confirmedBy: staffUserId,
        confirmedAt: '2026-08-16T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_bank_receipts_state_fields'),
    })
  })

  it('rejects a missing invoice or profile (FK)', async () => {
    await expect(
      insertReceipt({ invoiceId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toMatchObject({ code: '23503' })
    await expect(
      insertReceipt({ profileId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects a receipt whose profile does not own the referenced invoice', async () => {
    const other = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO profiles (id) VALUES (uuid_generate_v7()) RETURNING id
    `)
    const otherProfileId = other.rows[0]!.id
    await expect(insertReceipt({ profileId: otherProfileId })).rejects.toMatchObject({
      code: '23503',
      message: expect.stringContaining('fk_bank_receipts_invoice_profile'),
    })
  })

  it('rejects Confirmed with an unknown staff user', async () => {
    await expect(
      insertReceipt({
        state: 'Confirmed',
        confirmedBy: 'missing-staff',
        confirmedAt: '2026-08-16T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects a duplicate attachment_key', async () => {
    const key = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
    await insertReceipt({ attachmentKey: key })
    await expect(insertReceipt({ attachmentKey: key })).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('restricts deletes of invoices that still have receipts', async () => {
    await insertReceipt()
    await expect(
      ctx.db.execute(sql`DELETE FROM invoices WHERE id = ${invoiceId}`),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('creates the lookup indexes, unique attachment index, and updated_at trigger', async () => {
    const indexes = await ctx.db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = ${ctx.schemaName}
        AND indexname IN (
          'idx_bank_receipts_invoice_id',
          'idx_bank_receipts_profile_id',
          'idx_bank_receipts_state',
          'uq_bank_receipts_attachment_key'
        )
      ORDER BY indexname
    `)
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'idx_bank_receipts_invoice_id',
      'idx_bank_receipts_profile_id',
      'idx_bank_receipts_state',
      'uq_bank_receipts_attachment_key',
    ])

    const id = await insertReceipt()
    const before = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM bank_receipts WHERE id = ${id}
    `)
    await ctx.db.execute(sql`
      UPDATE bank_receipts SET state = 'UnderReview' WHERE id = ${id}
    `)
    const after = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM bank_receipts WHERE id = ${id}
    `)
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.rows[0]!.updated_at).getTime(),
    )
  })

  it('migration 0078 is idempotent — re-running keeps enforcement', async () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()
    await expect(insertReceipt({ amount: 0 })).rejects.toMatchObject({ code: '23514' })
  })
})

async function seedGreenfieldInvoiceParents(pool: IsolatedTestDb['pool']): Promise<void> {
  const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
  await pool.query(uuidSql)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
    )
  `)
  await pool.query(`
    CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )
  `)
}

describe('bank_receipts exported helpers (T-04.3.01.01)', () => {
  it('createInvoicesTable then createBankReceiptsTable succeeds on PostgreSQL', async () => {
    const ctx = await createIsolatedTestDb()
    try {
      await seedGreenfieldInvoiceParents(ctx.pool)
      await expect(ctx.pool.query(sqlToString(createInvoicesTable))).resolves.toBeDefined()
      await expect(ctx.pool.query(sqlToString(createBankReceiptsTable))).resolves.toBeDefined()

      const rel = await ctx.pool.query<{ rel: string | null }>(
        `SELECT to_regclass('bank_receipts')::text AS rel`,
      )
      expect(rel.rows[0]?.rel).toMatch(/bank_receipts$/)

      const unique = await ctx.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'invoices'::regclass
            AND conname = 'uq_invoices_id_profile_id'`,
      )
      expect(unique.rows).toHaveLength(1)

      const fk = await ctx.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'bank_receipts'::regclass
            AND conname = 'fk_bank_receipts_invoice_profile'`,
      )
      expect(fk.rows).toHaveLength(1)
    } finally {
      await ctx.pool.end()
      await dropTestSchema(ctx.schemaName)
    }
  }, 60_000)

  it('createBankReceiptsTable adds the invoices unique when invoices lacks it', async () => {
    const ctx = await createIsolatedTestDb()
    try {
      await seedBankReceiptsPrerequisites(ctx.pool)
      const before = await ctx.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'invoices'::regclass
            AND conname = 'uq_invoices_id_profile_id'`,
      )
      expect(before.rows).toHaveLength(0)

      await expect(ctx.pool.query(sqlToString(createBankReceiptsTable))).resolves.toBeDefined()

      const after = await ctx.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'invoices'::regclass
            AND conname = 'uq_invoices_id_profile_id'`,
      )
      expect(after.rows).toHaveLength(1)
      const rel = await ctx.pool.query<{ rel: string | null }>(
        `SELECT to_regclass('bank_receipts')::text AS rel`,
      )
      expect(rel.rows[0]?.rel).toMatch(/bank_receipts$/)
    } finally {
      await ctx.pool.end()
      await dropTestSchema(ctx.schemaName)
    }
  }, 60_000)
})
