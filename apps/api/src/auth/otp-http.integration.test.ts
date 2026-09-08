import { fetchWithPreauth } from '../test/public-auth.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;

beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    "INSERT INTO users(user_id,username,email,password_hash) VALUES ('otp-user','otp-old@example.test','otp-old@example.test','test-only')"
  );
  const sessionId = randomUUID(),
    token = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'otp-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, token, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${sessionId}`,
    'X-CSRF-Token': token,
    'Content-Type': 'application/json',
  };
}, 40000);

afterEach(async () => {
  await http?.close();
}, 15000);

async function challenge(
  destination: string,
  purpose = 'change_username',
  userId: string | null = 'otp-user'
) {
  const id = randomUUID();
  // Tests transaction behavior independently of provider delivery.
  await http.pool.query(
    `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose,user_id,password_hash,tos_version_id)
    VALUES ($1,$2,$3,NOW()+INTERVAL '5 minutes',$4,$5,'fixture-password','fixture-terms')`,
    [id, destination, createHash('sha256').update('123456').digest('hex'), purpose, userId]
  );
  if (purpose === 'change_username') {
    const previous = randomUUID();
    await http.pool.query(
      `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose,user_id,auth_version)
      SELECT $1,username,$2,NOW()+INTERVAL '5 minutes','change_username',user_id,auth_version FROM users WHERE user_id=$3`,
      [previous, createHash('sha256').update('112233').digest('hex'), userId]
    );
    await http.pool.query(
      'UPDATE otp_challenges SET previous_challenge_id=$1 WHERE challenge_id=$2',
      [previous, id]
    );
  }
  return id;
}

async function post(path: string, body: unknown) {
  return fetchWithPreauth(`${http.base}/api/auth/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

it('consumes username OTP in the account transaction and persists failed attempts without hanging', async () => {
  const id = await challenge('otp-new@example.test');
  const body = {
    newUsername: 'otp-new@example.test',
    otpChallengeId: id,
    otp: '123456',
    previousOtp: '112233',
  };
  expect((await post('change-username', { ...body, otp: '654321' })).status).toBe(401);
  expect(
    (
      await http.pool.query(
        'SELECT attempts_remaining,consumed_at FROM otp_challenges WHERE challenge_id=$1',
        [id]
      )
    ).rows[0]
  ).toEqual({ attempts_remaining: 4, consumed_at: null });
  await http.pool
    .query(`CREATE FUNCTION reject_test_username() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.username='otp-new@example.test' THEN RAISE EXCEPTION 'Injected account write failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_username BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_test_username();`);
  expect((await post('change-username', body)).status).toBe(500);
  expect(
    (await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [id]))
      .rows[0].consumed_at
  ).toBeNull();
  await http.pool.query('DROP TRIGGER reject_test_username ON users');
  const completed = await post('change-username', body);
  expect(completed.status, (await completed.text()) + http.logs()).toBe(200);
  expect(
    (await http.pool.query("SELECT username FROM users WHERE user_id='otp-user'")).rows[0].username
  ).toBe(body.newUsername);
  expect(
    (await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [id]))
      .rows[0].consumed_at
  ).not.toBeNull();
  expect((await post('change-username', body)).status).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='username_changed'"
      )
    ).rows[0].count
  ).toBe(1);
}, 15000);

it('allows exactly one concurrent contact verification and rejects reuse', async () => {
  const id = await challenge('+989121234567', 'add_mobile');
  const body = {
    contactType: 'mobile',
    contactValue: '+989121234567',
    otpChallengeId: id,
    otp: '123456',
    previousOtp: '112233',
  };
  const results = await Promise.all([post('add-contact', body), post('add-contact', body)]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(
    (await http.pool.query("SELECT mobile FROM users WHERE user_id='otp-user'")).rows[0].mobile
  ).toBe(body.contactValue);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='contact_added'"
      )
    ).rows[0].count
  ).toBe(1);
}, 10000);

it('does not overwrite or resend a challenge consumed while its update waits', async () => {
  const id = await challenge('resend-race@example.test', 'registration', null);
  const client = await http.pool.connect();
  let resend: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT challenge_id FROM otp_challenges WHERE challenge_id=$1 FOR UPDATE', [
      id,
    ]);
    resend = post('register/resend', { challengeId: id });
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE otp_challenges%'`)
          ).rows[0].count
      )
      .toBe(1);
    await client.query(
      'UPDATE otp_challenges SET consumed_at=NOW(),attempts_remaining=0 WHERE challenge_id=$1',
      [id]
    );
    await client.query('COMMIT');
    const response = await resend;
    expect(response.status, await response.text()).toBe(409);
    expect(
      (
        await http.pool.query(
          'SELECT otp_hash,resend_count FROM otp_challenges WHERE challenge_id=$1',
          [id]
        )
      ).rows[0]
    ).toEqual({ otp_hash: createHash('sha256').update('123456').digest('hex'), resend_count: 0 });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await resend;
  }
}, 10000);

it('rejects cross-purpose and cross-account codes without consuming them', async () => {
  const login = await challenge('otp-old@example.test', 'login');
  const reset = await challenge('otp-old@example.test', 'password_reset');
  expect(
    (
      await post('reset-password', {
        challengeId: login,
        otp: '123456',
        newPassword: 'Changed-test-password-123!',
      })
    ).status
  ).toBe(404);
  expect((await post('login/verify', { challengeId: reset, otp: '123456' })).status).toBe(404);
  expect((await post('register/verify', { challengeId: login, otp: '123456' })).status).toBe(404);
  expect((await post('register/resend', { challengeId: login })).status).toBe(404);
  expect((await post('login/resend', { challengeId: reset })).status).toBe(404);

  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('another-user','another@example.test','test-only')"
  );
  const otherUser = await challenge('other-new@example.test', 'change_username', 'another-user');
  expect(
    (
      await post('change-username', {
        newUsername: 'other-new@example.test',
        otpChallengeId: otherUser,
        otp: '123456',
        previousOtp: '112233',
      })
    ).status
  ).toBe(404);
  const mobile = await challenge('bound@example.test', 'add_mobile');
  expect(
    (
      await post('add-contact', {
        contactType: 'email',
        contactValue: 'bound@example.test',
        otpChallengeId: mobile,
        otp: '123456',
      })
    ).status
  ).toBe(404);
  expect(
    (await http.pool.query('SELECT consumed_at,attempts_remaining FROM otp_challenges')).rows
  ).toEqual(Array(5).fill({ consumed_at: null, attempts_remaining: 5 }));
  const valid = await post('login/verify', { challengeId: login, otp: '123456' });
  expect(valid.status, (await valid.text()) + http.logs()).toBe(200);
}, 15000);

it('issues account-bound contact and password-reset challenges through their actual routes', async () => {
  expect(
    (await post('change-username/send-otp', { newUsername: 'issued-change@example.test' })).status
  ).toBe(200);
  expect(
    (await post('add-contact/send-otp', { contactType: 'mobile', contactValue: '+989129999999' }))
      .status
  ).toBe(200);
  // These are independent issuance routes; clear only the test send quotas.
  await http.pool.query(
    'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
  );
  expect((await post('forgot-password', { username: 'otp-old@example.test' })).status).toBe(200);
  expect(
    (
      await http.pool.query(
        'SELECT purpose,user_id,destination FROM otp_challenges ORDER BY purpose,destination'
      )
    ).rows
  ).toEqual([
    { purpose: 'add_mobile', user_id: 'otp-user', destination: '+989129999999' },
    { purpose: 'change_username', user_id: 'otp-user', destination: 'issued-change@example.test' },
    { purpose: 'change_username', user_id: 'otp-user', destination: 'otp-old@example.test' },
    { purpose: 'password_reset', user_id: 'otp-user', destination: 'otp-old@example.test' },
  ]);
}, 10000);

it('exhausts login after five concurrent wrong codes and refuses the correct code afterward', async () => {
  const id = await challenge('otp-old@example.test', 'login');
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () => post('login/verify', { challengeId: id, otp: '654321' }))
  );
  expect(attempts.map((r) => r.status)).toEqual(Array(5).fill(401));
  expect(
    (
      await http.pool.query('SELECT attempts_remaining FROM otp_challenges WHERE challenge_id=$1', [
        id,
      ])
    ).rows[0].attempts_remaining
  ).toBe(0);
  expect((await post('login/verify', { challengeId: id, otp: '123456' })).status).toBe(429);
  // Clear only this isolated fixture's transport counters, preserving the
  // exhausted challenge, to prove expiry of the IP window cannot revive it.
  await http.pool.query(
    'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
  );
  const correct = await post('login/verify', { challengeId: id, otp: '123456', trustDevice: true });
  expect(correct.status).toBe(401);
  expect(await correct.json()).toMatchObject({ error: { code: 'AUTH:OTP:MAX_ATTEMPTS' } });
  expect((await http.pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count).toBe(
    1
  );
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM device_trusts')).rows[0].count
  ).toBe(0);
});

it('rolls back OTP consumption and partial session writes when refresh-token insertion fails', async () => {
  const id = await challenge('otp-old@example.test', 'login');
  await http.pool
    .query(`CREATE FUNCTION reject_test_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected refresh write failure'; END $$;
    CREATE TRIGGER reject_test_refresh BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION reject_test_refresh();`);
  const body = { challengeId: id, otp: '123456' };
  expect((await post('login/verify', body)).status).toBe(500);
  expect(
    (await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [id]))
      .rows[0].consumed_at
  ).toBeNull();
  expect(
    (await http.pool.query("SELECT count(*)::int AS count FROM sessions WHERE user_id='otp-user'"))
      .rows[0].count
  ).toBe(1);
  expect(
    (await http.pool.query("SELECT last_login_at FROM users WHERE user_id='otp-user'")).rows[0]
      .last_login_at
  ).toBeNull();
  await http.pool.query('DROP TRIGGER reject_test_refresh ON refresh_tokens');
  const results = await Promise.all([post('login/verify', body), post('login/verify', body)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await http.pool.query("SELECT count(*)::int AS count FROM sessions WHERE user_id='otp-user'"))
      .rows[0].count
  ).toBe(2);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id='otp-user'"
      )
    ).rows[0].count
  ).toBe(1);
}, 15000);

it('rolls back registration, consent and OTP when session creation fails, then retries once', async () => {
  const terms = randomUUID();
  await http.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at)
    VALUES ($1,'atomic-v1','قوانین','Terms','published',true,NOW())`,
    [terms]
  );
  const id = await challenge('atomic-register@example.test', 'registration', null);
  await http.pool.query('UPDATE otp_challenges SET tos_version_id=$1 WHERE challenge_id=$2', [
    terms,
    id,
  ]);
  await http.pool
    .query(`CREATE FUNCTION reject_test_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected session write failure'; END $$;
    CREATE TRIGGER reject_test_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_test_session();`);
  const body = { challengeId: id, otp: '123456' };
  expect((await post('register/verify', body)).status).toBe(500);
  expect(
    (await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [id]))
      .rows[0].consumed_at
  ).toBeNull();
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM users WHERE username='atomic-register@example.test'"
      )
    ).rows[0].count
  ).toBe(0);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM tos_acceptances WHERE version_id=$1',
        [terms]
      )
    ).rows[0].count
  ).toBe(0);
  await http.pool.query('DROP TRIGGER reject_test_session ON sessions');
  const results = await Promise.all([post('register/verify', body), post('register/verify', body)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE u.username='atomic-register@example.test'"
      )
    ).rows[0].count
  ).toBe(1);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM tos_acceptances WHERE version_id=$1',
        [terms]
      )
    ).rows[0].count
  ).toBe(1);
}, 15000);

it('requires both linked codes, retains the valid code on failure, and rejects unpaired legacy challenges', async () => {
  const id = await challenge('paired-new@example.test');
  const body = {
    newUsername: 'paired-new@example.test',
    otpChallengeId: id,
    otp: '123456',
    previousOtp: '112233',
  };
  expect((await post('change-username', { ...body, previousOtp: undefined })).status).toBe(400);
  expect((await post('change-username', { ...body, previousOtp: '445566' })).status).toBe(401);
  expect(
    (
      await http.pool.query(
        `SELECT consumed_at,attempts_remaining FROM otp_challenges
    WHERE challenge_id=(SELECT previous_challenge_id FROM otp_challenges WHERE challenge_id=$1)`,
        [id]
      )
    ).rows[0]
  ).toEqual({ consumed_at: null, attempts_remaining: 4 });
  expect(
    (
      await http.pool.query(
        'SELECT consumed_at,attempts_remaining FROM otp_challenges WHERE challenge_id=$1',
        [id]
      )
    ).rows[0]
  ).toEqual({ consumed_at: null, attempts_remaining: 5 });
  expect((await post('change-username', { ...body, otp: '445566' })).status).toBe(401);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM otp_challenges WHERE consumed_at IS NOT NULL'
      )
    ).rows[0].count
  ).toBe(0);
  await http.pool.query(
    'UPDATE otp_challenges SET previous_challenge_id=NULL WHERE challenge_id=$1',
    [id]
  );
  expect((await post('change-username', body)).status).toBe(400);
  expect(
    (await http.pool.query("SELECT username FROM users WHERE user_id='otp-user'")).rows[0].username
  ).toBe('otp-old@example.test');
});

it('rolls back both issued challenges and delivery rows if the new destination cannot be queued', async () => {
  await http.pool.query(`CREATE FUNCTION reject_pair_issue() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.destination='pair-fail@example.test' THEN RAISE EXCEPTION 'Injected pair failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_pair_issue BEFORE INSERT ON otp_challenges FOR EACH ROW EXECUTE FUNCTION reject_pair_issue();`);
  expect(
    (await post('change-username/send-otp', { newUsername: 'pair-fail@example.test' })).status
  ).toBe(500);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(0);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM auth_delivery_outbox')).rows[0].count
  ).toBe(0);
});

it('enforces both stacked IP and authenticated-user limits without accepting a body user ID', async () => {
  await http.pool.query(
    `INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
    VALUES ('add-contact:user:otp-user',$1,300000,3)`,
    [Math.floor(Date.now() / 300000) * 300000]
  );
  expect((await post('add-contact/send-otp', { userId: 'other-user' })).status).toBe(429);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('other-user','other-limit@example.test','test-only')"
  );
  const id = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'other-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [id, csrf, randomUUID()]
  );
  headers = { ...headers, Cookie: `barghsa_session=${id}`, 'X-CSRF-Token': csrf };
  // An invalid form still reaches validation for the other authenticated user.
  expect((await post('add-contact/send-otp', {})).status).toBe(400);
  expect(
    (
      await http.pool.query(
        "SELECT key,cardinality(events) AS count FROM rate_limit_windows WHERE security AND key LIKE 'add-contact:%' ORDER BY key"
      )
    ).rows
  ).toEqual([
    { key: 'add-contact:ip:127.0.0.1', count: 2 },
    { key: 'add-contact:user:other-user', count: 1 },
    { key: 'add-contact:user:otp-user', count: 4 },
  ]);
});
