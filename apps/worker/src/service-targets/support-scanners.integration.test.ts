import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../../packages/db/src/migrate.js';
import { scanServiceEscalations } from './escalation-scanner.js';
import { scanServiceBreaches } from './breach-scanner.js';
import { enqueueOutbox } from '../notifications/outbox-writer.js';
import { InAppNotificationTransport } from '../notifications/in-app-transport.js';

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
    DELETE FROM service_breach_alerts; DELETE FROM in_app_notifications; DELETE FROM consultation_requests; DELETE FROM tickets; DELETE FROM verification_cases; DELETE FROM app_config; UPDATE users SET is_admin=false`);
});
const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
async function seed(
  domain: 'ticket' | 'verification_case' | 'consultation',
  includeDisabled = true
) {
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
    } else if (domain === 'consultation') {
      await pool.query(
        `INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,submitted_by,submission_key,staff_owner_id,status,updated_at)
         SELECT $1,'10000000-0000-4000-8000-000000000001',id,'{"title":{"en":"Consultation","fa":"مشاوره"}}'::jsonb,
         'support-owner',$1,$2,'under_review',NOW()-INTERVAL '4 hours'
         FROM products WHERE system_key='electricity_generation_station'`,
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
for (const domain of ['ticket', 'verification_case', 'consultation'] as const) {
  it(`${domain} scans beyond a full page of unavailable or already alerted items`, async () => {
    await seed(domain);
    await pool.query(
      'INSERT INTO service_breach_alerts(service_type,item_id,target_hours,source_activity_at) VALUES ($1,$2,1,(SELECT updated_at FROM consultation_requests WHERE id=$2::text::uuid))',
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

for (const domain of ['ticket', 'verification_case', 'consultation'] as const) {
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
      `UPDATE ${domain === 'ticket' ? 'tickets' : domain === 'consultation' ? 'consultation_requests' : 'verification_cases'} SET ${domain === 'consultation' ? 'staff_owner_id' : 'assigned_to'}='support-disabled' WHERE id::text=ANY($1::text[])`,
      [ids.slice(0, 2)]
    );
    for (const id of ids)
      await pool.query(
        "INSERT INTO service_breach_alerts(id,service_type,item_id,target_hours,alerted_at,source_activity_at) VALUES ($1,$2,$3,1,NOW()-INTERVAL '2 hours',(SELECT updated_at FROM consultation_requests WHERE id=$3::text::uuid))",
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

async function consultation(
  status = 'submitted',
  owner: string | null = 'support-active',
  age = '4 hours'
) {
  const id = randomUUID();
  const rows = await pool.query(
    `INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,submitted_by,submission_key,staff_owner_id,status,updated_at)
     SELECT $1,'10000000-0000-4000-8000-000000000001',id,'{"title":{"en":"Consultation","fa":"مشاوره"}}'::jsonb,
     'support-owner',$1,$2,$3,NOW()-$4::interval
     FROM products WHERE system_key='electricity_generation_station' RETURNING id`,
    [id, owner, status, age]
  );
  expect(rows.rowCount).toBe(1);
  return id;
}
async function consultationSettings(target: number | null = 1) {
  await pool.query(
    `INSERT INTO app_config(key,value) VALUES('admin.service_response_targets',$1::jsonb),
    ('admin.escalation_policy',$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [
      JSON.stringify({ consultation: target }),
      JSON.stringify({
        consultation: {
          level2: { delayHours: 1, channels: ['in_app', 'email'] },
          level3: { delayHours: 1, channels: ['in_app'] },
        },
      }),
    ]
  );
}
async function administrator() {
  await pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff,is_admin)
    VALUES('support-admin','admin@example.test','test',true,true)
    ON CONFLICT(user_id) DO UPDATE SET is_admin=true,disabled_at=NULL,activation_token=NULL`);
}
async function consultationLead() {
  await pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff)
    VALUES('support-lead','lead@example.test','test',true) ON CONFLICT DO NOTHING`);
  const team = (
    await pool.query(`INSERT INTO staff_teams(name,lead_user_id)
    VALUES('Consultation team','support-lead') ON CONFLICT(name) DO UPDATE SET lead_user_id=EXCLUDED.lead_user_id RETURNING id`)
  ).rows[0].id;
  await pool.query(
    `INSERT INTO staff_team_members(team_id,user_id)
    VALUES($1,'support-active'),($1,'support-lead') ON CONFLICT DO NOTHING`,
    [team]
  );
}
it('consultation clocks exclude customer waits and terminal states and deliver private linked staff notices', async () => {
  await consultationSettings();
  const due = [];
  for (const status of ['submitted', 'under_review', 'offer_accepted'])
    due.push(await consultation(status));
  for (const status of [
    'awaiting_customer_info',
    'offer_pending',
    'offer_declined',
    'completed',
    'rejected',
    'cancelled',
  ])
    await consultation(status);
  await consultation('under_review', 'support-active', '30 minutes');
  const result = await scanServiceBreaches({ pool, logger });
  expect(result.errors).toEqual([]);
  expect(result.scanned.consultation).toBe(3);
  expect(result.alerted).toBe(3);
  const rows = (await pool.query('SELECT * FROM notification_outbox ORDER BY id')).rows;
  expect(rows.map((row) => row.payload.item_id).sort()).toEqual(due.sort());
  const transport = new InAppNotificationTransport(pool);
  for (const row of rows) {
    expect(row.user_id).toBe('support-active');
    expect(row.profile_id).toBeNull();
    expect(row.payload.service_type_name_fa).toBe('درخواست مشاوره');
    expect(row.payload.service_type_name_en).toBe('consultation request');
    const delivery = {
      eventKey: row.event_key,
      channel: 'in_app' as const,
      profileId: null,
      recipientId: row.user_id,
      payload: row.payload,
      idempotencyKey: row.idempotency_key,
      outboxId: row.id,
    };
    expect((await transport.send(delivery)).status).toBe('delivered');
    expect((await transport.send(delivery)).status).toBe('delivered');
  }
  const notices = (await pool.query('SELECT * FROM in_app_notifications')).rows;
  expect(notices).toHaveLength(3);
  for (const row of notices) {
    expect(row.recipient_user_id).toBe('support-active');
    expect(row.operating_context).toBe('staff');
    expect(row.profile_id).toBeNull();
    expect(row.link_route).toMatch(/^\/admin\/consultations\?requestId=/);
    expect(row.localized_content.fa.body).toBeTruthy();
    expect(row.localized_content.en.body).toBeTruthy();
  }
});
it('consultation episodes advance to the configured lead then admins once per tier under concurrent scans', async () => {
  await consultationSettings();
  await consultationLead();
  await administrator();
  const id = await consultation();
  expect((await scanServiceBreaches({ pool, logger })).alerted).toBe(1);
  await pool.query("UPDATE service_breach_alerts SET alerted_at=NOW()-INTERVAL '2 hours'");
  let results = await Promise.all([
    scanServiceEscalations({ pool, logger }),
    scanServiceEscalations({ pool, logger }),
  ]);
  expect(results.flatMap((r) => r.errors)).toEqual([]);
  expect(results.reduce((n, r) => n + r.escalated.consultation.level2, 0)).toBe(1);
  const lead = (
    await pool.query(
      "SELECT user_id,channels,payload FROM notification_outbox WHERE event_key='admin.service_escalated'"
    )
  ).rows;
  expect(lead).toHaveLength(1);
  expect(lead[0].channels).toEqual(['in_app', 'email']);
  expect(lead.every((r) => r.user_id === 'support-lead' && r.payload.escalation_level === 2)).toBe(
    true
  );
  await pool.query("UPDATE service_breach_alerts SET escalated_at=NOW()-INTERVAL '2 hours'");
  results = await Promise.all([
    scanServiceEscalations({ pool, logger }),
    scanServiceEscalations({ pool, logger }),
  ]);
  expect(results.flatMap((r) => r.errors)).toEqual([]);
  expect(results.reduce((n, r) => n + r.escalated.consultation.level3, 0)).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT user_id,payload FROM notification_outbox WHERE payload->>'escalation_level'='3'"
      )
    ).rows
  ).toEqual([
    {
      user_id: 'support-admin',
      payload: expect.objectContaining({
        item_id: id,
        link_route: `/admin/consultations?requestId=${id}`,
      }),
    },
  ]);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(3);
  expect((await scanServiceEscalations({ pool, logger })).escalated.consultation).toEqual({
    level2: 0,
    level3: 0,
  });
  await pool.query(
    "UPDATE consultation_requests SET status='completed',updated_at=NOW() WHERE id=$1",
    [id]
  );
  expect((await scanServiceBreaches({ pool, logger })).pruned).toBe(1);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toHaveLength(0);
});
it('consultation staff activity resets episodes even when recovery happened between scanner passes', async () => {
  await consultationSettings();
  await consultationLead();
  const id = await consultation();
  expect((await scanServiceBreaches({ pool, logger })).alerted).toBe(1);
  const previous = (await pool.query('SELECT id FROM service_breach_alerts')).rows[0].id;
  await pool.query("UPDATE service_breach_alerts SET alerted_at=NOW()-INTERVAL '3 hours'");
  await pool.query(
    "UPDATE consultation_requests SET status='under_review',updated_at=NOW()-INTERVAL '90 minutes' WHERE id=$1",
    [id]
  );
  expect((await scanServiceEscalations({ pool, logger })).escalated.consultation.level2).toBe(0);
  const again = await scanServiceBreaches({ pool, logger });
  expect(again.errors).toEqual([]);
  expect(again.pruned).toBe(1);
  expect(again.alerted).toBe(1);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows[0].id).not.toBe(previous);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(2);
  await pool.query('UPDATE consultation_requests SET updated_at=NOW() WHERE id=$1', [id]);
  expect((await scanServiceBreaches({ pool, logger })).pruned).toBe(1);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toHaveLength(0);
});
it('consultation unassigned fallback retries when no admin exists and disabling restarts a later breach', async () => {
  await consultationSettings();
  const id = await consultation('submitted', null);
  expect((await scanServiceBreaches({ pool, logger })).alerted).toBe(0);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toHaveLength(0);
  await administrator();
  expect((await scanServiceBreaches({ pool, logger })).alerted).toBe(1);
  expect((await pool.query('SELECT user_id FROM notification_outbox')).rows).toEqual([
    { user_id: 'support-admin' },
  ]);
  await consultationSettings(null);
  const disabled = await scanServiceBreaches({ pool, logger });
  expect(disabled.pruned).toBe(1);
  expect(disabled.scanned.consultation).toBe(0);
  expect((await scanServiceEscalations({ pool, logger })).escalated.consultation).toEqual({
    level2: 0,
    level3: 0,
  });
  await consultationSettings();
  expect((await scanServiceBreaches({ pool, logger })).alerted).toBe(1);
  expect(
    (await pool.query("SELECT payload->>'item_id' AS id FROM notification_outbox")).rows
  ).toEqual([{ id }, { id }]);
});
it('consultation scanner rollback leaves no episode or notice and retries exactly once', async () => {
  await consultationSettings();
  const id = await consultation();
  const failed = await scanServiceBreaches({
    pool,
    logger,
    enqueue: async (client, input) => {
      await enqueueOutbox(client, input);
      if (input.payload?.item_id === id) throw new Error('injected consultation enqueue failure');
      return { inserted: true, outboxId: 'unused' };
    },
  });
  expect(failed.errors).toHaveLength(1);
  expect(failed.alerted).toBe(0);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toHaveLength(0);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(0);
  const results = await Promise.all([
    scanServiceBreaches({ pool, logger }),
    scanServiceBreaches({ pool, logger }),
  ]);
  expect(results.flatMap((r) => r.errors)).toEqual([]);
  expect(results.reduce((n, r) => n + r.alerted, 0)).toBe(1);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(1);
});

it('consultation activity from a transaction started before alerting cannot reuse or escalate the old episode', async () => {
  await consultationSettings();
  await consultationLead();
  const id = await consultation();
  const writer = await pool.connect();
  let releaseScan: () => void = () => {};
  let signalEnqueued: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  const enqueued = new Promise<void>((resolve) => {
    signalEnqueued = resolve;
  });
  try {
    await writer.query('BEGIN');
    const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const scan = scanServiceBreaches({
      pool,
      logger,
      enqueue: async (client, input) => {
        const result = await enqueueOutbox(client, input);
        signalEnqueued();
        await gate;
        return result;
      },
    });
    await Promise.race([
      enqueued,
      scan.then((result) => {
        throw new Error(JSON.stringify(result));
      }),
    ]);
    const response = writer.query(
      "UPDATE consultation_requests SET status='under_review',updated_at=NOW() WHERE id=$1",
      [id]
    );
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      waiting =
        (
          await pool.query(
            "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
            [pid]
          )
        ).rows[0]?.waiting === true;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    releaseScan();
    expect((await scan).alerted).toBe(1);
    await response;
    await writer.query('COMMIT');
    const state = (
      await pool.query(
        `SELECT r.updated_at<=l.alerted_at AS response_before_alert_time,
      r.updated_at IS DISTINCT FROM l.source_activity_at AS activity_changed
      FROM consultation_requests r JOIN service_breach_alerts l ON l.item_id=r.id::text WHERE r.id=$1`,
        [id]
      )
    ).rows[0];
    expect(state).toEqual({ response_before_alert_time: true, activity_changed: true });
    const later = () => new Date(Date.now() + 2 * 3600000);
    const escalated = await scanServiceEscalations({ pool, logger, now: later });
    expect(escalated.errors).toEqual([]);
    expect(escalated.escalated.consultation).toEqual({ level2: 0, level3: 0 });
    const fresh = await scanServiceBreaches({ pool, logger, now: later });
    expect(fresh.errors).toEqual([]);
    expect(fresh.pruned).toBe(1);
    expect(fresh.alerted).toBe(1);
    expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(2);
  } finally {
    releaseScan();
    await writer.query('ROLLBACK');
    writer.release();
  }
});
