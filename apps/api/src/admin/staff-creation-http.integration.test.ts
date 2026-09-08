import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);

async function actor() {
  const userId = randomUUID(),
    sessionId = randomUUID(),
    csrfToken = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$2,'test-only',true)",
    [userId, `${userId}@example.test`]
  );
  const result = await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline,step_up_verified_at)
     VALUES ($1,$2,$3,clock_timestamp()+INTERVAL '1 day',clock_timestamp()+INTERVAL '30 minutes',clock_timestamp())
     RETURNING step_up_verified_at`,
    [sessionId, userId, csrfToken]
  );
  return {
    userId,
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

function staff(activationMethod: 'link' | 'tempPassword' = 'tempPassword') {
  return {
    username: `${randomUUID()}@example.test`,
    firstName: 'New',
    lastName: 'Staff',
    roleIds: ['role-finance', 'role-finance'],
    activationMethod,
  };
}

async function create(current: Awaited<ReturnType<typeof actor>>, input: ReturnType<typeof staff>) {
  return fetch(`${http.base}/api/admin/users/create-staff`, {
    method: 'POST',
    headers: current.headers,
    body: JSON.stringify(input),
  });
}

async function noCreation(current: Awaited<ReturnType<typeof actor>>, username: string) {
  expect(
    (await http.pool.query('SELECT user_id FROM users WHERE username=$1', [username])).rows
  ).toEqual([]);
  expect(
    (
      await http.pool.query(
        'SELECT destination FROM account_login_identifiers WHERE destination=$1',
        [username]
      )
    ).rows
  ).toEqual([]);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE user_id=$1 AND event='staff_user_created'",
        [current.userId]
      )
    ).rows
  ).toEqual([]);
}

async function creationCounts() {
  return (
    await http.pool.query(`SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM profiles) AS profiles,
    (SELECT COUNT(*) FROM user_roles) AS roles,
    (SELECT COUNT(*) FROM auth_delivery_outbox) AS deliveries,
    (SELECT COUNT(*) FROM account_login_identifiers) AS identifiers,
    (SELECT COUNT(*) FROM audit_log WHERE event='staff_user_created') AS audits`)
  ).rows[0];
}

it.each(['missing', 'expired', 'future'] as const)(
  'staff creation rejects %s step-up',
  async (mode) => {
    const current = await actor(),
      input = staff();
    await http.pool.query('UPDATE sessions SET step_up_verified_at=$1 WHERE session_id=$2', [
      mode === 'missing' ? null : new Date(Date.now() + (mode === 'future' ? 60000 : -16 * 60000)),
      current.sessionId,
    ]);
    const before = await creationCounts();
    const response = await create(current, input);
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTHZ:STEP_UP_REQUIRED' },
      requiresStepUp: true,
    });
    await noCreation(current, input.username);
    expect(await creationCounts()).toEqual(before);
  }
);

it.each(['link', 'tempPassword'] as const)(
  'staff creation commits its verified actor and %s result together',
  async (method) => {
    const current = await actor(),
      input = staff(method);
    const response = await create(current, input);
    expect(response.status, await response.clone().text()).toBe(201);
    const body = (await response.json()) as {
      userId: string;
      temporaryPassword?: string;
      activationToken?: string;
      deliveryStatus?: string;
    };
    expect(body.activationToken).toBeUndefined();
    if (method === 'tempPassword') expect(body.temporaryPassword).toEqual(expect.any(String));
    else {
      expect(body.temporaryPassword).toBeUndefined();
      expect(body.deliveryStatus).toBe('queued');
    }
    expect(
      (
        await http.pool.query('SELECT profile_type,status FROM profiles WHERE user_id=$1', [
          body.userId,
        ])
      ).rows
    ).toEqual([{ profile_type: 'INDIVIDUAL', status: 'VERIFIED' }]);
    expect(
      (await http.pool.query('SELECT role_id FROM user_roles WHERE user_id=$1', [body.userId])).rows
    ).toEqual([{ role_id: 'role-finance' }]);
    expect(
      (await http.pool.query('SELECT id FROM auth_delivery_outbox WHERE user_id=$1', [body.userId]))
        .rows
    ).toHaveLength(method === 'link' ? 1 : 0);
    const audit = (
      await http.pool.query(
        "SELECT metadata,correlation_id FROM audit_log WHERE user_id=$1 AND event='staff_user_created'",
        [current.userId]
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].metadata)).toMatchObject({
      targetUserId: body.userId,
      stepUpVerified: true,
      stepUpVerifiedAt: current.verifiedAt,
      roleIds: ['role-finance'],
    });
    expect(audit[0].correlation_id).toBe(response.headers.get('x-correlation-id'));
    expect(audit[0].correlation_id).toBe(current.headers['X-Correlation-ID']);
  }
);

it.each(['step-up expiry', 'session expiry', 'audit failure'] as const)(
  'staff creation rolls back on %s during persistence',
  async (mode) => {
    const current = await actor(),
      input = staff('link');
    await http.pool.query(`CREATE SEQUENCE staff_create_audit_reached;
    CREATE FUNCTION delay_staff_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='staff_user_created' THEN
      PERFORM nextval('staff_create_audit_reached');
      ${mode === 'audit failure' ? "RAISE EXCEPTION 'controlled audit failure';" : 'PERFORM pg_sleep(2.2);'}
    END IF; RETURN NEW; END $$;
    CREATE TRIGGER delay_staff_create_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_staff_create_audit()`);
    try {
      if (mode === 'step-up expiry')
        await http.pool.query(
          "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '2 seconds' WHERE session_id=$1",
          [current.sessionId]
        );
      if (mode === 'session expiry')
        await http.pool.query(
          "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
          [current.sessionId]
        );
      const before = await creationCounts();
      const response = await create(current, input);
      expect(response.status, await response.clone().text()).toBe(
        mode === 'audit failure' ? 500 : mode === 'step-up expiry' ? 403 : 401
      );
      expect(await response.text()).not.toContain('temporaryPassword');
      expect(
        (await http.pool.query('SELECT is_called FROM staff_create_audit_reached')).rows[0]
          .is_called
      ).toBe(true);
      await noCreation(current, input.username);
      expect(await creationCounts()).toEqual(before);
    } finally {
      await http.pool.query(
        'DROP TRIGGER delay_staff_create_audit ON audit_log; DROP FUNCTION delay_staff_create_audit(); DROP SEQUENCE staff_create_audit_reached'
      );
    }
  },
  15000
);
