import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const IDEMPOTENCY_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0057_add_invoice_type_idempotency.sql',
)

/**
 * Real-PostgreSQL enforcement tests for the invoice idempotency migration
 * (T-04.1.02.06).
 *
 * Runs migration 0057 against an isolated Testcontainers schema and proves:
 *   - a nullable `type` discriminator column is added;
 *   - pre-existing rows are backfilled from the legacy metadata source
 *     (metadata->>'source' = 'auto' | 'manual');
 *   - the unique (order_id, type) index rejects a second invoice of the
 *     same type for the same order (idempotency);
 *   - the same order may still carry invoices of a different type;
 *   - NULLs are treated as distinct, so order-less manual invoices and
 *     untyped rows never collide;
 *   - the migration is idempotent (re-runnable).
 */
describe('invoice type + idempotency unique index (T-04.1.02.06)', () => {
  let ctx: IsolatedTestDb

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

    // Base invoices table exactly as it exists BEFORE migration 0057:
    // origin columns + metadata, but no `type` column.
    await ctx.db.execute(sql`
      CREATE TABLE invoices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        contract_id TEXT,
        consultation_id TEXT,
        state invoice_state NOT NULL DEFAULT 'Draft',
        total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
        metadata JSONB
      )
    `)

    await ctx.db.execute(sql`INSERT INTO profiles (id) VALUES (uuid_generate_v7())`)
    await ctx.db.execute(sql`INSERT INTO orders (id) VALUES (uuid_generate_v7())`)

    // Legacy pre-0057 rows carrying ONLY the metadata source discriminator.
    // The migration must backfill `type` from these.
    await ctx.db.execute(sql`
      INSERT INTO invoices (profile_id, order_id, metadata, total_amount) VALUES
        ((SELECT id FROM profiles LIMIT 1), (SELECT id FROM orders LIMIT 1),
         '{"source":"auto"}'::jsonb, 1000000),
        ((SELECT id FROM profiles LIMIT 1), NULL,
         '{"source":"manual"}'::jsonb, 200000)
    `)

    const migrationSql = readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function freshOrder(): Promise<string> {
    const r = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO orders (id) VALUES (uuid_generate_v7()) RETURNING id
    `)
    return r.rows[0]!.id
  }

  async function profileId(): Promise<string> {
    const r = await ctx.db.execute<{ id: string }>(sql`
      SELECT id FROM profiles LIMIT 1
    `)
    return r.rows[0]!.id
  }

  it('adds a nullable type column', async () => {
    const cols = await ctx.db.execute<{ column_name: string; is_nullable: string }>(sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices' AND column_name = 'type'
    `)
    expect(cols.rows).toHaveLength(1)
    expect(cols.rows[0]!.is_nullable).toBe('YES')
  })

  it('backfills existing rows from the legacy metadata source', async () => {
    const rows = await ctx.db.execute<{ order_id: string | null; type: string | null }>(sql`
      SELECT order_id, type FROM invoices ORDER BY total_amount
    `)
    expect(rows.rows).toHaveLength(2)
    // The auto row kept its order link and gained type='auto'.
    expect(
      rows.rows.some((r) => r.order_id !== null && r.type === 'auto'),
    ).toBe(true)
    // The order-less (manual) row gained type='manual'.
    expect(
      rows.rows.some((r) => r.order_id === null && r.type === 'manual'),
    ).toBe(true)
  })

  it('rejects a second invoice of the same type for the same order (idempotency)', async () => {
    const orderId = await freshOrder()
    const profile = await profileId()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000)
      `),
    ).resolves.toBeDefined()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000)
      `),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('allows the same order to carry invoices of a different type', async () => {
    const orderId = await freshOrder()
    const profile = await profileId()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000)
      `),
    ).resolves.toBeDefined()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'manual', 100000)
      `),
    ).resolves.toBeDefined()
  })

  it('treats NULLs as distinct — untyped rows do not collide', async () => {
    const orderId = await freshOrder()
    const profile = await profileId()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000)
      `),
    ).resolves.toBeDefined()

    // Same order, but type NULL — a distinct key, so the insert is allowed.
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, NULL, 100000)
      `),
    ).resolves.toBeDefined()
  })

  it('allows multiple order-less (manual) invoices of the same type', async () => {
    const profile = await profileId()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, NULL, 'manual', 100000)
      `),
    ).resolves.toBeDefined()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, NULL, 'manual', 100000)
      `),
    ).resolves.toBeDefined()
  })

  it('migration 0057 is idempotent — re-running is a no-op', async () => {
    const migrationSql = readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    const idx = await ctx.db.execute<{ index_name: string }>(sql`
      SELECT indexname AS index_name FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'invoices' AND indexname = 'uq_invoices_order_id_type'
    `)
    expect(idx.rows).toHaveLength(1)
  })
})
