import { afterEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { runMigrations, verifyMigrationVersion } from './migrate'
import { runSeed } from './seed'

const databases: string[] = []
const folder = resolve(__dirname, '../drizzle/production')

afterEach(async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  try {
    for (const name of databases.splice(0)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`)
  } finally {
    await pool.end()
  }
})

describe('complete production schema baseline', () => {
  it('creates the declared schema in an empty database without test-only prerequisite tables', async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run')
    const name = `test_baseline_${randomUUID().replaceAll('-', '')}`
    const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    try {
      await management.query(`CREATE DATABASE "${name}"`)
      databases.push(name)
    } finally {
      await management.end()
    }
    const url = new URL(process.env.TEST_DATABASE_URL)
    url.pathname = `/${name}`
    const options = { connection: { pgdirectUrl: url.toString() } }
    expect(await runMigrations(options)).toEqual({ ok: true, applied: ['0080_complete_schema', '0081_restore_domain_constraints', '0082_restore_foundation_constraints', '0083_staff_identity', '0084_staff_capabilities'] })
    expect(await runMigrations(options)).toEqual({ ok: true, applied: [] })
    expect(await verifyMigrationVersion('0082', options)).toBe(true)
    const pool = new Pool({ connectionString: url.toString() })
    try {
      const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
      expect(tables.rows.length).toBeGreaterThanOrEqual(85)
      expect(await runSeed(false, drizzle(pool))).toMatchObject({ ok: true, errors: [] })
      expect(await runSeed(false, drizzle(pool))).toMatchObject({ ok: true, errors: [] })
      expect((await pool.query('SELECT count(*)::int AS count FROM products')).rows[0].count).toBe(4)
      await expect(pool.query('DELETE FROM products WHERE system_key IS NOT NULL')).rejects.toMatchObject({ code: 'P0001' })
      await expect(pool.query("INSERT INTO addresses(profile_id, province_id, city_id, full_address, postal_code) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'address', '1234567890')"))
        .rejects.toMatchObject({ code: '23503' })
      await pool.query("INSERT INTO users(user_id, username, password_hash) VALUES ('baseline-user', 'baseline@example.test', 'test-only')")
      const profile = (await pool.query("INSERT INTO profiles(user_id, is_default) VALUES ('baseline-user', true) RETURNING id")).rows[0].id
      await expect(pool.query("INSERT INTO profiles(user_id, is_default) VALUES ('baseline-user', true)")).rejects.toMatchObject({ code: '23505' })
      await expect(pool.query('INSERT INTO wallets(profile_id, posted_balance) VALUES ($1, -1)', [profile])).rejects.toMatchObject({ code: '23514' })
      await pool.query('INSERT INTO wallets(profile_id, posted_balance) VALUES ($1, $2)', [profile, '9007199254740993'])

      // Representative deployed state: populated current product/finance
      // tables with the old migration journal and missing unjournaled schema.
      const oldSql = readFileSync(resolve(folder, '../0079_create_bank_receipt_attachment_claims.sql'), 'utf8')
      await pool.query(oldSql)
      await pool.query('DELETE FROM drizzle.__drizzle_migrations')
      await pool.query('INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES ($1, $2)',
        [createHash('sha256').update(oldSql).digest('hex'), '1789776000000'])
      await pool.query('ALTER TABLE users DROP COLUMN password_change_token')
      await pool.query('ALTER TABLE users DROP COLUMN is_staff')
      await pool.query("INSERT INTO users(user_id, username, password_hash, is_admin) VALUES ('legacy-admin', 'legacy-admin@example.test', 'test-only', true)")
      await pool.query("INSERT INTO user_roles(user_id, role_id) VALUES ('baseline-user', 'role-finance')")
      await pool.query(`UPDATE staff_roles SET permissions='["legal:read"]' WHERE role_id='role-legal-contracts'`)
      await pool.query('DROP TABLE sms_provider_configs')
      const oldHistory = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rows
      const productsBefore = (await pool.query('SELECT * FROM products ORDER BY id')).rows
      expect((await runMigrations(options)).ok).toBe(true)
      expect((await pool.query("SELECT is_admin, is_staff FROM users WHERE user_id='legacy-admin'")).rows[0])
        .toEqual({ is_admin: true, is_staff: true })
      expect((await pool.query("SELECT is_admin, is_staff FROM users WHERE user_id='baseline-user'")).rows[0])
        .toEqual({ is_admin: false, is_staff: true })
      expect((await pool.query("SELECT permissions FROM staff_roles WHERE role_id='role-legal-contracts'")).rows[0].permissions).toBe('["legal:read"]')
      expect((await pool.query('SELECT * FROM products ORDER BY id')).rows).toEqual(productsBefore)
      expect((await pool.query('SELECT posted_balance::text AS balance FROM wallets WHERE profile_id=$1', [profile])).rows[0].balance)
        .toBe('9007199254740993')
      expect((await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows[0]).toEqual(oldHistory[0])
      expect(await runMigrations(options)).toEqual({ ok: true, applied: [] })
    } finally {
      await pool.end()
    }
  }, 30_000)
})
