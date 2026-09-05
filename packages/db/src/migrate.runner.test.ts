import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { runMigrations, verifyMigrationVersion, type MigrationOptions } from './migrate'

const resources: { folder: string; schema: string }[] = []

function fixture(): MigrationOptions & { migrationsFolder: string; migrationsSchema: string } {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) throw new Error('PostgreSQL test setup did not provide a database URL')
  const folder = mkdtempSync(join(tmpdir(), 'barghsa-migrations-'))
  const schema = `test_migration_${randomUUID().replaceAll('-', '')}`
  resources.push({ folder, schema })
  mkdirSync(join(folder, 'meta'))
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({
    version: '7', dialect: 'postgresql', entries: [
      { idx: 0, version: '7', when: 1000, tag: '0000_foundation', breakpoints: true },
    ],
  }))
  writeFileSync(join(folder, '0000_foundation.sql'), `CREATE TABLE "${schema}".example (id integer PRIMARY KEY);`)
  return { migrationsFolder: folder, migrationsSchema: schema, connection: { pgdirectUrl: connectionString } }
}

afterEach(async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  try {
    for (const { folder, schema } of resources.splice(0)) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      rmSync(folder, { recursive: true, force: true })
    }
  } finally {
    await pool.end()
  }
})

describe('production migration runner', () => {
  it('reports actual journal tags, verifies schema-qualified metadata, and can run twice', async () => {
    const options = fixture()
    expect(await verifyMigrationVersion('0000', options)).toBe(false)
    expect(await runMigrations(options)).toEqual({ ok: true, applied: ['0000_foundation'] })
    expect(await verifyMigrationVersion('0000_foundation', options)).toBe(true)
    expect(await runMigrations(options)).toEqual({ ok: true, applied: [] })
    writeFileSync(join(options.migrationsFolder, '0000_foundation.sql'), 'SELECT 1;')
    expect(await verifyMigrationVersion('0000', options)).toBe(false)
  })

  it('serializes competing deploys so a migration is applied exactly once', async () => {
    const options = fixture()
    const results = await Promise.all([runMigrations(options), runMigrations(options)])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(results.flatMap((result) => result.applied)).toEqual(['0000_foundation'])
  })

  it('rolls back a failed migration and allows retry on a fresh owned connection', async () => {
    const options = fixture()
    const path = join(options.migrationsFolder, '0000_foundation.sql')
    writeFileSync(path, `CREATE TABLE "${options.migrationsSchema}".example (id integer); SELECT * FROM missing_relation;`)
    expect((await runMigrations(options)).ok).toBe(false)
    expect(await verifyMigrationVersion('0000', options)).toBe(false)
    writeFileSync(path, `CREATE TABLE "${options.migrationsSchema}".example (id integer);`)
    expect((await runMigrations(options)).ok).toBe(true)
  })

  it('does not disguise connection failures as an empty migration history', async () => {
    const options = fixture()
    options.connection = { pgdirectUrl: 'postgresql://127.0.0.1:1/unavailable', connectionTimeoutMillis: 100 }
    await expect(verifyMigrationVersion('0000', options)).rejects.toThrow()
    expect((await runMigrations(options)).ok).toBe(false)
  })
})
