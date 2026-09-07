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

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { Pool } from 'pg';

/**
 * Called once before all test workers start.
 * Starts a PostgreSQL container and exposes the connection string.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const started = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('barghsa_test')
    .withUsername('barghsa')
    .withPassword('barghsa_test')
    .start();

  try {
    const connectionString = started.getConnectionUri();
    // Create the shared extension before parallel fixture migrations start.
    const bootstrap = new Pool({ connectionString, max: 1 });
    try {
      await bootstrap.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
    } finally {
      await bootstrap.end();
    }
    // Each project gets its own worker environment. A shared process.env
    // value would point every project at the last container started.
    project.config.env = { ...project.config.env, TEST_DATABASE_URL: connectionString };
  } catch (error) {
    await started.stop();
    throw error;
  }

  // Capture this container in the returned teardown. Module-level state would
  // be overwritten when several projects load this same global setup module.
  return async () => {
    await started.stop();
  };
}
