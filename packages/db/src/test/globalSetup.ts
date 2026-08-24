/**
 * Vitest global setup — starts a PostgreSQL Testcontainers instance
 * before the test suite runs and tears it down after all tests complete.
 *
 * This file is referenced by vitest.config.ts via `globalSetup`.
 * Each worker creates an isolated schema via `createIsolatedTestDb()`
 * so parallel tests never collide.
 *
 * @see https://vitest.dev/config/#globalsetup
 * @see https://node.testcontainers.org/
 */

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

let container: StartedPostgreSqlContainer | null = null
let shutdownPool: Pool | null = null

/**
 * Called once before all test workers start.
 * Starts a PostgreSQL container and exposes the connection string.
 */
export async function setup(): Promise<void> {
  const started = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('barghsa_test')
    .withUsername('barghsa')
    .withPassword('barghsa_test')
    .start()

  container = started

  const connectionString = started.getConnectionUri()
  process.env.TEST_DATABASE_URL = connectionString

  // Create a lightweight pool for schema management (used by test helpers).
  shutdownPool = new Pool({ connectionString, max: 2 })
}

/**
 * Called once after all test workers finish.
 * Stops the PostgreSQL container and cleans up the management pool.
 */
export async function teardown(): Promise<void> {
  if (shutdownPool) {
    await shutdownPool.end().catch(() => {})
    shutdownPool = null
  }
  if (container) {
    await container.stop()
    container = null
  }
  delete process.env.TEST_DATABASE_URL
}