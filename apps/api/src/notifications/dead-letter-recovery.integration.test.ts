import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { FailedNotificationsService } from '../admin/failed-notifications.service.js';
import { NotificationsService } from './notifications.service.js';
const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => db.pool,
}));
let fixture: Awaited<ReturnType<typeof startHttpFixture>>, profileId: string;
const service = new NotificationsService();
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  db.pool = fixture.pool;
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('triage-staff','triage@example.test','test-only')"
  );
  profileId = (
    await db.pool.query("INSERT INTO profiles(user_id) VALUES ('triage-staff') RETURNING id")
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await fixture?.close();
});
async function seed() {
  const outbox = randomUUID(),
    job = randomUUID(),
    dead = randomUUID();
  await db.pool.query(
    `INSERT INTO notification_outbox(id,profile_id,event_key,payload,channels,idempotency_key,status)
    VALUES ($1::uuid,$2,'invoice.created','{}',ARRAY['email'],$1::text,'failed')`,
    [outbox, profileId]
  );
  await db.pool.query(
    `INSERT INTO notification_job(id,outbox_id,channel,status,attempts,delivery_payload)
    VALUES ($1,$2,'email','dead_letter',5,'{"preserved":"snapshot"}')`,
    [job, outbox]
  );
  await db.pool.query(
    `INSERT INTO notification_dead_letter(id,outbox_id,job_id,channel,event_key,profile_id,attempts,idempotency_key)
    VALUES ($1::uuid,$2,$3,'email','invoice.created',$4,5,$1::text)`,
    [dead, outbox, job, profileId]
  );
  return { outbox, job, dead };
}
it('requeues once under concurrent actions and keeps the snapshot and audit evidence', async () => {
  const row = await seed();
  await Promise.all(
    Array.from({ length: 8 }, () => service.deadLetterAction(row.dead, 'retry', 'triage-staff'))
  );
  expect(
    (
      await db.pool.query(
        'SELECT status,attempts,delivery_payload FROM notification_job WHERE id=$1',
        [row.job]
      )
    ).rows[0]
  ).toEqual({ status: 'queued', attempts: 0, delivery_payload: { preserved: 'snapshot' } });
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='notification_dead_letter_action' AND metadata::jsonb->>'deadLetterId'=$1",
        [row.dead]
      )
    ).rows[0].count
  ).toBe(1);
  await db.pool.query(
    "UPDATE notification_job SET status='done',attempts=1,provider_ref='real-receipt' WHERE id=$1",
    [row.job]
  );
  await db.pool.query("UPDATE notification_outbox SET status='delivered' WHERE id=$1", [
    row.outbox,
  ]);
  await service.deadLetterAction(row.dead, 'retry', 'triage-staff');
  expect(
    (
      await db.pool.query('SELECT status,attempts,provider_ref FROM notification_job WHERE id=$1', [
        row.job,
      ])
    ).rows[0]
  ).toEqual({ status: 'done', attempts: 1, provider_ref: 'real-receipt' });
});
it('cannot steal an active worker claim or revive a cancelled event', async () => {
  const row = await seed();
  await db.pool.query(
    "UPDATE notification_outbox SET status='sending',lease_token='worker-claim',locked_until=NOW()+INTERVAL '1 minute' WHERE id=$1",
    [row.outbox]
  );
  await expect(service.deadLetterAction(row.dead, 'retry', 'triage-staff')).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (await db.pool.query('SELECT lease_token FROM notification_outbox WHERE id=$1', [row.outbox]))
      .rows[0].lease_token
  ).toBe('worker-claim');
  await db.pool.query(
    "UPDATE notification_outbox SET status='cancelled',locked_until=NULL WHERE id=$1",
    [row.outbox]
  );
  await expect(service.deadLetterAction(row.dead, 'retry', 'triage-staff')).rejects.toMatchObject({
    status: 409,
  });
});
it('never retries a resolved record or a job already delivered', async () => {
  const row = await seed();
  await service.deadLetterAction(row.dead, 'resolve', 'triage-staff');
  expect(await service.deadLetterAction(row.dead, 'retry', 'triage-staff')).toMatchObject({
    status: 'resolved',
  });
  expect(
    (await db.pool.query('SELECT attempts FROM notification_job WHERE id=$1', [row.job])).rows[0]
      .attempts
  ).toBe(5);
  const done = await seed();
  await db.pool.query("UPDATE notification_job SET status='done' WHERE id=$1", [done.job]);
  await expect(service.deadLetterAction(done.dead, 'retry', 'triage-staff')).rejects.toMatchObject({
    status: 409,
  });
});

it('admin retry uses the same claim safeguards and preserves cumulative attempts', async () => {
  const admin = new FailedNotificationsService();
  const row = await seed();
  await db.pool.query(
    "UPDATE notification_outbox SET attempts=9,lease_token='expired',locked_until=NOW()-INTERVAL '1 minute' WHERE id=$1",
    [row.outbox]
  );
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      admin.retryFailedNotification(row.dead, 'triage-staff', '127.0.0.1')
    )
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  for (const result of results)
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
  expect(
    (
      await db.pool.query(
        'SELECT status,attempts,lease_token FROM notification_outbox WHERE id=$1',
        [row.outbox]
      )
    ).rows[0]
  ).toEqual({ status: 'queued', attempts: 9, lease_token: null });
  expect(
    (await db.pool.query('SELECT delivery_payload FROM notification_job WHERE id=$1', [row.job]))
      .rows[0].delivery_payload
  ).toEqual({ preserved: 'snapshot' });
  const active = await seed();
  await db.pool.query(
    "UPDATE notification_outbox SET locked_until=NOW()+INTERVAL '1 minute',lease_token='active' WHERE id=$1",
    [active.outbox]
  );
  await expect(
    admin.retryFailedNotification(active.dead, 'triage-staff', '127.0.0.1')
  ).rejects.toMatchObject({ status: 409 });
  const done = await seed();
  await db.pool.query(
    "UPDATE notification_job SET status='done',provider_ref='receipt' WHERE id=$1",
    [done.job]
  );
  await expect(
    admin.retryFailedNotification(done.dead, 'triage-staff', '127.0.0.1')
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await db.pool.query('SELECT status FROM notification_outbox WHERE id=$1', [done.outbox]))
      .rows[0].status
  ).toBe('failed');
});
