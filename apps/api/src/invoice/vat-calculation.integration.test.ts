/**
 * Real-PostgreSQL integration tests for the VAT calculation module
 * (T-04.1.02.04).
 *
 * Proves the resolution precedence against actual PostgreSQL vat tables:
 *   - product override wins over category default (T-09.12.02)
 *   - category default applies when no override is active
 *   - 0% fallback when neither is configured
 *   - effective-window boundaries (exclusive `effective_until`)
 *   - works on the shared pool AND a caller-owned transaction client
 *     (the invoice-generation snapshot seam).
 *
 * Tables needed: products (for type derivation), vat_configurations,
 * product_vat_overrides, users (FK). Only the uuid_v7 migration is
 * required — the vat tables are hand-written to mirror the real schema.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { VatCalculationRepository } from './vat-calculation.repository.js'
import { VatCalculationService } from './vat-calculation.service.js'

// ---- Real-DB wiring ------------------------------------------------------
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

const USER_ID = 'vat-config-admin'
const CATEGORY_A = 'electricity'
const PRODUCT_ID = '11111111-1111-7111-8111-111111111111'
const PRODUCT_B = '22222222-2222-7222-8222-222222222222'
const RATE_CAT_9 = '33333333-3333-7333-8333-333333333333'
const RATE_CAT_5 = '44444444-4444-7444-8444-444444444444'
const RATE_OVERRIDE = '55555555-5555-7555-8555-555555555555'

describe('VatCalculationRepository — real PostgreSQL integration (T-04.1.02.04)', () => {
  let ctx: IsolatedTestDb
  let repo: VatCalculationRepository
  let service: VatCalculationService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    repo = new VatCalculationRepository()
    service = new VatCalculationService(repo)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY)`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      type TEXT NOT NULL,
      system_key TEXT,
      title JSONB,
      price BIGINT
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS vat_configurations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      category TEXT NOT NULL,
      rate INTEGER NOT NULL,
      effective_from TIMESTAMPTZ NOT NULL,
      effective_until TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS product_vat_overrides (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      product_id UUID NOT NULL,
      vat_config_id UUID NOT NULL REFERENCES vat_configurations(id) ON DELETE RESTRICT,
      effective_from TIMESTAMPTZ NOT NULL,
      effective_until TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)

    // Seed: two products, a 9% open category rate, a 5% scheduled category
    // rate, and a 5% override on PRODUCT_ID.
    await ctx.db.execute(`INSERT INTO users (user_id) VALUES ('${USER_ID}') ON CONFLICT (user_id) DO NOTHING`)
    await ctx.db.execute(
      `INSERT INTO products (id, type) VALUES
         ('${PRODUCT_ID}', '${CATEGORY_A}'),
         ('${PRODUCT_B}', '${CATEGORY_A}')
       ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO vat_configurations (id, category, rate, effective_from, effective_until, created_by)
       VALUES
         ('${RATE_CAT_9}', '${CATEGORY_A}', 900, '2026-01-01T00:00:00Z', NULL, '${USER_ID}'),
         ('${RATE_CAT_5}', '${CATEGORY_A}', 500, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z', '${USER_ID}'),
         ('${RATE_OVERRIDE}', 'product_override', 500, '2026-01-01T00:00:00Z', NULL, '${USER_ID}')
       ON CONFLICT (id) DO NOTHING`,
    )
    await ctx.db.execute(
      `INSERT INTO product_vat_overrides (id, product_id, vat_config_id, effective_from, effective_until, created_by)
       VALUES ('66666666-6666-7666-8666-666666666666', '${PRODUCT_ID}', '${RATE_OVERRIDE}',
               '2026-01-01T00:00:00Z', NULL, '${USER_ID}')
       ON CONFLICT (id) DO NOTHING`,
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('product override wins over the category default (pool executor)', async () => {
    const result = await service.resolveRate(ctx.pool, {
      productId: PRODUCT_ID,
      at: new Date('2026-08-01T00:00:00Z'),
    })
    expect(result).toEqual({ rateBasisPoints: 500, source: 'product_override' })
  })

  it('category default applies when no override exists (bare product, type-derived)', async () => {
    const result = await service.resolveRate(ctx.pool, {
      productId: PRODUCT_B,
      at: new Date('2026-08-01T00:00:00Z'),
    })
    // PRODUCT_B has no override → type `electricity` derives the category
    // and the open 9% rate applies.
    expect(result).toEqual({ rateBasisPoints: 900, source: 'category' })
  })

  it('returns 0% when resolving a category with no active rate', async () => {
    const result = await service.resolveRate(ctx.pool, {
      category: 'hardware',
      at: new Date('2026-08-01T00:00:00Z'),
    })
    expect(result).toEqual({ rateBasisPoints: 0, source: 'fallback_zero' })
  })

  it('an ended rate does not apply (exclusive effective_until)', async () => {
    // The 5% 'electricity' rate ended 2026-06-01; asking for it directly at
    // a later date must not return it (only the open 9% remains).
    const at = new Date('2026-07-01T00:00:00Z')
    const product = await ctx.db.execute<{ type: string }>(
      `SELECT type FROM products WHERE id = '${PRODUCT_B}'`,
    )
    const type = product.rows[0]!.type
    const result = await service.resolveRate(ctx.pool, { category: type, at })
    expect(result.rateBasisPoints).not.toBe(500)
  })

  it('resolves correctly inside a caller-owned transaction client', async () => {
    const client = await ctx.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await service.resolveRate(client, {
        productId: PRODUCT_ID,
        at: new Date('2026-08-01T00:00:00Z'),
      })
      expect(result).toEqual({ rateBasisPoints: 500, source: 'product_override' })
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  })

  it('vatAmount math is integer-only half-up to the nearest IRR', () => {
    expect(service.vatAmount(750_000n, 900)).toBe(67_500n)
    expect(service.vatAmount(55_055n, 1000)).toBe(5_506n)
    expect(service.vatAmount(1_000_000n, 900, false)).toBe(0n)
    expect(() => service.vatAmount(-1n, 900)).toThrow(RangeError)
  })
})
