import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { wallets } from './wallets.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0069_wallet_available_balance_check.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const SCHEMA_PATH = resolve(__dirname, './wallets.ts')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')
const SCHEMA_SOURCE = readFileSync(SCHEMA_PATH, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for the wallets available-
 * balance CHECK (T-04.2.01.07).
 *
 * The invariant is `(posted_balance - reserved_balance) >= 0` evaluated
 * on the derived expression — `available_balance` is not a stored column
 * and is not a generated STORED column. Migration 0069 is the durable
 * enforcement path.
 */
describe('wallets available-balance CHECK schema (T-04.2.01.07)', () => {
  it('Drizzle wallets table does not declare a stored availableBalance column', () => {
    const names = getTableConfig(wallets).columns.map((c) => c.name)
    expect(names).toEqual([
      'profile_id',
      'posted_balance',
      'reserved_balance',
      'version',
      'updated_at',
    ])
    expect(names).not.toContain('available_balance')
  })

  it('Drizzle schema declares the derived-expression CHECK', () => {
    const { checks } = getTableConfig(wallets)
    const found = checks.find((c) => String(c.name) === 'chk_wallets_available_balance_nonneg')
    expect(found).toBeDefined()
  })

  it('migration 0069 still declares CHECK ((posted_balance - reserved_balance) >= 0)', () => {
    expect(MIGRATION).toContain('chk_wallets_available_balance_nonneg')
    expect(MIGRATION).toContain('CHECK ((posted_balance - reserved_balance) >= 0)')
    expect(MIGRATION).toMatch(
      /ADD CONSTRAINT chk_wallets_available_balance_nonneg[\s\S]*CHECK \(\(posted_balance - reserved_balance\) >= 0\)/,
    )
    expect(MIGRATION).not.toMatch(/ADD COLUMN\s+available_balance/i)
    expect(MIGRATION).not.toMatch(/available_balance\s+(BIGINT|INT|INTEGER|NUMERIC)/i)
    expect(MIGRATION).not.toMatch(/GENERATED ALWAYS AS/i)
    expect(MIGRATION).not.toMatch(/CREATE\s+(OR REPLACE\s+)?(FUNCTION|TRIGGER)/i)
  })

  it('createWalletsTable mirrors the CHECK and does not store available_balance', () => {
    expect(SCHEMA_SOURCE).toContain('chk_wallets_available_balance_nonneg')
    expect(SCHEMA_SOURCE).toContain('CHECK ((posted_balance - reserved_balance) >= 0)')
    expect(SCHEMA_SOURCE).not.toMatch(/availableBalance:\s/ )
    expect(SCHEMA_SOURCE).not.toMatch(/available_balance['"]?\s*:/)
    expect(SCHEMA_SOURCE).not.toMatch(/GENERATED ALWAYS AS/i)
  })

  it('migration 0069 is idempotent (CREATE TABLE IF NOT EXISTS + guarded backfill)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS wallets')
    expect(MIGRATION).toMatch(/IF to_regclass\('wallets'\) IS NOT NULL/)
    expect(MIGRATION).toContain("conname = 'chk_wallets_available_balance_nonneg'")
  })

  it('migration 0069 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === '0069_wallet_available_balance_check')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(69)
    const prior = journal.entries.find((row) => row.tag === '0068_create_wallet_transactions')
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('wallets available-balance PostgreSQL enforcement (T-04.2.01.07)', () => {
  let ctx: IsolatedTestDb
  let profileId: string

  async function insertWallet(opts: {
    posted?: bigint | number
    reserved?: bigint | number
  } = {}): Promise<string> {
    const result = await ctx.pool.query<{ profile_id: string }>(
      `INSERT INTO wallets (profile_id, posted_balance, reserved_balance)
       VALUES ($1, $2::bigint, $3::bigint)
       RETURNING profile_id`,
      [profileId, opts.posted ?? 0, opts.reserved ?? 0],
    )
    return result.rows[0]!.profile_id
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    const inserted = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO profiles (id) VALUES (uuid_generate_v7())
      RETURNING id
    `)
    profileId = inserted.rows[0]!.id

    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('does not create a stored or generated available_balance column', async () => {
    const cols = await ctx.db.execute<{ column_name: string; is_generated: string }>(sql`
      SELECT column_name, is_generated
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'wallets'
      ORDER BY ordinal_position
    `)
    expect(cols.rows.map((row) => row.column_name)).toEqual([
      'profile_id',
      'posted_balance',
      'reserved_balance',
      'version',
      'updated_at',
    ])
    expect(cols.rows.every((row) => row.is_generated === 'NEVER')).toBe(true)

    const generated = await ctx.db.execute<{ attname: string }>(sql`
      SELECT a.attname
      FROM pg_attribute a
      WHERE a.attrelid = 'wallets'::regclass
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attgenerated <> ''
    `)
    expect(generated.rows).toEqual([])
  })

  it('persists the named CHECK on the derived posted - reserved expression', async () => {
    const rows = await ctx.db.execute<{ conname: string; def: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'wallets'::regclass
        AND conname = 'chk_wallets_available_balance_nonneg'
    `)
    expect(rows.rows).toHaveLength(1)
    const def = rows.rows[0]!.def.replace(/\s+/g, ' ')
    expect(def).toContain('CHECK')
    expect(def).toContain('posted_balance - reserved_balance')
    expect(def).toContain('>= 0')
  })

  it('accepts availableBalance = 0 and availableBalance > 0', async () => {
    await expect(insertWallet({ posted: 0, reserved: 0 })).resolves.toBe(profileId)
    await ctx.db.execute(sql`DELETE FROM wallets WHERE profile_id = ${profileId}`)

    await expect(insertWallet({ posted: 1_000_000, reserved: 250_000 })).resolves.toBe(profileId)
    await ctx.db.execute(sql`DELETE FROM wallets WHERE profile_id = ${profileId}`)

    await expect(insertWallet({ posted: 50_000, reserved: 50_000 })).resolves.toBe(profileId)
  })

  it('rejects INSERT when reservedBalance exceeds postedBalance', async () => {
    await ctx.db.execute(sql`DELETE FROM wallets WHERE profile_id = ${profileId}`)
    await expect(insertWallet({ posted: 100, reserved: 101 })).rejects.toMatchObject({
      code: '23514',
      constraint: 'chk_wallets_available_balance_nonneg',
    })
  })

  it('rejects UPDATE that would make availableBalance negative', async () => {
    await ctx.db.execute(sql`DELETE FROM wallets WHERE profile_id = ${profileId}`)
    await insertWallet({ posted: 100_000, reserved: 40_000 })

    await expect(
      ctx.pool.query(
        `UPDATE wallets SET reserved_balance = 100_001 WHERE profile_id = $1`,
        [profileId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'chk_wallets_available_balance_nonneg',
    })

    await expect(
      ctx.pool.query(
        `UPDATE wallets SET posted_balance = 10 WHERE profile_id = $1`,
        [profileId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'chk_wallets_available_balance_nonneg',
    })

    const after = await ctx.db.execute<{ posted: string; reserved: string }>(sql`
      SELECT posted_balance::text AS posted, reserved_balance::text AS reserved
      FROM wallets WHERE profile_id = ${profileId}
    `)
    expect(after.rows[0]).toEqual({ posted: '100000', reserved: '40000' })
  })

  it('migration 0069 is idempotent — re-running keeps enforcement', async () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    await ctx.db.execute(sql`DELETE FROM wallets WHERE profile_id = ${profileId}`)
    await expect(insertWallet({ posted: 1, reserved: 2 })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('backfill path adds the CHECK to a legacy wallets table', async () => {
    await ctx.db.execute(sql`DROP TABLE IF EXISTS wallets CASCADE`)
    await ctx.db.execute(sql`
      CREATE TABLE wallets (
        profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
        posted_balance BIGINT NOT NULL DEFAULT 0,
        reserved_balance BIGINT NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)

    const constraints = await ctx.db.execute<{ name: string }>(sql`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid = 'wallets'::regclass
        AND conname = 'chk_wallets_available_balance_nonneg'
    `)
    expect(constraints.rows.map((r) => r.name)).toEqual([
      'chk_wallets_available_balance_nonneg',
    ])

    await expect(insertWallet({ posted: 5, reserved: 6 })).rejects.toMatchObject({
      code: '23514',
      constraint: 'chk_wallets_available_balance_nonneg',
    })
    await expect(insertWallet({ posted: 6, reserved: 5 })).resolves.toBe(profileId)
  })
})
