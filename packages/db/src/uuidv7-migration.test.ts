import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Integration tests for the uuid_generate_v7() migration.
 *
 * These tests run against real PostgreSQL (via Testcontainers) and
 * verify that the migration SQL creates a working UUIDv7 function.
 */

const MIGRATION_PATH = resolve(__dirname, '../drizzle/0000_init_uuidv7_function.sql')

describe('uuid_generate_v7 migration', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_')

    // Apply the migration SQL. Use the pool's native query() which handles
    // multi-statement SQL including dollar-quoted function bodies.
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('creates the uuid_generate_v7 function in the public schema', async () => {
    const result = await ctx.db.execute<{ exists: boolean }>(
      sql`SELECT EXISTS(
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'uuid_generate_v7'
      ) AS exists`,
    )
    expect(result.rows[0]?.exists).toBe(true)
  })

  it('returns a valid UUID', async () => {
    const result = await ctx.db.execute<{ uuid: string }>(
      sql`SELECT uuid_generate_v7() AS uuid`,
    )
    const uuid = result.rows[0]?.uuid as string
    // Standard UUID format: 8-4-4-4-12 hex digits
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('generates UUIDv7 version (version nibble = 7)', async () => {
    const result = await ctx.db.execute<{ uuid: string }>(
      sql`SELECT uuid_generate_v7() AS uuid`,
    )
    const uuid = result.rows[0]?.uuid as string
    // The version nibble is the first character of the third group.
    const version = uuid[14]
    expect(version).toBe('7')
  })

  it('generates RFC 4122 variant (variant bits = 10xx)', async () => {
    const result = await ctx.db.execute<{ uuid: string }>(
      sql`SELECT uuid_generate_v7() AS uuid`,
    )
    const uuid = result.rows[0]?.uuid as string
    // The variant is encoded in the first hex digit of the fourth group.
    // RFC 4122 variant = 10xx, so the high nibble is 8, 9, a, or b.
    const variantHighNibble = uuid[19]
    expect(variantHighNibble).toMatch(/[89ab]/)
  })

  it('generates monotonic increasing values (ordered by timestamp)', async () => {
    // Generate 100 UUIDs in a batch and verify they are strictly increasing
    // when sorted by their timestamp component.
    const result = await ctx.db.execute<{ uuids: string[] }>(
      sql`SELECT array_agg(uuid_generate_v7() ORDER BY uuid_generate_v7()) AS uuids
          FROM generate_series(1, 100)`,
    )
    const uuids = result.rows[0]?.uuids as string[]
    expect(uuids).toHaveLength(100)

    // Verify strictly increasing lexicographic order (valid for UUIDv7
    // because the timestamp prefix is the same order as the binary value).
    for (let i = 1; i < uuids.length; i++) {
      expect(uuids[i]! > uuids[i - 1]!).toBe(true)
    }
  })

  it('generates distinct values on each call', async () => {
    const result = await ctx.db.execute<{ distinct: boolean }>(
      sql`SELECT count(DISTINCT uuid_generate_v7()) = 100 AS distinct
          FROM generate_series(1, 100)`,
    )
    expect(result.rows[0]?.distinct).toBe(true)
  })

  it('can be used as a DEFAULT column value', async () => {
    // Create a table with uuid_generate_v7() as default.
    await ctx.db.execute(sql`
      CREATE TABLE _uuid_default_test (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
        label text NOT NULL
      )
    `)

    // Insert without specifying id.
    await ctx.db.execute(sql`INSERT INTO _uuid_default_test (label) VALUES ('a')`)
    const row = await ctx.db.execute<{ id: string; label: string }>(
      sql`SELECT id, label FROM _uuid_default_test`,
    )
    expect(row.rows[0]?.label).toBe('a')
    expect(row.rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})