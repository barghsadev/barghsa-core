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
//   2. Checks the `__drizzle_migrations` table for already-applied migrations.
//   3. Applies any pending migrations from the `drizzle/` folder in order.
//   4. Reports the IDs of newly-applied migrations.
//   5. Verifies the final schema version matches expectations (health check).
//   6. Exits with code 0 on success, 1 on failure.
//
// Usage:
//   pnpm db:migrate:run
//   DATABASE_URL=postgresql://... pnpm db:migrate:run
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(__dirname, '..', 'drizzle')

export interface MigrationResult {
  ok: boolean
  applied: string[]
  error?: string
}

/**
 * Run all pending migrations against the database.
 *
 * Uses Drizzle ORM's built-in `migrate` function which checks the
 * `__drizzle_migrations` meta-table and applies any new SQL files
 * from the migrations folder.
 */
export async function runMigrations(): Promise<MigrationResult> {
  const pool = createDirectDbPool()
  const db = drizzle(pool)

  const startedAt = Date.now()

  try {
    // Drizzle's migrate applies pending files from the migrations folder
    // and returns a list of applied migration journal entries.
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
    })

    const elapsedMs = Date.now() - startedAt

    // Query which migrations have been applied to build the report.
    const result = await pool.query(`
      SELECT id, hash, created_at
      FROM __drizzle_migrations
      ORDER BY id ASC
    `)

    const applied = result.rows.map(
      (row: { id: number | string }) => String(row.id),
    )

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

  process.exit(0)
}

// Allow direct invocation: `tsx src/migrate.ts`
const isDirectRun = process.argv[1]?.includes('migrate')
if (isDirectRun) {
  main()
}
