import { fetchWithPreauth } from '../test/public-auth.js';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
const primary = '+989120000010',
  secondary = 'secondary-login@example.test';
const password = 'Local-contact-password-123!';
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    'INSERT INTO users(user_id,username,email,mobile,password_hash) VALUES ($1,$2,$3,$2,$4)',
    ['contact-user', primary, secondary, await argon2.hash(password)]
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'contact-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
const post = (path: string, body: unknown) =>
  fetchWithPreauth(`${http.base}/api/auth/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
const login = (username: string, secret = password) =>
  post('login', { username, password: secret });
const user = async () => (await fetch(`${http.base}/api/auth/user`, { headers })).json();
async function expireOtpCooldown(destination: string) {
  // Simulate the minute between contact verification, login, and recovery in this local fixture.
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [
    `otp:dest:${destination}:60s`,
  ]);
}
async function setFixtureOtp(challengeId: string) {
  // Known fixture code isolates transaction/login behavior from provider delivery.
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    createHash('sha256').update('123456').digest('hex'),
    challengeId,
  ]);
}
async function contactChallenge(destination = secondary) {
  const response = await post('add-contact/send-otp', {
    contactType: destination.includes('@') ? 'email' : 'mobile',
    contactValue: destination,
  });
  expect(response.status, http.logs()).toBe(200);
  const { challengeId } = (await response.json()) as { challengeId: string };
  await setFixtureOtp(challengeId);
  return challengeId;
}
const complete = (id: string, destination = secondary) =>
  post('add-contact', {
    contactType: destination.includes('@') ? 'email' : 'mobile',
    contactValue: destination,
    otpChallengeId: id,
    otp: '123456',
  });
it('requires proof for a historical secondary email, then accepts both identifiers and binds recovery', async () => {
  expect(await user()).toMatchObject({ emailVerified: false, mobileVerified: true });
  expect((await login(secondary)).status).toBe(401);
  const challengeId = await contactChallenge();
  expect((await complete(challengeId)).status, http.logs()).toBe(200);
  expect(await user()).toMatchObject({ emailVerified: true, mobileVerified: true });
  for (const destination of [primary, secondary]) {
    await expireOtpCooldown(destination);
    const response = await login(destination);
    expect(response.status, http.logs()).toBe(200);
    const result = (await response.json()) as { requiresOtp: boolean; challengeId: string };
    expect(result.requiresOtp).toBe(true);
    expect(
      (
        await http.pool.query(
          'SELECT user_id,destination,purpose FROM otp_challenges WHERE challenge_id=$1',
          [result.challengeId]
        )
      ).rows[0]
    ).toEqual({ user_id: 'contact-user', destination, purpose: 'login' });
  }
  await expireOtpCooldown(secondary);
  const reset = await post('forgot-password', { username: secondary });
  expect(reset.status).toBe(200);
  const resetId = ((await reset.json()) as { challengeId: string }).challengeId;
  expect(
    (
      await http.pool.query('SELECT user_id,purpose FROM otp_challenges WHERE challenge_id=$1', [
        resetId,
      ])
    ).rows[0]
  ).toEqual({ user_id: 'contact-user', purpose: 'password_reset' });
  const tosVersionId = randomUUID();
  await http.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at)
     VALUES ($1,'alias-proof-v1','قوانین','Terms','published',true,NOW())`,
    [tosVersionId]
  );
  await expireOtpCooldown(secondary);
  const registration = await post('register', { username: secondary, password, tosVersionId });
  expect(registration.status, await registration.clone().text()).toBe(200);
  const body = (await registration.json()) as { challengeId: string };
  expect(body).toEqual({ challengeId: expect.any(String) });
  await setFixtureOtp(body.challengeId);
  const duplicate = await post('register/verify', { challengeId: body.challengeId, otp: '123456' });
  expect(duplicate.status, await duplicate.clone().text()).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    error: { code: 'AUTH:REGISTER:USERNAME_TAKEN' },
  });
  expect((await http.pool.query('SELECT user_id,username FROM users')).rows).toEqual([
    { user_id: 'contact-user', username: primary },
  ]);
});
it('shares failed-login counters across aliases and clears them after successful login OTP', async () => {
  expect((await complete(await contactChallenge())).status).toBe(200);
  for (const destination of [primary, secondary, primary, secondary])
    expect((await login(destination, 'wrong-password')).status).toBe(401);
  const key =
    'login:failures:' +
    createHash('sha256')
      .update(JSON.stringify([primary, '127.0.0.1']))
      .digest('hex');
  const count = async () =>
    Number(
      (
        await http.pool.query(
          'SELECT COALESCE(sum(cardinality(events)),0) AS count FROM rate_limit_windows WHERE security AND key=$1',
          [key]
        )
      ).rows[0].count
    );
  expect(await count()).toBe(4);
  await expireOtpCooldown(secondary);
  const loginResponse = await login(secondary);
  expect(loginResponse.status, http.logs()).toBe(200);
  const { challengeId } = (await loginResponse.json()) as { challengeId: string };
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    createHash('sha256').update('654321').digest('hex'),
    challengeId,
  ]);
  const response = await post('login/verify', { challengeId, otp: '654321', trustDevice: false });
  expect(response.status, http.logs()).toBe(200);
  expect(await count()).toBe(0);
});

it('rejects a disabled account before creating a session or sending a login code', async () => {
  await http.pool.query(
    "UPDATE users SET disabled_at=clock_timestamp() WHERE user_id='contact-user'"
  );
  const invalid = await login(primary, 'wrong-password');
  expect(invalid.status).toBe(401);
  expect(await invalid.json()).toMatchObject({ error: { code: 'AUTH:LOGIN:INVALID_CREDENTIALS' } });
  const disabled = await login(primary);
  expect(disabled.status).toBe(403);
  expect(await disabled.json()).toMatchObject({ error: { code: 'AUTH:ACCOUNT:DISABLED' } });
  expect(disabled.headers.get('Set-Cookie') ?? '').not.toContain('barghsa_session=');
  expect((await http.pool.query('SELECT session_id FROM sessions')).rowCount).toBe(1);
  expect((await http.pool.query('SELECT challenge_id FROM otp_challenges')).rows).toEqual([]);
  expect((await http.pool.query('SELECT id FROM auth_delivery_outbox')).rows).toEqual([]);
});

it('rolls back OTP consumption and contact changes when a primary account wins the destination', async () => {
  const challengeId = await contactChallenge();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('competing-account',$1,'test-only')",
    [secondary]
  );
  expect((await complete(challengeId)).status).toBe(409);
  expect(
    (
      await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [
        challengeId,
      ])
    ).rows[0].consumed_at
  ).toBeNull();
  expect(await user()).toMatchObject({ emailVerified: false });
  expect(
    (
      await http.pool.query('SELECT user_id FROM account_login_identifiers WHERE destination=$1', [
        secondary,
      ])
    ).rows[0].user_id
  ).toBe('competing-account');
});

it.each([
  { type: 'email', first: secondary, second: 'another-alias@example.test' },
  { type: 'mobile', first: '+989120000011', second: '+989120000012' },
] as const)(
  'keeps the first verified $type when a second valid challenge is pending',
  async ({ type, first, second }) => {
    if (type === 'mobile') {
      await http.pool.query(
        "UPDATE users SET username='fixture-primary@example.test',email='fixture-primary@example.test',mobile=NULL WHERE user_id='contact-user'"
      );
    }
    const firstChallenge = await contactChallenge(first);
    const secondChallenge = await contactChallenge(second);
    expect((await complete(firstChallenge, first)).status).toBe(200);

    const rejected = await complete(secondChallenge, second);
    const expected =
      type === 'email'
        ? 'AUTH:CHANGE_USERNAME:ALREADY_HAS_EMAIL'
        : 'AUTH:CHANGE_USERNAME:ALREADY_HAS_MOBILE';
    // Claiming a previously empty slot also invalidates an old auth-version proof.
    expect(rejected.status).toBe(type === 'email' ? 409 : 401);
    expect(await rejected.json()).toMatchObject({
      error: { code: type === 'email' ? expected : 'AUTH:TOKEN_INVALID' },
    });
    const later = await post('add-contact/send-otp', { contactType: type, contactValue: second });
    expect(later.status).toBe(409);
    expect(await later.json()).toMatchObject({ error: { code: expected } });
    expect(
      (
        await http.pool.query(
          'SELECT destination FROM account_login_identifiers WHERE destination=ANY($1::text[])',
          [[first, second]]
        )
      ).rows
    ).toEqual([{ destination: first }]);
    const outcomes = await http.pool.query(
      'SELECT destination,consumed_at FROM otp_challenges WHERE challenge_id=ANY($1::text[]) ORDER BY destination',
      [[firstChallenge, secondChallenge]]
    );
    expect(outcomes.rows).toHaveLength(2);
    expect(outcomes.rows).toEqual(
      expect.arrayContaining([
        { destination: first, consumed_at: expect.any(Date) },
        { destination: second, consumed_at: null },
      ])
    );
    expect(
      (await http.pool.query("SELECT metadata::jsonb FROM audit_log WHERE event='contact_added'"))
        .rows
    ).toEqual([{ metadata: { contactType: type, contactValue: first } }]);
  }
);

it('does not retain proof after a contact changes and never grants an alias after audit rollback', async () => {
  const challengeId = await contactChallenge();
  await http.pool.query(
    "CREATE FUNCTION reject_contact_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER reject_contact_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='contact_added') EXECUTE FUNCTION reject_contact_audit()"
  );
  expect((await complete(challengeId)).status).toBe(500);
  expect(await user()).toMatchObject({ emailVerified: false });
  expect(
    (
      await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [
        challengeId,
      ])
    ).rows[0].consumed_at
  ).toBeNull();
  await http.pool.query('DROP TRIGGER reject_contact_audit ON audit_log');
  expect((await complete(challengeId)).status).toBe(200);
  await http.pool.query(
    "UPDATE users SET email='changed-contact@example.test' WHERE user_id='contact-user'"
  );
  expect((await login(secondary)).status).toBe(401);
  expect((await login('changed-contact@example.test')).status).toBe(401);
});

it('verifies a secondary mobile on an email account and uses it for login', async () => {
  const email = 'primary-login@example.test';
  await http.pool.query("UPDATE users SET username=$1,email=$1 WHERE user_id='contact-user'", [
    email,
  ]);
  expect(await user()).toMatchObject({ emailVerified: true, mobileVerified: false });
  expect((await login(primary)).status).toBe(401);
  expect((await complete(await contactChallenge(primary), primary)).status).toBe(200);
  expect(await user()).toMatchObject({ emailVerified: true, mobileVerified: true });
  await expireOtpCooldown(primary);
  const response = await login(primary);
  expect(response.status, http.logs()).toBe(200);
  const { challengeId } = (await response.json()) as { challengeId: string };
  expect(
    (
      await http.pool.query(
        'SELECT user_id,destination,purpose FROM otp_challenges WHERE challenge_id=$1',
        [challengeId]
      )
    ).rows[0]
  ).toEqual({ user_id: 'contact-user', destination: primary, purpose: 'login' });
});
