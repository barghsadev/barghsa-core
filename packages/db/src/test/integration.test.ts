import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createIsolatedTestDb, dropTestSchema } from './testDb'
import type { IsolatedTestDb } from './testDb'

/**
 * Integration tests that run against real PostgreSQL (via Testcontainers).
 * These verify that the test harness connects to a live database, that each
 * worker receives an isolated schema, and that real PostgreSQL semantics
 * (transactions, constraint enforcement) are available — never SQLite or an
 * in-memory stand-in.
 */

describe('integration test harness', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('connects to a real PostgreSQL server', async () => {
    const result = await ctx.db.execute<{ version: string }>(
      sql`SELECT version() AS version`,
    )
    const version = result.rows[0]?.version as string
    expect(version).toMatch(/PostgreSQL/i)
    expect(version).not.toMatch(/SQLite/i)
  })

  it('verifies the isolated schema search_path is applied', async () => {
    const result = await ctx.db.execute<{ current_schema: string }>(
      sql`SELECT current_schema() AS current_schema`,
    )
    expect(result.rows[0]?.current_schema).toBe(ctx.schemaName)
  })

  it('runs queries inside a real transaction with rollback', async () => {
    // Create a throwaway table, insert inside a tx, then roll back.
    await ctx.db.execute(sql`CREATE TABLE _tx_probe (id serial PRIMARY KEY, v text)`)
    try {
      // The db instance is a single drizzle wrapper; open an explicit client
      // transaction to verify rollback semantics of the PG transaction log.
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO _tx_probe (v) VALUES ('a')`)
        throw new Error('force rollback')
      })
    } catch {
      // expected
    }
    const after = await ctx.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM _tx_probe`,
    )
    expect(after.rows[0]?.count).toBe(0)
  })

  it('enforces PostgreSQL constraints (unique / not-null)', async () => {
    await ctx.db.execute(
      sql`CREATE TABLE _constraint_probe (id int PRIMARY KEY, email text NOT NULL UNIQUE)`,
    )
    await ctx.db.execute(
      sql`INSERT INTO _constraint_probe (id, email) VALUES (1, 'a@example.test')`,
    )

    // Duplicate unique value must be rejected by PostgreSQL.
    await expect(
      ctx.db.execute(
        sql`INSERT INTO _constraint_probe (id, email) VALUES (2, 'a@example.test')`,
      ),
    ).rejects.toThrow()

    // NULL in a NOT NULL column must be rejected.
    await expect(
      ctx.db.execute(sql`INSERT INTO _constraint_probe (id, email) VALUES (3, NULL)`),
    ).rejects.toThrow()
  })

  it('uses row-level locking available in real PostgreSQL', async () => {
    // SELECT ... FOR UPDATE is a real-PG feature (advisory/row locks). If the
    // harness were backed by SQLite this would fail, so it proves the adapter
    // boundary is the real database.
    await ctx.db.execute(
      sql`CREATE TABLE _lock_probe (id int PRIMARY KEY, v int)`,
    )
    await ctx.db.execute(sql`INSERT INTO _lock_probe (id, v) VALUES (1, 100)`)

    const locked = await ctx.db.execute(
      sql`SELECT id, v FROM _lock_probe WHERE id = 1 FOR UPDATE`,
    )
    expect(locked.rows[0]?.v).toBe(100)
  })
})

describe('schema isolation across workers', () => {
  it('creates a unique schema each call', async () => {
    const a = await createIsolatedTestDb()
    const b = await createIsolatedTestDb()
    try {
      expect(a.schemaName).not.toBe(b.schemaName)

      // Objects in one schema are invisible in the other — true isolation.
      await a.db.execute(
        sql`CREATE TABLE _iso_probe (id int PRIMARY KEY, v text)`,
      )
      await b.db.execute(sql`CREATE TABLE _iso_probe (id int PRIMARY KEY, v text)`)
      await a.db.execute(sql`INSERT INTO _iso_probe (id, v) VALUES (1, 'a')`)

      const bCount = await b.db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM _iso_probe`,
      )
      expect(bCount.rows[0]?.count).toBe(0)
    } finally {
      await a.pool.end()
      await b.pool.end()
      await dropTestSchema(a.schemaName)
      await dropTestSchema(b.schemaName)
    }
  })
})