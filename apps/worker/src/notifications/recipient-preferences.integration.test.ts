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
  eventKey = 'wallet.topup_completed'
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await enqueueOutbox(client, {
      userId,
      profileId,
      channels,
      eventKey,
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
