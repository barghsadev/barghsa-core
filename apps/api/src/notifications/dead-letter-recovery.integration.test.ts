import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { FailedNotificationsService } from '../admin/failed-notifications.service.js';
const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => db.pool,
}));
let fixture: Awaited<ReturnType<typeof startHttpFixture>>, profileId: string;
const headers: Record<string, string> = {};
let routeIndex = 0;
const prefixes = ['/api/admin/failed-notifications', '/api/admin/notifications/dead-letters'];
const service = {
  async deadLetterAction(id: string, action: string, _actor: string) {
    const response = await fetch(`${fixture.base}${prefixes[routeIndex++ % 2]}/${id}/${action}`, {
      method: 'POST',
      headers,
    });
    const body = await response.json();
    if (!response.ok) throw { status: response.status, body };
    return body;
  },
};
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  db.pool = fixture.pool;
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin) VALUES ('triage-staff','triage@example.test','test-only',true,true)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await db.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'triage-staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, csrf, randomUUID()]
  );
  headers.Cookie = `barghsa_session=${session}`;
  headers['X-CSRF-Token'] = csrf;
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
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => service.deadLetterAction(row.dead, 'retry', 'triage-staff'))
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  for (const result of results)
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
  for (const action of ['resolve', 'dismiss'])
    await expect(service.deadLetterAction(row.dead, action, 'triage-staff')).rejects.toMatchObject({
      status: 409,
    });
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
        "SELECT count(*)::int AS count FROM audit_log WHERE event='notification_retried' AND metadata::jsonb->>'deadLetterId'=$1",
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
  await expect(service.deadLetterAction(row.dead, 'retry', 'triage-staff')).rejects.toMatchObject({
    status: 409,
  });
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
  await expect(service.deadLetterAction(row.dead, 'retry', 'triage-staff')).rejects.toMatchObject({
    status: 409,
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

it('keeps both route aliases masked and validates filters, identity, CSRF and step-up', async () => {
  const row = await seed();
  await db.pool.query('UPDATE notification_outbox SET payload=$2 WHERE id=$1', [
    row.outbox,
    JSON.stringify({
      email: 'recipient@example.test',
      token: 'private-token',
      nested: { otp: 123456 },
    }),
  ]);
  for (const prefix of prefixes) {
    const request = (suffix = '', method = 'GET', requestHeaders = headers) =>
      fetch(`${fixture.base}${prefix}${suffix}`, { method, headers: requestHeaders });
    expect((await request('', 'GET', {})).status).toBe(401);
    expect(await (await request('/access')).json()).toEqual({ canView: true, canRetry: true });
    const response = await request('?status=open&channel=email&limit=200');
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{ id: string; data: unknown }>;
    const item = rows.find((item: { id: string }) => item.id === row.dead);
    expect(item).toMatchObject({ data: { token: '***', nested: { otp: '***' } } });
    expect(JSON.stringify(item)).not.toContain('recipient@example.test');
    expect(JSON.stringify(item)).not.toContain(profileId);
    expect(item).not.toHaveProperty('idempotencyKey');
    for (const query of [
      'limit=1&limit=2',
      'offset=',
      'limit=1.5',
      'offset=1000001',
      'status=bad',
      'channel=bad',
      'severity=bad',
    ])
      expect((await request(`?${query}`)).status).toBe(400);
    expect((await request('/bad/retry', 'POST')).status).toBe(400);
    expect((await request(`/${row.dead}/retry`, 'POST', { Cookie: headers.Cookie! })).status).toBe(
      403
    );
    await db.pool.query(
      "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='triage-staff'"
    );
    try {
      expect((await request(`/${row.dead}/retry`, 'POST')).status).toBe(403);
    } finally {
      await db.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='triage-staff'"
      );
    }
  }
});
it('rolls queue and triage changes back when the audit cannot be stored', async () => {
  const row = await seed();
  await db.pool.query(
    `CREATE FUNCTION reject_notification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_notification_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='notification_retried') EXECUTE FUNCTION reject_notification_audit()`
  );
  try {
    await expect(service.deadLetterAction(row.dead, 'retry', 'triage-staff')).rejects.toMatchObject(
      { status: 500 }
    );
    expect(
      (await db.pool.query('SELECT status FROM notification_dead_letter WHERE id=$1', [row.dead]))
        .rows[0].status
    ).toBe('open');
    expect(
      (await db.pool.query('SELECT status FROM notification_outbox WHERE id=$1', [row.outbox]))
        .rows[0].status
    ).toBe('failed');
    expect(
      (await db.pool.query('SELECT status,attempts FROM notification_job WHERE id=$1', [row.job]))
        .rows[0]
    ).toEqual({ status: 'dead_letter', attempts: 5 });
  } finally {
    await db.pool.query('DROP TRIGGER reject_notification_audit ON audit_log');
  }
});
it('rechecks permission after waiting for the actor lock and rolls back a revoked action', async () => {
  const row = await seed(),
    client = await db.pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='triage-staff' FOR UPDATE");
    pending = service.deadLetterAction(row.dead, 'retry', 'triage-staff').catch((error) => error);
    await expect
      .poll(async () =>
        Number(
          (
            await db.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%' "
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query("UPDATE users SET is_admin=false WHERE user_id='triage-staff'");
    await client.query('COMMIT');
    expect(await pending).toMatchObject({ status: 403 });
    expect(
      (await db.pool.query('SELECT status FROM notification_dead_letter WHERE id=$1', [row.dead]))
        .rows[0].status
    ).toBe('open');
    expect(
      (
        await db.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await db.pool.query("UPDATE users SET is_admin=true WHERE user_id='triage-staff'");
  }
});
