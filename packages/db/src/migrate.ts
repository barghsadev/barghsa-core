import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDirectDbPool } from './index.js'

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
//   4. Reports the IDs of newly-applied migrations (diff from snapshot).
//   5. Verifies the final schema version matches expectations (health check).
//   6. Exits with code 0 on success, 1 on failure.
//
// Usage:
//   pnpm db:migrate:run
//   DATABASE_URL=postgresql://... pnpm db:migrate:run
//   EXPECTED_MIGRATION_ID=0001 pnpm db:migrate:run   (enables post-run check)
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(__dirname, '..', 'drizzle')

export interface MigrationResult {
  ok: boolean
  applied: string[]
  error?: string
}

/**
 * Count how many migrations have already been applied, by querying
 * the `__drizzle_migrations` meta-table.  Returns an empty array when
 * the table does not exist yet (fresh database).
 */
async function getAppliedMigrationIds(pool: import('pg').Pool): Promise<string[]> {
  try {
    const result = await pool.query(`
      SELECT id
      FROM __drizzle_migrations
      ORDER BY id ASC
    `)
    return result.rows.map(
      (row: { id: number | string }) => String(row.id),
    )
  } catch {
    // __drizzle_migrations table may not exist yet on a fresh database.
    return []
  }
}

/**
 * Run all pending migrations against the database.
 *
 * Uses Drizzle ORM's built-in `migrate` function which checks the
 * `__drizzle_migrations` meta-table and applies any new SQL files
 * from the migrations folder.
 *
 * Returns the IDs of only the migrations that were newly applied
 * during this call (diff-based tracking).
 */
export async function runMigrations(): Promise<MigrationResult> {
  const pool = createDirectDbPool()
  const db = drizzle(pool)

  try {
    // Snapshot applied migration IDs before running migrations.
    const beforeIds = await getAppliedMigrationIds(pool)

    // Drizzle's migrate applies pending files from the migrations folder.
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
    })

    // Query applied IDs after migration and compute the diff.
    const afterIds = await getAppliedMigrationIds(pool)
    const beforeSet = new Set(beforeIds)
    const applied = afterIds.filter((id) => !beforeSet.has(id))

    return {
      ok: true,
      applied,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      applied: [],
      error: message,
    }
  }
}

/**
 * Verify that the database schema version matches an expected migration ID.
 *
 * This is a post-migration health check: the caller provides the expected
 * latest migration ID (e.g. `'0001'`), and the function checks whether it
 * appears in the `__drizzle_migrations` table.  This ensures the migration
 * pipeline actually ran before new app instances start accepting traffic.
 *
 * Returns `true` when the expected migration has been applied.
 */
export async function verifyMigrationVersion(
  expectedMigrationId: string,
): Promise<boolean> {
  const pool = createDirectDbPool()
  try {
    const result = await pool.query(
      `SELECT 1 FROM __drizzle_migrations WHERE id = $1`,
      [expectedMigrationId],
    )
    return result.rows.length > 0
  } catch {
    return false
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
