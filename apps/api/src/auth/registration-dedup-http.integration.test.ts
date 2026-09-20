import { fetchWithPreauth } from '../test/public-auth.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const terms = randomUUID();
const nextTerms = randomUUID();
const password = 'Registration-dedup-password-123!';

async function start(poolMax = 4) {
  vi.stubEnv('DB_POOL_MIN', '1');
  vi.stubEnv('DB_POOL_MAX', String(poolMax));
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at)
     VALUES ($1,'dedup-v1','قوانین','Terms','published',true,NOW()),
            ($2,'dedup-v2','قوانین جدید','New terms','published',false,NOW())`,
    [terms, nextTerms]
  );
}

beforeEach(() => start(), 40000);
afterEach(async () => {
  await http?.close();
  vi.unstubAllEnvs();
}, 15000);

async function register(username: string, overrides: Record<string, string> = {}) {
  const response = await fetchWithPreauth(`${http.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, tosVersionId: terms, ...overrides }),
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await response.json();
  return { response, body: body as { challengeId?: string; error?: { code: string } } };
}

async function sendCount(destination: string) {
  return (
    await http.pool.query('SELECT count FROM rate_limit_rolling(true,$1,60000,NULL,false)', [
      `otp:dest:${destination}:60s`,
    ])
  ).rows[0].count;
}

for (const poolMax of [4, 1]) {
  it(`returns one challenge and delivery for concurrent identical starts with ${poolMax} connections`, async () => {
    if (poolMax === 1) {
      await http.close();
      await start(1);
    }
    const results = await Promise.all([
      register('Dedup@Example.test'),
      register('dedup@example.test'),
      register(' dedup@example.test '),
    ]);
    for (const { response, body } of results) {
      expect(response.status, JSON.stringify(body) + http.logs()).toBe(200);
      expect(Object.keys(body)).toEqual(['challengeId']);
    }
    expect(new Set(results.map(({ body }) => body.challengeId)).size).toBe(1);
    const rows = (
      await http.pool.query(
        `SELECT c.challenge_id,c.destination,c.attempts_remaining,c.resend_count,o.id
       FROM otp_challenges c JOIN auth_delivery_outbox o USING(challenge_id)`
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      challenge_id: results[0]!.body.challengeId,
      destination: 'dedup@example.test',
      attempts_remaining: 5,
      resend_count: 0,
    });
    expect(Number(await sendCount('dedup@example.test'))).toBe(1);
    // Deduplication never bypasses the independent transport guard.
    expect((await register('dedup@example.test')).response.status).toBe(429);
  }, 15000);
}

it('normalizes national and international mobile retries to the same request', async () => {
  const first = await register('09121234567');
  const retry = await register(' +989121234567 ');
  expect(first.response.status).toBe(200);
  expect(retry.response.status).toBe(200);
  expect(retry.body).toEqual(first.body);
  expect(Number(await sendCount('+989121234567'))).toBe(1);
});

it('reuses accepted terms after publication changes but never matches a changed password or terms ID', async () => {
  const username = 'publication@example.test';
  const first = await register(username);
  expect(first.response.status).toBe(200);
  await http.pool.query('UPDATE tos_versions SET is_active=false WHERE id=$1', [terms]);
  await http.pool.query('UPDATE tos_versions SET is_active=true WHERE id=$1', [nextTerms]);
  const retry = await register(username);
  expect(retry.response.status).toBe(200);
  expect(retry.body).toEqual(first.body);
  const changedPassword = await register(username, { password: 'Different-password-456!' });
  expect(changedPassword.response.status).toBe(400); // Its old terms cannot start a new request.
  await http.pool.query("SELECT rate_limit_rolling_reset(true,'registration:ip:127.0.0.1')");
  // Isolate the destination send quota from the already-tested transport limit.
  await http.pool.query('DELETE FROM rate_limit_windows WHERE key LIKE $1', ['registration:ip:%']);
  const changedTerms = await register(username, { tosVersionId: nextTerms });
  expect(changedTerms.response.status).toBe(429);
  expect(changedTerms.body).toMatchObject({ error: { code: 'AUTH:OTP:RATE_LIMITED' } });
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(1);
});

for (const invalidation of [
  "expires_at=clock_timestamp()-INTERVAL '1 second'",
  'attempts_remaining=0',
  'consumed_at=clock_timestamp()',
]) {
  it(`does not reuse a terminal challenge with ${invalidation}`, async () => {
    const username = 'terminal@example.test';
    const first = await register(username);
    expect(first.response.status).toBe(200);
    await http.pool.query(`UPDATE otp_challenges SET ${invalidation} WHERE challenge_id=$1`, [
      first.body.challengeId,
    ]);
    // A new send remains subject to the ordinary destination quota.
    expect((await register(username)).response.status).toBe(429);
    await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [`otp:dest:${username}:60s`]);
    const next = await register(username);
    expect(next.response.status, JSON.stringify(next.body) + http.logs()).toBe(200);
    expect(next.body.challengeId).not.toBe(first.body.challengeId);
  });
}

it('rolls back a failed queue write and its send quotas, allowing an immediate safe retry', async () => {
  const username = 'queue-rollback@example.test';
  await http.pool
    .query(`CREATE FUNCTION reject_registration_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected delivery failure'; END $$;
    CREATE TRIGGER reject_registration_delivery BEFORE INSERT ON auth_delivery_outbox FOR EACH ROW EXECUTE FUNCTION reject_registration_delivery();`);
  expect((await register(username)).response.status).toBe(500);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(0);
  expect(Number(await sendCount(username))).toBe(0);
  await http.pool.query('DROP TRIGGER reject_registration_delivery ON auth_delivery_outbox');
  const retry = await register(username);
  expect(retry.response.status, JSON.stringify(retry.body) + http.logs()).toBe(200);
  expect(Number(await sendCount(username))).toBe(1);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM auth_delivery_outbox')).rows[0].count
  ).toBe(1);
});
