import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { runSeed } from './index'
import { products } from '../schema/products'
import { users } from '../schema/users'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION_PATH = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const PRODUCTS_MIGRATION_PATH = resolve(__dirname, '../../drizzle/0014_recreate_products_schema.sql')

/**
 * Integration tests for the seed runner (T-02.04.05, updated for T-03.01.01.01).
 *
 * Each test runs against an isolated PostgreSQL schema (via Testcontainers)
 * so no test state leaks between runs.
 */

describe('seed verification', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    // Apply the uuid_generate_v7() migration — required by base table defaults.
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)

    // Create the products table using the new schema migration.
    const productsMigrationSql = readFileSync(PRODUCTS_MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(productsMigrationSql)

    // Create the users table matching the schema definition.
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT,
        mobile TEXT,
        password_hash TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'fa',
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        password_change_token TEXT,
        password_change_token_expires_at TIMESTAMPTZ,
        notification_preferences TEXT NOT NULL DEFAULT 'IN_APP',
        timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
        last_accepted_tos_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Create the provinces table needed by the geography seeder (T-03.02.02).
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS provinces (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        name_fa TEXT NOT NULL,
        name_en TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('creates 4 default electricity products with correct systemKey and null price', async () => {
    const result = await runSeed(false, ctx.db)
    expect(result.ok).toBe(true)

    const allProducts = await ctx.db
      .select()
      .from(products)
      .where(sql`system_key IS NOT NULL`)
      .orderBy(products.systemKey)

    expect(allProducts).toHaveLength(4)

    const expectedKeys = ['thermal', 'green', 'free_market', 'energy_saving']
    for (const expectedKey of expectedKeys) {
      const product = allProducts.find((p) => p.systemKey === expectedKey)
      expect(product).toBeDefined()
      expect(product!.price).toBeNull()
      expect(product!.type).toBe('electricity')
      expect(product!.status).toBe('inactive')
      expect(product!.title).toEqual(
        expect.objectContaining({ fa: expect.any(String), en: expect.any(String) })
      )
    }
  })

  it('does not create duplicate system products when seed is re-run', async () => {
    const result = await runSeed(false, ctx.db)
    expect(result.ok).toBe(true)

    // Verify the seeder reports skipped, not created.
    const productResult = result.results.find((r) => r.entity === 'products')
    expect(productResult).toBeDefined()
    expect(productResult!.skipped).toBe(4)
    expect(productResult!.created).toBe(0)

    // Database still has exactly 4 system products.
    const countResult = await ctx.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM products WHERE system_key IS NOT NULL`,
    )
    expect(countResult.rows[0]?.count).toBe(4)
  })

  it('creates an admin user when bootstrap env vars are provided', async () => {
    const originalSecret = process.env['ADMIN_BOOTSTRAP_SECRET']
    const originalEmail = process.env['ADMIN_BOOTSTRAP_EMAIL']

    try {
      process.env['ADMIN_BOOTSTRAP_SECRET'] = 'test-secret'
      process.env['ADMIN_BOOTSTRAP_EMAIL'] = 'admin@test.example'

      const result = await runSeed(false, ctx.db)
      expect(result.ok).toBe(true)

      const adminResult = result.results.find((r) => r.entity === 'admin_bootstrap')
      expect(adminResult).toBeDefined()
      expect(adminResult!.created).toBe(1)

      // Verify the user exists in the database.
      const adminUser = await ctx.db
        .select()
        .from(users)
        .where(eq(users.username, 'admin@test.example'))
        .limit(1)

      expect(adminUser).toHaveLength(1)
      expect(adminUser[0]!.isAdmin).toBe(true)
      expect(adminUser[0]!.mustChangePassword).toBe(true)
      expect(adminUser[0]!.locale).toBe('fa')
    } finally {
      if (originalSecret !== undefined) {
        process.env['ADMIN_BOOTSTRAP_SECRET'] = originalSecret
      } else {
        delete process.env['ADMIN_BOOTSTRAP_SECRET']
      }
      if (originalEmail !== undefined) {
        process.env['ADMIN_BOOTSTRAP_EMAIL'] = originalEmail
      } else {
        delete process.env['ADMIN_BOOTSTRAP_EMAIL']
      }
    }
  })

  it('skips admin bootstrap when env vars are not set', async () => {
    delete process.env['ADMIN_BOOTSTRAP_SECRET']
    delete process.env['ADMIN_BOOTSTRAP_EMAIL']

    const result = await runSeed(false, ctx.db)
    expect(result.ok).toBe(true)

    const adminResult = result.results.find((r) => r.entity === 'admin_bootstrap')
    expect(adminResult).toBeDefined()
    expect(adminResult!.skipped).toBe(1)
    expect(adminResult!.created).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Database constraint tests (T-02.04.06, updated for T-03.01.01.01)
  // -----------------------------------------------------------------------

  /**
   * System product constraint triggers are already applied via the
   * 0014_recreate_products_schema.sql migration.
   */
  describe('system product constraints', () => {
    it('prevents deletion of system-defined electricity products', async () => {
      // Fetch a system product.
      const [systemProduct] = await ctx.db
        .select({ id: products.id, systemKey: products.systemKey })
        .from(products)
        .where(sql`system_key IS NOT NULL`)
        .limit(1)

      expect(systemProduct).toBeDefined()

      // Attempt to delete it — should throw.
      await expect(
        ctx.db.delete(products).where(eq(products.id, systemProduct!.id)),
      ).rejects.toThrow(/cannot delete system-defined/i)

      // Verify the row still exists.
      const remaining = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, systemProduct!.id))
        .limit(1)

      expect(remaining).toHaveLength(1)
    })

    it('prevents changing system_key on system-defined products', async () => {
      const [systemProduct] = await ctx.db
        .select({ id: products.id, systemKey: products.systemKey })
        .from(products)
        .where(sql`system_key IS NOT NULL`)
        .limit(1)

      expect(systemProduct).toBeDefined()

      // Attempt to change system_key — should throw.
      await expect(
        ctx.db
          .update(products)
          .set({ systemKey: 'hacked_type' })
          .where(eq(products.id, systemProduct!.id)),
      ).rejects.toThrow(/cannot change system_key/i)
    })

    it('prevents inserting a 5th system-defined electricity product', async () => {
      // Attempt to insert a bogus 5th system product — should throw.
      await expect(
        ctx.db.insert(products).values({
          systemKey: 'nuclear',
          title: { fa: 'برق هسته‌ای', en: 'Nuclear Electricity' },
          type: 'electricity',
          status: 'inactive',
        }),
      ).rejects.toThrow(/cannot insert more than 4/i)
    })

    it('allows inserting admin-created products (null system_key)', async () => {
      // Admin-created products have system_key = NULL — should succeed.
      await expect(
        ctx.db.insert(products).values({
          systemKey: null,
          title: { fa: 'برق سفارشی', en: 'Custom Electricity' },
          type: 'electricity',
          status: 'active',
        }),
      ).resolves.not.toThrow()
    })

    it('allows updating price and status on system products', async () => {
      const [systemProduct] = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(sql`system_key IS NOT NULL`)
        .limit(1)

      expect(systemProduct).toBeDefined()

      // Updating price and status must succeed.
      await expect(
        ctx.db
          .update(products)
          .set({ price: BigInt(500000), status: 'active' })
          .where(eq(products.id, systemProduct!.id)),
      ).resolves.not.toThrow()
    })
  })
})
