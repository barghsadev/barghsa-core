import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
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
let actor: { userId: string; sessionId: string; csrfToken: string };
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
    "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin) VALUES ('triage-staff','triage@example.test','test-only',true,false)"
  );
  await db.pool.query(`INSERT INTO staff_roles(role_id,name,description,permissions)
    VALUES ('triage-role','Triage role','Fixture','["admin:jobs:view","admin:jobs:retry"]')`);
  await db.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('triage-staff','triage-role')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await db.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'triage-staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, csrf, randomUUID()]
  );
  actor = { userId: 'triage-staff', sessionId: session, csrfToken: csrf };
  headers.Cookie = `barghsa_session=${session}`;
  headers['X-CSRF-Token'] = csrf;
  profileId = (
    await db.pool.query("INSERT INTO profiles(user_id) VALUES ('triage-staff') RETURNING id")
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await db.pool.query("UPDATE users SET is_staff=true,is_admin=false WHERE user_id='triage-staff'");
  await db.pool.query(
    `UPDATE sessions SET revoked_at=NULL,csrf_token=$2,
    expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '1 hour',step_up_verified_at=NOW()
    WHERE session_id=$1`,
    [actor.sessionId, actor.csrfToken]
  );
  await db.pool.query(
    `UPDATE staff_roles SET permissions='["admin:jobs:view","admin:jobs:retry"]' WHERE role_id='triage-role'`
  );
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

it('serves scoped stable delivery-history pages and honors revoked read permission', async () => {
  const row = await seed();
  const ids = Array.from({ length: 30 }, () => randomUUID())
    .sort()
    .reverse();
  await db.pool.query(
    `INSERT INTO notification_delivery_log(id,notification_id,channel,status,attempt_number,error_detail,created_at)
    SELECT value,$1,'email','failed',1,'token=***','2026-09-09T01:00:00Z' FROM unnest($2::uuid[]) AS value`,
    [row.outbox, ids]
  );
  await db.pool.query(
    `INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number)
    VALUES ($1,'sms','delivered',1)`,
    [row.outbox]
  );
  const read = (offset: number) =>
    fetch(
      `${fixture.base}/api/admin/notifications/delivery-logs?notificationId=${row.outbox}&channel=email&limit=25&offset=${offset}`,
      { headers }
    );
  const first = await read(0),
    second = await read(25);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const firstPage: unknown = await first.json(),
    secondPage: unknown = await second.json();
  if (!Array.isArray(firstPage) || !Array.isArray(secondPage))
    throw new Error('Invalid history page');
  const entries = [...firstPage, ...secondPage];
  expect(entries.map((entry) => entry.id)).toEqual(ids);
  for (const entry of entries)
    expect(entry).toMatchObject({
      notificationId: row.outbox,
      channel: 'email',
      status: 'failed',
      attemptNumber: 1,
      errorDetail: 'token=***',
    });
  await db.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id='triage-role'");
  expect((await read(0)).status).toBe(403);
});
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
    Array.from({ length: 8 }, () => admin.retryFailedNotification(row.dead, actor, '127.0.0.1'))
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
    admin.retryFailedNotification(active.dead, actor, '127.0.0.1')
  ).rejects.toMatchObject({ status: 409 });
  const done = await seed();
  await db.pool.query(
    "UPDATE notification_job SET status='done',provider_ref='receipt' WHERE id=$1",
    [done.job]
  );
  await expect(admin.retryFailedNotification(done.dead, actor, '127.0.0.1')).rejects.toMatchObject({
    status: 409,
  });
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
    pending = new FailedNotificationsService()
      .retryFailedNotification(row.dead, actor, '127.0.0.1')
      .catch((error) => error);
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
    await client.query("UPDATE staff_roles SET permissions='[]' WHERE role_id='triage-role'");
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
    await db.pool.query(
      "UPDATE users SET is_staff=true,is_admin=false WHERE user_id='triage-staff'"
    );
  }
});

async function snapshot(row: Awaited<ReturnType<typeof seed>>) {
  const [outbox, job, dead, audit] = await Promise.all([
    db.pool.query('SELECT * FROM notification_outbox WHERE id=$1', [row.outbox]),
    db.pool.query('SELECT * FROM notification_job WHERE id=$1', [row.job]),
    db.pool.query('SELECT * FROM notification_dead_letter WHERE id=$1', [row.dead]),
    db.pool.query(
      "SELECT event,metadata,correlation_id FROM audit_log WHERE metadata::jsonb->>'deadLetterId'=$1 ORDER BY created_at,id",
      [row.dead]
    ),
  ]);
  return { outbox: outbox.rows[0], job: job.rows[0], dead: dead.rows[0], audits: audit.rows };
}

for (const prefix of prefixes) {
  for (const action of ['retry', 'resolve', 'dismiss'] as const) {
    const request = (id: string) =>
      fetch(`${fixture.base}${prefix}/${id}/${action}`, { method: 'POST', headers });
    it(`${prefix} ${action} binds current session and request correlation to its atomic audit`, async () => {
      const row = await seed();
      const before = await snapshot(row);
      const response = await request(row.dead);
      expect(response.status).toBe(200);
      const result = await snapshot(row);
      expect(result.dead.status).toBe(
        action === 'retry' ? 'retried' : action === 'resolve' ? 'resolved' : 'dismissed'
      );
      expect(result.audits).toHaveLength(1);
      const proof = (
        await db.pool.query('SELECT step_up_verified_at FROM sessions WHERE session_id=$1', [
          actor.sessionId,
        ])
      ).rows[0].step_up_verified_at;
      expect(JSON.parse(result.audits[0].metadata)).toMatchObject({
        sessionId: actor.sessionId,
        stepUpVerified: true,
        stepUpVerifiedAt: proof.toISOString(),
        deadLetterId: row.dead,
      });
      expect(result.audits[0].correlation_id).toBe(response.headers.get('x-correlation-id'));
      expect(result.outbox.idempotency_key).toBe(before.outbox.idempotency_key);
      expect(result.job.delivery_payload).toEqual(before.job.delivery_payload);
      if (action === 'retry') expect(result.job).toMatchObject({ status: 'queued', attempts: 0 });
      else expect(result.job).toEqual(before.job);
    });

    for (const change of ['revoked', 'csrf', 'step-up', 'permission'] as const) {
      it(`${prefix} ${action} rejects ${change} changed after the request guard`, async () => {
        const row = await seed(),
          before = await snapshot(row),
          blocker = await db.pool.connect();
        let pending: ReturnType<typeof request> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            "SELECT role_id FROM staff_roles WHERE role_id='triage-role' FOR UPDATE"
          );
          pending = request(row.dead);
          await expect
            .poll(
              async () =>
                (
                  await db.pool.query(
                    "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE OF ur,r%'"
                  )
                ).rows[0].count
            )
            .toBe(1);
          if (change === 'permission')
            await blocker.query(
              "UPDATE staff_roles SET permissions='[]' WHERE role_id='triage-role'"
            );
          else {
            const assignment =
              change === 'revoked'
                ? 'revoked_at=clock_timestamp()'
                : change === 'csrf'
                  ? "csrf_token='changed-after-guard'"
                  : "step_up_verified_at=NOW()-INTERVAL '1 day'";
            await db.pool.query(`UPDATE sessions SET ${assignment} WHERE session_id=$1`, [
              actor.sessionId,
            ]);
          }
          await blocker.query('COMMIT');
          expect((await pending).status).toBe(change === 'revoked' ? 401 : 403);
          expect(await snapshot(row)).toEqual(before);
        } finally {
          await blocker.query('ROLLBACK').catch(() => {});
          blocker.release();
          await pending;
        }
      });
    }

    it(`${prefix} ${action} rolls back queue, triage and audit when step-up expires before commit`, async () => {
      const row = await seed(),
        before = await snapshot(row);
      await db.pool
        .query(`CREATE FUNCTION invalidate_triage_session() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE sessions SET step_up_verified_at=NULL WHERE session_id='${actor.sessionId}'; RETURN NEW; END $$;
        CREATE TRIGGER invalidate_triage_session BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.user_id='triage-staff') EXECUTE FUNCTION invalidate_triage_session()`);
      try {
        expect((await request(row.dead)).status).toBe(403);
        expect(await snapshot(row)).toEqual(before);
      } finally {
        await db.pool.query('DROP TRIGGER invalidate_triage_session ON audit_log');
        await db.pool.query('DROP FUNCTION invalidate_triage_session()');
      }
    });
  }
}
