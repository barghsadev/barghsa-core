import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDirectDbPool, type DbPoolConfig } from './index.js'

// ---------------------------------------------------------------------------
// Migration runner for production deployments.
//
// Uses a direct PostgreSQL connection (bypassing PgBouncer) so that
// transaction-level features (CREATE TABLE, ALTER TABLE, etc.) work
// correctly.  The runner:
//
//   1. Connects to the database via a direct pool.
//   2. Snapshot the current migration count.
//   3. Applies any pending migrations from the `drizzle/` folder in order.
//   4. Reports the journal tags of newly-applied migrations.
//   5. Verifies the final schema version matches expectations (health check).
//   6. Exits with code 0 on success, 1 on failure.
//
// Usage:
//   pnpm db:migrate:run
//   DATABASE_URL=postgresql://... pnpm db:migrate:run
//   EXPECTED_MIGRATION_ID=0082 pnpm db:migrate:run   (enables post-run check)
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(__dirname, '..', 'drizzle', 'production')

export interface MigrationResult {
  ok: boolean
  applied: string[]
  error?: string
}

export interface MigrationOptions {
  migrationsFolder?: string
  migrationsSchema?: string
  connection?: DbPoolConfig
}

interface JournalEntry { tag: string; when: number }
interface AppliedMigration { id: string; hash: string; created_at: string }

function journal(folder: string): JournalEntry[] {
  return (JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[]
  }).entries
}

function metadataTable(schema: string): string {
  return `"${schema.replaceAll('"', '""')}"."__drizzle_migrations"`
}

async function getAppliedMigrations(client: Pool | PoolClient, schema: string): Promise<AppliedMigration[]> {
  try {
    const result = await client.query<AppliedMigration>(
      `SELECT id::text, hash, created_at::text FROM ${metadataTable(schema)} ORDER BY id ASC`,
    )
    return result.rows
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return []
    throw error
  }
}

/** Run migrations on one direct connection under a session advisory lock.
 * Each invocation owns and closes its pool, including failure paths.
 */
export async function runMigrations(options: MigrationOptions = {}): Promise<MigrationResult> {
  const pool = createDirectDbPool(options.connection, { shared: false })
  const folder = options.migrationsFolder ?? MIGRATIONS_FOLDER
  const schema = options.migrationsSchema ?? 'drizzle'
  let client: PoolClient | undefined
  try {
    client = await pool.connect()
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`barghsa:migrations:${schema}`])
    const entries = journal(folder)
    const before = await getAppliedMigrations(client, schema)
    await migrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: schema })
    const after = await getAppliedMigrations(client, schema)
    const beforeIds = new Set(before.map((row) => row.id))
    const applied = after.filter((row) => !beforeIds.has(row.id)).map((row) => {
      const entry = entries.find((entry) => String(entry.when) === row.created_at)
      if (!entry) throw new Error(`Migration timestamp ${row.created_at} is absent from the journal`)
      return entry.tag
    })
    return { ok: true, applied }
  } catch (error) {
    return { ok: false, applied: [], error: error instanceof Error ? error.message : String(error) }
  } finally {
    // Destroy the checked-out connection to release its session lock even when
    // a failed transaction prevents an explicit unlock query.
    client?.release(true)
    await pool.end()
  }
}

/** Verify a journal tag or its numeric prefix against the actual SQL digest.
 * Permission/network failures propagate; only an absent metadata table means
 * the database has no applied migration. IDs are not database serial numbers.
 */
export async function verifyMigrationVersion(expectedMigrationId: string, options: MigrationOptions = {}): Promise<boolean> {
  const folder = options.migrationsFolder ?? MIGRATIONS_FOLDER
  const entry = journal(folder).find((entry) => entry.tag === expectedMigrationId
    || entry.tag.split('_')[0] === expectedMigrationId.padStart(4, '0'))
  if (!entry) return false
  const pool = createDirectDbPool(options.connection, { shared: false })
  try {
    const applied = await getAppliedMigrations(pool, options.migrationsSchema ?? 'drizzle')
    const hash = createHash('sha256').update(readFileSync(resolve(folder, `${entry.tag}.sql`))).digest('hex')
    return applied.some((row) => row.created_at === String(entry.when) && row.hash === hash)
  } finally {
    await pool.end()
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const result = await runMigrations()

  if (!result.ok) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'migration_failed',
      error: result.error,
    }))
    process.exit(1)
  }

  if (result.applied.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No pending migrations to apply — schema is up to date.')
  } else {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'migrations_applied',
        count: result.applied.length,
        applied: result.applied,
      }),
    )
  }

  // Post-migration health check: verify expected migration version.
  const expectedId = process.env['EXPECTED_MIGRATION_ID']
  if (expectedId) {
    const versionOk = await verifyMigrationVersion(expectedId)
    if (!versionOk) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'migration_version_mismatch',
        expected: expectedId,
      }))
      process.exit(1)
    }
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'migration_version_verified',
        expected: expectedId,
      }),
    )
  }

  process.exit(0)
}

// Allow direct invocation: `tsx src/migrate.ts`
// Check using __filename to avoid matching other files with 'migrate' in the path.
const isDirectRun = process.argv[1] != null && __filename === resolve(process.argv[1])
if (isDirectRun) {
  main()
}
