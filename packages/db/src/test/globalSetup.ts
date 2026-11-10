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
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DockerComposeEnvironment } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { Pool } from 'pg';

type TestPostgres = {
  connectionString: string;
  close: () => Promise<void>;
};
type TestPostgresContainer = {
  getConnectionUri: () => string;
  close: TestPostgres['close'];
};

async function startSingleContainer(): Promise<TestPostgresContainer> {
  const started = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase('barghsa_test')
    .withUsername('barghsa')
    .withPassword('barghsa_test')
    .start();
  return {
    getConnectionUri: () => started.getConnectionUri(),
    close: async () => {
      await started.stop();
    },
  };
}

async function startComposeDatabase(): Promise<TestPostgresContainer> {
  const password = randomBytes(24).toString('hex');
  const started = await new DockerComposeEnvironment(
    resolve(__dirname, '../../../..'),
    'docker-compose.test.yml'
  )
    .withProjectName(`barghsa-test-${randomUUID()}`)
    .withEnvironment({ BARGHSA_TEST_POSTGRES_PASSWORD: password })
    .up();
  return {
    getConnectionUri: () => {
      const port = started.getContainer('postgres-1').getMappedPort(5432);
      return `postgresql://barghsa:${password}@127.0.0.1:${port}/barghsa_test`;
    },
    close: async () => {
      await started.down({ timeout: 30_000, removeVolumes: true });
    },
  };
}

/** Start an owned disposable PostgreSQL before the test workers. */
export async function startTestPostgres(): Promise<TestPostgres> {
  const database = await (process.env.BARGHSA_TEST_POSTGRES_COMPOSE === '1'
    ? startComposeDatabase()
    : startSingleContainer());
  try {
    const connectionString = database.getConnectionUri();
    // Create the shared extension before parallel fixture migrations start.
    const bootstrap = new Pool({ connectionString, max: 1 });
    try {
      await bootstrap.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
      await bootstrap.query('CREATE EXTENSION IF NOT EXISTS vector');
    } finally {
      await bootstrap.end();
    }
    return { connectionString, close: database.close };
  } catch (error) {
    await database.close();
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
