import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture';
import { ProviderSecretsService } from '../provider-config/provider-secrets.service';

const key = 'webhook-http-fixture-key';
const secret = `whsec_${Buffer.from('webhook-http-signing-secret').toString('base64')}`;
let http: Awaited<ReturnType<typeof startHttpFixture>>;

beforeAll(async () => {
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_KEY', key);
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    vi.unstubAllEnvs();
  }
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('webhook-staff','webhook-staff','fixture',true)"
  );
  const config = new ProviderSecretsService(key).encryptConfig('resend', {
    api_key: 're_fixture',
    from_email: 'sender@example.test',
    webhook_secret: secret,
  });
  await http.pool.query(
    `INSERT INTO email_provider_configs(id,transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
     VALUES ($1,'resend','Webhook fixture','active',$2,'webhook-staff','passed',NOW(),NOW(),
       encode(sha256(convert_to(jsonb_build_array('resend'::text,$2::jsonb)::text,'UTF8')),'hex'))`,
    [randomUUID(), config]
  );
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM email_suppressions');
  await http.pool.query('DELETE FROM email_webhook_events');
});

function payload(type = 'email.bounced', data: Record<string, unknown> = {}) {
  return {
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: randomUUID(),
      from: 'sender@example.test',
      to: ['recipient@example.test'],
      bounce: { type: 'Permanent', subType: 'NoEmail', message: 'Mailbox unavailable' },
      ...data,
    },
  };
}

async function post(
  event: unknown,
  options: { id?: string; rotation?: boolean; tampered?: boolean; stale?: boolean } = {}
) {
  const id = options.id ?? randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000) - (options.stale ? 3600 : 0));
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return fetch(`${http.base}/api/webhooks/email/resend`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `${options.rotation ? `v1,${Buffer.alloc(32).toString('base64')} ` : ''}v1,${signature}`,
    },
    body: options.tampered ? `${body} ` : body,
  });
}

it('accepts actual Resend hard bounces and suppresses each normalized recipient once', async () => {
  const event = payload('email.bounced', {
    to: ['Person@Example.test', 'person@example.test', 'second@example.test'],
  });
  const response = await post(event);
  expect(response.status).toBe(200);
  expect(
    (await http.pool.query('SELECT address,reason FROM email_suppressions ORDER BY address')).rows
  ).toEqual([
    { address: 'person@example.test', reason: 'hard_bounce' },
    { address: 'second@example.test', reason: 'hard_bounce' },
  ]);
  const stored = (await http.pool.query('SELECT raw FROM email_webhook_events')).rows[0];
  expect(stored.raw).toEqual(event);
});

it('accepts a complaint recipient array and deduplicates concurrent provider retries', async () => {
  const event = payload('email.complained');
  const id = randomUUID();
  const responses = await Promise.all([post(event, { id }), post(event, { id })]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect((await http.pool.query('SELECT reason FROM email_suppressions')).rows).toEqual([
    { reason: 'complaint' },
  ]);
  expect((await http.pool.query('SELECT id FROM email_webhook_events')).rowCount).toBe(1);
});

it('accepts the current signature after a stale space-separated rotation candidate', async () => {
  expect((await post(payload('email.clicked'), { rotation: true })).status).toBe(200);
});

it('does not suppress temporary bounces or delivery delays', async () => {
  expect((await post(payload('email.bounced', { bounce: { type: 'Temporary' } }))).status).toBe(
    200
  );
  expect((await post(payload('email.delivery_delayed'))).status).toBe(200);
  expect((await http.pool.query('SELECT id FROM email_suppressions')).rowCount).toBe(0);
});

for (const data of [
  null,
  [],
  { email_id: 'message', to: [null] },
  { email_id: {}, to: ['person@example.test'] },
]) {
  it(`rejects malformed signed data ${JSON.stringify(data)} without recording it`, async () => {
    expect((await post({ type: 'email.bounced', data })).status).toBe(400);
    expect((await http.pool.query('SELECT id FROM email_webhook_events')).rowCount).toBe(0);
  });
}

for (const options of [{ tampered: true }, { stale: true }]) {
  it(`rejects invalid request ${JSON.stringify(options)} before writing`, async () => {
    expect((await post(payload(), options)).status).toBe(401);
    expect((await http.pool.query('SELECT id FROM email_webhook_events')).rowCount).toBe(0);
  });
}

it('rolls back the event if suppression fails, allowing the same event to retry', async () => {
  await http.pool
    .query(`CREATE FUNCTION reject_webhook_suppression() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture suppression failure'; END $$;
    CREATE TRIGGER reject_webhook_suppression BEFORE INSERT ON email_suppressions FOR EACH ROW EXECUTE FUNCTION reject_webhook_suppression()`);
  const event = payload();
  const id = randomUUID();
  try {
    expect((await post(event, { id })).status).toBe(500);
    expect((await http.pool.query('SELECT id FROM email_webhook_events')).rowCount).toBe(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_webhook_suppression ON email_suppressions; DROP FUNCTION reject_webhook_suppression()'
    );
  }
  expect((await post(event, { id })).status).toBe(200);
  expect((await http.pool.query('SELECT id FROM email_suppressions')).rowCount).toBe(1);
});
