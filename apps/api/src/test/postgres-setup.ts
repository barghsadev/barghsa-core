import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { startTestPostgres } from '../../../../packages/db/src/test/globalSetup';
import { runMigrations } from '../../../../packages/db/src/migrate';

/** A fresh production-migrated template for this test run, never shared across runs. */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await startTestPostgres();
  const management = new Pool({ connectionString: database.connectionString, max: 1 });
  let ready = false;
  try {
    const template = `http_template_${randomUUID().replaceAll('-', '')}`;
    await management.query(`CREATE DATABASE "${template}"`);
    const url = new URL(database.connectionString);
    url.pathname = `/${template}`;
    const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
    if (!migration.ok)
      throw new Error(`HTTP template migration failed: ${JSON.stringify(migration)}`);
    // Tests can clone this baseline, but cannot connect and mutate it.
    await management.query(`ALTER DATABASE "${template}" ALLOW_CONNECTIONS false`);
    project.config.env = {
      ...project.config.env,
      TEST_DATABASE_URL: database.connectionString,
      BARGHSA_HTTP_TEMPLATE_DATABASE: template,
    };
    ready = true;
    return database.close;
  } finally {
    try {
      await management.end();
    } finally {
      if (!ready) await database.close();
    }
  }
}
