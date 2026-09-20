import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ServiceDuePeriodSetting } from '@barghsa/shared/finance';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const endpoint = '/api/admin/config/invoice-due-periods';
const initial = { serviceType: 'manual', defaultDays: 10, expectedPeriodId: null };
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['due-admin-a', 'due-admin-b', 'due-other']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$1,'test-only',true)",
      [user]
    );
    if (user !== 'due-other')
      await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance')", [
        user,
      ]);
    const sid = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [sid, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${sid}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query('DELETE FROM service_due_periods');
  await http.pool.query('DELETE FROM audit_log');
  await http.pool.query(
    "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes',step_up_verified_at=NOW()"
  );
});
function request(body?: unknown, user = 'due-admin-a') {
  return fetch(`${http.base}${endpoint}`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function settings(response: Response) {
  expect(response.status).toBe(200);
  return (await response.json()) as ServiceDuePeriodSetting[];
}
async function counts() {
  return (
    await http.pool.query(`SELECT (SELECT count(*)::int FROM service_due_periods) AS periods,
    (SELECT count(*)::int FROM audit_log WHERE event='invoice.due_period.changed') AS audits`)
  ).rows[0];
}

it('reads four independent defaults and versions changes with safe retries and matching audit history', async () => {
  const defaults = await settings(await request());
  expect(defaults).toHaveLength(4);
  expect(defaults.every((row) => row.defaultDays === 7 && row.periodId === null)).toBe(true);
  const first = await settings(await request(initial));
  const manual = first.find((row) => row.serviceType === 'manual')!;
  expect(manual.defaultDays).toBe(10);
  expect(
    first
      .filter((row) => row.serviceType !== 'manual')
      .every((row) => row.defaultDays === 7 && row.periodId === null)
  ).toBe(true);
  expect(await settings(await request(initial))).toEqual(first);
  expect(await counts()).toEqual({ periods: 1, audits: 1 });
  const second = await settings(
    await request({ ...initial, defaultDays: 14, expectedPeriodId: manual.periodId })
  );
  expect(second.find((row) => row.serviceType === 'manual')?.defaultDays).toBe(14);
  const history = (
    await http.pool.query(
      'SELECT default_days,effective_from,effective_until,created_by FROM service_due_periods ORDER BY effective_from'
    )
  ).rows;
  expect(history.map((row) => row.default_days)).toEqual([10, 14]);
  expect(history[0].effective_until).toEqual(history[1].effective_from);
  expect(history.every((row) => row.created_by === 'due-admin-a')).toBe(true);
  expect(await counts()).toEqual({ periods: 2, audits: 2 });
});

it('refuses stale concurrent writes instead of overwriting the winning version', async () => {
  const results = await Promise.all([
    request(initial),
    request({ ...initial, defaultDays: 20 }, 'due-admin-b'),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await counts()).toEqual({ periods: 1, audits: 1 });
});

it('applies configured days to newly issued invoices and preserves existing invoice deadlines', async () => {
  const profileId = randomUUID();
  await http.pool.query("INSERT INTO profiles(id,user_id) VALUES ($1,'due-other')", [profileId]);
  const current = (await settings(await request(initial))).find(
    (row) => row.serviceType === 'manual'
  )!;
  const issue = async () => {
    const response = await fetch(`${http.base}/api/admin/invoices/manual`, {
      method: 'POST',
      headers: headers['due-admin-a']!,
      body: JSON.stringify({
        profileId,
        idempotencyKey: randomUUID(),
        lines: [
          {
            description: 'Configured invoice',
            quantity: 1,
            unitPrice: '1000',
            vatRate: 0,
            isTaxable: false,
          },
        ],
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { invoiceId: string };
  };
  const first = await issue();
  const firstDates = (
    await http.pool.query('SELECT issued_at,due_at FROM invoices WHERE id=$1', [first.invoiceId])
  ).rows[0];
  expect(firstDates.due_at.getTime() - firstDates.issued_at.getTime()).toBe(10 * 86_400_000);
  expect(
    (await request({ ...initial, defaultDays: 14, expectedPeriodId: current.periodId })).status
  ).toBe(200);
  const second = await issue();
  const secondDates = (
    await http.pool.query('SELECT issued_at,due_at FROM invoices WHERE id=$1', [second.invoiceId])
  ).rows[0];
  expect(secondDates.due_at.getTime() - secondDates.issued_at.getTime()).toBe(14 * 86_400_000);
  expect(
    (await http.pool.query('SELECT due_at FROM invoices WHERE id=$1', [first.invoiceId])).rows[0]
      .due_at
  ).toEqual(firstDates.due_at);
});

it('requires a session, permission, CSRF and current step-up; invalid bodies cannot write', async () => {
  expect((await fetch(`${http.base}${endpoint}`)).status).toBe(401);
  expect((await request(undefined, 'due-other')).status).toBe(403);
  expect((await request(initial, 'due-other')).status).toBe(403);
  expect(
    (
      await fetch(`${http.base}${endpoint}`, {
        method: 'PUT',
        headers: { ...headers['due-admin-a'], 'X-CSRF-Token': 'wrong' },
        body: JSON.stringify(initial),
      })
    ).status
  ).toBe(403);
  for (const bad of [0, 366, 1.5, '10'])
    expect((await request({ ...initial, defaultDays: bad })).status).toBe(400);
  expect((await request({ ...initial, serviceType: 'unknown' })).status).toBe(400);
  expect((await request({ ...initial, extra: true })).status).toBe(400);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='due-admin-a'");
  const response = await request(initial);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } });
  expect(await counts()).toEqual({ periods: 0, audits: 0 });
});

it('preserves a future period and bounds the new current setting to its start', async () => {
  const future = (
    await http.pool
      .query(`INSERT INTO service_due_periods(service_type,default_days,effective_from,created_by)
    VALUES ('manual',30,NOW()+INTERVAL '10 days','due-admin-a') RETURNING id,effective_from`)
  ).rows[0];
  const current = (await settings(await request(initial))).find(
    (row) => row.serviceType === 'manual'
  )!;
  expect(current.defaultDays).toBe(10);
  expect(current.effectiveUntil).toBe((future.effective_from as Date).toISOString());
  expect(
    (await http.pool.query('SELECT default_days FROM service_due_periods WHERE id=$1', [future.id]))
      .rows[0].default_days
  ).toBe(30);
});

it('rolls back version changes if audit insertion fails', async () => {
  const first = (await settings(await request(initial))).find(
    (row) => row.serviceType === 'manual'
  )!;
  await http.pool.query(
    "CREATE FUNCTION reject_due_period_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_due_period_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_due_period_audit()"
  );
  try {
    expect(
      (await request({ ...initial, defaultDays: 15, expectedPeriodId: first.periodId })).status
    ).toBe(500);
    expect((await settings(await request())).find((row) => row.serviceType === 'manual')).toEqual(
      first
    );
    expect(await counts()).toEqual({ periods: 1, audits: 1 });
  } finally {
    await http.pool.query('DROP TRIGGER reject_due_period_audit ON audit_log');
  }
});

it.each(['pair', 'audit', 'read'] as const)(
  'rejects session expiry after the %s wait',
  async (target) => {
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      if (target === 'pair')
        await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
          'barghsa.service_due_periods',
          'manual',
        ]);
      else if (target === 'audit') await blocker.query('LOCK TABLE audit_log IN SHARE MODE');
      else await blocker.query('LOCK TABLE service_due_periods IN ACCESS EXCLUSIVE MODE');
      await http.pool.query(
        "UPDATE sessions SET expires_at=NOW()+INTERVAL '2 seconds' WHERE user_id='due-admin-a'"
      );
      pending = request(target === 'read' ? undefined : initial);
      const pattern =
        target === 'pair'
          ? '%SELECT pg_advisory_xact_lock%'
          : target === 'audit'
            ? '%INSERT INTO audit_log%'
            : '%WITH instant AS MATERIALIZED%';
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
                "SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE user_id='due-admin-a'"
              )
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(401);
      expect(await counts()).toEqual({ periods: 0, audits: 0 });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);
