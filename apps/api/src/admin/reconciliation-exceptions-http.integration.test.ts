import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-reconciliation','Jobs','Test role','["admin:reconciliation:view","admin:reconciliation:resolve"]'),('test-reconciliation-view','View jobs','Test role','["admin:reconciliation:view"]')`
  );
  for (const [user, role] of [
    ['operator', 'test-reconciliation'],
    ['viewer', 'test-reconciliation-view'],
    ['other', null],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [user, `${user}@example.test`]
    );
    if (role)
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [user, role]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM reconciliation_exceptions');
  await http.pool.query(
    "DELETE FROM audit_log WHERE event IN ('reconciliation_status_changed','resolution_recorded')"
  );
});
function request(path = '', method = 'GET', body?: unknown, user = 'operator') {
  return fetch(`${http.base}/api/admin/reconciliation/items${path}`, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function seed() {
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO reconciliation_exceptions(id,exception_type,severity,description) VALUES ($1,'wallet_mismatch','high','Local test mismatch')",
    [id]
  );
  return id;
}
async function row(id: string) {
  return (await http.pool.query('SELECT * FROM reconciliation_exceptions WHERE id=$1', [id]))
    .rows[0];
}
it('enforces view and mutation permissions and records the full lifecycle without overwriting resolution', async () => {
  expect((await fetch(`${http.base}/api/admin/reconciliation/items`)).status).toBe(401);
  expect((await request('', 'GET', undefined, 'other')).status).toBe(403);
  const id = await seed();
  expect((await request(`/${id}/resolve`, 'POST', { note: 'Resolved' }, 'viewer')).status).toBe(
    403
  );
  expect((await request('?status=open&severity=high', 'GET', undefined, 'viewer')).status).toBe(
    200
  );
  expect((await request(`/${id}/investigate`, 'POST', {})).status).toBe(200);
  expect((await row(id)).assigned_to_id).toBe('operator');
  expect((await request(`/${id}/resolve`, 'POST', { note: ' ' })).status).toBe(400);
  expect((await request(`/${id}/resolve`, 'POST', { note: 'Original resolution' })).status).toBe(
    200
  );
  expect((await request(`/${id}/close`, 'POST', { note: 'Closure checked' })).status).toBe(200);
  expect(await row(id)).toMatchObject({
    status: 'closed',
    resolution_note: 'Original resolution',
    resolved_by_id: 'operator',
  });
  expect((await request(`/${id}/resolve`, 'POST', { note: 'Repeat' })).status).toBe(409);
  const audit = await http.pool.query(
    "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event IN ('reconciliation_status_changed','resolution_recorded') ORDER BY created_at"
  );
  expect(audit.rows).toHaveLength(3);
  expect(audit.rows[2].metadata.resolutionNote).toBe('Closure checked');
});
it('commits one competing resolution and rolls back a failed audit', async () => {
  const id = await seed();
  const responses = await Promise.all([
    request(`/${id}/resolve`, 'POST', { note: 'First' }),
    request(`/${id}/resolve`, 'POST', { note: 'Second' }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const next = await seed();
  await http.pool.query(
    "CREATE FUNCTION reject_reconciliation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test reconciliation audit failure'; END $$; CREATE TRIGGER reject_reconciliation_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='resolution_recorded') EXECUTE FUNCTION reject_reconciliation_audit()"
  );
  try {
    expect((await request(`/${next}/resolve`, 'POST', { note: 'Fail audit' })).status).toBe(500);
    expect(await row(next)).toMatchObject({
      status: 'open',
      resolution_note: null,
      resolved_by_id: null,
    });
  } finally {
    await http.pool.query('DROP TRIGGER reject_reconciliation_audit ON audit_log');
  }
});
it.each(['investigate', 'resolve', 'close'])(
  'rejects revoked authority during %s and releases its transaction',
  async (action) => {
    const id = await seed();
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
      pending = request(`/${id}/${action}`, 'POST', { note: 'Reviewed' });
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%' "
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query("DELETE FROM user_roles WHERE user_id='operator'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(await row(id)).toMatchObject({
        status: 'open',
        assigned_to_id: null,
        resolved_by_id: null,
      });
      expect(
        (
          await http.pool.query(
            "SELECT id FROM audit_log WHERE event IN ('reconciliation_status_changed','resolution_recorded')"
          )
        ).rows
      ).toHaveLength(0);
      expect(
        (
          await http.pool.query(
            "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-reconciliation') ON CONFLICT DO NOTHING"
      );
    }
  }
);
