import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

type Operation = 'roles' | 'disable' | 'activation';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);

async function session(userId: string) {
  const sessionId = randomUUID(),
    csrfToken = randomUUID(),
    familyId = randomUUID();
  const result = await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,$2,$3,$4,clock_timestamp()+INTERVAL '1 day',clock_timestamp()+INTERVAL '30 minutes',clock_timestamp()) RETURNING step_up_verified_at`,
    [sessionId, userId, csrfToken, familyId]
  );
  await http.pool.query(
    'INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), familyId, randomUUID(), userId, sessionId]
  );
  return {
    sessionId,
    verifiedAt: result.rows[0].step_up_verified_at.toISOString(),
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/json',
      'X-Correlation-ID': randomUUID(),
    },
  };
}

async function scenario(operation: Operation, self = false) {
  const actorId = randomUUID(),
    targetId = self ? actorId : randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'fixture-only',true)",
    [actorId, `${actorId}@example.test`]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-admin')", [
    actorId,
  ]);
  if (!self) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash,is_staff,must_change_password,activation_token,activation_token_expires_at)
      VALUES ($1,$2,'fixture-only',true,$3,$4,CASE WHEN $3 THEN clock_timestamp()+INTERVAL '1 day' ELSE NULL END)`,
      [
        targetId,
        `${targetId}@example.test`,
        operation === 'activation',
        operation === 'activation' ? 'old-activation-hash' : null,
      ]
    );
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-customer-support')",
      [targetId]
    );
    await session(targetId);
  }
  const actor = await session(actorId);
  return {
    actorId,
    targetId,
    actor,
    operation,
    event:
      operation === 'roles'
        ? 'role_change'
        : operation === 'disable'
          ? 'staff_user_disabled'
          : 'staff_activation_reissued',
  };
}
type Scenario = Awaited<ReturnType<typeof scenario>>;

function perform(s: Scenario) {
  const path =
    s.operation === 'roles'
      ? `/api/admin/users/${s.targetId}/roles`
      : s.operation === 'disable'
        ? `/api/admin/staff/${s.targetId}/disable`
        : `/api/admin/users/${s.targetId}/resend-activation`;
  return fetch(http.base + path, {
    method: s.operation === 'roles' ? 'PUT' : 'POST',
    headers: s.actor.headers,
    body: JSON.stringify(
      s.operation === 'roles' ? { roleIds: ['role-finance'], reason: 'New finance duties' } : {}
    ),
  });
}

async function snapshot(s: Scenario) {
  const ids = [...new Set([s.actorId, s.targetId])];
  return {
    users: (
      await http.pool.query(
        'SELECT user_id,disabled_at,activation_token,activation_token_expires_at FROM users WHERE user_id=ANY($1::text[]) ORDER BY user_id',
        [ids]
      )
    ).rows,
    roles: (
      await http.pool.query(
        'SELECT user_id,role_id FROM user_roles WHERE user_id=ANY($1::text[]) ORDER BY user_id,role_id',
        [ids]
      )
    ).rows,
    sessions: (
      await http.pool.query(
        'SELECT session_id,revoked_at FROM sessions WHERE user_id=ANY($1::text[]) ORDER BY session_id',
        [ids]
      )
    ).rows,
    refresh: (
      await http.pool.query(
        'SELECT id,consumed_at FROM refresh_tokens WHERE user_id=ANY($1::text[]) ORDER BY id',
        [ids]
      )
    ).rows,
    outbox: (
      await http.pool.query(
        'SELECT id,code_hash FROM auth_delivery_outbox WHERE user_id=$1 ORDER BY id',
        [s.targetId]
      )
    ).rows,
    audit: (
      await http.pool.query('SELECT id FROM audit_log WHERE user_id=ANY($1::text[]) ORDER BY id', [
        ids,
      ])
    ).rows,
  };
}

async function auditBoundary(
  s: Scenario,
  mode: 'step-up expiry' | 'session expiry' | 'audit failure'
) {
  await http.pool.query(`CREATE SEQUENCE staff_sensitive_audit_reached;
    CREATE FUNCTION delay_staff_sensitive_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='${s.event}' THEN
      PERFORM nextval('staff_sensitive_audit_reached');
      ${mode === 'audit failure' ? "RAISE EXCEPTION 'controlled sensitive audit failure';" : 'PERFORM pg_sleep(2.2);'}
    END IF; RETURN NEW; END $$;
    CREATE TRIGGER delay_staff_sensitive_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_staff_sensitive_audit()`);
  try {
    if (mode === 'step-up expiry')
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '2 seconds' WHERE session_id=$1",
        [s.actor.sessionId]
      );
    if (mode === 'session expiry')
      await http.pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
        [s.actor.sessionId]
      );
    const before = await snapshot(s);
    const response = await perform(s);
    expect(
      (await http.pool.query('SELECT is_called FROM staff_sensitive_audit_reached')).rows[0]
        .is_called
    ).toBe(true);
    expect(response.status, await response.clone().text()).toBe(
      mode === 'audit failure' ? 500 : mode === 'step-up expiry' ? 403 : 401
    );
    expect(await snapshot(s)).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER delay_staff_sensitive_audit ON audit_log; DROP FUNCTION delay_staff_sensitive_audit(); DROP SEQUENCE staff_sensitive_audit_reached'
    );
  }
}

for (const operation of ['roles', 'disable', 'activation'] as const) {
  it(`${operation} binds the audit to current verification and request correlation`, async () => {
    const s = await scenario(operation),
      before = await snapshot(s),
      response = await perform(s);
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = (
      await http.pool.query(
        'SELECT user_id,metadata,correlation_id FROM audit_log WHERE event=$1 AND user_id=$2',
        [s.event, operation === 'disable' ? s.targetId : s.actorId]
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].metadata)).toMatchObject({
      stepUpVerified: true,
      stepUpVerifiedAt: s.actor.verifiedAt,
    });
    expect(rows[0].correlation_id).toBe(s.actor.headers['X-Correlation-ID']);
    expect(rows[0].correlation_id).toBe(response.headers.get('x-correlation-id'));
    const after = await snapshot(s);
    if (operation === 'activation') {
      expect(after.outbox).toHaveLength(1);
      expect(after.users.find((u) => u.user_id === s.targetId).activation_token).not.toBe(
        'old-activation-hash'
      );
      expect(after.sessions).toEqual(before.sessions);
      expect(after.refresh).toEqual(before.refresh);
    } else {
      const targetSession = before.sessions.find((r) => r.session_id !== s.actor.sessionId);
      expect(
        after.sessions.find((r) => r.session_id === targetSession.session_id).revoked_at
      ).not.toBeNull();
      expect(after.sessions.find((r) => r.session_id === s.actor.sessionId).revoked_at).toBeNull();
      if (operation === 'roles')
        expect(after.roles.filter((r) => r.user_id === s.targetId)).toEqual([
          { user_id: s.targetId, role_id: 'role-finance' },
        ]);
      else expect(after.users.find((r) => r.user_id === s.targetId).disabled_at).not.toBeNull();
    }
  });
  for (const mode of ['step-up expiry', 'session expiry', 'audit failure'] as const) {
    it(
      `${operation} rolls back on ${mode} during persistence`,
      async () => auditBoundary(await scenario(operation), mode),
      15000
    );
  }
}

it('a valid self role change commits its intended sign-out', async () => {
  const s = await scenario('roles', true),
    response = await perform(s);
  expect(response.status, await response.clone().text()).toBe(200);
  expect((await fetch(`${http.base}/api/auth/sessions`, { headers: s.actor.headers })).status).toBe(
    401
  );
  const after = await snapshot(s);
  expect(after.roles).toEqual([{ user_id: s.actorId, role_id: 'role-finance' }]);
  expect(after.sessions[0].revoked_at).not.toBeNull();
  expect(after.refresh[0].consumed_at).not.toBeNull();
});
it(
  'self role changes still roll back when step-up expires before commit',
  async () => auditBoundary(await scenario('roles', true), 'step-up expiry'),
  15000
);
it('self disablement retains its explicit rejection and credentials', async () => {
  const s = await scenario('disable', true),
    before = await snapshot(s),
    response = await perform(s);
  expect(response.status).toBe(400);
  expect(await snapshot(s)).toEqual(before);
});
