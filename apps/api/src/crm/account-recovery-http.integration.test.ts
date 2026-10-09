import { createServer, type Server } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { fetchWithPreauth } from '../test/public-auth.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>, storage: Server;
const objects = new Map<string, Buffer>(),
  headers: Record<string, Record<string, string>> = {};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
beforeAll(async () => {
  storage = createServer(async (req, res) => {
    const key = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname).replace(
      '/test-evidence/',
      ''
    );
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      objects.set(key, Buffer.concat(chunks));
      res.setHeader('ETag', '"fixture"');
      res.end();
      return;
    }
    const bytes = objects.get(key);
    if (!bytes) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', bytes.length);
    res.end(bytes);
  });
  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', resolve));
  const address = storage.address();
  if (!address || typeof address === 'string') throw new Error();
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, `http://127.0.0.1:${address.port}`);
  for (const actor of ['recovery-creator', 'recovery-reviewer', 'recovery-denied']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES($1,$2,'test-only',$3)",
      [actor, actor + '@example.test', actor !== 'recovery-denied']
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
      [session, actor, csrf, randomUUID()]
    );
    headers[actor] = {
      cookie: `barghsa_session=${session}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => storage.close(() => resolve()));
});
const post = (path: string, body: unknown = {}, actor = 'recovery-reviewer') =>
  fetch(http.base + '/api/crm/account-recovery' + path, {
    method: 'POST',
    headers: headers[actor]!,
    body: JSON.stringify(body),
  });
async function create() {
  const user = 'claimant-' + randomUUID(),
    oldLogin = user + '@example.test',
    newLogin = 'new-' + user + '@example.test';
  await http.pool.query(
    'INSERT INTO users(user_id,username,email,mobile,password_hash) VALUES($1,$2,$2,$3,$4)',
    [
      user,
      oldLogin,
      '+98912' + String(Math.floor(Math.random() * 10000000)).padStart(7, '0'),
      await argon2.hash('Old-recovery-password-123!'),
    ]
  );
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,first_name) VALUES($1,'INDIVIDUAL','VERIFIED','Claimant') RETURNING id",
      [user]
    )
  ).rows[0].id;
  const key = `uploads/document/${randomUUID()}.pdf`,
    bytes = Buffer.from('%PDF-1.7\nIdentity evidence\n%%EOF');
  objects.set(key, bytes);
  await http.pool.query(
    "INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name) VALUES($1,'active',$2::jsonb,$3,'application/pdf','document','identity.pdf')",
    [
      key,
      JSON.stringify({
        verified: true,
        uploadedBy: 'recovery-creator',
        profileId,
        purpose: 'verification_evidence',
      }),
      bytes.length,
    ]
  );
  const response = await post(
    '',
    {
      profileId,
      newLogin,
      supportReference: 'support-' + user,
      reason: 'Original identity and representative authority checked',
      evidenceKeys: [key],
    },
    'recovery-creator'
  );
  expect(response.status, http.logs()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return { id, user, oldLogin, newLogin, profileId };
}
async function approved() {
  const row = await create();
  expect(
    (
      await post('/' + row.id + '/review', {
        decision: 'approved',
        notes: 'Independent original-owner identity check',
      })
    ).status,
    http.logs()
  ).toBe(200);
  return row;
}
async function code(id: string) {
  const response = await post('/' + id + '/code');
  expect(response.status, http.logs()).toBe(200);
  const { challengeId } = (await response.json()) as { challengeId: string };
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$2 WHERE challenge_id=$1', [
    challengeId,
    digest('123456'),
  ]);
  return challengeId;
}
const verify = (caseId: string, challengeId: string, value = '123456') =>
  fetchWithPreauth(http.base + '/api/auth/recovery/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId, challengeId, code: value }),
  });
const read = (id: string, actor = 'recovery-reviewer') =>
  fetch(http.base + '/api/crm/account-recovery/' + id, { headers: headers[actor]! });
it('requires independent review, sealed evidence, current permissions and recent step-up', async () => {
  const row = await create();
  expect(
    (
      await post(
        '/' + row.id + '/review',
        { decision: 'approved', notes: 'Self review' },
        'recovery-creator'
      )
    ).status
  ).toBe(403);
  expect((await read(row.id, 'recovery-denied')).status).toBe(403);
  expect((await post('/' + row.id + '/apply')).status).toBe(409);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 hour' WHERE user_id='recovery-reviewer'"
  );
  expect(
    (await post('/' + row.id + '/review', { decision: 'approved', notes: 'Expired step-up' }))
      .status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='recovery-reviewer'"
  );
  expect(
    (
      await post('/' + row.id + '/review', {
        decision: 'approved',
        notes: 'Original-owner evidence checked',
      })
    ).status
  ).toBe(200);
  await http.pool.query(
    "INSERT INTO audit_log(id,user_id,event,metadata) VALUES($1,'recovery-creator','legacy-audit','not JSON')",
    [randomUUID()]
  );
  const detail = (await (await read(row.id)).json()) as { evidenceDownloadUrls: string[] };
  expect(detail.evidenceDownloadUrls).toHaveLength(1);
  expect(await (await fetch(detail.evidenceDownloadUrls[0]!)).text()).toContain(
    'Identity evidence'
  );
});
it('binds claimant OTP to case, purpose and new contact; persists failed attempts and refuses replay', async () => {
  const row = await approved(),
    challengeId = await code(row.id),
    other = await approved();
  const raw = await fetch(http.base + '/api/auth/recovery/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: row.id, challengeId, code: '123456' }),
  });
  expect(raw.status).toBe(403);
  expect((await verify(other.id, challengeId)).status).toBe(409);
  expect((await verify(row.id, challengeId, '000000')).status).toBe(401);
  expect(
    (
      await http.pool.query('SELECT attempts_remaining FROM otp_challenges WHERE challenge_id=$1', [
        challengeId,
      ])
    ).rows[0].attempts_remaining
  ).toBe(4);
  expect(
    (
      await http.pool.query(
        "SELECT event FROM audit_log WHERE metadata::jsonb->>'caseId'=$1 AND event='account_recovery_contact_rejected'",
        [row.id]
      )
    ).rows
  ).toHaveLength(1);
  expect((await verify(row.id, challengeId)).status, http.logs()).toBe(200);
  expect((await verify(row.id, challengeId)).status).toBe(409);
  expect(
    (
      await http.pool.query(
        'SELECT purpose,destination,user_id,consumed_at FROM otp_challenges WHERE challenge_id=$1',
        [challengeId]
      )
    ).rows[0]
  ).toMatchObject({
    purpose: 'account_recovery',
    destination: row.newLogin,
    user_id: row.user,
    consumed_at: expect.any(Date),
  });
  expect(
    (
      await http.pool.query(
        'SELECT encrypted_payload FROM auth_delivery_outbox WHERE challenge_id=$1',
        [challengeId]
      )
    ).rows[0].encrypted_payload
  ).not.toContain('123456');
  expect(http.logs()).not.toContain('123456');
});
it('atomically replaces lost contacts, invalidates all old authentication and makes concurrent application single-use', async () => {
  const row = await approved(),
    challengeId = await code(row.id);
  const oldSession = randomUUID(),
    oldRefresh = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,'old-token',$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour')",
    [oldSession, row.user, randomUUID()]
  );
  await http.pool.query(
    'INSERT INTO refresh_tokens(id,user_id,session_id,family_id,token_hash) SELECT $1,user_id,session_id,family_id,$2 FROM sessions WHERE session_id=$3',
    [oldRefresh, digest('old-refresh'), oldSession]
  );
  await http.pool.query(
    "INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at) VALUES($1,$2,'old-device',NOW()+INTERVAL '30 days')",
    [randomUUID(), row.user]
  );
  expect((await verify(row.id, challengeId)).status).toBe(200);
  const replies = await Promise.all([post('/' + row.id + '/apply'), post('/' + row.id + '/apply')]);
  expect(replies.map((x) => x.status)).toEqual([200, 200]);
  const user = (
    await http.pool.query(
      'SELECT username,email,mobile,must_change_password,auth_version FROM users WHERE user_id=$1',
      [row.user]
    )
  ).rows[0];
  expect(user).toMatchObject({
    username: row.newLogin,
    email: row.newLogin,
    mobile: null,
    must_change_password: true,
    auth_version: 1,
  });
  expect(
    (await http.pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [oldSession]))
      .rows[0].revoked_at
  ).toBeInstanceOf(Date);
  expect(
    (await http.pool.query('SELECT consumed_at FROM refresh_tokens WHERE id=$1', [oldRefresh]))
      .rows[0].consumed_at
  ).toBeInstanceOf(Date);
  expect(
    (
      await http.pool.query(
        'SELECT expires_at<=NOW() AS expired FROM device_trusts WHERE user_id=$1',
        [row.user]
      )
    ).rows[0].expired
  ).toBe(true);
  expect(
    (
      await http.pool.query('SELECT destination FROM account_login_identifiers WHERE user_id=$1', [
        row.user,
      ])
    ).rows
  ).toEqual([{ destination: row.newLogin }]);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='account_recovery_applied' AND metadata::jsonb->>'caseId'=$1",
        [row.id]
      )
    ).rows
  ).toHaveLength(1);
  expect(
    (
      await post('/' + row.id + '/complete', {
        oldContact: 'old-contact-message-1',
        newContact: 'new-contact-message-2',
      })
    ).status
  ).toBe(409);
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [
    `otp:dest:${row.newLogin}:60s`,
  ]);
  const forgot = await fetchWithPreauth(http.base + '/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: row.newLogin }),
  });
  expect(forgot.status, http.logs()).toBe(200);
  const resetId = ((await forgot.json()) as { challengeId: string }).challengeId;
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$2 WHERE challenge_id=$1', [
    resetId,
    digest('654321'),
  ]);
  const password = 'Recovered-password-987!';
  const reset = await fetchWithPreauth(http.base + '/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: resetId, otp: '654321', newPassword: password }),
  });
  expect(reset.status, http.logs()).toBe(200);
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [
    `otp:dest:${row.newLogin}:60s`,
  ]);
  const login = await fetchWithPreauth(http.base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: row.newLogin, password }),
  });
  expect(login.status, http.logs()).toBe(200);
  const forced = (await login.json()) as {
    mustChangePassword: boolean;
    passwordChangeToken: string;
  };
  expect(forced.mustChangePassword).toBe(true);
  const finalPassword = 'Final-recovered-password-456!';
  const change = await fetchWithPreauth(http.base + '/api/auth/force-change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      passwordChangeToken: forced.passwordChangeToken,
      newPassword: finalPassword,
    }),
  });
  expect(change.status, http.logs()).toBe(200);
  const fresh = await fetchWithPreauth(http.base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: row.newLogin, password: finalPassword }),
  });
  expect(fresh.status, http.logs()).toBe(200);
  const loginId = ((await fresh.json()) as { challengeId: string }).challengeId;
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$2 WHERE challenge_id=$1', [
    loginId,
    digest('987654'),
  ]);
  const signed = await fetchWithPreauth(http.base + '/api/auth/login/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: loginId, otp: '987654', trustDevice: false }),
  });
  expect(signed.status, http.logs()).toBe(200);
  expect((await signed.json()) as unknown).toMatchObject({
    userId: row.user,
    sessionId: expect.any(String),
  });
  expect(
    (
      await post('/' + row.id + '/complete', {
        oldContact: 'old-contact-message-1',
        newContact: 'new-contact-message-2',
      })
    ).status,
    http.logs()
  ).toBe(200);
  const detail = (await (await read(row.id)).json()) as {
    state: string;
    history: Array<{ event: string }>;
  };
  expect(detail.state).toBe('completed');
  expect(detail.history.map((x) => x.event)).toContain('account_recovery_completed');
  await expect(
    http.pool.query('DELETE FROM account_recovery_cases WHERE id=$1', [row.id])
  ).rejects.toThrow('history is permanent');
  await expect(
    http.pool.query(
      "UPDATE account_recovery_cases SET new_login='attacker@example.test' WHERE id=$1",
      [row.id]
    )
  ).rejects.toThrow('immutable');
});
it('refuses stale identity/contact/approval proof and allows rejecting expired cases safely', async () => {
  const row = await approved(),
    challengeId = await code(row.id);
  expect((await verify(row.id, challengeId)).status).toBe(200);
  await http.pool.query(
    "UPDATE otp_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE challenge_id=$1",
    [challengeId]
  );
  expect((await post('/' + row.id + '/apply')).status).toBe(409);
  await http.pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
    row.user,
    'changed-' + row.oldLogin,
  ]);
  expect((await post('/' + row.id + '/apply')).status).toBe(409);
  expect(
    (
      await post('/' + row.id + '/review', {
        decision: 'rejected',
        notes: 'Target changed; identity must be reviewed again',
      })
    ).status
  ).toBe(200);
});
it('rolls back credential, token and case writes when mandatory audit fails', async () => {
  const row = await approved(),
    challengeId = await code(row.id);
  expect((await verify(row.id, challengeId)).status).toBe(200);
  await http.pool.query(
    `CREATE FUNCTION fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='account_recovery_applied' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_recovery_audit()`
  );
  try {
    expect((await post('/' + row.id + '/apply')).status).toBe(500);
    expect(
      (
        await http.pool.query('SELECT username,auth_version FROM users WHERE user_id=$1', [
          row.user,
        ])
      ).rows[0]
    ).toEqual({ username: row.oldLogin, auth_version: 0 });
    expect(
      (await http.pool.query('SELECT state FROM account_recovery_cases WHERE id=$1', [row.id]))
        .rows[0].state
    ).toBe('approved');
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_recovery_audit ON audit_log;DROP FUNCTION fail_recovery_audit()'
    );
  }
});

it.each(['contact', 'session'] as const)(
  'rolls back the entire application if %s proof expires before commit',
  async (proof) => {
    const row = await approved(),
      challengeId = await code(row.id);
    expect((await verify(row.id, challengeId)).status).toBe(200);
    await http.pool
      .query(`CREATE FUNCTION expire_recovery_proof() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='account_recovery_applied' THEN
      ${proof === 'contact' ? "UPDATE otp_challenges SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE challenge_id='" + challengeId + "';" : "UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id='recovery-reviewer';"}
    END IF; RETURN NEW; END $$;CREATE TRIGGER expire_recovery_proof BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION expire_recovery_proof()`);
    try {
      expect((await post('/' + row.id + '/apply')).status).toBe(proof === 'contact' ? 409 : 401);
      expect(
        (
          await http.pool.query('SELECT username,auth_version FROM users WHERE user_id=$1', [
            row.user,
          ])
        ).rows[0]
      ).toEqual({ username: row.oldLogin, auth_version: 0 });
      expect(
        (await http.pool.query('SELECT state FROM account_recovery_cases WHERE id=$1', [row.id]))
          .rows[0].state
      ).toBe('approved');
      expect(
        (
          await http.pool.query(
            "SELECT id FROM audit_log WHERE event='account_recovery_applied' AND metadata::jsonb->>'caseId'=$1",
            [row.id]
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await http.pool.query(
        'DROP TRIGGER expire_recovery_proof ON audit_log;DROP FUNCTION expire_recovery_proof()'
      );
    }
  }
);
