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
export async function startTestPostgres(): Promise<{
  connectionString: string;
  close: () => Promise<void>;
}> {
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
    return {
      connectionString,
      close: async () => {
        await started.stop();
      },
    };
  } catch (error) {
    await started.stop();
    throw error;
  }
}

/** Vitest adapter; standalone fixtures use startTestPostgres directly. */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await startTestPostgres();
  try {
    project.config.env = { ...project.config.env, TEST_DATABASE_URL: database.connectionString };
    return database.close;
  } catch (error) {
    await database.close();
    throw error;
  }
}
