import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { ErrorCodes } from '@barghsa/shared/errors';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const profileId = randomUUID();
const oldDue = '2026-09-12T10:00:00.000Z';
const body = { dueAt: '2026-09-20T10:00:00.000Z', reason: 'Customer requested an extension' };
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES
    ('due-finance','due-finance@example.test','test-only',true),
    ('due-customer','due-customer@example.test','test-only',false)`);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('due-finance','role-finance')"
  );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,is_default) VALUES ($1,'due-customer',true)",
    [profileId]
  );
}, 40_000);
afterAll(async () => {
  await http?.close();
});

async function fixture() {
  const invoiceId = randomUUID(),
    sessionId = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO invoices(id,profile_id,state,total_amount,issued_at,payable_from,due_at)
    VALUES ($1,$2,'Unpaid',1000,'2026-09-01T10:00:00Z','2026-09-01T10:00:00Z',$3)`,
    [invoiceId, profileId, oldDue]
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'due-finance',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, csrf, randomUUID()]
  );
  const headers = {
    Cookie: `barghsa_session=${sessionId}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const url = `${http.base}/api/admin/invoices/${invoiceId}/due-at`;
  return {
    invoiceId,
    sessionId,
    headers,
    url,
    submit: () => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }),
  };
}
async function stored(invoiceId: string) {
  const row = (
    await http.pool.query('SELECT due_at, metadata FROM invoices WHERE id=$1', [invoiceId])
  ).rows[0];
  const count = (
    await http.pool.query(
      "SELECT count(*) FROM audit_log WHERE event='invoice.due_at.override' AND metadata::jsonb->>'invoiceId'=$1",
      [invoiceId]
    )
  ).rows[0].count;
  return {
    dueAt: (row.due_at as Date).toISOString(),
    metadata: row.metadata,
    audits: Number(count),
  };
}

it('Finance reads and changes the deadline with an attributed customer-visible reason', async () => {
  const f = await fixture();
  await http.pool.query(
    `INSERT INTO invoice_reminder_schedule(invoice_id,"offset",channel,scheduled_at,status,sent_at)
    VALUES ($1,-1,'in_app',$2,'scheduled',NULL),($1,-7,'in_app',$2,'sent',$2)`,
    [f.invoiceId, oldDue]
  );
  expect((await fetch(f.url, { headers: f.headers })).status).toBe(200);
  const response = await f.submit();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    dueAt: body.dueAt,
    dueAtOverride: { reason: body.reason, actorUserId: 'due-finance', customerVisible: true },
  });
  expect(await stored(f.invoiceId)).toMatchObject({ dueAt: body.dueAt, audits: 1 });
  expect((await stored(f.invoiceId)).metadata).toMatchObject({ reminderPlanDirty: true });
  expect(
    (
      await http.pool.query(
        `SELECT "offset",status FROM invoice_reminder_schedule WHERE invoice_id=$1 ORDER BY "offset"`,
        [f.invoiceId]
      )
    ).rows
  ).toEqual([
    { offset: -7, status: 'sent' },
    { offset: -1, status: 'cancelled' },
  ]);
  const customerSession = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'due-customer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [customerSession, randomUUID(), randomUUID()]
  );
  const customer = await fetch(`${http.base}/api/invoices/${f.invoiceId}`, {
    headers: { Cookie: `barghsa_session=${customerSession}` },
  });
  expect(customer.status).toBe(200);
  const details = await customer.json();
  expect(details).toMatchObject({
    invoice: { dueAt: body.dueAt, dueAtOverrideReason: body.reason },
  });
  expect(JSON.stringify(details)).not.toContain('due-finance');
  expect(JSON.stringify(details)).not.toContain('reminderPlanDirty');
});

it('requires session, CSRF, current permission and step-up', async () => {
  const f = await fixture();
  expect((await fetch(f.url)).status).toBe(401);
  expect(
    (
      await fetch(f.url, {
        method: 'POST',
        headers: { ...f.headers, 'X-CSRF-Token': 'wrong' },
        body: JSON.stringify(body),
      })
    ).status
  ).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    f.sessionId,
  ]);
  const denied = await f.submit();
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({
    error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
  });
  try {
    await http.pool.query("DELETE FROM user_roles WHERE user_id='due-finance'");
    expect((await fetch(f.url, { headers: f.headers })).status).toBe(403);
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('due-finance','role-finance') ON CONFLICT DO NOTHING"
    );
  }
  expect(await stored(f.invoiceId)).toMatchObject({ dueAt: oldDue, audits: 0 });
});

it.each(['invoice', 'audit', 'read'] as const)(
  'rolls back when session expires while waiting for %s lock',
  async (target) => {
    const f = await fixture();
    await http.pool.query(
      `INSERT INTO invoice_reminder_schedule(invoice_id,"offset",channel,scheduled_at)
      VALUES ($1,0,'in_app',$2)`,
      [f.invoiceId, oldDue]
    );
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      if (target === 'invoice')
        await blocker.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [f.invoiceId]);
      else if (target === 'read')
        await blocker.query('LOCK TABLE invoices IN ACCESS EXCLUSIVE MODE');
      else await blocker.query('LOCK TABLE audit_log IN SHARE MODE');
      await http.pool.query(
        "UPDATE sessions SET expires_at=NOW()+INTERVAL '2 seconds' WHERE session_id=$1",
        [f.sessionId]
      );
      pending = target === 'read' ? fetch(f.url, { headers: f.headers }) : f.submit();
      const pattern =
        target !== 'audit' ? 'SELECT id, state, issued_at%' : '%INSERT INTO audit_log%';
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
                [pattern]
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1',
                [f.sessionId]
              )
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(401);
      expect(await stored(f.invoiceId)).toMatchObject({ dueAt: oldDue, audits: 0 });
      expect(
        (
          await http.pool.query(
            'SELECT status FROM invoice_reminder_schedule WHERE invoice_id=$1',
            [f.invoiceId]
          )
        ).rows
      ).toEqual([{ status: 'scheduled' }]);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);
