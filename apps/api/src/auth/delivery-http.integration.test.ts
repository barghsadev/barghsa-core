import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import * as argon2 from 'argon2';
import { startHttpFixture } from '../test/http-fixture.js';

// Global setup compiles both applications; exercise the shipped worker modules.
const requireWorker = createRequire(resolve(__dirname, '../../../worker/package.json'));
const { runAuthDelivery } = requireWorker('./dist/auth-delivery/runner.js') as {
  runAuthDelivery: (pool: Pool, send?: (message: unknown) => Promise<string>) => Promise<string>;
};
const { createAuthSender } = requireWorker('./dist/auth-delivery/providers.js') as {
  createAuthSender: (pool: Pool, request: typeof fetch) => (message: unknown) => Promise<string>;
};
let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
let mailbox: Server;
let endpoint: string;
let received: Array<{ text: string; to: string[]; key: string | undefined }>;
let failProvider: boolean;
const terms = randomUUID();
const password = 'Delivery-test-password-123!';

beforeEach(async () => {
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'http-fixture-delivery-key-only');
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await fixture.pool.query(
    `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at)
    VALUES ($1,'delivery-v1','قوانین','Terms','published',true,NOW())`,
    [terms]
  );
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('provider-admin','provider@example.test','test-only')"
  );
  await fixture.pool.query(
    `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status)
    VALUES ('resend','Controlled mailbox','active',$1,'provider-admin','passed')`,
    [JSON.stringify({ api_key: 'controlled-test-key', from_email: 'auth@example.test' })]
  );
  received = [];
  failProvider = false;
  mailbox = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += String(chunk);
    if (failProvider) {
      res.writeHead(503);
      res.end('unavailable');
      return;
    }
    const body = JSON.parse(data) as { text: string; to: string[] };
    received.push({ ...body, key: req.headers['idempotency-key'] as string | undefined });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'mailbox-receipt' }));
  });
  await new Promise<void>((done) => mailbox.listen(0, '127.0.0.1', done));
  const address = mailbox.address();
  if (!address || typeof address === 'string') throw new Error('Mailbox startup failed');
  endpoint = `http://127.0.0.1:${address.port}`;
}, 40000);

afterEach(async () => {
  if (mailbox)
    await new Promise<void>((done, reject) =>
      mailbox.close((error) => (error ? reject(error) : done()))
    );
  await fixture?.close();
  vi.unstubAllEnvs();
}, 15000);

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${fixture.base}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
async function register() {
  const response = await post('auth/register', {
    username: 'delivery@example.test',
    password,
    tosVersionId: terms,
  });
  const body = (await response.json()) as { challengeId: string };
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.challengeId;
}
function deliver() {
  const send = createAuthSender(fixture.pool, async (_url, options) => fetch(endpoint, options));
  return runAuthDelivery(fixture.pool, send);
}

it('registers using the message received by the provider and wipes the encrypted payload', async () => {
  const challengeId = await register();
  expect(await deliver()).toBe('sent');
  expect(received).toHaveLength(1);
  expect(received[0]!.to).toEqual(['delivery@example.test']);
  const otp = received[0]!.text.match(/\d{6}/)?.[0];
  expect(otp).toBeTruthy();
  const response = await post('auth/register/verify', { challengeId, otp });
  expect(response.status, await response.text()).toBe(200);
  expect(await deliver()).toBe('idle');
  const delivery = (
    await fixture.pool.query(
      'SELECT id,status,encrypted_payload,provider_ref FROM auth_delivery_outbox'
    )
  ).rows[0];
  expect(delivery).toEqual({
    id: received[0]!.key,
    status: 'sent',
    encrypted_payload: null,
    provider_ref: 'mailbox-receipt',
  });
});

it('retries provider failure and cancels replaced or expired codes without sending them', async () => {
  const challengeId = await register();
  failProvider = true;
  expect(await deliver()).toBe('retry');
  expect(received).toHaveLength(0);
  await fixture.pool.query(
    "UPDATE auth_delivery_outbox SET available_at=NOW()-INTERVAL '1 second'"
  );
  failProvider = false;
  expect(await deliver()).toBe('sent');
  // Advance only the test fixture's send quota; do not sleep through the one-minute window.
  await fixture.pool.query(
    'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
  );
  const resend = await post('auth/register/resend', { challengeId });
  expect(resend.status, await resend.text()).toBe(200);
  await fixture.pool.query(
    "UPDATE otp_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE challenge_id=$1",
    [challengeId]
  );
  expect(await deliver()).toBe('cancelled');
  expect(received).toHaveLength(1);
});

it('allows only one worker to claim a message while the provider is in flight', async () => {
  await register();
  let release!: () => void;
  const send = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = () => resolve('receipt');
      })
  );
  const first = runAuthDelivery(fixture.pool, send);
  await expect.poll(() => send.mock.calls.length).toBe(1);
  expect(await runAuthDelivery(fixture.pool, send)).toBe('idle');
  release();
  expect(await first).toBe('sent');
  expect(send).toHaveBeenCalledOnce();
});

it('cancels an unsent replaced code and recovers an expired worker lease', async () => {
  const challengeId = await register();
  await fixture.pool.query(
    'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
  );
  const resend = await post('auth/register/resend', { challengeId });
  expect(resend.status, await resend.text()).toBe(200);
  expect(await deliver()).toBe('cancelled');
  await fixture.pool.query(
    "UPDATE auth_delivery_outbox SET status='leased',lease_token=$1,lease_until=NOW()-INTERVAL '1 second' WHERE status='pending'",
    [randomUUID()]
  );
  expect(await deliver()).toBe('sent');
  expect(received).toHaveLength(1);
  const otp = received[0]!.text.match(/\d{6}/)?.[0];
  const verified = await post('auth/register/verify', { challengeId, otp });
  expect(verified.status, await verified.text()).toBe(200);
});

it('ends failed delivery after five attempts and erases the secret', async () => {
  await register();
  failProvider = true;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await fixture.pool.query(
      "UPDATE auth_delivery_outbox SET available_at=NOW()-INTERVAL '1 second'"
    );
    expect(await deliver()).toBe(attempt === 5 ? 'dead' : 'retry');
  }
  expect(await deliver()).toBe('idle');
  expect(
    (
      await fixture.pool.query(
        'SELECT attempts,status,encrypted_payload,last_error FROM auth_delivery_outbox'
      )
    ).rows[0]
  ).toEqual({
    attempts: 5,
    status: 'dead',
    encrypted_payload: null,
    last_error: 'delivery_failed',
  });
  expect(received).toHaveLength(0);
});

it('resets a password using the delivered code and returns opaque IDs for unknown accounts', async () => {
  const original = await argon2.hash(password);
  await fixture.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='provider-admin'", [
    original,
  ]);
  const known = await post('auth/forgot-password', { username: 'provider@example.test' });
  const knownBody = (await known.json()) as { challengeId: string; sent: boolean; message: string };
  expect(known.status, JSON.stringify(knownBody)).toBe(200);
  const unknown = await post('auth/forgot-password', { username: 'unknown@example.test' });
  const unknownBody = (await unknown.json()) as typeof knownBody;
  expect(unknown.status, JSON.stringify(unknownBody)).toBe(200);
  expect(unknownBody).toEqual({ ...knownBody, challengeId: expect.any(String) });
  expect(unknownBody.challengeId).not.toBe(knownBody.challengeId);
  expect(unknownBody.challengeId).toMatch(/^[a-f0-9-]{36}$/);
  expect(await deliver()).toBe('sent');
  expect(received).toHaveLength(1);
  const otp = received[0]!.text.match(/\d{6}/)?.[0];
  const newPassword = 'Changed-delivery-password-123!';
  const reset = await post('auth/reset-password', {
    challengeId: knownBody.challengeId,
    otp,
    newPassword,
  });
  expect(reset.status, await reset.text()).toBe(200);
  const stored = (
    await fixture.pool.query("SELECT password_hash FROM users WHERE user_id='provider-admin'")
  ).rows[0].password_hash;
  expect(await argon2.verify(stored, newPassword)).toBe(true);
  expect(await argon2.verify(stored, password)).toBe(false);
  const repeat = await post('auth/reset-password', {
    challengeId: knownBody.challengeId,
    otp,
    newPassword: 'Another-password-123!',
  });
  expect(repeat.status, await repeat.text()).toBe(409);
});

it('rejects a delivered login code after credentials change, including a change racing verification', async () => {
  await fixture.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='provider-admin'", [
    await argon2.hash(password),
  ]);
  const login = await post('auth/login', { username: 'provider@example.test', password });
  const challenge = (await login.json()) as { challengeId: string };
  expect(login.status, JSON.stringify(challenge)).toBe(200);
  expect(await deliver()).toBe('sent');
  const otp = received[0]!.text.match(/\d{6}/)?.[0];
  const client = await fixture.pool.connect();
  let verifying: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE users SET password_hash='changed-credential-test' WHERE user_id='provider-admin'"
    );
    verifying = post('auth/login/verify', { challengeId: challenge.challengeId, otp });
    await expect
      .poll(
        async () =>
          (
            await fixture.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT auth_version,%'`)
          ).rows[0].count
      )
      .toBe(1);
    await client.query('COMMIT');
    const result = await verifying;
    expect(result.status, await result.text()).toBe(401);
    expect(
      (
        await fixture.pool.query(
          "SELECT count(*)::int AS count FROM sessions WHERE user_id='provider-admin'"
        )
      ).rows[0].count
    ).toBe(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await verifying;
  }
});

it('allows only one password reset across two previously issued codes', async () => {
  await fixture.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='provider-admin'", [
    await argon2.hash(password),
  ]);
  const credentials: Array<{ challengeId: string; otp: string | undefined; newPassword: string }> =
    [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await fixture.pool.query(
      'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
    );
    const response = await post('auth/forgot-password', { username: 'provider@example.test' });
    const body = (await response.json()) as { challengeId: string };
    expect(response.status).toBe(200);
    expect(await deliver()).toBe('sent');
    credentials.push({
      challengeId: body.challengeId,
      otp: received.at(-1)!.text.match(/\d{6}/)?.[0],
      newPassword: `Concurrent-new-password-${attempt}!`,
    });
  }
  const results = await Promise.all(credentials.map((body) => post('auth/reset-password', body)));
  expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  expect(
    (
      await fixture.pool.query(
        "SELECT count(*)::int AS count FROM password_history WHERE user_id='provider-admin'"
      )
    ).rows[0].count
  ).toBe(1);
});

it('requires staff OTP even on a trusted device', async () => {
  await fixture.pool.query(
    "UPDATE users SET password_hash=$1,is_staff=true WHERE user_id='provider-admin'",
    [await argon2.hash(password)]
  );
  const fingerprint = 'b'.repeat(64);
  await fixture.pool.query(
    `INSERT INTO device_trusts(id,user_id,device_fingerprint,trusted_at,expires_at,ip_address)
    VALUES ($1,'provider-admin',$2,NOW(),NOW()+INTERVAL '1 day','127.0.0.1')`,
    [randomUUID(), createHash('sha256').update(fingerprint).digest('hex')]
  );
  const response = await post(
    'auth/login',
    {
      username: 'provider@example.test',
      password,
      deviceInfo: { fingerprint: 'ignored-client-input' },
    },
    { Cookie: `barghsa_device=${fingerprint}` }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    requiresOtp: true,
    userIsStaff: true,
    challengeId: expect.any(String),
  });
});

it('rechecks credentials while creating a trusted-device session', async () => {
  await fixture.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='provider-admin'", [
    await argon2.hash(password),
  ]);
  const fingerprint = 'c'.repeat(64);
  await fixture.pool.query(
    `INSERT INTO device_trusts(id,user_id,device_fingerprint,trusted_at,expires_at,ip_address)
    VALUES ($1,'provider-admin',$2,NOW(),NOW()+INTERVAL '1 day','127.0.0.1')`,
    [randomUUID(), createHash('sha256').update(fingerprint).digest('hex')]
  );
  const client = await fixture.pool.connect();
  let loggingIn: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE users SET password_hash='changed-during-login' WHERE user_id='provider-admin'"
    );
    loggingIn = post(
      'auth/login',
      {
        username: 'provider@example.test',
        password,
        deviceInfo: { fingerprint: 'ignored-client-input' },
      },
      { Cookie: `barghsa_device=${fingerprint}` }
    );
    await expect
      .poll(
        async () =>
          (
            await fixture.pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT auth_version,%'`)
          ).rows[0].count
      )
      .toBe(1);
    await client.query('COMMIT');
    const response = await loggingIn;
    expect(response.status, await response.text()).toBe(401);
    expect(
      (
        await fixture.pool.query(
          "SELECT count(*)::int AS count FROM sessions WHERE user_id='provider-admin'"
        )
      ).rows[0].count
    ).toBe(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await loggingIn;
  }
});

async function createStaff() {
  await fixture.pool.query("UPDATE users SET is_admin=true WHERE user_id='provider-admin'");
  const sessionId = randomUUID(),
    csrf = randomUUID();
  await fixture.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'provider-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, csrf, randomUUID()]
  );
  const response = await post(
    'admin/users/create-staff',
    {
      username: 'new-staff@example.test',
      firstName: 'New',
      lastName: 'Staff',
      roleIds: ['role-finance'],
      activationMethod: 'link',
    },
    { Cookie: `barghsa_session=${sessionId}`, 'X-CSRF-Token': csrf }
  );
  const body = (await response.json()) as {
    userId: string;
    deliveryStatus: string;
    activationToken?: string;
  };
  expect(response.status, JSON.stringify(body)).toBe(201);
  expect(body.deliveryStatus).toBe('queued');
  expect(body.activationToken).toBeUndefined();
  return body.userId;
}

it('creates staff with a queued link and consumes the delivered link only once', async () => {
  const userId = await createStaff();
  expect(await deliver()).toBe('sent');
  expect(received).toHaveLength(1);
  const link = received[0]!.text.match(/https:\/\/[^\s]+/)?.[0];
  expect(link).toBeTruthy();
  const token = new URLSearchParams(new URL(link!).hash.slice(1)).get('token')!;
  const account = (
    await fixture.pool.query(
      'SELECT activation_token,is_admin,is_staff FROM users WHERE user_id=$1',
      [userId]
    )
  ).rows[0];
  expect(account).toEqual({
    activation_token: createHash('sha256').update(token).digest('hex'),
    is_admin: false,
    is_staff: true,
  });
  const newPassword = 'Activated-staff-password-123!';
  const results = await Promise.all(
    [1, 2].map(() => post('auth/activate-staff', { token, newPassword }))
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  const activated = (
    await fixture.pool.query(
      'SELECT password_hash,activation_token,must_change_password FROM users WHERE user_id=$1',
      [userId]
    )
  ).rows[0];
  expect(activated.activation_token).toBeNull();
  expect(activated.must_change_password).toBe(false);
  expect(await argon2.verify(activated.password_hash, newPassword)).toBe(true);
  expect(
    (
      await fixture.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='staff_user_activated'"
      )
    ).rows[0].count
  ).toBe(1);
});

it('does not send an expired activation and rolls back staff creation when queuing fails', async () => {
  const userId = await createStaff();
  await fixture.pool.query(
    "UPDATE users SET activation_token_expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    [userId]
  );
  expect(await deliver()).toBe('cancelled');
  expect(received).toHaveLength(0);
  await fixture.pool
    .query(`CREATE FUNCTION reject_staff_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected queue failure'; END; $$;
    CREATE TRIGGER reject_staff_delivery BEFORE INSERT ON auth_delivery_outbox FOR EACH ROW EXECUTE FUNCTION reject_staff_delivery()`);
  const session = (
    await fixture.pool.query(
      "SELECT session_id,csrf_token FROM sessions WHERE user_id='provider-admin' LIMIT 1"
    )
  ).rows[0];
  const response = await post(
    'admin/users/create-staff',
    {
      username: 'rollback-staff@example.test',
      firstName: 'Rollback',
      lastName: 'Staff',
      roleIds: [],
      activationMethod: 'link',
    },
    { Cookie: `barghsa_session=${session.session_id}`, 'X-CSRF-Token': session.csrf_token }
  );
  expect(response.status).toBe(500);
  expect(
    (
      await fixture.pool.query(
        "SELECT count(*)::int AS count FROM users WHERE username='rollback-staff@example.test'"
      )
    ).rows[0].count
  ).toBe(0);
});

it('lets an administrator replace a pending activation and invalidates the previous link', async () => {
  const userId = await createStaff();
  expect(await deliver()).toBe('sent');
  const first = new URLSearchParams(
    new URL(received[0]!.text.match(/https:\/\/[^\s]+/)![0]).hash.slice(1)
  ).get('token')!;
  const session = (
    await fixture.pool.query(
      "SELECT session_id,csrf_token FROM sessions WHERE user_id='provider-admin' LIMIT 1"
    )
  ).rows[0];
  const headers = {
    Cookie: `barghsa_session=${session.session_id}`,
    'X-CSRF-Token': session.csrf_token,
  };
  const staffStatus = async () => {
    const response = await fetch(`${fixture.base}/api/admin/staff`, { headers });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      items: { userId: string; activationPending: boolean; activationExpiresAt: string | null }[];
    };
    return data.items.find((item) => item.userId === userId)!;
  };
  expect(await staffStatus()).toMatchObject({
    activationPending: true,
    activationExpiresAt: expect.any(String),
  });
  const tooSoon = await post(`admin/users/${userId}/resend-activation`, {}, headers);
  expect(tooSoon.status, await tooSoon.text()).toBe(429);
  expect(Number(tooSoon.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(Number(tooSoon.headers.get('retry-after'))).toBeLessThanOrEqual(60);
  await fixture.pool.query("UPDATE auth_delivery_outbox SET created_at=NOW()-INTERVAL '2 minutes'");
  const replaced = await post(`admin/users/${userId}/resend-activation`, {}, headers);
  expect(replaced.status, await replaced.text()).toBe(200);
  const stale = await post('auth/activate-staff', {
    token: first,
    newPassword: 'Activated-staff-password-123!',
  });
  expect(stale.status, await stale.text()).toBe(401);
  expect(await deliver()).toBe('sent');
  const next = new URLSearchParams(
    new URL(received[1]!.text.match(/https:\/\/[^\s]+/)![0]).hash.slice(1)
  ).get('token')!;
  expect(next).not.toBe(first);
  const activated = await post('auth/activate-staff', {
    token: next,
    newPassword: 'Activated-staff-password-123!',
  });
  expect(activated.status, await activated.text()).toBe(200);
  expect(await staffStatus()).toMatchObject({
    activationPending: false,
    activationExpiresAt: null,
  });
  const afterActivation = await post(`admin/users/${userId}/resend-activation`, {}, headers);
  expect(afterActivation.status, await afterActivation.text()).toBe(409);
});

it('rolls back challenge creation if the delivery insert fails', async () => {
  await fixture.pool
    .query(`CREATE FUNCTION reject_auth_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected delivery failure'; END; $$;
    CREATE TRIGGER reject_auth_delivery BEFORE INSERT ON auth_delivery_outbox FOR EACH ROW EXECUTE FUNCTION reject_auth_delivery()`);
  const response = await post('auth/register', {
    username: 'delivery@example.test',
    password,
    tosVersionId: terms,
  });
  expect(response.status).toBe(500);
  expect(
    (await fixture.pool.query('SELECT count(*)::int AS count FROM otp_challenges')).rows[0].count
  ).toBe(0);
});

it('changes username only with both codes delivered to the old and new mailboxes', async () => {
  const sessionId = randomUUID(),
    csrf = randomUUID();
  await fixture.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'provider-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [sessionId, csrf, randomUUID()]
  );
  const headers = { Cookie: `barghsa_session=${sessionId}`, 'X-CSRF-Token': csrf };
  const issued = await post(
    'auth/change-username/send-otp',
    { newUsername: 'PAIR-NEW@example.test' },
    headers
  );
  const pair = (await issued.json()) as { destination: string; challengeId: string };
  expect(issued.status, JSON.stringify(pair)).toBe(200);
  expect(pair.destination).toBe('pair-new@example.test');
  expect(await deliver()).toBe('sent');
  expect(await deliver()).toBe('sent');
  expect(received.map((message) => message.to[0]).sort()).toEqual([
    'pair-new@example.test',
    'provider@example.test',
  ]);
  const code = (address: string) =>
    received.find((message) => message.to[0] === address)!.text.match(/\d{6}/)![0];
  const response = await post(
    'auth/change-username',
    {
      newUsername: pair.destination,
      otpChallengeId: pair.challengeId,
      otp: code('pair-new@example.test'),
      previousOtp: code('provider@example.test'),
    },
    headers
  );
  expect(response.status, await response.text()).toBe(200);
  expect(
    (await fixture.pool.query("SELECT username FROM users WHERE user_id='provider-admin'")).rows[0]
      .username
  ).toBe(pair.destination);
  expect(
    (
      await fixture.pool.query(
        'SELECT count(*)::int AS count FROM otp_challenges WHERE consumed_at IS NOT NULL'
      )
    ).rows[0].count
  ).toBe(2);
});

it('trusts only the opaque browser cookie after OTP and rejects public fingerprint imitation, expiry and revocation', async () => {
  await fixture.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='provider-admin'", [
    await argon2.hash(password),
  ]);
  const userAgent = 'Common browser string';
  await fixture.pool.query(
    `INSERT INTO device_trusts(id,user_id,device_fingerprint,expires_at)
    VALUES ($1,'provider-admin',$2,NOW()+INTERVAL '1 day')`,
    [randomUUID(), createHash('sha256').update(userAgent).digest('hex')]
  );
  const credentials = {
    username: 'provider@example.test',
    password,
    deviceInfo: { fingerprint: userAgent },
  };
  const first = await post('auth/login', credentials, { 'User-Agent': userAgent });
  const challenge = (await first.json()) as { requiresOtp: boolean; challengeId: string };
  expect(first.status).toBe(200);
  expect(challenge.requiresOtp).toBe(true);
  const cookie = first.headers.get('set-cookie')!.split(';')[0]!;
  expect(cookie).toMatch(/^barghsa_device=[a-f0-9]{64}$/);
  expect(first.headers.get('set-cookie')).toContain('HttpOnly');
  const token = cookie.split('=')[1]!;
  expect(await deliver()).toBe('sent');
  const otp = received.at(-1)!.text.match(/\d{6}/)?.[0];
  const verified = await post(
    'auth/login/verify',
    { challengeId: challenge.challengeId, otp, trustDevice: true },
    { Cookie: cookie, 'User-Agent': userAgent }
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  expect(await verified.text()).not.toContain(token);
  const trustedHash = createHash('sha256').update(token).digest('hex');
  expect(
    (
      await fixture.pool.query(
        'SELECT count(*)::int AS count FROM device_trusts WHERE device_fingerprint=$1',
        [trustedHash]
      )
    ).rows[0].count
  ).toBe(1);
  const returning = await post('auth/login', credentials, {
    Cookie: cookie,
    'User-Agent': 'Updated browser version',
  });
  expect(returning.status).toBe(200);
  expect(await returning.json()).toMatchObject({ requiresOtp: false });
  const sessionCount = async () =>
    (await fixture.pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count;
  const beforeRiskChecks = await sessionCount();
  for (const address of ['192.0.2.44', '2001:db8::4', null]) {
    await fixture.pool.query('UPDATE device_trusts SET ip_address=$1 WHERE device_fingerprint=$2', [
      address,
      trustedHash,
    ]);
    await fixture.pool.query(
      'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
    );
    const changedNetwork = await post('auth/login', credentials, {
      Cookie: cookie,
      // Untrusted forwarded headers cannot supply the address recorded after OTP.
      'X-Forwarded-For': address ?? '127.0.0.1',
    });
    expect(changedNetwork.status, await changedNetwork.clone().text()).toBe(200);
    expect(await changedNetwork.json()).toMatchObject({ requiresOtp: true });
    expect(changedNetwork.headers.getSetCookie()).toEqual([]);
    expect(await sessionCount()).toBe(beforeRiskChecks);
  }
  await fixture.pool.query(
    "UPDATE device_trusts SET ip_address='127.0.0.1' WHERE device_fingerprint=$1",
    [trustedHash]
  );
  // Reset only isolated send quotas between independent new-device/expiry checks.
  await fixture.pool.query(
    'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
  );
  const imitation = await post(
    'auth/login',
    { ...credentials, deviceInfo: { fingerprint: token } },
    { 'User-Agent': userAgent }
  );
  expect(imitation.status).toBe(200);
  expect(await imitation.json()).toMatchObject({ requiresOtp: true });
  expect(imitation.headers.get('set-cookie')).not.toContain(token);
  await fixture.pool.query(
    "UPDATE device_trusts SET expires_at=NOW()-INTERVAL '1 second' WHERE device_fingerprint=$1",
    [trustedHash]
  );
  await fixture.pool.query(
    'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
  );
  const expired = await post('auth/login', credentials, { Cookie: cookie });
  expect(await expired.json()).toMatchObject({ requiresOtp: true });
  await fixture.pool.query('DELETE FROM device_trusts WHERE device_fingerprint=$1', [trustedHash]);
  await fixture.pool.query(
    'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
  );
  const revoked = await post('auth/login', credentials, { Cookie: cookie });
  expect(await revoked.json()).toMatchObject({ requiresOtp: true });
}, 20000);

it.each([true, false])(
  'refreshes existing device context only when OTP trust opt-in is %s',
  async (trustDevice) => {
    await fixture.pool.query("UPDATE users SET password_hash=$1 WHERE user_id='provider-admin'", [
      await argon2.hash(password),
    ]);
    const token = 'e'.repeat(64);
    const hash = createHash('sha256').update(token).digest('hex');
    const id = randomUUID();
    await fixture.pool.query(
      `INSERT INTO device_trusts(id,user_id,device_fingerprint,user_agent_hint,ip_address,expires_at)
     VALUES ($1,'provider-admin',$2,'Old browser','192.0.2.1',NOW()+INTERVAL '1 day')`,
      [id, hash]
    );
    const headers = { Cookie: `barghsa_device=${token}`, 'User-Agent': 'Updated browser' };
    const credentials = { username: 'provider@example.test', password };
    const login = await post('auth/login', credentials, headers);
    expect(login.status).toBe(200);
    const challenge = (await login.json()) as { requiresOtp: boolean; challengeId: string };
    expect(challenge.requiresOtp).toBe(true);
    const unchanged = await fixture.pool.query('SELECT * FROM device_trusts WHERE id=$1', [id]);
    expect(unchanged.rows[0].ip_address).toBe('192.0.2.1');
    expect(await deliver()).toBe('sent');
    const otp = received.at(-1)!.text.match(/\d{6}/)![0];
    const verified = await post(
      'auth/login/verify',
      { challengeId: challenge.challengeId, otp, trustDevice },
      headers
    );
    expect(verified.status, await verified.clone().text()).toBe(200);
    const trust = await fixture.pool.query(
      'SELECT id,ip_address,user_agent_hint,EXTRACT(EPOCH FROM expires_at-trusted_at)::int AS seconds FROM device_trusts WHERE device_fingerprint=$1',
      [hash]
    );
    if (trustDevice) {
      expect(trust.rows).toEqual([
        { id, ip_address: '127.0.0.1', user_agent_hint: 'Updated browser', seconds: 30 * 86400 },
      ]);
    } else {
      expect(
        (await fixture.pool.query('SELECT * FROM device_trusts WHERE id=$1', [id])).rows
      ).toEqual(unchanged.rows);
    }
    await fixture.pool.query(
      'DELETE FROM security_rate_limit_counters; DELETE FROM rate_limit_windows WHERE security'
    );
    const returning = await post('auth/login', credentials, headers);
    expect(returning.status).toBe(200);
    expect(await returning.json()).toMatchObject({ requiresOtp: !trustDevice });
  },
  20000
);
