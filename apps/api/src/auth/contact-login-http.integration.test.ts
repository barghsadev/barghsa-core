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
  fetch(`${http.base}/api/auth/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const login = (username: string, secret = password) =>
  post('login', { username, password: secret });
const user = async () => (await fetch(`${http.base}/api/auth/user`, { headers })).json();
async function expireOtpCooldown(destination: string) {
  // Simulate the minute between contact verification, login, and recovery in this local fixture.
  await http.pool.query('DELETE FROM security_rate_limit_counters WHERE key=$1', [
    `otp:dest:${destination}:60s`,
  ]);
}
async function contactChallenge(destination = secondary) {
  const response = await post('add-contact/send-otp', {
    contactType: destination.includes('@') ? 'email' : 'mobile',
    contactValue: destination,
  });
  expect(response.status, http.logs()).toBe(200);
  const { challengeId } = (await response.json()) as { challengeId: string };
  // Known fixture code isolates transaction/login behavior from provider delivery.
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    createHash('sha256').update('123456').digest('hex'),
    challengeId,
  ]);
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
  expect(
    (await post('register', { username: secondary, password, tosVersionId: randomUUID() })).status
  ).toBe(409);
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
          'SELECT COALESCE(sum(count),0) AS count FROM security_rate_limit_counters WHERE key=$1',
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
