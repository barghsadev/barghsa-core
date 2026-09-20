import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../migrate';

/** Disposable database using exactly the production migration journal. */
export async function createMigratedTestDb() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL test setup did not run');
  const name = `test_migrated_${randomUUID().replaceAll('-', '')}`;
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let pool: Pool | undefined,
    created = false;
  const close = async () => {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
    }
  };
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    const connectionString = url.toString();
    const result = await runMigrations({ connection: { pgdirectUrl: connectionString } });
    if (!result.ok) throw new Error(result.error);
    pool = new Pool({ connectionString });
    return { pool, db: drizzle(pool), connectionString, close };
  } catch (error) {
    await close();
    throw error;
  }
}
