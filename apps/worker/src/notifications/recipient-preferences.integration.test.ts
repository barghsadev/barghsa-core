import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { NotificationChannel } from '@barghsa/shared/notifications';
import {
  loadChannelAvailabilityContext,
  loadNotificationRecipient,
} from './channel-availability-loader.js';
import { resolveChannelAvailability } from './channel-availability.js';
import { enqueueOutbox } from './outbox-writer.js';
import { runOutboxPoll } from './outbox-runner.js';
import { InAppNotificationTransport } from './in-app-transport.js';
import { EmailNotificationTransport } from './email-transport.js';
import { SmsNotificationTransport } from './sms-transport.js';
import { notificationsDeliveryAttempts } from './worker-metrics.js';
import { durableDelivery, DeliveryOutcomeUnknown } from './send-receipt.js';

for (const failure of ['inbox', 'job', 'log', 'outbox'] as const) {
  it(`rolls inbox delivery back on transient ${failure} failure and preserves accepted external receipts`, async () => {
    const { userId, profileId } = await account();
    const id = await queue(userId, profileId, ['in_app', 'email']);
    const keys: string[] = [];
    const options = {
      pool,
      deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
      availability: () => ({
        enabledChannels: { email: true, sms: true },
        verifiedEmail: true,
        verifiedPhone: false,
        marketingOptedIn: {},
      }),
      transports: {
        in_app: new InAppNotificationTransport(pool),
        email: {
          channel: 'email' as const,
          async send(payload: { idempotencyKey: string }) {
            keys.push(payload.idempotencyKey);
            return { status: 'delivered' as const, providerRef: 'accepted-email' };
          },
        },
      },
    };
    const table = {
      inbox: 'in_app_notifications',
      job: 'notification_job',
      log: 'notification_delivery_log',
      outbox: 'notification_outbox',
    }[failure];
    const condition =
      failure === 'inbox'
        ? `NEW.delivery_key='outbox:${id}'`
        : failure === 'job'
          ? `NEW.outbox_id='${id}' AND NEW.status='done'`
          : failure === 'log'
            ? `NEW.notification_id='${id}' AND NEW.status='delivered'`
            : `NEW.id='${id}' AND NEW.status='delivered'`;
    await pool.query(`CREATE SEQUENCE atomic_delivery_failure;
      CREATE FUNCTION reject_atomic_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF nextval('atomic_delivery_failure')=1 THEN RAISE EXCEPTION 'test delivery persistence failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_atomic_delivery BEFORE INSERT OR UPDATE ON ${table}
      FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION reject_atomic_delivery()`);
    notificationsDeliveryAttempts.reset();
    const attempts = async (channel: string, status: string) =>
      (await notificationsDeliveryAttempts.get()).values.find(
        (entry) => entry.labels.channel === channel && entry.labels.status === status
      )?.value ?? 0;
    try {
      expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 0, failed: 1 });
      expect(
        (
          await pool.query('SELECT id FROM in_app_notifications WHERE delivery_key=$1', [
            `outbox:${id}`,
          ])
        ).rows
      ).toEqual([]);
      expect(
        (
          await pool.query(
            "SELECT channel,provider_ref FROM notification_delivery_log WHERE notification_id=$1 AND status='delivered'",
            [id]
          )
        ).rows
      ).toEqual([{ channel: 'email', provider_ref: 'accepted-email' }]);
      expect(
        (
          await pool.query(
            'SELECT status,attempts FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
            [id]
          )
        ).rows
      ).toEqual([
        { status: 'done', attempts: 1 },
        { status: 'retrying', attempts: 1 },
      ]);
      expect(await attempts('email', 'delivered')).toBe(1);
      expect(await attempts('email', 'failed')).toBe(0);
      expect(await attempts('in_app', 'delivered')).toBe(0);
      expect(await attempts('in_app', 'failed')).toBe(1);
    } finally {
      await pool.query(`DROP TRIGGER reject_atomic_delivery ON ${table}`);
      await pool.query('DROP FUNCTION reject_atomic_delivery()');
      await pool.query('DROP SEQUENCE atomic_delivery_failure');
    }
    await pool.query(
      "UPDATE notification_job SET run_after=NOW()-INTERVAL '1 second' WHERE outbox_id=$1",
      [id]
    );
    await pool.query(
      "UPDATE notification_outbox SET scheduled_for=NOW()-INTERVAL '1 second' WHERE id=$1",
      [id]
    );
    expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
    expect(keys).toHaveLength(1);
    const inbox = (
      await pool.query('SELECT id FROM in_app_notifications WHERE delivery_key=$1', [
        `outbox:${id}`,
      ])
    ).rows;
    expect(inbox).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT provider_ref FROM notification_job WHERE outbox_id=$1 AND channel='in_app' AND status='done'",
          [id]
        )
      ).rows
    ).toEqual([{ provider_ref: inbox[0].id }]);
    expect(
      (
        await pool.query(
          "SELECT provider_ref FROM notification_delivery_log WHERE notification_id=$1 AND channel='in_app' AND status='delivered'",
          [id]
        )
      ).rows
    ).toEqual([{ provider_ref: inbox[0].id }]);
    expect(await attempts('email', 'delivered')).toBe(1);
    expect(await attempts('in_app', 'delivered')).toBe(1);
    expect(await attempts('in_app', 'failed')).toBe(1);
  });
}

const name = `test_recipient_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  pool = new Pool({ connectionString: url.toString(), max: 5 });
  const folder = resolve(__dirname, '../../../../packages/db/drizzle/production');
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries)
    await pool.query(readFileSync(resolve(folder, `${entry.tag}.sql`), 'utf8'));
}, 30000);
beforeEach(async () => {
  await pool.query(
    "UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')"
  );
});
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${name}"`);
    await management.end();
  }
});

async function account() {
  const userId = randomUUID();
  const email = `${userId}@example.test`;
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash,notification_preferences) VALUES ($1,$2,'test-only','IN_APP,EMAIL,SMS')",
    [userId, email]
  );
  const profileId = (
    await pool.query('INSERT INTO profiles(user_id) VALUES ($1) RETURNING id', [userId])
  ).rows[0].id as string;
  return { userId, email, profileId };
}

async function queue(
  userId: string,
  profileId: string,
  channels: NotificationChannel[] = ['in_app', 'email', 'sms'],
  eventKey = 'wallet.topup_completed',
  payload: Record<string, unknown> = {}
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await enqueueOutbox(client, {
      userId,
      profileId,
      channels,
      eventKey,
      payload,
      idempotencyKey: randomUUID(),
    });
    await client.query('COMMIT');
    if (!result.outboxId) throw new Error('Missing queued occurrence');
    return result.outboxId;
  } finally {
    client.release();
  }
}

async function verifyMobile(userId: string) {
  const mobile = `+989${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0')}`;
  await pool.query('UPDATE users SET mobile=$2 WHERE user_id=$1', [userId, mobile]);
  await pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ($2,$1,'mobile',NOW())",
    [userId, mobile]
  );
  return mobile;
}

it('requires current verification proof and never lets an unverified secondary shadow the primary recipient', async () => {
  const owner = await account(),
    recipient = await account();
  const id = await queue(recipient.userId, owner.profileId);
  const secondary = `${randomUUID()}@example.test`;
  await pool.query('UPDATE users SET email=$2,mobile=$3 WHERE user_id=$1', [
    recipient.userId,
    secondary,
    '+989121000001',
  ]);
  expect(await loadNotificationRecipient(pool, id)).toMatchObject({
    userId: recipient.userId,
    email: recipient.email,
    mobile: null,
  });
  await pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ($2,$1,'email',NOW()),($3,$1,'mobile',NOW())",
    [recipient.userId, secondary, '+989121000001']
  );
  await pool.query(
    "INSERT INTO email_suppressions(address,reason,profile_id) VALUES ($1,'complaint',$2)",
    [secondary, owner.profileId]
  );
  expect(await loadNotificationRecipient(pool, id)).toMatchObject({
    email: secondary,
    mobile: '+989121000001',
    emailSuppressed: true,
  });
  await pool.query('UPDATE users SET email=$2,mobile=$3 WHERE user_id=$1', [
    recipient.userId,
    `${randomUUID()}@example.test`,
    '+989121000002',
  ]);
  expect(await loadNotificationRecipient(pool, id)).toMatchObject({
    email: recipient.email,
    mobile: null,
    emailSuppressed: false,
  });
});

it('uses account choices across profiles and also requires each profile marketing consent', async () => {
  const owner = await account(),
    recipient = await account();
  const ids = await Promise.all([
    queue(recipient.userId, owner.profileId),
    queue(recipient.userId, recipient.profileId),
  ]);
  await pool.query("UPDATE users SET notification_preferences='IN_APP' WHERE user_id=$1", [
    owner.userId,
  ]);
  for (const id of ids) {
    expect(
      resolveChannelAvailability(
        'marketing.promotion',
        ['in_app', 'email'],
        await loadChannelAvailabilityContext(pool, id)
      )
    ).toMatchObject({ allowed: ['in_app'], skipped: [{ reason: 'marketing_opt_in_required' }] });
  }
  await pool.query(
    "INSERT INTO user_notification_preferences(profile_id,channel,marketing_opted_in) VALUES ($1,'email',true),($2,'email',true)",
    [owner.profileId, recipient.profileId]
  );
  for (const id of ids)
    expect(
      resolveChannelAvailability(
        'marketing.promotion',
        ['in_app', 'email'],
        await loadChannelAvailabilityContext(pool, id)
      ).allowed
    ).toEqual(['in_app', 'email']);
  await pool.query("UPDATE users SET notification_preferences='IN_APP' WHERE user_id=$1", [
    recipient.userId,
  ]);
  for (const id of ids)
    expect(
      resolveChannelAvailability(
        'marketing.promotion',
        ['in_app', 'email'],
        await loadChannelAvailabilityContext(pool, id)
      )
    ).toMatchObject({ allowed: ['in_app'], skipped: [{ reason: 'channel_disabled' }] });
});

it.each(['IN_APP', 'IN_APP,EMAIL', 'IN_APP,SMS', 'IN_APP,EMAIL,SMS'])(
  'honors choices saved after enqueue (%s), keeps one inbox item, and records external skips',
  async (preferences) => {
    const recipient = await account();
    await verifyMobile(recipient.userId);
    const id = await queue(recipient.userId, recipient.profileId);
    await pool.query('UPDATE users SET notification_preferences=$2 WHERE user_id=$1', [
      recipient.userId,
      preferences,
    ]);
    const email = vi.fn(async () => ({
      status: 'delivered' as const,
      providerRef: 'email-receipt',
    }));
    const sms = vi.fn(async () => ({ status: 'delivered' as const, providerRef: 'sms-receipt' }));
    const options = {
      pool,
      deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
      transports: {
        in_app: new InAppNotificationTransport(pool),
        email: { channel: 'email' as const, send: email },
        sms: { channel: 'sms' as const, send: sms },
      },
    };
    expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
    expect(email).toHaveBeenCalledTimes(preferences.includes('EMAIL') ? 1 : 0);
    expect(sms).toHaveBeenCalledTimes(preferences.includes('SMS') ? 1 : 0);
    const jobs = (
      await pool.query(
        'SELECT channel,status,attempts,last_error FROM notification_job WHERE outbox_id=$1',
        [id]
      )
    ).rows;
    for (const channel of ['email', 'sms'])
      if (!preferences.includes(channel.toUpperCase()))
        expect(jobs.find((j) => j.channel === channel)).toMatchObject({
          attempts: 0,
          last_error: 'skipped: channel_disabled',
        });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM in_app_notifications WHERE delivery_key=$1',
          [`outbox:${id}`]
        )
      ).rows[0].count
    ).toBe(1);
    expect(await runOutboxPoll(options)).toEqual({ leased: 0, delivered: 0, failed: 0 });
  }
);

it.each(['email', 'sms'] as const)(
  'rechecks %s preferences after loading a saved message and before any provider request',
  async (channel) => {
    const recipient = await account();
    const mobile = await verifyMobile(recipient.userId);
    const id = await queue(recipient.userId, recipient.profileId, ['in_app', channel]);
    const snapshot = {
      version: 1,
      userId: recipient.userId,
      profileId: recipient.profileId,
      idempotencyKey: 'saved-key',
      destination: recipient.email,
      subject: 'subject',
      html: '<p>Body</p>',
      providerId: randomUUID(),
      message: {
        destination: mobile,
        providerId: randomUUID(),
        templateId: '42',
        parameters: [{ name: 'VALUE', value: '1' }],
      },
    };
    await pool.query(
      'UPDATE notification_job SET delivery_payload=$3 WHERE outbox_id=$1 AND channel=$2',
      [id, channel, snapshot]
    );
    const deliveryPool = {
      async query(sql: string, params?: unknown[]) {
        const result = await pool.query(sql, params);
        if (sql.startsWith('SELECT delivery_payload'))
          await pool.query("UPDATE users SET notification_preferences='IN_APP' WHERE user_id=$1", [
            recipient.userId,
          ]);
        return result;
      },
    };
    const request = vi.fn<typeof fetch>();
    const transport =
      channel === 'email'
        ? new EmailNotificationTransport(deliveryPool, request)
        : new SmsNotificationTransport(deliveryPool, request);
    await expect(
      transport.send({
        outboxId: id,
        profileId: recipient.profileId,
        recipientId: recipient.userId,
        channel,
        eventKey: 'wallet.topup_completed',
        payload: {},
        idempotencyKey: 'saved-key',
      })
    ).rejects.toThrow('channel_disabled');
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT delivery_payload FROM notification_job WHERE outbox_id=$1 AND channel=$2',
          [id, channel]
        )
      ).rows[0].delivery_payload
    ).toEqual(snapshot);
    expect(
      await runOutboxPoll({
        pool,
        deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
        transports: { in_app: new InAppNotificationTransport(pool), [channel]: transport },
      })
    ).toEqual({ leased: 1, delivered: 1, failed: 0 });
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT attempts,last_error FROM notification_job WHERE outbox_id=$1 AND channel=$2',
          [id, channel]
        )
      ).rows[0]
    ).toEqual({ attempts: 0, last_error: 'skipped: channel_disabled' });
  }
);

async function queuedReminder() {
  const recipient = await account();
  const dueAt = new Date(Date.now() + 6 * 86400000);
  const invoiceId = randomUUID();
  await pool.query(
    `INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,issued_at,due_at,metadata)
    VALUES ($1,$2,'Unpaid',100,0,NOW(),$3,'{"due":{"serviceType":"electricity"}}')`,
    [invoiceId, recipient.profileId, dueAt]
  );
  const id = await queue(
    recipient.userId,
    recipient.profileId,
    ['in_app', 'email'],
    'payment.invoice_reminder',
    { invoiceId, offset: -7, dueAt: dueAt.toISOString(), scheduledAt: new Date().toISOString() }
  );
  const email = vi.fn(async () => ({
    status: 'delivered' as const,
    providerRef: 'reminder-accepted',
  }));
  const options = {
    pool,
    deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
    transports: {
      in_app: new InAppNotificationTransport(pool),
      email: { channel: 'email' as const, send: email },
    },
  };
  return { ...recipient, emailAddress: recipient.email, id, invoiceId, email, options };
}
for (const change of ['Paid', 'Cancelled', 'Refunded', 'deadline', 'archived'] as const) {
  it(`suppresses an already queued reminder after ${change}`, async () => {
    const r = await queuedReminder();
    if (change === 'deadline')
      await pool.query("UPDATE invoices SET due_at=due_at+INTERVAL '1 day' WHERE id=$1", [
        r.invoiceId,
      ]);
    else if (change === 'archived')
      await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [r.profileId]);
    else
      await pool.query('UPDATE invoices SET state=$2,paid_amount=$3 WHERE id=$1', [
        r.invoiceId,
        change,
        change === 'Paid' ? 100 : 0,
      ]);
    expect(await runOutboxPoll(r.options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
    expect(r.email).not.toHaveBeenCalled();
    expect(
      (
        await pool.query('SELECT id FROM in_app_notifications WHERE delivery_key=$1', [
          `outbox:${r.id}`,
        ])
      ).rows
    ).toEqual([]);
    const jobs = (
      await pool.query(
        'SELECT status,attempts,last_error FROM notification_job WHERE outbox_id=$1',
        [r.id]
      )
    ).rows;
    expect(jobs).toHaveLength(2);
    for (const job of jobs)
      expect(job).toMatchObject({
        status: 'failed',
        attempts: 0,
        last_error: expect.stringMatching(/^skipped: reminder_/),
      });
    expect(
      (await pool.query('SELECT id FROM notification_dead_letter WHERE outbox_id=$1', [r.id])).rows
    ).toEqual([]);
  });
}
it('pauses an already queued disabled offset without consuming retries, then resumes once', async () => {
  const r = await queuedReminder();
  await pool.query(
    `INSERT INTO invoice_reminder_offset_toggles(service_type,"offset",enabled,updated_by)
 VALUES ('electricity',-7,false,$1) ON CONFLICT(service_type,"offset") DO UPDATE SET enabled=false`,
    [r.userId]
  );
  try {
    expect(await runOutboxPoll(r.options)).toEqual({ leased: 1, delivered: 0, failed: 0 });
    expect(r.email).not.toHaveBeenCalled();
    const jobs = (
      await pool.query(
        'SELECT attempts,run_after,status FROM notification_job WHERE outbox_id=$1',
        [r.id]
      )
    ).rows;
    for (const job of jobs) {
      expect(job.attempts).toBe(0);
      expect(job.status).toBe('queued');
      expect(job.run_after.getTime()).toBeGreaterThan(Date.now());
    }
    await pool.query(
      `UPDATE invoice_reminder_offset_toggles SET enabled=true WHERE service_type='electricity' AND "offset"=-7`
    );
    await pool.query(
      "UPDATE notification_job SET run_after=NOW()-INTERVAL '1 second' WHERE outbox_id=$1",
      [r.id]
    );
    await pool.query(
      "UPDATE notification_outbox SET scheduled_for=NOW()-INTERVAL '1 second' WHERE id=$1",
      [r.id]
    );
    expect(await runOutboxPoll(r.options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
    expect(r.email).toHaveBeenCalledOnce();
    expect(await runOutboxPoll(r.options)).toEqual({ leased: 0, delivered: 0, failed: 0 });
  } finally {
    await pool.query(
      "DELETE FROM invoice_reminder_offset_toggles WHERE service_type='electricity'"
    );
  }
});

for (const accepted of [true, false]) {
  it(`preserves ${accepted ? 'accepted' : 'unknown'} reminder receipts after payment`, async () => {
    const r = await queuedReminder();
    const send = durableDelivery(pool, r.id, 'email', 'existing-reminder-attempt');
    if (accepted)
      await send({ id: randomUUID(), transport: 'smtp' }, async () => 'existing-acceptance');
    else
      await expect(
        send({ id: randomUUID(), transport: 'smtp' }, async () => {
          throw new Error('unknown transport outcome');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    await pool.query("UPDATE invoices SET state='Paid',paid_amount=100 WHERE id=$1", [r.invoiceId]);
    expect(await runOutboxPoll(r.options)).toEqual({
      leased: 1,
      delivered: accepted ? 1 : 0,
      failed: accepted ? 0 : 1,
    });
    expect(r.email).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT status,attempt_number FROM notification_send_receipts WHERE outbox_id=$1',
          [r.id]
        )
      ).rows
    ).toEqual([{ status: accepted ? 'accepted' : 'unknown', attempt_number: 1 }]);
    expect(
      (
        await pool.query(
          "SELECT id FROM notification_delivery_log WHERE notification_id=$1 AND channel='email' AND send_attempt_token IS NOT NULL",
          [r.id]
        )
      ).rows
    ).toHaveLength(1);
  });
}
it('rechecks payment committed while invoice locking waits', async () => {
  const r = await queuedReminder(),
    writer = await pool.connect();
  await writer.query('BEGIN');
  await writer.query("UPDATE invoices SET state='Paid',paid_amount=100 WHERE id=$1", [r.invoiceId]);
  const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const polling = runOutboxPoll(r.options);
  try {
    await vi.waitFor(async () =>
      expect(
        (
          await pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [
            pid,
          ])
        ).rows.length
      ).toBeGreaterThan(0)
    );
  } finally {
    await writer.query('COMMIT');
    writer.release();
  }
  expect(await polling).toEqual({ leased: 1, delivered: 1, failed: 0 });
  expect(r.email).not.toHaveBeenCalled();
});
it('holds invoice eligibility through provider I/O and local persistence', async () => {
  const r = await queuedReminder();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  r.email.mockImplementation(async () => {
    await gate;
    return { status: 'delivered', providerRef: 'reminder-accepted' };
  });
  const polling = runOutboxPoll(r.options);
  const writer = await pool.connect();
  const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let payment: Promise<unknown> | undefined;
  try {
    await vi.waitFor(() => expect(r.email).toHaveBeenCalledOnce());
    payment = writer.query("UPDATE invoices SET state='Paid',paid_amount=100 WHERE id=$1", [
      r.invoiceId,
    ]);
    await vi.waitFor(async () =>
      expect(
        (await pool.query('SELECT cardinality(pg_blocking_pids($1)) AS n', [pid])).rows[0].n
      ).toBeGreaterThan(0)
    );
  } finally {
    release();
    await polling;
    await payment;
    writer.release();
  }
  expect(
    (await pool.query('SELECT state FROM invoices WHERE id=$1', [r.invoiceId])).rows[0].state
  ).toBe('Paid');
  expect(
    (
      await pool.query('SELECT id FROM in_app_notifications WHERE delivery_key=$1', [
        `outbox:${r.id}`,
      ])
    ).rows
  ).toHaveLength(1);
});
it('serializes reminder policy guards without exhausting the worker pool', async () => {
  const reminders = [];
  for (let i = 0; i < 5; i++) reminders.push(await queuedReminder());
  const first = reminders[0]!;
  expect(await runOutboxPoll({ ...first.options, leaseSize: 5 })).toEqual({
    leased: 5,
    delivered: 5,
    failed: 0,
  });
  expect(first.email).toHaveBeenCalledTimes(5);
});
it('rechecks the current recipient window instead of a saved wider window', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-13T23:00:00Z'));
  try {
    const r = await queuedReminder();
    await pool.query("UPDATE users SET timezone='UTC' WHERE user_id=$1", [r.userId]);
    await pool.query(
      `INSERT INTO app_config(key,value) VALUES ('notification.delivery_window','{"timezone":"UTC","start_hour":9,"end_hour":21}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
    );
    await pool.query(
      `UPDATE notification_job SET delivery_window='{"timezone":"UTC","startHour":0,"endHour":23.983333333333334}' WHERE outbox_id=$1`,
      [r.id]
    );
    expect(await runOutboxPoll({ pool, transports: r.options.transports })).toEqual({
      leased: 1,
      delivered: 0,
      failed: 0,
    });
    expect(r.email).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          "SELECT attempts,run_after FROM notification_job WHERE outbox_id=$1 AND channel='email'",
          [r.id]
        )
      ).rows[0]
    ).toEqual({ attempts: 0, run_after: new Date('2026-09-14T09:00:00Z') });
    expect(
      (
        await pool.query('SELECT id FROM in_app_notifications WHERE delivery_key=$1', [
          `outbox:${r.id}`,
        ])
      ).rows
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    await pool.query("DELETE FROM app_config WHERE key='notification.delivery_window'");
  }
});
it('pauses dirty queued plans without consuming an attempt', async () => {
  const r = await queuedReminder();
  await pool.query(
    `UPDATE invoices SET metadata=metadata || '{"reminderPlanDirty":true}'::jsonb WHERE id=$1`,
    [r.invoiceId]
  );
  expect(await runOutboxPoll(r.options)).toEqual({ leased: 1, delivered: 0, failed: 0 });
  expect(r.email).not.toHaveBeenCalled();
  expect(
    (await pool.query('SELECT attempts FROM notification_job WHERE outbox_id=$1', [r.id])).rows
  ).toEqual([{ attempts: 0 }, { attempts: 0 }]);
});

for (const locale of ['fa', 'en']) {
  it(`delivers the active localized reminder email and persists its version (${locale})`, async () => {
    const r = await queuedReminder();
    await pool.query('UPDATE users SET locale=$2 WHERE user_id=$1', [r.userId, locale]);
    await pool.query("UPDATE email_provider_configs SET status='superseded' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
      VALUES ('resend','Reminder fixture','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'fixture-only', from_email: 'sender@example.test' }), r.userId]
    );
    await pool.query(
      "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key='payment.invoice_reminder' AND channel='email' AND locale=$1",
      [locale]
    );
    const subject =
      locale === 'fa' ? 'یادآوری پرداخت {{invoiceId}}' : 'Payment reminder {{invoiceId}}';
    const template = (
      await pool.query(
        `INSERT INTO notification_templates(event_key,channel,locale,version,subject,body_template,variables,status,is_active,created_by)
      VALUES ('payment.invoice_reminder','email',$1,900,$2,'<p>{{invoiceId}}: {{dueAt}} / {{offset}} / {{scheduledAt}}</p>',
      '["invoiceId","dueAt","offset","scheduledAt"]','active',true,$3) RETURNING id`,
        [locale, subject, r.userId]
      )
    ).rows[0];
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'localized-reminder' }), { status: 200 })
    );
    const options = {
      ...r.options,
      transports: {
        in_app: new InAppNotificationTransport(pool),
        email: new EmailNotificationTransport(pool, request),
      },
    };
    expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
    expect(request).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(sent.subject).toBe(subject.replace('{{invoiceId}}', r.invoiceId));
    expect(sent.html).toContain(r.invoiceId);
    expect(sent.to).toContain(r.emailAddress);
    const job = (
      await pool.query(
        "SELECT delivery_payload,status FROM notification_job WHERE outbox_id=$1 AND channel='email'",
        [r.id]
      )
    ).rows[0];
    expect(job.status).toBe('done');
    expect(job.delivery_payload).toMatchObject({ templateId: template.id, templateVersion: 900 });
    expect(await runOutboxPoll(options)).toEqual({ leased: 0, delivered: 0, failed: 0 });
    expect(request).toHaveBeenCalledOnce();
  });

  it(`delivers the matching remote SMS template and preserves its snapshot (${locale})`, async () => {
    const r = await queuedReminder();
    await verifyMobile(r.userId);
    await pool.query('UPDATE users SET locale=$2 WHERE user_id=$1', [r.userId, locale]);
    await pool.query("UPDATE notification_outbox SET channels=ARRAY['in_app','sms'] WHERE id=$1", [
      r.id,
    ]);
    await pool.query(
      "UPDATE notification_job SET channel='sms' WHERE outbox_id=$1 AND channel='email'",
      [r.id]
    );
    await pool.query("UPDATE sms_provider_configs SET status='superseded' WHERE status='active'");
    const mappings = [
      { event_key: 'payment.invoice_reminder', template_id: '99', variables: { invoiceId: 'ID' } },
      {
        event_key: 'payment.invoice_reminder',
        locale: 'fa',
        template_id: '42',
        variables: { invoiceId: 'ID' },
      },
      {
        event_key: 'payment.invoice_reminder',
        locale: 'en',
        template_id: '43',
        variables: { invoiceId: 'ID' },
      },
    ];
    await pool.query(
      `INSERT INTO sms_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
      VALUES ('smsir','Reminder fixture','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('smsir'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [
        JSON.stringify({ api_key: 'fixture-only', sender: '3000', template_mappings: mappings }),
        r.userId,
      ]
    );
    await pool.query(
      "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key='payment.invoice_reminder' AND channel='sms' AND locale=$1",
      [locale]
    );
    const template = (
      await pool.query(
        `INSERT INTO notification_templates(event_key,channel,locale,version,body_template,variables,status,is_active,created_by)
      VALUES ('payment.invoice_reminder','sms',$1,900,'{{invoiceId}}','["invoiceId"]','active',true,$2) RETURNING id`,
        [locale, r.userId]
      )
    ).rows[0];
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ status: 1, data: { messageId: 123 } }), { status: 200 })
    );
    const options = {
      ...r.options,
      transports: {
        in_app: new InAppNotificationTransport(pool),
        sms: new SmsNotificationTransport(pool, request),
      },
    };
    expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      TemplateId: locale === 'fa' ? 42 : 43,
      Parameters: [{ Name: 'ID', Value: r.invoiceId }],
    });
    const job = (
      await pool.query(
        "SELECT delivery_payload,status FROM notification_job WHERE outbox_id=$1 AND channel='sms'",
        [r.id]
      )
    ).rows[0];
    expect(job).toMatchObject({
      status: 'done',
      delivery_payload: {
        templateId: template.id,
        templateVersion: 900,
        message: { templateId: locale === 'fa' ? '42' : '43' },
      },
    });
    expect(await runOutboxPoll(options)).toEqual({ leased: 0, delivered: 0, failed: 0 });
    expect(request).toHaveBeenCalledOnce();
  });
}
