import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../../packages/db/src/migrate.js';
import {
  DEFAULT_SERVICE_WORKFLOWS,
  SERVICE_WORKFLOW_CONFIG_KEY,
  SERVICE_WORKFLOW_KEYS,
  type ServiceWorkflowKey,
  type ServiceWorkflowPolicy,
} from '@barghsa/shared/admin';
import { scanServiceWorkflows } from './workflow-scanner.js';
import { scanServiceBreaches } from './breach-scanner.js';
import { scanServiceEscalations } from './escalation-scanner.js';
import { enqueueOutbox } from '../notifications/outbox-writer.js';
import { InAppNotificationTransport } from '../notifications/in-app-transport.js';
let management: Pool,
  pool: Pool,
  profile: string,
  plan: string,
  hardware: string,
  agreement: string,
  address: string,
  province: string,
  city: string,
  team: string;
const database = `test_workflows_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
  await pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff,is_admin) VALUES
    ('wf-owner','owner@example.test','test',false,false),('wf-source','source@example.test','test',true,false),
    ('wf-destination','destination@example.test','test',true,false),('wf-no-access','noaccess@example.test','test',true,false),
    ('wf-admin','admin@example.test','test',true,true);
    INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('wf-source','Source','Test','["*"]'),('wf-destination','Destination','Test','["*"]');
    INSERT INTO user_roles(user_id,role_id) VALUES('wf-source','wf-source'),('wf-destination','wf-destination')`);
  profile = (await pool.query("INSERT INTO profiles(user_id) VALUES('wf-owner') RETURNING id"))
    .rows[0].id;
  province = (
    await pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES('Test province','Workflow province') RETURNING id"
    )
  ).rows[0].id;
  city = (
    await pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'Test city','Workflow city') RETURNING id",
      [province]
    )
  ).rows[0].id;
  address = (
    await pool.query(
      "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES($1,$2,$3,'Private address','1234567890',true) RETURNING id",
      [profile, province, city]
    )
  ).rows[0].id;
  const product = async (type: string) =>
    (
      await pool.query(
        'INSERT INTO products(type,title,status,price) VALUES($1,\'{"en":"Workflow test"}\', \'active\',1000) RETURNING id',
        [type]
      )
    ).rows[0].id;
  plan = await product('saving_plan');
  hardware = await product('hardware');
  agreement = (
    await pool.query(
      "INSERT INTO saving_plan_agreement_versions(plan_id,title,body,created_by) VALUES($1,'Terms','Immutable terms','wf-source') RETURNING id",
      [plan]
    )
  ).rows[0].id;
  team = (
    await pool.query("INSERT INTO staff_teams(name) VALUES('Workflow destination') RETURNING id")
  ).rows[0].id;
  await pool.query(
    "INSERT INTO staff_team_members(team_id,user_id) VALUES($1,'wf-destination'),($1,'wf-no-access')",
    [team]
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
    TRUNCATE service_breach_alerts;
    TRUNCATE orders,contracts,tickets,verification_cases,consultation_requests,solar_construction_requests CASCADE;
    DELETE FROM app_config;
    DELETE FROM user_roles WHERE user_id='wf-source' AND role_id='wf-destination';
    DELETE FROM staff_team_members WHERE user_id='wf-source';
    UPDATE users SET disabled_at=NULL WHERE user_id LIKE 'wf-%';
    UPDATE staff_roles SET permissions='["*"]' WHERE role_id IN ('wf-source','wf-destination')`);
});
afterEach(() => vi.unstubAllEnvs());
async function configure(
  key: ServiceWorkflowKey,
  change: Partial<NonNullable<ServiceWorkflowPolicy[ServiceWorkflowKey]>> = {}
) {
  const policy = structuredClone(DEFAULT_SERVICE_WORKFLOWS);
  policy[key] = {
    hours: 1,
    notification: 'breach',
    email: false,
    escalation: {
      condition: 'sla_breached',
      from: { kind: 'any', id: null },
      to: { kind: 'team', id: team },
      afterHours: 1,
      email: true,
    },
    ...change,
  };
  await pool.query(
    `INSERT INTO app_config(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [SERVICE_WORKFLOW_CONFIG_KEY, JSON.stringify(policy)]
  );
  return policy;
}
async function seed(key: ServiceWorkflowKey, status?: string) {
  const id = randomUUID();
  if (key.startsWith('ticket_')) {
    await pool.query(
      `INSERT INTO tickets(id,user_id,assigned_to,subject,body,priority,status,updated_at)
      VALUES($1,'wf-owner','wf-source','Private subject','Private body',$2,$3,NOW()-INTERVAL '4 hours')`,
      [id, key.slice(7), status ?? 'waiting_staff']
    );
    return { id, table: 'tickets' };
  }
  if (key === 'verification') {
    await pool.query(
      `INSERT INTO verification_cases(id,profile_id,field_name,requested_value,reason,created_by,assigned_to,status,updated_at)
      VALUES($1,$2,'first_name','Private name','Private evidence','wf-source','wf-source',$3,NOW()-INTERVAL '4 hours')`,
      [id, profile, status ?? 'Under Review']
    );
    return { id, table: 'verification_cases' };
  }
  if (key === 'consultation') {
    await pool.query(
      `INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,submitted_by,submission_key,staff_owner_id,status,updated_at)
      SELECT $1,$2,id,'{"title":{"en":"Private consultation"}}','wf-owner',$1,'wf-source',$3,NOW()-INTERVAL '4 hours' FROM products WHERE system_key='electricity_generation_station'`,
      [id, profile, status ?? 'under_review']
    );
    return { id, table: 'consultation_requests' };
  }
  if (key.endsWith('_contract')) {
    const c = await pool.connect(),
      version = randomUUID();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,$3,$4)`,
        [id, profile, key === 'saving_contract' ? 'savings' : key.split('_')[0], version]
      );
      await c.query(
        `INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,'{"text":"Private contract"}','Initial','wf-source')`,
        [version, id]
      );
      await c.query(
        "UPDATE contracts SET state=$2,updated_at=NOW()-INTERVAL '4 hours' WHERE id=$1",
        [id, status ?? 'AwaitingStaffReview']
      );
      await c.query('COMMIT');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    return { id, table: 'contracts' };
  }
  if (key === 'solar_order') {
    await pool.query(
      `INSERT INTO solar_construction_requests(id,profile_id,submitted_by,submission_key,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at,status,submitted_at)
      VALUES($1,$2,'wf-owner',$1,'building_apartment','off_grid','villa','concrete','2020-01-01',true,'v1','Private agreement',NOW(),$3,NOW()-INTERVAL '4 hours')`,
      [id, profile, status ?? 'documents_under_review']
    );
    return { id, table: 'solar_construction_requests' };
  }
  const order = randomUUID();
  await pool.query(
    `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
    VALUES($1,'wf-owner',$2,$3,$4,$5,$6,'Private address','1234567890')`,
    [
      key === 'electricity_order' ? id : order,
      profile,
      plan,
      key === 'electricity_order' ? 'electricity' : 'savings',
      province,
      city,
    ]
  );
  if (key === 'electricity_order') {
    await pool.query(
      `INSERT INTO electricity_orders(id,profile_id,settings_snapshot,status,submitted_at,total_kwh,average_power_kw,green_rule_applied,submitted_by,period_start,period_end,pricing_snapshot)
      VALUES($1,$2,'{}',$3,NOW()-INTERVAL '4 hours',1,1,false,'wf-owner',NOW(),NOW()+INTERVAL '1 day','{}')`,
      [id, profile, status ?? 'awaiting_staff_review']
    );
    return { id, table: 'electricity_orders' };
  }
  await pool.query(
    `INSERT INTO saving_orders(id,order_id,profile_id,saving_plan_id,hardware_product_id,bill_identifier,installation_address_id,agreement_version_id,agreement_snapshot,address_snapshot,pricing_snapshot,verification_result,status,financial_status,submitted_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Private agreement','{}','{"total":"9007199254740993"}','{}',$9,'paid',NOW()-INTERVAL '4 hours')`,
    [
      id,
      order,
      profile,
      plan,
      hardware,
      String(Date.now()).slice(0, 13),
      address,
      agreement,
      status ?? 'in_progress',
    ]
  );
  return { id, table: 'saving_orders' };
}
const scan = (options: Parameters<typeof scanServiceWorkflows>[0] = {}) =>
  scanServiceWorkflows({ pool, ...options });
for (const key of SERVICE_WORKFLOW_KEYS)
  it(`${key} enforces a real source deadline, durable channels, rule routing and per-episode deduplication`, async () => {
    await configure(key);
    const item = await seed(key);
    const before = (
      await pool.query(`SELECT to_jsonb(r) AS value FROM ${item.table} r WHERE id=$1`, [item.id])
    ).rows;
    const first = await scan();
    expect(first.errors).toEqual([]);
    expect(first.alerted).toBe(1);
    const later = () => new Date(Date.now() + 2 * 3600000);
    const second = await scan({ now: later });
    expect(second.errors).toEqual([]);
    expect(second.escalated).toBe(1);
    const repeat = await scan({ now: later });
    expect(repeat.errors).toEqual([]);
    expect(repeat.alerted + repeat.escalated).toBe(0);
    const notices = (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE event_key IN ('admin.service_target_breached','admin.service_escalated') ORDER BY created_at,id"
      )
    ).rows;
    expect(notices).toHaveLength(2);
    expect(notices[1].user_id).toBe('wf-destination');
    expect(notices[1].channels).toEqual(['in_app', 'email']);
    expect(notices[0].channels).toEqual(['in_app']);
    expect(notices[0].profile_id).toBeNull();
    expect(JSON.stringify(notices.map((n) => n.payload))).not.toContain('Private');
    expect(notices[0].payload.service_type_name_fa).not.toBe(key);
    expect(
      (await pool.query(`SELECT to_jsonb(r) AS value FROM ${item.table} r WHERE id=$1`, [item.id]))
        .rows
    ).toEqual(before);
    const transport = new InAppNotificationTransport(pool);
    expect(
      (
        await transport.send({
          eventKey: notices[1].event_key,
          channel: 'in_app',
          profileId: null,
          recipientId: notices[1].user_id,
          payload: notices[1].payload,
          idempotencyKey: notices[1].idempotency_key,
          outboxId: notices[1].id,
        })
      ).status
    ).toBe('delivered');
    expect(
      (
        await pool.query(
          "SELECT metadata::jsonb AS m FROM audit_log WHERE event='service_workflow_escalated' AND metadata::jsonb->>'itemId'=$1",
          [item.id]
        )
      ).rows
    ).toHaveLength(1);
  });
it('ignores other priorities, customer waits and completed work; legacy scanners cannot duplicate managed workflows', async () => {
  await configure('ticket_urgent');
  await seed('ticket_urgent');
  await seed('ticket_low');
  await seed('ticket_urgent', 'waiting_customer');
  await seed('ticket_urgent', 'closed');
  await pool.query(
    `INSERT INTO app_config(key,value) VALUES('admin.service_response_targets','{"ticket":1}'),('admin.escalation_policy','{"ticket":{"level2":{"delayHours":1,"channels":["in_app"]},"level3":{"delayHours":1,"channels":["in_app"]}}}')`
  );
  expect((await scan()).alerted).toBe(1);
  const legacy = await scanServiceBreaches({ pool });
  expect(legacy.errors).toEqual([]);
  expect(legacy.alerted).toBe(0);
  const tiers = await scanServiceEscalations({ pool });
  expect(tiers.errors).toEqual([]);
  expect(tiers.escalated.ticket.level2).toBe(0);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(1);
});
it('honors source roles, ticket-priority timers, current destination permissions and account activation', async () => {
  await configure('ticket_urgent', {
    notification: 'escalation',
    escalation: {
      condition: 'ticket_priority',
      from: { kind: 'role', id: 'wf-destination' },
      to: { kind: 'team', id: team },
      afterHours: 2,
      email: false,
    },
  });
  await seed('ticket_urgent');
  expect((await scan()).escalated).toBe(0);
  await pool.query("INSERT INTO user_roles(user_id,role_id) VALUES('wf-source','wf-destination')");
  await pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id='wf-destination'");
  expect((await scan()).escalated).toBe(0);
  await pool.query(
    "UPDATE staff_roles SET permissions='[\"tickets:read\"]' WHERE role_id='wf-destination'; UPDATE users SET disabled_at=NOW() WHERE user_id='wf-destination'"
  );
  expect((await scan()).escalated).toBe(0);
  await pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='wf-destination'");
  const final = await scan();
  expect(final.errors).toEqual([]);
  expect(final.escalated).toBe(1);
  expect((await pool.query('SELECT user_id FROM notification_outbox')).rows).toEqual([
    { user_id: 'wf-destination' },
  ]);
});
it('commits each episode once under concurrent scans and retries a failed notification atomically', async () => {
  await configure('ticket_urgent');
  for (let n = 0; n < 5; n++) await seed('ticket_urgent');
  const fail = await scan({
    batchSize: 2,
    enqueue: async (client, input) => {
      await enqueueOutbox(client, input);
      throw new Error('injected delivery failure');
    },
  });
  expect(fail.errors).toHaveLength(1);
  expect(fail.alerted).toBe(0);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toEqual([]);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toEqual([]);
  const results = await Promise.all([scan({ batchSize: 2 }), scan({ batchSize: 2 })]);
  expect(results.flatMap((r) => r.errors)).toEqual([]);
  expect(results.reduce((n, r) => n + r.alerted, 0)).toBe(5);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toHaveLength(5);
});
it('ends recovered episodes, restarts after disabling and does not extend fulfillment deadlines on unrelated activity', async () => {
  await configure('electricity_order');
  const item = await seed('electricity_order');
  expect((await scan()).alerted).toBe(1);
  await pool.query('UPDATE electricity_orders SET updated_at=NOW() WHERE id=$1', [item.id]);
  expect((await scan()).alerted).toBe(0);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toHaveLength(1);
  await pool.query("UPDATE electricity_orders SET status='changes_requested' WHERE id=$1", [
    item.id,
  ]);
  expect((await scan()).pruned).toBe(1);
  await pool.query("UPDATE electricity_orders SET status='awaiting_staff_review' WHERE id=$1", [
    item.id,
  ]);
  expect((await scan()).alerted).toBe(1);
  await pool.query('UPDATE app_config SET value=$1::jsonb WHERE key=$2', [
    JSON.stringify(DEFAULT_SERVICE_WORKFLOWS),
    SERVICE_WORKFLOW_CONFIG_KEY,
  ]);
  expect((await scan()).pruned).toBe(1);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toEqual([]);
});
it('honors assigned-ticket read scope and routes an unassigned order through its configured source role', async () => {
  await configure('ticket_urgent');
  await pool.query(
    "UPDATE staff_roles SET permissions='[\"tickets:assigned\"]' WHERE role_id='wf-source'"
  );
  await seed('ticket_urgent');
  expect((await scan()).errors).toEqual([]);
  expect(
    (
      await pool.query(
        "SELECT user_id FROM notification_outbox WHERE event_key='admin.service_target_breached'"
      )
    ).rows
  ).toEqual([{ user_id: 'wf-source' }]);
  await pool.query(
    "UPDATE staff_roles SET permissions='[\"orders:read\"]' WHERE role_id='wf-source'"
  );
  await configure('solar_order', {
    escalation: {
      condition: 'sla_breached',
      from: { kind: 'role', id: 'wf-source' },
      to: { kind: 'team', id: team },
      afterHours: 1,
      email: false,
    },
  });
  const item = await seed('solar_order');
  expect((await scan()).errors).toEqual([]);
  expect(
    (
      await pool.query("SELECT user_id FROM notification_outbox WHERE payload->>'item_id'=$1", [
        item.id,
      ])
    ).rows
  ).toEqual([{ user_id: 'wf-source' }]);
});
it('uses PostgreSQL timestamp precision at a priority deadline and preserves an uncertain audit failure for retry', async () => {
  await configure('ticket_urgent', {
    notification: 'escalation',
    escalation: {
      condition: 'ticket_priority',
      from: { kind: 'any', id: null },
      to: { kind: 'team', id: team },
      afterHours: 2,
      email: false,
    },
  });
  const item = await seed('ticket_urgent'),
    now = new Date();
  await pool.query(
    "UPDATE tickets SET updated_at=$2::timestamptz-INTERVAL '2 hours'+INTERVAL '1 microsecond' WHERE id=$1",
    [item.id, now]
  );
  expect((await scan({ now: () => now })).escalated).toBe(0);
  vi.stubEnv('WORKER_SYSTEM_ACTOR_USER_ID', 'missing-workflow-audit-actor');
  const due = () => new Date(now.getTime() + 1);
  const failed = await scan({ now: due });
  expect(failed.errors).toHaveLength(1);
  expect(failed.escalated).toBe(0);
  expect((await pool.query('SELECT escalation_level FROM service_breach_alerts')).rows).toEqual([
    { escalation_level: 1 },
  ]);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toEqual([]);
  vi.unstubAllEnvs();
  const retried = await scan({ now: due });
  expect(retried.errors).toEqual([]);
  expect(retried.escalated).toBe(1);
});
it('matches a current source team and routes to the destination role without granting item access', async () => {
  await configure('ticket_urgent', {
    escalation: {
      condition: 'sla_breached',
      from: { kind: 'team', id: team },
      to: { kind: 'role', id: 'wf-destination' },
      afterHours: 1,
      email: false,
    },
  });
  const item = await seed('ticket_urgent');
  expect((await scan()).alerted).toBe(1);
  const later = () => new Date(Date.now() + 2 * 3600000);
  expect((await scan({ now: later })).escalated).toBe(0);
  await pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES($1,'wf-source')", [
    team,
  ]);
  const routed = await scan({ now: later });
  expect(routed.errors).toEqual([]);
  expect(routed.escalated).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT user_id FROM notification_outbox WHERE event_key='admin.service_escalated' AND payload->>'item_id'=$1",
        [item.id]
      )
    ).rows
  ).toEqual([{ user_id: 'wf-destination' }]);
});
it('does not permanently claim a breach while its first recipient is unavailable', async () => {
  await configure('ticket_urgent');
  await seed('ticket_urgent');
  await pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id IN ('wf-source','wf-admin')");
  const unavailable = await scan();
  expect(unavailable.errors).toEqual([]);
  expect(unavailable.alerted).toBe(0);
  expect((await pool.query('SELECT id FROM service_breach_alerts')).rows).toEqual([]);
  expect((await pool.query('SELECT id FROM notification_outbox')).rows).toEqual([]);
  await pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='wf-source'");
  expect((await scan()).alerted).toBe(1);
  expect((await pool.query('SELECT user_id FROM notification_outbox')).rows).toEqual([
    { user_id: 'wf-source' },
  ]);
});
