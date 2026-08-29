/**
 * Test database helpers for isolated PostgreSQL schemas.
 *
 * Each call to `createIsolatedTestDb()` creates a unique PostgreSQL schema
 * on the shared Testcontainers-managed database, runs any pending migrations,
 * and returns a Drizzle instance scoped to that schema.  Parallel workers
 * each get their own schema so tests never collide.
 *
 * Usage:
 * ```ts
 * import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
 * import { describe, it, afterAll } from 'vitest'
 *
 * describe('widget service', () => {
 *   const ctx = await createIsolatedTestDb()
 *   afterAll(() => dropTestSchema(ctx.schemaName))
 *
 *   it('does something with the database', async () => {
 *     await ctx.db.execute(sql`SELECT 1`)
 *   })
 * })
 * ```
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'

export interface IsolatedTestDb {
  /** The PostgreSQL schema name (e.g. `test_a1b2c3d4`). */
  schemaName: string
  /** Drizzle ORM instance scoped to the isolated schema. */
  db: ReturnType<typeof drizzle>
  /** Pool backing this instance — call `end()` after the test. */
  pool: Pool
  /**
   * Connection string whose `search_path` targets the isolated schema.
   * Callers that need additional pools (e.g. to exercise concurrent
   * connections) can build their own `Pool` from this URL.
   */
  connectionString: string
}

const MANAGEMENT_POOL_MAX = 5

/**
 * Lazily-initialized management pool connected to the Testcontainers
 * database.  Used only for CREATE / DROP SCHEMA statements.
 */
function getManagementPool(): Pool {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Did you run vitest with the globalSetup?',
    )
  }
  return new Pool({ connectionString: url, max: MANAGEMENT_POOL_MAX })
}

/**
 * Create a new isolated PostgreSQL schema and return a Drizzle instance
 * scoped to it.
 *
 * @param prefix - Optional schema name prefix (default `test_`).
 * @param poolMax - Max connections for the returned pool. Defaults to 1 so
 *   tests never accidentally use parallel connections; raise it (e.g. 4)
 *   when a test must exercise concurrent transactions on the same data.
 * @returns An `IsolatedTestDb` with `schemaName`, `db`, `pool`, and the
 *   schema-scoped `connectionString`.
 */
export async function createIsolatedTestDb(
  prefix = 'test_',
  poolMax = 1,
): Promise<IsolatedTestDb> {
  const schemaName = `${prefix}${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const mgmtPool = getManagementPool()

  try {
    await mgmtPool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)

    // Build a connection string that targets the isolated schema.
    const baseUrl = process.env.TEST_DATABASE_URL!
    const sep = baseUrl.includes('?') ? '&' : '?'
    const schemaUrl = `${baseUrl}${sep}options=${encodeURIComponent(`-c search_path=${schemaName},public`)}`

    const pool = new Pool({ connectionString: schemaUrl, max: poolMax })
    const db = drizzle(pool, { logger: false })

    return { schemaName, db, pool, connectionString: schemaUrl }
  } finally {
    await mgmtPool.end().catch(() => {})
  }
}

/**
 * Drop an isolated test schema and all its objects.
 * Call this in `afterAll` / `afterEach` to keep the test database clean.
 */
export async function dropTestSchema(schemaName: string): Promise<void> {
  if (!schemaName.startsWith('test_')) {
    throw new Error(
      `Refusing to drop schema "${schemaName}": does not start with 'test_'`,
    )
  }
  const mgmtPool = getManagementPool()
  try {
    await mgmtPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  } finally {
    await mgmtPool.end().catch(() => {})
  }
}