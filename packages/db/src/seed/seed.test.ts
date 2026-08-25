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

/**
 * Integration tests for the seed runner (T-02.04.05).
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

    // Create the products table matching the schema definition.
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        product_type TEXT NOT NULL DEFAULT 'electricity',
        system_type TEXT UNIQUE,
        title_fa TEXT NOT NULL,
        price NUMERIC(20, 0),
        is_active BOOLEAN NOT NULL DEFAULT false,
        min_kwh NUMERIC(20, 6) NOT NULL DEFAULT '0',
        max_kwh NUMERIC(20, 6) NOT NULL DEFAULT '0',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Create the users table matching the schema definition.
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'fa',
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        last_accepted_tos_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('creates 4 default electricity products with correct systemType and null price', async () => {
    const result = await runSeed(false, ctx.db)
    expect(result.ok).toBe(true)

    const allProducts = await ctx.db
      .select()
      .from(products)
      .where(sql`system_type IS NOT NULL`)
      .orderBy(products.systemType)

    expect(allProducts).toHaveLength(4)

    const expectedTypes = ['thermal', 'green', 'free_market', 'energy_saving']
    for (const expected of expectedTypes) {
      const product = allProducts.find((p) => p.systemType === expected)
      expect(product).toBeDefined()
      expect(product!.price).toBeNull()
      expect(product!.productType).toBe('electricity')
      expect(product!.isActive).toBe(false)
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
      sql`SELECT count(*)::int AS count FROM products WHERE system_type IS NOT NULL`,
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
})
