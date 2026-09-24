import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createIsolatedTestDb, dropTestSchema, type IsolatedTestDb } from '@barghsa/db/test';
import { checkSmsCredit } from './sms-credit-monitor.js';

let ctx: IsolatedTestDb;
const providerId = '5dd3409d-1a90-4a31-b5ad-8a90d423723e';

beforeAll(async () => {
  ctx = await createIsolatedTestDb('test_', 4);
  await ctx.pool.query(`CREATE TABLE sms_provider_configs (
    id uuid PRIMARY KEY, status text NOT NULL, last_test_status text NOT NULL,
    config jsonb NOT NULL
  )`);
  await ctx.pool.query(`CREATE TABLE provider_health_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel text NOT NULL,
    provider_id uuid NOT NULL, kind text NOT NULL,
    CONSTRAINT provider_health_events_channel_check CHECK (channel IN ('email','sms')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT provider_health_events_kind_check CHECK (kind IN ('circuit_open','circuit_recovered'))
  )`);
  const sql = readFileSync(
    resolve(__dirname, '../../../../packages/db/drizzle/production/0203_sms_credit_monitoring.sql'),
    'utf8'
  );
  for (const statement of sql.split('--> statement-breakpoint'))
    await ctx.pool.query(statement.trim());
}, 40_000);

afterAll(async () => {
  await ctx?.pool.end();
  if (ctx) await dropTestSchema(ctx.schemaName);
});

beforeEach(async () => {
  await ctx.pool.query('DELETE FROM provider_health_events');
  await ctx.pool.query('DELETE FROM sms_provider_configs');
  await ctx.pool.query(
    `INSERT INTO sms_provider_configs(id,status,last_test_status,config)
     VALUES ($1,'active','passed',$2)`,
    [providerId, { api_key: 'fixture-key', sender: '3000', low_credit_threshold: 100 }]
  );
});

function creditResponse(balance: number): typeof fetch {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(JSON.stringify({ status: 1, data: balance }), { status: 200 })
    );
}

it('claims once across replicas, alerts once while low, and records recovery', async () => {
  const request = creditResponse(50);
  const claims = await Promise.all([
    checkSmsCredit(ctx.pool, request),
    checkSmsCredit(ctx.pool, request),
  ]);
  expect(claims.sort()).toEqual(['checked', 'idle']);
  expect(request).toHaveBeenCalledTimes(1);
  let state = await ctx.pool.query(
    'SELECT low_credit_balance,credit_checked_at,low_credit_alert_active,credit_next_check_at FROM sms_provider_configs WHERE id=$1',
    [providerId]
  );
  expect(Number(state.rows[0].low_credit_balance)).toBe(50);
  expect(state.rows[0].credit_checked_at).toBeInstanceOf(Date);
  expect(state.rows[0].low_credit_alert_active).toBe(true);
  expect(state.rows[0].credit_next_check_at.getTime()).toBeGreaterThan(
    Date.now() + 5 * 60 * 60_000
  );

  await ctx.pool.query(
    "UPDATE sms_provider_configs SET credit_next_check_at=NOW()-INTERVAL '1 second'"
  );
  expect(await checkSmsCredit(ctx.pool, request)).toBe('checked');
  let events = await ctx.pool.query(
    'SELECT kind FROM provider_health_events ORDER BY created_at,id'
  );
  expect(events.rows.map((row) => row.kind)).toEqual(['low_credit']);

  await ctx.pool.query(
    "UPDATE sms_provider_configs SET credit_next_check_at=NOW()-INTERVAL '1 second'"
  );
  expect(await checkSmsCredit(ctx.pool, creditResponse(150))).toBe('checked');
  events = await ctx.pool.query('SELECT kind FROM provider_health_events ORDER BY created_at,id');
  expect(events.rows.map((row) => row.kind).sort()).toEqual(['credit_recovered', 'low_credit']);
  state = await ctx.pool.query('SELECT low_credit_alert_active FROM sms_provider_configs');
  expect(state.rows[0].low_credit_alert_active).toBe(false);
});

it('keeps the last known balance and retries after a provider failure', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
  await expect(checkSmsCredit(ctx.pool, request)).rejects.toThrow('SMS.ir credit check failed');
  const result = await ctx.pool.query(
    'SELECT low_credit_balance,credit_check_lease_token,credit_next_check_at FROM sms_provider_configs'
  );
  expect(result.rows[0].low_credit_balance).toBeNull();
  expect(result.rows[0].credit_check_lease_token).toBeNull();
  expect(result.rows[0].credit_next_check_at.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  expect(await checkSmsCredit(ctx.pool, request)).toBe('idle');
});
