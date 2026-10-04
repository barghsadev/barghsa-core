import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const teamId = randomUUID(),
  fallbackId = randomUUID();
let profileId: string, productId: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['customer', 'alpha', 'beta', 'ineligible']) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,$3,$4)',
      [user, `${user}@routing.test`, 'test-only', user !== 'customer']
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',$5)`,
      [session, user, csrf, randomUUID(), user === 'customer' ? 'customer' : 'staff']
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (user !== 'customer') {
      await http.pool.query(
        'INSERT INTO staff_roles(role_id,name,description,permissions) VALUES($1,$1,$1,$2::jsonb)',
        [
          user,
          JSON.stringify(
            user === 'ineligible'
              ? ['crm:verify', 'verification:read']
              : ['orders:read', 'orders:write']
          ),
        ]
      );
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$1)', [user]);
    }
  }
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('customer','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  productId = (
    await http.pool.query(
      "SELECT id FROM products WHERE system_key='electricity_generation_station'"
    )
  ).rows[0].id;
  await http.pool.query("INSERT INTO staff_teams(id,name) VALUES($1,'Primary'),($2,'Fallback')", [
    teamId,
    fallbackId,
  ]);
  for (const user of ['alpha', 'beta', 'ineligible'])
    await http.pool.query('INSERT INTO staff_team_members(team_id,user_id) VALUES($1,$2)', [
      teamId,
      user,
    ]);
  await http.pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES($1,'beta')", [
    fallbackId,
  ]);
}, 40000);
beforeEach(async () => {
  await http.pool
    .query(`DELETE FROM rate_limit_counters; DELETE FROM rate_limit_windows WHERE NOT security;
    DELETE FROM consultation_request_events; DELETE FROM consultation_requests;
    DELETE FROM tickets; DELETE FROM verification_cases; DELETE FROM in_app_notifications;
    DELETE FROM audit_log; DELETE FROM staff_assignment_cursors;
    DELETE FROM app_config WHERE key='admin.staff_assignment_rules';
    UPDATE staff_teams SET is_active=true,skill_tags='[]';
    UPDATE users SET disabled_at=NULL,activation_token=NULL,is_admin=false;
    UPDATE sessions SET operating_context=CASE WHEN user_id='customer' THEN 'customer' ELSE 'staff' END;
    UPDATE staff_roles SET permissions='["orders:read","orders:write"]' WHERE role_id IN ('alpha','beta');`);
  await http.pool.query(
    "INSERT INTO staff_teams(id,name) VALUES($1,'Primary'),($2,'Fallback') ON CONFLICT(id) DO NOTHING",
    [teamId, fallbackId]
  );
  for (const user of ['alpha', 'beta', 'ineligible'])
    await http.pool.query(
      'INSERT INTO staff_team_members(team_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [teamId, user]
    );
  await http.pool.query(
    "INSERT INTO staff_team_members(team_id,user_id) VALUES($1,'beta') ON CONFLICT DO NOTHING",
    [fallbackId]
  );
});
afterAll(async () => {
  await http?.close();
}, 15000);
async function rule(strategy: string, extra: Record<string, unknown> = {}) {
  await http.pool.query(
    `INSERT INTO app_config(key,value,version) VALUES('admin.staff_assignment_rules',$1::jsonb,7)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=7`,
    [JSON.stringify({ consultation: { teamId, strategy, ...extra } })]
  );
}
function submit(key = randomUUID(), id = productId, user = 'customer') {
  return fetch(`${http.base}/api/consultations/requests`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify({ profileId, productId: id, submissionKey: key }),
  });
}
async function created(key = randomUUID()) {
  const response = await submit(key);
  expect(response.status, http.logs()).toBe(201);
  return (await response.json()) as { requestId: string; status: string };
}
async function owner(id: string) {
  return (
    await http.pool.query(
      'SELECT staff_owner_id,staff_team,status,invoice_id,fee FROM consultation_requests WHERE id=$1',
      [id]
    )
  ).rows[0];
}

it('routes each new request once, preserves simultaneous replay, and exposes the assigned work to both contexts', async () => {
  await rule('round_robin');
  const key = randomUUID();
  const [first, replay] = await Promise.all([created(key), created(key)]);
  expect(replay).toEqual(first);
  expect(await owner(first.requestId)).toEqual({
    staff_owner_id: 'alpha',
    staff_team: 'Primary',
    status: 'submitted',
    invoice_id: null,
    fee: null,
  });
  const second = await created();
  expect((await owner(second.requestId)).staff_owner_id).toBe('beta');
  expect((await owner((await created()).requestId)).staff_owner_id).toBe('alpha');
  const assignmentAudit = (
    await http.pool.query(
      "SELECT metadata::jsonb FROM audit_log WHERE event='work_auto_assigned' AND metadata::jsonb->>'itemId'=$1",
      [first.requestId]
    )
  ).rows;
  expect(assignmentAudit).toHaveLength(1);
  expect(assignmentAudit[0].metadata).toMatchObject({
    workType: 'consultation',
    itemId: first.requestId,
    userId: 'alpha',
    teamId,
    strategy: 'round_robin',
    configVersion: 7,
    priorityIndex: 0,
  });
  const notification = (
    await http.pool.query(
      'SELECT recipient_user_id AS user_id,operating_context,link_route AS link FROM in_app_notifications WHERE link_route=$1',
      [`/admin/consultations?requestId=${first.requestId}`]
    )
  ).rows;
  expect(notification).toEqual([
    {
      user_id: 'alpha',
      operating_context: 'staff',
      link: `/admin/consultations?requestId=${first.requestId}`,
    },
  ]);
  const detail = await fetch(`${http.base}/api/consultations/requests/${first.requestId}`, {
    headers: headers.customer!,
  });
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    request: {
      staff_owner_id: 'alpha',
      staff_owner_username: 'alpha@routing.test',
      staff_team: 'Primary',
    },
    history: [{ status: 'submitted' }],
  });
  const mine = await fetch(`${http.base}/api/admin/consultations/requests?assignment=mine`, {
    headers: headers.alpha!,
  });
  expect(mine.status, http.logs()).toBe(200);
  const requests = ((await mine.json()) as { requests: { id: string }[] }).requests;
  expect(requests.map((item) => item.id)).toContain(first.requestId);
  expect(requests.map((item) => item.id)).not.toContain(second.requestId);
  const unassigned = await fetch(
    `${http.base}/api/admin/consultations/requests?assignment=unassigned`,
    { headers: headers.alpha! }
  );
  expect(await unassigned.json()).toMatchObject({ requests: [] });
});

it('balances all open work and ignores completed consultations', async () => {
  const existing = await created();
  await http.pool.query("UPDATE consultation_requests SET staff_owner_id='alpha' WHERE id=$1", [
    existing.requestId,
  ]);
  await rule('load');
  expect((await owner((await created()).requestId)).staff_owner_id).toBe('beta');
  await http.pool.query(
    "UPDATE consultation_requests SET status='completed' WHERE staff_owner_id='alpha'"
  );
  expect((await owner((await created()).requestId)).staff_owner_id).toBe('alpha');
  await http.pool.query(
    "INSERT INTO tickets(id,user_id,subject,body,assigned_to,status) VALUES($1,'customer','Open work','Details','alpha','open')",
    [randomUUID()]
  );
  await http.pool.query(
    "INSERT INTO verification_cases(id,profile_id,field_name,requested_value,reason,created_by,assigned_to) VALUES($1,$2,'first_name','Value','Correction','customer','alpha')",
    [randomUUID(), profileId]
  );
  expect((await owner((await created()).requestId)).staff_owner_id).toBe('beta');
});

it('uses expertise and ordered fallbacks only when current members can read and handle consultations', async () => {
  await rule('expertise', { fallbacks: [{ teamId: fallbackId, strategy: 'expertise' }] });
  await http.pool.query(
    'UPDATE staff_teams SET skill_tags=\'["electricity_generation_station"]\' WHERE id=$1',
    [fallbackId]
  );
  const fallback = await created();
  expect(await owner(fallback.requestId)).toMatchObject({
    staff_owner_id: 'beta',
    staff_team: 'Fallback',
  });
  expect(
    (
      await http.pool.query(
        "SELECT metadata::jsonb FROM audit_log WHERE event='work_auto_assigned'"
      )
    ).rows[0].metadata
  ).toMatchObject({ priorityIndex: 1, strategy: 'expertise', teamId: fallbackId });
  await http.pool.query(
    "UPDATE staff_roles SET permissions='[\"orders:write\"]' WHERE role_id='beta'"
  );
  const manual = await created();
  expect(await owner(manual.requestId)).toMatchObject({
    staff_owner_id: null,
    staff_team: null,
    status: 'submitted',
  });
  // Existing manual assignment remains available after automatic fallback exhausts.
  const assigned = await fetch(
    `${http.base}/api/admin/consultations/requests/${manual.requestId}/assign`,
    { method: 'POST', headers: headers.alpha!, body: JSON.stringify({ assignTo: 'self' }) }
  );
  expect(assigned.status, http.logs()).toBe(200);
  expect(await assigned.json()).toMatchObject({ staffOwnerId: 'alpha', status: 'under_review' });
});

it.each(['disabled', 'pending', 'inactive'] as const)(
  'keeps a manual queue when the configured team is unavailable (%s)',
  async (state) => {
    await rule('round_robin');
    if (state === 'inactive') await http.pool.query('UPDATE staff_teams SET is_active=false');
    else if (state === 'disabled')
      await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id IN ('alpha','beta')");
    else
      await http.pool.query(
        "UPDATE users SET activation_token='pending' WHERE user_id IN ('alpha','beta')"
      );
    const request = await created();
    expect(await owner(request.requestId)).toMatchObject({
      staff_owner_id: null,
      staff_team: null,
    });
    expect((await http.pool.query('SELECT * FROM staff_assignment_cursors')).rows).toEqual([]);
  }
);

it('rolls back routing on invalid product submission and rejects foreign profile access', async () => {
  await rule('round_robin');
  expect((await submit(randomUUID(), randomUUID())).status).toBe(400);
  await http.pool.query("UPDATE sessions SET operating_context='customer' WHERE user_id='alpha'");
  expect((await submit(randomUUID(), productId, 'alpha')).status).toBe(404);
  expect(
    (await http.pool.query("SELECT * FROM audit_log WHERE event='work_auto_assigned'")).rows
  ).toEqual([]);
  expect((await http.pool.query('SELECT * FROM staff_assignment_cursors')).rows).toEqual([]);
  expect((await http.pool.query('SELECT * FROM in_app_notifications')).rows).toEqual([]);
  expect((await owner((await created()).requestId)).staff_owner_id).toBe('alpha');
});

it('uses committed role revocation when a routing decision waits on the role', async () => {
  await rule('round_robin');
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='beta'");
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query(
      'UPDATE staff_roles SET permissions=\'["verification:read","crm:verify"]\' WHERE role_id=\'alpha\''
    );
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = submit();
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
              [pid]
            )
          ).rows.length,
        { timeout: 5000, interval: 20 }
      )
      .toBeGreaterThan(0);
    await blocker.query('COMMIT');
    const response = await pending;
    expect(response.status, http.logs()).toBe(201);
    expect(await owner(((await response.json()) as { requestId: string }).requestId)).toMatchObject(
      { staff_owner_id: null, staff_team: null }
    );
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});

it.each(['rules', 'team', 'delete', 'manual'] as const)(
  'routes alongside an eligible admin changing %s without holding its account before routing/team locks',
  async (change) => {
    const existing = await created();
    await rule('round_robin');
    await http.pool.query("UPDATE users SET is_admin=true WHERE user_id='alpha'");
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW(),otp_step_up_verified_at=NOW() WHERE user_id='alpha'"
    );
    const blocker = await http.pool.connect(),
      probe = await http.pool.connect();
    let creation: Promise<Response> | undefined, mutation: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [
        'admin.staff_assignment_rules',
      ]);
      await blocker.query('SELECT id FROM staff_teams WHERE id=$1 FOR UPDATE', [teamId]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      creation = submit();
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows.length,
          { timeout: 5000, interval: 20 }
        )
        .toBeGreaterThan(0);
      const creatorPid = (
        await http.pool.query(
          'SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
          [pid]
        )
      ).rows[0].pid;
      const path =
        change === 'rules'
          ? '/api/admin/config/assignment-rules'
          : change === 'manual'
            ? `/api/admin/consultations/requests/${existing.requestId}/assign`
            : `/api/admin/staff-teams/${teamId}`;
      const body =
        change === 'rules'
          ? { consultation: { teamId: null, strategy: 'load' } }
          : change === 'manual'
            ? { assignTo: 'team', team: 'Primary' }
            : { description: 'Updated while routing' };
      mutation = fetch(`${http.base}${path}`, {
        method: change === 'manual' ? 'POST' : change === 'delete' ? 'DELETE' : 'PUT',
        headers: headers.alpha!,
        ...(change === 'delete' ? {} : { body: JSON.stringify(body) }),
      });
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) OR $2::int=ANY(pg_blocking_pids(pid))',
                [pid, creatorPid]
              )
            ).rows.length,
          { timeout: 5000, interval: 20 }
        )
        .toBeGreaterThan(1);
      // A writer blocked on routing/team ownership must leave candidate accounts
      // available. The old account-first order fails this independent probe.
      await probe.query('BEGIN');
      await probe.query("SELECT user_id FROM users WHERE user_id='alpha' FOR UPDATE NOWAIT");
      await probe.query('COMMIT');
      await blocker.query('COMMIT');
      const [createdResponse, changed] = await Promise.all([creation, mutation]);
      expect([createdResponse.status, changed.status], http.logs()).toEqual([201, 200]);
      expect(
        await owner(((await createdResponse.json()) as { requestId: string }).requestId)
      ).toMatchObject({ staff_owner_id: 'alpha', staff_team: 'Primary', status: 'submitted' });
    } finally {
      await probe.query('ROLLBACK');
      probe.release();
      await blocker.query('ROLLBACK');
      blocker.release();
      await Promise.allSettled([creation, mutation].filter(Boolean));
    }
  }
);
