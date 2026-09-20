import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { startHttpFixture } from '../test/http-fixture.js';
let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

it('serves unavailable metrics through a database outage and recovers without stale samples', async () => {
  async function scrape() {
    const response = await fetch(`${fixture.base}/metrics`, {
      signal: AbortSignal.timeout(15_000),
    });
    expect(response.status).toBe(200);
    return response.text();
  }
  const healthy = await scrape();
  expect(healthy).toMatch(/^pg_metrics_collection_success 1$/m);
  expect(healthy).toMatch(/^pg_checkpoints_timed_total \d+/m);
  expect(healthy).toMatch(/^pg_metrics_view_available\{view="statements"\} 0$/m);

  // This control connection only changes the disposable database owned by this fixture.
  const identity = (
    await fixture.pool.query('SELECT current_database() AS name, pg_backend_pid() AS pid')
  ).rows[0];
  const database: string = identity.name;
  if (!/^test_http_[a-f0-9]+$/.test(database)) {
    throw new Error('Refusing to alter a database not owned by this fixture');
  }
  // PostgreSQL requires changing ALLOW_CONNECTIONS from another database.
  const control = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    await control.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`);
    await control.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> $2`,
      [database, identity.pid]
    );
    const failed = await scrape();
    expect(failed).toMatch(/^pg_metrics_collection_success 0$/m);
    expect(failed).not.toMatch(/^pg_cache_hit_ratio /m);
    expect(failed).not.toMatch(/^pg_checkpoints_timed_total /m);
  } finally {
    try {
      await control.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`);
    } finally {
      await control.end();
    }
  }
  const recovered = await scrape();
  expect(recovered).toMatch(/^pg_metrics_collection_success 1$/m);
  expect(recovered).toMatch(/^pg_checkpoints_timed_total \d+/m);
}, 45_000);
