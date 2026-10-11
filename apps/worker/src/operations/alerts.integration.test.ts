import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  parseOperationsAlerts,
  publishOperationsAlerts,
  receiveOperationsAlerts,
} from './alerts.js';
import { InAppNotificationTransport } from '../notifications/in-app-transport.js';
import { EmailNotificationTransport } from '../notifications/email-transport.js';
import { runOutboxPoll } from '../notifications/outbox-runner.js';
import { loadNotificationRecipient } from '../notifications/channel-availability-loader.js';

let ctx: { pool: Pool; connectionString: string; close: () => Promise<void> };
let server: ReturnType<typeof createServer>, base: string;
const secret = 'fixture-operations-secret'.repeat(3);
beforeAll(async () => {
  const database = `test_ops_${randomUUID().replaceAll('-', '')}`;
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  execFileSync(process.execPath, [resolve(__dirname, '../../../../packages/db/dist/migrate.js')], {
    env: { ...process.env, DATABASE_URL: url.toString(), PGDIRECT_URL: url.toString() },
    stdio: 'pipe',
  });
  const pool = new Pool({ connectionString: url.toString() });
  ctx = {
    pool,
    connectionString: url.toString(),
    close: async () => {
      await pool.end();
      await vi.waitFor(async () =>
        expect(
          Number(
            (
              await management.query('SELECT count(*) FROM pg_stat_activity WHERE datname=$1', [
                database,
              ])
            ).rows[0].count
          )
        ).toBe(0)
      );
      await management.query(`DROP DATABASE "${database}"`);
      await management.end();
    },
  };
  await ctx.pool
    .query(`INSERT INTO users(user_id,username,password_hash,is_staff,is_admin,notification_preferences)
    VALUES('ops-admin','ops-admin@example.test','fixture-only',true,true,'IN_APP,EMAIL'),
      ('ops-staff','ops-staff@example.test','fixture-only',true,false,'IN_APP,EMAIL'),
      ('ops-customer','ops-customer@example.test','fixture-only',false,false,'IN_APP,EMAIL')`);
  await ctx.pool.query(
    `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
    VALUES('resend','Fixture','active',$1,'ops-admin','passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
    [{ api_key: 'fixture-only-key', from_email: 'sender@example.test' }]
  );
  for (const locale of ['fa', 'en']) {
    await ctx.pool.query(
      `INSERT INTO notification_templates(id,event_key,channel,locale,subject,body_template,variables,status,is_active)
      VALUES($1,'system.service_outage','email',$2,'Service status','{{details}}: {{eta}}','[{"name":"details"},{"name":"eta"}]','active',true)`,
      [randomUUID(), locale]
    );
  }
  server = createServer((req, res) => {
    void receiveOperationsAlerts(req, res, ctx.pool);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing receiver address');
  base = `http://127.0.0.1:${address.port}`;
}, 30000);
beforeEach(async () => {
  vi.stubEnv('OPS_ALERT_WEBHOOK_SECRET', secret);
  vi.stubEnv('OPS_ALERT_ENVIRONMENT', 'staging');
  vi.stubEnv('OPS_ALERT_DATABASE', 'core');
  await ctx.pool.query('DELETE FROM notification_outbox');
  await ctx.pool.query('DELETE FROM in_app_notifications');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.close();
});
function envelope(status = 'firing', fingerprint = randomUUID().replaceAll('-', '')) {
  return {
    alerts: [
      {
        status,
        fingerprint,
        startsAt: '2026-10-01T00:00:00Z',
        labels: {
          alertname: 'EmailProviderDegraded',
          environment: 'staging',
          database: 'core',
          severity: 'warning',
        },
        annotations: { description: 'token=DO_NOT_COPY' },
        generatorURL: 'https://unsafe.example/?secret=DO_NOT_COPY',
      },
    ],
  };
}
it('publishes through a restricted receiver role without user updates, credential reads or financial access', async () => {
  const role = 'ops_receiver_' + randomUUID().replaceAll('-', '');
  await ctx.pool.query(`CREATE ROLE ${role} LOGIN PASSWORD 'fixture-only-password';
    GRANT USAGE ON SCHEMA public TO ${role};
    GRANT EXECUTE ON FUNCTION public.lock_operations_alert_admins() TO ${role};
    GRANT INSERT ON operations_alert_receipts,notification_outbox,notification_job TO ${role};
    GRANT SELECT ON operations_alert_receipts TO ${role};
    GRANT SELECT(id,idempotency_key) ON notification_outbox TO ${role};
    GRANT SELECT(channel,outbox_id) ON notification_job TO ${role}`);
  const url = new URL(ctx.connectionString);
  url.username = role;
  url.password = 'fixture-only-password';
  const limited = new Pool({ connectionString: url.toString() });
  try {
    expect((await publishOperationsAlerts(limited, parsed()))[0]!.inserted).toBe(true);
    await expect(limited.query('SELECT password_hash FROM users')).rejects.toThrow(
      'permission denied'
    );
    await expect(
      limited.query("UPDATE users SET is_admin=true WHERE user_id='ops-customer'")
    ).rejects.toThrow('permission denied');
    await expect(limited.query('SELECT * FROM wallets')).rejects.toThrow('permission denied');
    await expect(limited.query('SELECT * FROM in_app_notifications')).rejects.toThrow(
      'permission denied'
    );
  } finally {
    await limited.end();
    await ctx.pool.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
  }
});

it('rejects a suppressed receipt insert instead of falsely acknowledging a replay', async () => {
  const alert = parsed();
  await ctx.pool
    .query(`CREATE FUNCTION suppress_ops_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER suppress_ops_receipt BEFORE INSERT ON operations_alert_receipts FOR EACH ROW EXECUTE FUNCTION suppress_ops_receipt()`);
  try {
    await expect(publishOperationsAlerts(ctx.pool, alert)).rejects.toThrow(
      'receipt was not stored'
    );
  } finally {
    await ctx.pool.query(
      'DROP TRIGGER suppress_ops_receipt ON operations_alert_receipts; DROP FUNCTION suppress_ops_receipt()'
    );
  }
  expect((await ctx.pool.query('SELECT id FROM notification_outbox')).rowCount).toBe(0);
  expect((await publishOperationsAlerts(ctx.pool, alert))[0]!.inserted).toBe(true);
});
function parsed(input = envelope()) {
  return parseOperationsAlerts(input, 'staging', 'core');
}

it('retains the P2 credit priority in the authenticated receipt and private admin intent', async () => {
  const original = envelope();
  const missing = {
    alerts: [
      {
        ...original.alerts[0]!,
        labels: { ...original.alerts[0]!.labels, alertname: 'SmsProviderLowCredit' },
      },
    ],
  };
  expect(() => parseOperationsAlerts(missing, 'staging', 'core')).toThrow('scope or identity');
  const input = {
    alerts: [
      {
        ...original.alerts[0]!,
        labels: {
          ...original.alerts[0]!.labels,
          alertname: 'SmsProviderLowCredit',
          priority: 'P2',
        },
      },
    ],
  };
  const response = await request(input);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { receipts: { id: string }[] };
  expect(
    (
      await ctx.pool.query(
        'SELECT alert_name,priority,severity FROM operations_alert_receipts WHERE id=$1',
        [body.receipts[0]!.id]
      )
    ).rows[0]
  ).toEqual({ alert_name: 'SmsProviderLowCredit', priority: 'P2', severity: 'warning' });
  expect(
    (await ctx.pool.query('SELECT payload FROM notification_outbox')).rows[0].payload.priority
  ).toBe('P2');
  expect((await ctx.pool.query('SELECT event_key,channels FROM notification_outbox')).rows).toEqual(
    [{ event_key: 'admin.operations_alert', channels: ['in_app'] }]
  );
});
const request = (input: unknown, headers: Record<string, string> = {}) =>
  fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input),
  });
it('authenticates machine requests, rejects browser credentials and enforces size and source scope', async () => {
  const input = envelope();
  expect((await request(input, { Authorization: 'Bearer wrong' })).status).toBe(403);
  expect((await request(input, { Origin: 'https://stg.barghsa.com' })).status).toBe(403);
  expect((await request(input, { Cookie: 'barghsa_session=fixture' })).status).toBe(403);
  input.alerts[0]!.labels.environment = 'production';
  expect((await request(input)).status).toBe(400);
  expect((await request({ alerts: [], padding: 'x'.repeat(140000) })).status).toBe(413);
  expect((await ctx.pool.query('SELECT id FROM notification_outbox')).rowCount).toBe(0);
});
it.each(['EmailProviderDegraded', 'SmsProviderDegraded'])(
  'records actual %s HTTP firing/recovery and delivers only private admin inbox/email occurrences',
  async (alertname) => {
    const input = envelope();
    input.alerts[0]!.labels.alertname = alertname;
    const response = await request(input);
    expect(response.status).toBe(200);
    const first = (await response.json()) as { receipts: { id: string; inserted: boolean }[] };
    expect(first.receipts).toHaveLength(1);
    expect(first.receipts[0]!.inserted).toBe(true);
    const repeat = await request(input);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({
      receipts: [{ id: first.receipts[0]!.id, inserted: false }],
    });
    input.alerts[0]!.status = 'resolved';
    expect((await request(input)).status).toBe(200);
    const events = (
      await ctx.pool.query(
        "SELECT * FROM notification_outbox WHERE event_key='system.service_outage' ORDER BY created_at,id"
      )
    ).rows;
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.user_id)).toEqual(['ops-admin', 'ops-admin']);
    expect(
      events.every(
        (e) => e.profile_id === null && JSON.stringify(e.channels) === '["in_app","email"]'
      )
    ).toBe(true);
    expect(JSON.stringify(events.map((e) => e.payload))).not.toMatch(
      /DO_NOT_COPY|unsafe\.example|generatorURL|annotations/
    );
    const send = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'provider-' + randomUUID() }), { status: 200 })
    );
    expect(
      await runOutboxPoll({
        pool: ctx.pool,
        transports: {
          in_app: new InAppNotificationTransport(ctx.pool),
          email: new EmailNotificationTransport(ctx.pool, send),
        },
      })
    ).toMatchObject({ delivered: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const notices = (
      await ctx.pool.query(
        "SELECT * FROM in_app_notifications WHERE type='system.service_outage' ORDER BY created_at"
      )
    ).rows;
    expect(notices).toHaveLength(2);
    expect(
      notices.every(
        (n) =>
          n.profile_id === null &&
          n.recipient_user_id === 'ops-admin' &&
          n.operating_context === 'staff' &&
          n.link_route === '/admin'
      )
    ).toBe(true);
    expect(notices.map((n) => n.params.alertStatus).sort()).toEqual(['firing', 'resolved']);
    expect(
      notices.find((n) => n.params.alertStatus === 'firing').localized_content.fa.body
    ).toContain('اختلال');
    expect(
      notices.find((n) => n.params.alertStatus === 'resolved').localized_content.en.body
    ).toContain('Resolved');
    await ctx.pool.query('UPDATE in_app_notifications SET is_read=true');
    const snapshot = JSON.stringify(
      (await ctx.pool.query('SELECT * FROM in_app_notifications ORDER BY id')).rows
    );
    expect((await request(input)).status).toBe(200);
    expect(
      await runOutboxPoll({
        pool: ctx.pool,
        transports: {
          in_app: new InAppNotificationTransport(ctx.pool),
          email: new EmailNotificationTransport(ctx.pool, send),
        },
      })
    ).toMatchObject({ leased: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify((await ctx.pool.query('SELECT * FROM in_app_notifications ORDER BY id')).rows)
    ).toBe(snapshot);
  }
);
it.each(['raise', 'suppress'])(
  'rolls receipt and every recipient intent back when a job insert is %s',
  async (failure) => {
    const alert = parsed();
    const before = (
      await ctx.pool.query('SELECT count(*)::int AS n FROM operations_alert_receipts')
    ).rows[0].n;
    await ctx.pool
      .query(`CREATE FUNCTION reject_ops_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${failure === 'raise' ? "RAISE EXCEPTION 'injected ops failure';" : 'RETURN NULL;'} END $$;
    CREATE TRIGGER reject_ops_job BEFORE INSERT ON notification_job FOR EACH ROW EXECUTE FUNCTION reject_ops_job()`);
    try {
      await expect(publishOperationsAlerts(ctx.pool, alert)).rejects.toThrow();
    } finally {
      await ctx.pool.query(
        'DROP TRIGGER reject_ops_job ON notification_job; DROP FUNCTION reject_ops_job()'
      );
    }
    expect(
      (await ctx.pool.query('SELECT count(*)::int AS n FROM operations_alert_receipts')).rows[0].n
    ).toBe(before);
    expect((await ctx.pool.query('SELECT id FROM notification_outbox')).rowCount).toBe(0);
    expect((await publishOperationsAlerts(ctx.pool, alert))[0]!.inserted).toBe(true);
  }
);
it('serializes replica replays and records a later business occurrence independently', async () => {
  const alert = parsed();
  const results = await Promise.all([
    publishOperationsAlerts(ctx.pool, alert),
    publishOperationsAlerts(ctx.pool, alert),
  ]);
  expect(results.flat().filter((r) => r.inserted)).toHaveLength(1);
  expect((await ctx.pool.query('SELECT id FROM notification_outbox')).rowCount).toBe(1);
  alert[0]!.startsAt = '2026-10-02T00:00:00.000Z';
  expect((await publishOperationsAlerts(ctx.pool, alert))[0]!.inserted).toBe(true);
  expect((await ctx.pool.query('SELECT id FROM notification_outbox')).rowCount).toBe(2);
});
it('requires current admin authority and a protected source receipt at delivery', async () => {
  const receipts = await publishOperationsAlerts(ctx.pool, parsed());
  const event = (await ctx.pool.query('SELECT * FROM notification_outbox')).rows[0];
  await ctx.pool.query("UPDATE users SET is_admin=false WHERE user_id='ops-admin'");
  try {
    expect(await loadNotificationRecipient(ctx.pool, event.id)).toBeNull();
    await expect(
      new InAppNotificationTransport(ctx.pool).send({
        channel: 'in_app',
        recipientId: 'ops-admin',
        profileId: null,
        eventKey: 'system.service_outage',
        payload: event.payload,
        outboxId: event.id,
        idempotencyKey: 'scope',
      })
    ).rejects.toThrow('active administrator');
  } finally {
    await ctx.pool.query("UPDATE users SET is_admin=true WHERE user_id='ops-admin'");
  }
  await expect(
    ctx.pool.query('UPDATE operations_alert_receipts SET status=$2 WHERE id=$1', [
      receipts[0]!.id,
      'resolved',
    ])
  ).rejects.toThrow('append-only');
  await expect(
    ctx.pool.query('DELETE FROM operations_alert_receipts WHERE id=$1', [receipts[0]!.id])
  ).rejects.toThrow('append-only');
  await expect(
    new InAppNotificationTransport(ctx.pool).send({
      channel: 'in_app',
      recipientId: 'ops-admin',
      profileId: null,
      eventKey: 'system.service_outage',
      payload: { alertReceiptId: 'forged', alertStatus: 'firing' },
      outboxId: randomUUID(),
      idempotencyKey: 'forged',
    })
  ).rejects.toThrow('protected receipt');
});
