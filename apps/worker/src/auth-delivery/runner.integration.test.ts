import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { decryptAuthDelivery, encryptAuthDelivery } from '@barghsa/shared/auth-delivery';
import { runAuthDelivery } from './runner.js';
import { createAuthSender, type AuthMessage } from './providers.js';

let pool: Pool, management: Pool;
const database = `test_delivery_${randomUUID().replaceAll('-', '')}`;
const code = '123456',
  destination = 'recipient@example.test';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  execFileSync(process.execPath, [resolve(__dirname, '../../../../packages/db/dist/migrate.js')], {
    env: { ...process.env, DATABASE_URL: url.toString(), PGDIRECT_URL: url.toString() },
    stdio: 'pipe',
  });
  pool = new Pool({ connectionString: url.toString() });
}, 20000);
afterAll(async () => {
  await pool?.end();
  try {
    await management?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await management?.end();
  }
});
beforeEach(async () => {
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'worker-delivery-fixture-key');
  vi.stubEnv('SMSIR_API_BASE', 'https://api.sms.ir');
  await pool.query('DELETE FROM auth_delivery_outbox');
  await pool.query('DELETE FROM otp_challenges');
  await pool.query('DELETE FROM sms_provider_configs');
  await pool.query('DELETE FROM email_provider_configs');
  await pool.query('DELETE FROM security_rate_limit_counters');
  await pool.query('DELETE FROM brand_config');
  await pool.query('DELETE FROM users');
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('delivery-user','recipient@example.test','fixture-only')"
  );
});
afterEach(() => vi.unstubAllEnvs());

async function queued(payload: unknown = { code, destination }, bound = true) {
  const id = randomUUID(),
    challenge = randomUUID();
  await pool.query(
    `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,purpose,expires_at,user_id)
    VALUES ($1,$2,$3,'login',NOW()+INTERVAL '10 minutes',$4)`,
    [challenge, destination, hash(code), bound ? 'delivery-user' : null]
  );
  await pool.query(
    `INSERT INTO auth_delivery_outbox(id,challenge_id,code_hash,encrypted_payload,expires_at)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')`,
    [id, challenge, hash(code), encryptAuthDelivery(id, payload)]
  );
  return { id, challenge };
}
async function state(id: string) {
  return (await pool.query('SELECT * FROM auth_delivery_outbox WHERE id=$1', [id])).rows[0];
}

it('returns idle with no claim and never calls a transport', async () => {
  const send = vi.fn();
  expect(await runAuthDelivery(pool, send)).toBe('idle');
  expect(send).not.toHaveBeenCalled();
});
it('delivers the bound challenge data, persists receipt and erases payload', async () => {
  const { id } = await queued({ code, destination, purpose: 'ignored', activationUrl: undefined });
  const send = vi.fn(async () => 'provider-receipt');
  expect(await runAuthDelivery(pool, send)).toBe('sent');
  expect(send).toHaveBeenCalledWith({
    id,
    code,
    destination,
    purpose: 'login',
    emailBranding: expect.objectContaining({ appTitle: 'Barghsa' }),
  });
  expect(await state(id)).toMatchObject({
    status: 'sent',
    provider_ref: 'provider-receipt',
    encrypted_payload: null,
    lease_token: null,
    lease_until: null,
  });
});
for (const invalid of [
  'expired',
  'consumed',
  'replaced',
  'exhausted',
  'disabled',
  'credential-change',
  'delivery-expired',
]) {
  it(`cancels ${invalid} challenges without exposing or sending their codes`, async () => {
    const { id, challenge } = await queued({ code, destination }, true);
    const updates: Record<string, string> = {
      expired: "UPDATE otp_challenges SET expires_at=NOW()-INTERVAL '1 second'",
      consumed: 'UPDATE otp_challenges SET consumed_at=NOW()',
      replaced: "UPDATE otp_challenges SET otp_hash='replacement'",
      exhausted: 'UPDATE otp_challenges SET attempts_remaining=0',
      disabled: 'UPDATE users SET disabled_at=NOW()',
      'credential-change': "UPDATE users SET password_hash='changed'",
      'delivery-expired': "UPDATE auth_delivery_outbox SET expires_at=NOW()-INTERVAL '1 second'",
    };
    await pool.query(updates[invalid]!);
    const send = vi.fn();
    expect(await runAuthDelivery(pool, send)).toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
    expect(await state(id)).toMatchObject({
      status: 'cancelled',
      encrypted_payload: null,
      lease_token: null,
    });
    expect(
      (
        await pool.query('SELECT challenge_id FROM otp_challenges WHERE challenge_id=$1', [
          challenge,
        ])
      ).rowCount
    ).toBe(1);
  });
}
for (const payload of [
  null,
  {},
  { code: 123456, destination },
  { code, destination: 'other@example.test' },
  { code: '654321', destination },
]) {
  it(`rejects malformed or mismatched encrypted payload ${JSON.stringify(payload)}`, async () => {
    const { id } = await queued(payload),
      send = vi.fn();
    expect(await runAuthDelivery(pool, send)).toBe('retry');
    expect(send).not.toHaveBeenCalled();
    expect(await state(id)).toMatchObject({
      status: 'pending',
      last_error: 'delivery_failed',
      attempts: 1,
      lease_token: null,
    });
  });
}
for (const damaged of ['missing', 'ciphertext', 'key']) {
  it(`handles ${damaged} encryption failure without leaking the payload`, async () => {
    const { id } = await queued();
    if (damaged === 'key') vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'wrong-key');
    else
      await pool.query('UPDATE auth_delivery_outbox SET encrypted_payload=$1', [
        damaged === 'missing' ? null : 'corrupt',
      ]);
    const send = vi.fn();
    expect(await runAuthDelivery(pool, send)).toBe('retry');
    expect(send).not.toHaveBeenCalled();
    expect((await state(id)).last_error).toBe('delivery_failed');
  });
}
it('bounds retries, applies backoff and wipes the final failed payload', async () => {
  const { id } = await queued(),
    send = vi.fn(async () => {
      throw new Error('provider failure with a secret');
    });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await pool.query("UPDATE auth_delivery_outbox SET available_at=NOW()-INTERVAL '1 second'");
    const before = Date.now();
    expect(await runAuthDelivery(pool, send)).toBe(attempt === 5 ? 'dead' : 'retry');
    const row = await state(id);
    expect(row.attempts).toBe(attempt);
    expect(row.last_error).toBe('delivery_failed');
    if (attempt < 5) {
      expect(new Date(row.available_at).getTime() - before).toBeGreaterThanOrEqual(
        5 * 2 ** (attempt - 1) * 1000 - 100
      );
      expect(row.encrypted_payload).toBeTruthy();
    } else expect(row.encrypted_payload).toBeNull();
  }
  expect(await runAuthDelivery(pool, send)).toBe('idle');
  expect(send).toHaveBeenCalledTimes(5);
});
it('does not call the provider after the retry budget was already consumed', async () => {
  const { id } = await queued();
  await pool.query('UPDATE auth_delivery_outbox SET attempts=5');
  const send = vi.fn();
  expect(await runAuthDelivery(pool, send)).toBe('dead');
  expect(send).not.toHaveBeenCalled();
  expect((await state(id)).encrypted_payload).toBeNull();
});
it('claims once during an in-flight send and recovers expired leases', async () => {
  const { id } = await queued();
  await pool.query(
    "UPDATE auth_delivery_outbox SET status='leased',lease_token=$1,lease_until=NOW()-INTERVAL '1 second'",
    [randomUUID()]
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = vi.fn(async () => {
    await held;
    return 'receipt';
  });
  const first = runAuthDelivery(pool, send);
  try {
    await expect.poll(() => send.mock.calls.length).toBe(1);
    expect(await runAuthDelivery(pool, send)).toBe('idle');
  } finally {
    release();
  }
  expect(await first).toBe('sent');
  expect((await state(id)).status).toBe('sent');
});
it('cannot overwrite a newer lease after a provider accepted the old attempt', async () => {
  const { id } = await queued(),
    newToken = randomUUID();
  const send = vi.fn(async () => {
    await pool.query(
      "UPDATE auth_delivery_outbox SET lease_token=$1,provider_ref='new-attempt' WHERE id=$2",
      [newToken, id]
    );
    return 'stale-receipt';
  });
  expect(await runAuthDelivery(pool, send)).toBe('retry');
  expect(await state(id)).toMatchObject({
    status: 'leased',
    lease_token: newToken,
    provider_ref: 'new-attempt',
  });
});
it('sends a valid staff activation with its encrypted link and cancels a replaced token', async () => {
  const id = randomUUID(),
    token = 'a'.repeat(64),
    link = `https://app.example.test/activate#token=${token}`;
  await pool.query(
    "UPDATE users SET is_staff=true,activation_token=$1,activation_token_expires_at=NOW()+INTERVAL '1 day'",
    [hash(token)]
  );
  await pool.query(
    `INSERT INTO auth_delivery_outbox(id,kind,user_id,code_hash,encrypted_payload,expires_at)
 VALUES ($1,'staff_activation','delivery-user',$2,$3,NOW()+INTERVAL '1 day')`,
    [id, hash(token), encryptAuthDelivery(id, { code: token, destination, activationUrl: link })]
  );
  const send = vi.fn(async () => 'activation-receipt');
  expect(await runAuthDelivery(pool, send)).toBe('sent');
  expect(send).toHaveBeenCalledWith({
    id,
    code: token,
    destination,
    purpose: 'staff_activation',
    activationUrl: link,
    emailBranding: expect.objectContaining({ appTitle: 'Barghsa' }),
  });
  await pool.query("UPDATE auth_delivery_outbox SET status='pending',encrypted_payload=$1", [
    encryptAuthDelivery(id, { code: token, destination, activationUrl: link }),
  ]);
  await pool.query("UPDATE users SET activation_token='replaced'");
  expect(await runAuthDelivery(pool, send)).toBe('cancelled');
  expect(send).toHaveBeenCalledOnce();
});

const smsConfig = {
  api_key: 'fixture-sms-key',
  sender: '9830000000',
  timeout: 15,
  throughput_limit: 1,
  low_credit_threshold: 0,
  template_mappings: [{ event_key: 'otp:login', template_id: '123', variables: { code: 'CODE' } }],
};
async function smsProvider(config: unknown = smsConfig) {
  await pool.query(
    `INSERT INTO sms_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES ('smsir','Fixture','active',$1,'delivery-user','passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('smsir'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
    [config]
  );
}
const message: AuthMessage = {
  id: 'message-1',
  destination: '09121234567',
  code,
  purpose: 'login',
};
for (const invalid of [
  { ...message, code: '123' },
  { ...message, purpose: 'staff_activation' },
  {
    ...message,
    code: 'a'.repeat(64),
    purpose: 'staff_activation',
    activationUrl: 'https://app.example.test/activate',
  },
]) {
  it(`rejects invalid authentication message ${invalid.purpose}/${invalid.code.length}`, async () => {
    const request = vi.fn();
    await expect(createAuthSender(pool, request)(invalid)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
}
it('rejects SMS delivery without an active tested provider', async () => {
  const request = vi.fn();
  await expect(createAuthSender(pool, request)(message)).rejects.toThrow(
    'Auth provider unavailable'
  );
  expect(request).not.toHaveBeenCalled();
});
for (const mapping of [
  undefined,
  [],
  [{ event_key: 'otp:other', template_id: '123', variables: { code: 'CODE' } }],
  [{ event_key: 'otp:login', template_id: 'invalid', variables: { code: 'CODE' } }],
  [{ event_key: 'otp:login', template_id: '123' }],
  [{ event_key: 'otp:login', template_id: '123', variables: { code: 'CODE', other: 'VALUE' } }],
]) {
  it(`rejects unsafe OTP SMS mapping ${JSON.stringify(mapping)}`, async () => {
    await smsProvider({ ...smsConfig, template_mappings: mapping });
    const request = vi.fn();
    await expect(createAuthSender(pool, request)(message)).rejects.toThrow(
      'OTP SMS template mapping unavailable'
    );
    expect(request).not.toHaveBeenCalled();
  });
}
it('rejects malformed mobile destinations before provider I/O', async () => {
  await smsProvider();
  const request = vi.fn();
  await expect(createAuthSender(pool, request)({ ...message, destination: '123' })).rejects.toThrow(
    'Invalid SMS destination'
  );
  expect(request).not.toHaveBeenCalled();
});
it('normalizes Iranian mobile numbers, sends the exact OTP mapping and enforces provider quota', async () => {
  vi.stubEnv('SMSIR_API_BASE', '');
  await smsProvider();
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ status: 1, data: { messageId: 123 } }), { status: 200 })
  );
  const send = createAuthSender(pool, request);
  expect(await send({ ...message, destination: '+989121234567' })).toBe('123');
  expect(request).toHaveBeenCalledOnce();
  const [url, options] = request.mock.calls[0]!;
  expect(url).toBe('https://api.sms.ir/v1/send/verify');
  expect(JSON.parse(String(options?.body))).toMatchObject({
    Mobile: '09121234567',
    TemplateId: 123,
    Parameters: [{ Name: 'CODE', Value: code }],
  });
  await expect(send({ ...message, id: 'message-2' })).rejects.toThrow('SMS provider quota reached');
  expect(request).toHaveBeenCalledOnce();
});
async function emailProvider() {
  await pool.query(
    `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES ('resend','Fixture','active',$1,'delivery-user','passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
    [{ api_key: 'fixture-mail-key', from_email: 'sender@example.test' }]
  );
}
it('sends OTP and activation email through the real shared adapter with stable idempotency', async () => {
  await emailProvider();
  const request = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ id: 'mail-receipt' }), { status: 200 })
  );
  const send = createAuthSender(pool, request);
  expect(await send({ ...message, destination })).toBe('mail-receipt');
  const link = 'https://app.example.test/activate#token=' + 'a'.repeat(64);
  expect(
    await send({
      ...message,
      id: 'activation-1',
      destination,
      code: 'a'.repeat(64),
      purpose: 'staff_activation',
      activationUrl: link,
    })
  ).toBe('mail-receipt');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]![1]?.headers).toMatchObject({ 'Idempotency-Key': message.id });
  expect(request.mock.calls[1]![1]?.headers).toMatchObject({ 'Idempotency-Key': 'activation-1' });
  const bodies = request.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
  expect(bodies[0].text).toContain(code);
  expect(bodies[1].text).toContain(link);
  expect(bodies[0].html).toContain('Barghsa');
  expect(bodies[1].html).toContain('Barghsa');
});

it('freezes active auth-email branding in encrypted delivery data across retries', async () => {
  await emailProvider();
  await pool.query(`INSERT INTO brand_config(config,version,status,created_by)
    VALUES ('{"appTitle":"First & Energy","primaryColor":"#123456"}',1,'active','delivery-user'),
    ('{"appTitle":"Draft name"}',2,'draft','delivery-user')`);
  const bodies: Record<string, unknown>[] = [];
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ id: 'branded-mail' }), {
      status: bodies.length === 1 ? 503 : 200,
    });
  });
  const sender = createAuthSender(pool, request);
  const { id } = await queued();
  expect(await runAuthDelivery(pool, sender)).toBe('retry');
  const saved = await state(id);
  expect(saved.encrypted_payload).not.toContain('First & Energy');
  expect(decryptAuthDelivery(id, saved.encrypted_payload)).toMatchObject({
    emailBranding: { appTitle: 'First & Energy' },
  });
  await pool.query(
    `UPDATE brand_config SET config='{"appTitle":"Later name","primaryColor":"#654321"}' WHERE status='active'`
  );
  await pool.query("UPDATE auth_delivery_outbox SET available_at=NOW()-INTERVAL '1 second'");
  expect(await runAuthDelivery(pool, sender)).toBe('sent');
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[1]?.subject).toContain('First & Energy');
  expect(bodies[1]?.html).toContain('First &amp; Energy');
  expect(bodies[1]?.html).toContain('#123456');
  expect(bodies[1]?.html).not.toMatch(/Draft name|Later name/);
  expect((await state(id)).encrypted_payload).toBeNull();
  await queued();
  expect(await runAuthDelivery(pool, sender)).toBe('sent');
  expect(bodies[2]?.subject).toContain('Later name');
});

it('retains the original plain email for already-attempted legacy delivery keys', async () => {
  await emailProvider();
  await queued();
  await pool.query('UPDATE auth_delivery_outbox SET attempts=1');
  const request = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ id: 'legacy-mail' }), { status: 200 })
  );
  expect(await runAuthDelivery(pool, createAuthSender(pool, request))).toBe('sent');
  const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(body.subject).toBe('کد تأیید برق‌آسا / Barghsa verification code');
  expect(body.text).toBe(
    `کد تأیید برق‌آسا: ${code}\nBarghsa verification code: ${code}\nاین کد را با کسی به اشتراک نگذارید. Do not share this code.`
  );
  expect(body.html).toBeUndefined();
});
