import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../../packages/db/src/migrate.js';
import { scanServiceEscalations } from './escalation-scanner.js';
import { scanServiceBreaches } from './breach-scanner.js';
import { enqueueOutbox } from '../notifications/outbox-writer.js';

let management: Pool, pool: Pool;
const database = `test_support_${randomUUID().replaceAll('-', '')}`;
const logger = { warn: vi.fn(), info: vi.fn() };
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const migrated = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  expect(migrated.ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
  await pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff,disabled_at) VALUES
    ('support-owner','owner@example.test','test',false,NULL),
    ('support-active','active@example.test','test',true,NULL),
    ('support-disabled','disabled@example.test','test',true,NOW())`);
  await pool.query(
    `INSERT INTO profiles(id,user_id) VALUES ('10000000-0000-4000-8000-000000000001','support-owner')`
  );
}, 40000);
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}"`);
    await management.end();
  }
});
beforeEach(async () => {
  await pool.query(`TRUNCATE notification_outbox CASCADE;
    DELETE FROM service_breach_alerts; DELETE FROM tickets; DELETE FROM verification_cases; DELETE FROM app_config`);
});
const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
async function seed(domain: 'ticket' | 'verification_case', includeDisabled = true) {
  await pool.query('INSERT INTO app_config(key,value) VALUES ($1,$2)', [
    'admin.service_response_targets',
    JSON.stringify({ [domain]: 1 }),
  ]);
  for (const [index, id] of ids.entries()) {
    const assignee = includeDisabled && index === 0 ? 'support-disabled' : 'support-active';
    if (domain === 'ticket') {
      await pool.query(
        `INSERT INTO tickets(id,user_id,assigned_to,subject,body,status,updated_at)
        VALUES ($1,'support-owner',$2,'Overdue','Private','in_progress',NOW()-INTERVAL '4 hours')`,
        [id, assignee]
      );
    } else {
      await pool.query(
        `INSERT INTO verification_cases(id,profile_id,field_name,requested_value,reason,created_by,assigned_to,status,updated_at)
        VALUES ($1,'10000000-0000-4000-8000-000000000001','first_name','Updated','Correction','support-active',$2,'Open',NOW()-INTERVAL '4 hours')`,
        [id, assignee]
      );
    }
  }
}
for (const domain of ['ticket', 'verification_case'] as const) {
  it(`${domain} scans beyond a full page of unavailable or already alerted items`, async () => {
    await seed(domain);
    await pool.query(
      'INSERT INTO service_breach_alerts(service_type,item_id,target_hours) VALUES ($1,$2,1)',
      [domain, ids[1]]
    );
    const result = await scanServiceBreaches({ pool, logger, batchSize: 2 });
    expect(result.errors).toEqual([]);
    expect(result.alerted).toBe(3);
    expect(result.scanned[domain]).toBe(5);
    expect(
      (
        await pool.query("SELECT payload->>'item_id' AS id FROM notification_outbox ORDER BY id")
      ).rows
        .map((row) => row.id)
        .sort()
    ).toEqual(ids.slice(2));
    expect((await scanServiceBreaches({ pool, logger, batchSize: 2 })).alerted).toBe(0);
    expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(3);
  });
}
it('keeps committed pages and retries a rolled-back page without duplicate alerts', async () => {
  await seed('ticket', false);
  const failed = await scanServiceBreaches({
    pool,
    logger,
    batchSize: 2,
    enqueue: async (client, input) => {
      const result = await enqueueOutbox(client, input);
      if (input.payload?.item_id === ids[2]) throw new Error('injected page failure');
      return result;
    },
  });
  expect(failed.errors).toHaveLength(1);
  expect(failed.alerted).toBe(2);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(2);
  const retry = await scanServiceBreaches({ pool, logger, batchSize: 2 });
  expect(retry.errors).toEqual([]);
  expect(retry.alerted).toBe(3);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(5);
});

for (const domain of ['ticket', 'verification_case'] as const) {
  it(`${domain} escalates later pages despite unavailable leads and concurrent scans`, async () => {
    await seed(domain, false);
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('support-lead','lead@example.test','test',true) ON CONFLICT DO NOTHING"
    );
    const team = (
      await pool.query(
        "INSERT INTO staff_teams(name,lead_user_id) VALUES ('Paging team','support-lead') ON CONFLICT (name) DO UPDATE SET lead_user_id=EXCLUDED.lead_user_id RETURNING id"
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'support-active'),($1,'support-lead') ON CONFLICT DO NOTHING",
      [team]
    );
    await pool.query(
      `UPDATE ${domain === 'ticket' ? 'tickets' : 'verification_cases'} SET assigned_to='support-disabled' WHERE id::text=ANY($1::text[])`,
      [ids.slice(0, 2)]
    );
    for (const id of ids)
      await pool.query(
        "INSERT INTO service_breach_alerts(id,service_type,item_id,target_hours,alerted_at) VALUES ($1,$2,$3,1,NOW()-INTERVAL '2 hours')",
        [id, domain, id]
      );
    await pool.query("INSERT INTO app_config(key,value) VALUES ('admin.escalation_policy',$1)", [
      JSON.stringify({
        [domain]: {
          level2: { delayHours: 1, channels: ['in_app'] },
          level3: { delayHours: null, channels: ['in_app'] },
        },
      }),
    ]);
    const results = await Promise.all([
      scanServiceEscalations({ pool, logger, batchSize: 2 }),
      scanServiceEscalations({ pool, logger, batchSize: 2 }),
    ]);
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(results.reduce((sum, r) => sum + r.escalated[domain].level2, 0)).toBe(3);
    expect(
      (
        await pool.query(
          'SELECT item_id FROM service_breach_alerts WHERE escalation_level=2 ORDER BY item_id'
        )
      ).rows.map((r) => r.item_id)
    ).toEqual(ids.slice(2));
    expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(3);
  });
}
