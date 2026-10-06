import { AuditWindow } from '../test/audit-window.js';
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { decryptAuthDelivery } from '@barghsa/shared/auth-delivery';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let session: string, csrf: string, headers: Record<string, string>;
const password = 'Sensitive-action-fixture-password-123!';
beforeAll(async () => {
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_KEY', 'otp-step-up-fixture-only');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  const argon = await import('argon2');
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_admin)
    VALUES('otp-gate-admin','otp-gate@example.test',$1,true),('otp-gate-other','otp-gate-other@example.test',$1,true),
    ('otp-gate-target','otp-gate-target@example.test',$1,false)`,
    [await argon.hash(password)]
  );
}, 40000);
beforeEach(async () => {
  session = randomUUID();
  csrf = randomUUID();
  await auditWindow.excludeExisting('', []);
  await http.pool.query(
    'DELETE FROM auth_delivery_outbox; DELETE FROM otp_challenges; DELETE FROM refresh_tokens; DELETE FROM sessions;  DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows;'
  );
  await http.pool
    .query(`UPDATE users SET disabled_at=NULL,auth_version=1 WHERE user_id LIKE 'otp-gate-%';
    DELETE FROM user_roles WHERE user_id='otp-gate-target';`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,'otp-gate-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
});
afterAll(async () => {
  await http?.close();
  vi.unstubAllEnvs();
}, 15000);
function request(path: string, body: unknown = {}, auth = headers, method = 'POST') {
  return fetch(http.base + '/api/' + path, {
    method,
    headers: auth,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
}
async function send() {
  const response = await request('auth/step-up/otp/send');
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as {
    challengeId: string;
    expiresAt: string;
    channel: string;
  };
  const row = (
    await http.pool.query(
      'SELECT id,encrypted_payload FROM auth_delivery_outbox WHERE challenge_id=$1',
      [body.challengeId]
    )
  ).rows[0];
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'http-fixture-delivery-key-only');
  const delivery = decryptAuthDelivery(row.id, row.encrypted_payload);
  if (
    !delivery ||
    typeof delivery !== 'object' ||
    !('code' in delivery) ||
    typeof delivery.code !== 'string'
  )
    throw new Error('Invalid fixture delivery');
  const code = delivery.code;
  expect(JSON.stringify(body)).not.toContain(code);
  expect(JSON.stringify(body)).not.toContain('otp-gate@example.test');
  expect(body.channel).toBe('email');
  return { ...body, code };
}
async function verify(challenge: { challengeId: string; code: string }, auth = headers) {
  return request(
    'auth/step-up/otp/verify',
    { challengeId: challenge.challengeId, code: challenge.code },
    auth
  );
}
function rotated(response: Response) {
  const cookies = Object.fromEntries(
    response.headers
      .getSetCookie()
      .filter((value) => value.split(';')[0]!.split('=')[1])
      .map((value) => value.split(';')[0]!.split('='))
  );
  return {
    Cookie: Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; '),
    'X-CSRF-Token': cookies.barghsa_csrf!,
    'Content-Type': 'application/json',
  };
}
it('requires authentication, CSRF and strict input without creating deliveries', async () => {
  expect((await request('auth/step-up/otp/send', {}, {})).status).toBe(401);
  expect((await request('auth/step-up/otp/send', {}, { Cookie: headers.Cookie! })).status).toBe(
    403
  );
  expect(
    (await request('auth/step-up/otp/send', { destination: 'foreign@example.test' })).status
  ).toBe(400);
  expect(
    (await request('auth/step-up/otp/verify', { challengeId: randomUUID(), code: '123' })).status
  ).toBe(400);
  expect((await http.pool.query('SELECT id FROM auth_delivery_outbox')).rows).toEqual([]);
});
it('rejects fresh password proof for providers, thresholds and roles; OTP rotation permits each exact action', async () => {
  const actions = [
    [
      'admin/email-providers',
      {
        transport: 'resend',
        label: 'OTP verified provider',
        config: { api_key: 'fixture-only', from_email: 'sender@example.test' },
      },
      'POST',
    ],
    ['admin/config/dual-approval-threshold', { threshold_irr: 250000 }, 'PUT'],
    [
      'admin/users/otp-gate-target/roles',
      { roleIds: ['role-finance'], reason: 'Verified role change' },
      'PUT',
    ],
  ] as const;
  for (const [path, body, method] of actions) {
    const blocked = await request(path, body, headers, method);
    expect(blocked.status, await blocked.clone().text()).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } });
  }
  const c = await send(),
    response = await verify(c);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ verified: true });
  const fresh = rotated(response);
  expect(fresh['X-CSRF-Token']).toBeTruthy();
  expect(fresh['X-CSRF-Token']).not.toBe(csrf);
  for (const [path, body, method] of actions) {
    const saved = await request(path, body, fresh, method);
    expect(saved.ok, (await saved.clone().text()) + http.logs()).toBe(true);
  }
  expect((await request('auth/step-up/otp/send', {}, headers)).status).toBe(401);
  const proof = (
    await auditWindow.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='step_up_verified'"
    )
  ).rows;
  expect(proof).toHaveLength(1);
  expect(proof[0].metadata).toMatchObject({ method: 'otp', stepUpVerified: true });
  expect((await verify(c, fresh)).status).toBe(401);
});
it('binds a challenge to its session, account and purpose without consuming foreign proof', async () => {
  const c = await send();
  for (const user of ['otp-gate-admin', 'otp-gate-other']) {
    const sid = randomUUID(),
      token = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline)
      VALUES($1,$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [sid, user, token]
    );
    expect(
      (await verify(c, { ...headers, Cookie: `barghsa_session=${sid}`, 'X-CSRF-Token': token }))
        .status
    ).toBe(401);
  }
  await http.pool.query(
    "UPDATE otp_challenges SET purpose='login',step_up_session_id=NULL WHERE challenge_id=$1",
    [c.challengeId]
  );
  expect((await verify(c)).status).toBe(401);
  expect(
    (
      await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [
        c.challengeId,
      ])
    ).rows[0].consumed_at
  ).toBeNull();
});
it('persists failed attempts and exhausts the challenge even for a subsequently correct code', async () => {
  const c = await send();
  for (let i = 0; i < 5; i++)
    expect((await verify({ ...c, code: c.code === '111111' ? '222222' : '111111' })).status).toBe(
      401
    );
  expect(
    (
      await http.pool.query('SELECT attempts_remaining FROM otp_challenges WHERE challenge_id=$1', [
        c.challengeId,
      ])
    ).rows[0].attempts_remaining
  ).toBe(0);
  expect((await verify(c)).status).toBe(401);
  expect(
    (
      await http.pool.query('SELECT otp_step_up_verified_at FROM sessions WHERE session_id=$1', [
        session,
      ])
    ).rows[0].otp_step_up_verified_at
  ).toBeNull();
});
it('retains issuance rate limits and invalidates the old code when a new code is requested', async () => {
  const old = await send();
  expect((await request('auth/step-up/otp/send')).status).toBe(429);
  await http.pool.query(
    "SELECT rate_limit_rolling_reset(true,'otp:dest:otp-gate@example.test:60s')"
  );
  const next = await send();
  expect(next.challengeId).not.toBe(old.challengeId);
  expect((await verify(old)).status).toBe(409);
  expect((await verify(next)).status).toBe(200);
});
it('rejects expired challenges, changed credentials and revoked sessions without stamping proof', async () => {
  const c = await send();
  await http.pool.query(
    "UPDATE otp_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE challenge_id=$1",
    [c.challengeId]
  );
  expect((await verify(c)).status).toBe(401);
  await http.pool.query(
    "UPDATE otp_challenges SET expires_at=NOW()+INTERVAL '5 minutes' WHERE challenge_id=$1",
    [c.challengeId]
  );
  await http.pool.query(
    "UPDATE users SET password_hash='changed-fixture-only' WHERE user_id='otp-gate-admin'"
  );
  expect((await verify(c)).status).toBe(401);
  await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [session]);
  expect((await verify(c)).status).toBe(401);
});
it('consumes proof once during concurrent verification', async () => {
  const c = await send();
  const responses = await Promise.all([verify(c), verify(c)]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  expect(
    (await auditWindow.query("SELECT id FROM audit_log WHERE event='step_up_verified'")).rows
  ).toHaveLength(1);
});

it('rejects stale OTP proof even while password proof remains fresh', async () => {
  const response = await verify(await send());
  expect(response.status).toBe(200);
  const fresh = rotated(response);
  await http.pool.query(
    "UPDATE sessions SET otp_step_up_verified_at=clock_timestamp()-INTERVAL '16 minutes' WHERE revoked_at IS NULL"
  );
  expect(
    (await request('admin/config/dual-approval-threshold', { threshold_irr: 99 }, fresh, 'PUT'))
      .status
  ).toBe(403);
});

for (const expiry of ['session', 'challenge']) {
  it(`rolls back verification when ${expiry} expires during a challenge lock wait`, async () => {
    const c = await send();
    const deadline = (
      await http.pool.query(
        expiry === 'session'
          ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '3 seconds' WHERE session_id=$1 RETURNING expires_at"
          : "UPDATE otp_challenges SET expires_at=clock_timestamp()+INTERVAL '3 seconds' WHERE challenge_id=$1 RETURNING expires_at",
        [expiry === 'session' ? session : c.challengeId]
      )
    ).rows[0].expires_at;
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT challenge_id FROM otp_challenges WHERE challenge_id=$1 FOR UPDATE',
        [c.challengeId]
      );
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = verify(c);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows[0].count
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [
                deadline,
              ])
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(401);
      expect(
        (
          await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [
            c.challengeId,
          ])
        ).rows[0].consumed_at
      ).toBeNull();
      expect(
        (
          await http.pool.query(
            'SELECT revoked_at,otp_step_up_verified_at FROM sessions WHERE session_id=$1',
            [session]
          )
        ).rows[0]
      ).toEqual({ revoked_at: null, otp_step_up_verified_at: null });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }, 15000);
}
it('rolls back code consumption, credential rotation and proof when the audit fails', async () => {
  const c = await send();
  await http.pool
    .query(`CREATE FUNCTION reject_otp_step_up_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='step_up_verified' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_otp_step_up_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_otp_step_up_audit();`);
  try {
    expect((await verify(c)).status).toBe(500);
    expect(
      (
        await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [
          c.challengeId,
        ])
      ).rows[0].consumed_at
    ).toBeNull();
    expect(
      (
        await http.pool.query(
          'SELECT revoked_at,otp_step_up_verified_at FROM sessions WHERE session_id=$1',
          [session]
        )
      ).rows[0]
    ).toEqual({ revoked_at: null, otp_step_up_verified_at: null });
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_otp_step_up_audit ON audit_log; DROP FUNCTION reject_otp_step_up_audit()'
    );
  }
});

const auditWindow = new AuditWindow(() => http.pool);
