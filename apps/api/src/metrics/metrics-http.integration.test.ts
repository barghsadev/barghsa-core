import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { startHttpFixture } from '../test/http-fixture.js';
let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  vi.stubEnv('DB_POOL_MAX', '7');
  try {
    fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    vi.unstubAllEnvs();
  }
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

it('reports each AI model circuit and current UTC month spend independently', async () => {
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('metrics-ai-admin','metrics-ai-admin@example.test','test-only',true)"
  );
  const modelId = (
    await fixture.pool.query<{ id: string }>(
      "INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by) VALUES ('Metrics','openai_compatible','https://example.test/v1','test','metrics-ai-admin') RETURNING id"
    )
  ).rows[0]!.id;
  const scrape = async () => (await fetch(`${fixture.base}/metrics`)).text();
  expect(await scrape()).toContain(`ai_model_health{model_id="${modelId}"} 1`);
  await fixture.pool.query(
    `INSERT INTO ai_model_budgets(model_id,monthly_token_limit,monthly_cost_limit_micros,
      input_price_per_million_micros,output_price_per_million_micros,
      used_input_tokens,used_output_tokens,used_cost_micros)
      VALUES ($1,10000,2468000,1,1,1000,1500,1234000)`,
    [modelId]
  );
  const current = await scrape();
  expect(current).toContain(`ai_model_monthly_spend_usd{model_id="${modelId}"} 1.234\n`);
  expect(current).toContain(
    `ai_model_monthly_budget_usage_ratio{model_id="${modelId}",unit="tokens"} 0.25\n`
  );
  expect(current).toContain(
    `ai_model_monthly_budget_usage_ratio{model_id="${modelId}",unit="usd"} 0.5\n`
  );
  await fixture.pool.query(
    `UPDATE ai_model_budgets SET period_start=
       ((date_trunc('month',now() AT TIME ZONE 'UTC') - interval '1 month') AT TIME ZONE 'UTC')
       WHERE model_id=$1`,
    [modelId]
  );
  const reset = await scrape();
  expect(reset).toContain(`ai_model_monthly_spend_usd{model_id="${modelId}"} 0\n`);
  expect(reset).toContain(
    `ai_model_monthly_budget_usage_ratio{model_id="${modelId}",unit="tokens"} 0\n`
  );
  expect(reset).toContain(
    `ai_model_monthly_budget_usage_ratio{model_id="${modelId}",unit="usd"} 0\n`
  );
  expect(
    (
      await fixture.pool.query('SELECT used_cost_micros FROM ai_model_budgets WHERE model_id=$1', [
        modelId,
      ])
    ).rows[0]
  ).toEqual({ used_cost_micros: '1234000' });
  await fixture.pool.query('UPDATE ai_model_circuit_states SET degraded=true WHERE id=$1', [
    modelId,
  ]);
  expect(await scrape()).toContain(`ai_model_health{model_id="${modelId}"} 0`);
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
  expect(healthy).toMatch(/^pg_pool_capacity 7$/m);
  expect(healthy).toMatch(/^pg_pool_connections\{state="active"\} \d+$/m);
  expect(healthy).toMatch(/^pg_pool_connections\{state="idle"\} \d+$/m);
  expect(healthy).toMatch(/^pg_pool_waiting_requests 0$/m);

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
    expect(failed).not.toMatch(/^ai_model_monthly_spend_usd\{/m);
    expect(failed).not.toMatch(/^ai_model_monthly_budget_usage_ratio\{/m);
    expect(failed).toMatch(/^pg_pool_capacity 7$/m);
  } finally {
    try {
      await control.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`);
    } finally {
      await control.end();
    }
  }
  // Reopening the database does not immediately replace terminated pool sockets.
  // Require an actual fresh collection, with a bound, instead of assuming the
  // first scrape after ALTER DATABASE is the successful one.
  let recovered = '';
  await expect
    .poll(
      async () => {
        recovered = await scrape();
        return recovered;
      },
      { timeout: 10_000, interval: 250 }
    )
    .toMatch(/^pg_metrics_collection_success 1$/m);
  expect(recovered).toMatch(/^pg_metrics_collection_success 1$/m);
  expect(recovered).toMatch(/^pg_checkpoints_timed_total \d+/m);
}, 45_000);
