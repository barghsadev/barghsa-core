import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { startHttpFixture } from '../test/http-fixture.js';
import { NotificationsService, type ContractCustomerEvent } from './notifications.service.js';
const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => db.pool,
}));
let http: Awaited<ReturnType<typeof startHttpFixture>>, profile: string, foreignProfile: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  db.pool = http.pool;
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('business-owner','business-owner','fixture')"
  );
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('foreign-business-owner','foreign-business-owner','fixture')"
  );
  foreignProfile = (
    await db.pool.query(
      "INSERT INTO profiles(user_id) VALUES('foreign-business-owner') RETURNING id"
    )
  ).rows[0].id;
  profile = (
    await db.pool.query("INSERT INTO profiles(user_id) VALUES('business-owner') RETURNING id")
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await http?.close();
});
const service = new NotificationsService();
function staffNotice() {
  return {
    userId: 'business-owner',
    operatingContext: 'staff' as const,
    type: 'general' as const,
    businessOccurrenceKey: 'approval:' + randomUUID() + ':requested',
    title: 'درخواست تأیید',
    body: 'بررسی مالی',
    localizedContent: {
      fa: { title: 'درخواست تأیید', body: 'بررسی مالی' },
      en: { title: 'Approval request', body: 'Financial review' },
    },
    link: '/admin/approval-requests',
  };
}
it('stores private staff outbox/job/history once and preserves read state on competing replay', async () => {
  const input = staffNotice();
  const key = `staff-notice:${input.businessOccurrenceKey}:${input.userId}`;
  const results = await Promise.all([
    transaction((c) => service.create(input, c)),
    transaction((c) => service.create(input, c)),
  ]);
  expect(results[0].id).toBe(results[1].id);
  const before = await snapshot(key);
  expect(before.outbox).toHaveLength(1);
  expect(before.outbox[0]).toMatchObject({
    profile_id: null,
    user_id: input.userId,
    event_key: 'general',
    channels: ['in_app'],
    status: 'delivered',
  });
  expect(before.inbox).toHaveLength(1);
  expect(before.inbox[0]).toMatchObject({
    profile_id: null,
    recipient_user_id: input.userId,
    operating_context: 'staff',
    type: 'general',
  });
  expect(before.jobs).toHaveLength(1);
  expect(before.jobs[0]).toMatchObject({
    status: 'done',
    channel: 'in_app',
    provider_ref: results[0].id,
    attempts: 1,
  });
  expect(before.logs).toHaveLength(1);
  expect(before.logs[0]).toMatchObject({
    status: 'delivered',
    channel: 'in_app',
    provider_ref: results[0].id,
  });
  await db.pool.query('UPDATE in_app_notifications SET is_read=true WHERE id=$1', [results[0].id]);
  const read = await snapshot(key);
  expect((await transaction((c) => service.create(input, c))).read).toBe(true);
  expect(await snapshot(key)).toEqual(read);
  await expect(
    transaction((c) => service.create({ ...input, body: 'Changed' }, c))
  ).rejects.toThrow('conflicts');
  expect(await snapshot(key)).toEqual(read);
  await expect(service.create(input)).rejects.toThrow('private business transaction');
  await expect(
    transaction((c) => service.create({ ...input, operatingContext: 'account' }, c))
  ).rejects.toThrow('private business transaction');
});

it('keeps generic customer envelopes scoped to their explicit profile and recipient', async () => {
  const input = {
    ...staffNotice(),
    operatingContext: 'customer' as const,
    profileId: profile,
    businessOccurrenceKey: 'customer-note:' + randomUUID(),
    link: '/consultations/' + randomUUID(),
  };
  const created = await transaction((c) => service.create(input, c));
  const key = `customer-notice:${input.businessOccurrenceKey}:${input.userId}`;
  const saved = await snapshot(key);
  expect(saved.outbox[0]).toMatchObject({
    profile_id: profile,
    user_id: input.userId,
    channels: ['in_app'],
  });
  expect(saved.inbox[0]).toMatchObject({
    profile_id: profile,
    recipient_user_id: input.userId,
    operating_context: 'customer',
  });
  expect((await transaction((c) => service.create(input, c))).id).toBe(created.id);
  expect(await snapshot(key)).toEqual(saved);
  await expect(
    transaction((c) => service.create({ ...input, profileId: foreignProfile }, c))
  ).rejects.toThrow('conflicts');
  expect(await snapshot(key)).toEqual(saved);
});

it.each([
  'notification_outbox',
  'in_app_notifications',
  'notification_job',
  'notification_delivery_log',
])('rolls staff notice and business state back for suppressed %s writes', async (table) => {
  const input = staffNotice();
  const key = `staff-notice:${input.businessOccurrenceKey}:${input.userId}`;
  const before = await snapshot(key);
  const locale = (await db.pool.query("SELECT locale FROM users WHERE user_id='business-owner'"))
    .rows[0].locale;
  await db.pool
    .query(`CREATE FUNCTION suppress_staff_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER suppress_staff_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION suppress_staff_notice()`);
  try {
    await expect(
      transaction(async (c) => {
        await c.query("UPDATE users SET locale='en' WHERE user_id='business-owner'");
        await service.create(input, c);
      })
    ).rejects.toThrow();
  } finally {
    await db.pool.query(
      `DROP TRIGGER suppress_staff_notice ON ${table}; DROP FUNCTION suppress_staff_notice()`
    );
  }
  expect(await snapshot(key)).toEqual(before);
  expect(
    (await db.pool.query("SELECT locale FROM users WHERE user_id='business-owner'")).rows[0].locale
  ).toBe(locale);
  await transaction((c) => service.create(input, c));
  expect((await snapshot(key)).outbox).toHaveLength(1);
});
it('stores a distinct inbox-only awaiting-staff occurrence and preserves its original receipt on replay', async () => {
  const input = {
    ...params(),
    eventKey: 'order.awaiting_staff' as const,
    payload: { orderNumber: randomUUID() },
    link: '/electricity/orders/' + randomUUID(),
  };
  await transaction((client) => service.createCustomerBusinessEvent(input, client));
  const before = await snapshot(input.occurrenceKey);
  expect(before.outbox).toHaveLength(1);
  expect(before.outbox[0]).toMatchObject({
    event_key: 'order.awaiting_staff',
    channels: ['in_app'],
    user_id: 'business-owner',
    profile_id: profile,
  });
  expect(before.inbox).toHaveLength(1);
  expect(before.inbox[0]).toMatchObject({
    type: 'order.awaiting_staff',
    recipient_user_id: 'business-owner',
    profile_id: profile,
    operating_context: 'customer',
  });
  expect(before.jobs).toHaveLength(1);
  expect(before.jobs[0]).toMatchObject({
    channel: 'in_app',
    status: 'done',
    attempts: 1,
    provider_ref: before.inbox[0].id,
  });
  expect(before.logs).toHaveLength(1);
  await db.pool.query('UPDATE in_app_notifications SET is_read=true WHERE id=$1', [
    before.inbox[0].id,
  ]);
  const read = await snapshot(input.occurrenceKey);
  await transaction(async (client) =>
    expect(await service.createCustomerBusinessEvent(input, client)).toBe(false)
  );
  expect(await snapshot(input.occurrenceKey)).toEqual(read);
});
function params(eventKey: ContractCustomerEvent = 'contract.awaiting_acceptance') {
  return {
    userId: 'business-owner',
    profileId: profile,
    operatingContext: 'customer' as const,
    type: 'general' as const,
    eventKey,
    occurrenceKey: `native:${randomUUID()}`,
    title: 'Contract',
    localizedContent: {
      fa: { title: 'قرارداد', body: 'پیام ذخیره‌شده' },
      en: { title: 'Contract', body: 'Saved message' },
    },
    link: `/contracts/${randomUUID()}`,
    payload: { contractNumber: '9007199254740993' },
  };
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function snapshot(key: string) {
  const outbox = (
    await db.pool.query('SELECT * FROM notification_outbox WHERE idempotency_key=$1', [key])
  ).rows;
  const id = outbox[0]?.id;
  return {
    outbox,
    inbox: (
      await db.pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [id]
      )
    ).rows,
    jobs: (
      await db.pool.query('SELECT * FROM notification_job WHERE outbox_id=$1 ORDER BY channel', [
        id,
      ])
    ).rows,
    logs: (
      await db.pool.query(
        'SELECT * FROM notification_delivery_log WHERE notification_id=$1 ORDER BY id',
        [id]
      )
    ).rows,
  };
}
it.each([
  'contract.awaiting_acceptance',
  'contract.accepted',
  'contract.signed',
  'contract.changes_requested',
] as const)(
  'commits immediate private inbox evidence and worker email for %s',
  async (eventKey) => {
    const input = params(eventKey);
    await transaction((client) => service.createCustomerBusinessEvent(input, client));
    const saved = await snapshot(input.occurrenceKey),
      id = saved.outbox[0].id;
    expect(saved.outbox).toMatchObject([
      {
        profile_id: profile,
        user_id: 'business-owner',
        event_key: eventKey,
        channels: ['in_app', 'email'],
        status: 'queued',
        idempotency_version: 2,
      },
    ]);
    expect(saved.inbox).toMatchObject([
      {
        recipient_user_id: 'business-owner',
        profile_id: profile,
        operating_context: 'customer',
        type: eventKey,
        is_read: false,
        localized_content: input.localizedContent,
      },
    ]);
    expect(saved.jobs).toMatchObject([
      { channel: 'email', status: 'queued', attempts: 0, max_attempts: 5 },
      { channel: 'in_app', status: 'done', attempts: 1, provider_ref: saved.inbox[0].id },
    ]);
    expect(saved.jobs.map((job) => job.priority)).toEqual(
      Array(2).fill(
        ['contract.awaiting_acceptance', 'contract.changes_requested'].includes(eventKey)
          ? 'urgent'
          : 'normal'
      )
    );
    expect(saved.logs).toMatchObject([
      {
        channel: 'in_app',
        status: 'delivered',
        attempt_number: 1,
        provider_ref: saved.inbox[0].id,
      },
    ]);
    const email = vi
      .fn()
      .mockResolvedValue({ status: 'delivered', providerRef: `controlled-email:${id}` });
    const inApp = vi.fn().mockRejectedValue(new Error('Immediate inbox must not be redelivered'));
    const worker = createRequire(__filename)(
      resolve(__dirname, '../../../worker/dist/notifications/outbox-runner.js')
    );
    expect(
      await worker.runOutboxPoll({
        pool: db.pool,
        transports: {
          email: { channel: 'email', send: email },
          in_app: { channel: 'in_app', send: inApp },
        },
        availability: () => ({
          enabledChannels: { email: true, sms: true },
          verifiedEmail: true,
          verifiedPhone: false,
          marketingOptedIn: {},
        }),
        deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
      })
    ).toMatchObject({ leased: 1, delivered: 1, failed: 0 });
    expect(email).toHaveBeenCalledOnce();
    expect(inApp).not.toHaveBeenCalled();
    const delivered = await snapshot(input.occurrenceKey);
    expect(delivered.inbox).toEqual(saved.inbox);
    expect(delivered.outbox[0].status).toBe('delivered');
    expect(delivered.jobs).toMatchObject([
      { channel: 'email', status: 'done' },
      { channel: 'in_app', status: 'done', attempts: 1 },
    ]);
    expect(delivered.logs.filter((row) => row.channel === 'in_app')).toEqual(saved.logs);
  }
);
it('serializes duplicate occurrences and retains the exact original read state and delivery evidence', async () => {
  const input = params(),
    first = await db.pool.connect(),
    second = await db.pool.connect();
  let pending: Promise<boolean> | undefined;
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    expect(await service.createCustomerBusinessEvent(input, first)).toBe(true);
    await first.query(
      'UPDATE in_app_notifications SET is_read=true,read_at=clock_timestamp() WHERE profile_id=$1',
      [profile]
    );
    const pid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = service.createCustomerBusinessEvent(input, second);
    await expect
      .poll(
        async () =>
          (
            await db.pool.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
              [pid]
            )
          ).rows[0].blocked
      )
      .toBe(true);
    await first.query('COMMIT');
    expect(await pending).toBe(false);
    const saved = await snapshot(input.occurrenceKey);
    await second.query('COMMIT');
    expect(await snapshot(input.occurrenceKey)).toEqual(saved);
    expect(saved.inbox).toHaveLength(1);
    expect(saved.inbox[0].is_read).toBe(true);
    expect(saved.outbox).toHaveLength(1);
    expect(saved.jobs).toHaveLength(2);
    expect(saved.logs).toHaveLength(1);
  } finally {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
    first.release();
    second.release();
    await pending;
  }
});
it.each(['payload', 'recipient', 'profile'] as const)(
  'rejects changed %s under the same occurrence without rewriting saved messages or jobs',
  async (change) => {
    const input = params();
    await transaction((client) => service.createCustomerBusinessEvent(input, client));
    const saved = await snapshot(input.occurrenceKey);
    await expect(
      transaction((client) =>
        service.createCustomerBusinessEvent(
          {
            ...input,
            ...(change === 'payload'
              ? { payload: { contractNumber: 'different' } }
              : change === 'recipient'
                ? { userId: 'foreign-business-owner' }
                : { profileId: foreignProfile }),
          },
          client
        )
      )
    ).rejects.toThrow('conflicts with saved delivery');
    expect(await snapshot(input.occurrenceKey)).toEqual(saved);
  }
);

it.each([
  ['in_app_notifications', 'Mandatory inbox delivery was not stored'],
  ['notification_job', 'Business delivery jobs were not stored'],
  ['notification_delivery_log', 'Business inbox delivery history was not stored'],
] as const)(
  'rolls back a silently suppressed %s write and permits the same occurrence after recovery',
  async (table, message) => {
    const input = params();
    await db.pool.query(
      `CREATE FUNCTION suppress_business_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER suppress_business_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION suppress_business_notice()`
    );
    try {
      await expect(
        transaction((client) => service.createCustomerBusinessEvent(input, client))
      ).rejects.toThrow(message);
      expect(await snapshot(input.occurrenceKey)).toEqual({
        outbox: [],
        inbox: [],
        jobs: [],
        logs: [],
      });
    } finally {
      await db.pool.query(
        `DROP TRIGGER suppress_business_notice ON ${table}; DROP FUNCTION suppress_business_notice()`
      );
    }
    await transaction((client) => service.createCustomerBusinessEvent(input, client));
    const recovered = await snapshot(input.occurrenceKey);
    expect(recovered.outbox).toHaveLength(1);
    expect(recovered.inbox).toHaveLength(1);
    expect(recovered.jobs).toHaveLength(2);
    expect(recovered.logs).toHaveLength(1);
  }
);
