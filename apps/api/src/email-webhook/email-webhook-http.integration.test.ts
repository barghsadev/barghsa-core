import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture';
import { ProviderSecretsService } from '../provider-config/provider-secrets.service';

const key = 'webhook-http-fixture-key';
const secret = `whsec_${Buffer.from('webhook-http-signing-secret').toString('base64')}`;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const providerId = randomUUID();
const sessionId = randomUUID();
let profileId: string;

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
    [providerId, config]
  );
  await http.pool
    .query(`INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('webhook-review','Webhook review','Fixture','["admin:jobs:view"]');
    INSERT INTO user_roles(user_id,role_id) VALUES ('webhook-staff','webhook-review')`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,'webhook-staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour')`,
    [sessionId, randomUUID(), randomUUID()]
  );
  profileId = (
    await http.pool.query("INSERT INTO profiles(user_id) VALUES ('webhook-staff') RETURNING id")
  ).rows[0].id;
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM email_suppressions');
  await http.pool.query('DELETE FROM email_webhook_events');
  await http.pool.query('DELETE FROM notification_outbox');
});

async function queue(messageId: string, receipt = true, receiptProvider = providerId) {
  const id = randomUUID(),
    token = randomUUID();
  await http.pool.query(
    `INSERT INTO notification_outbox(id,profile_id,event_key,channels,idempotency_key,status,provider_ref)
    VALUES ($1::uuid,$2,'invoice.created',ARRAY['email','sms'],$1::text,'sending','other-sms-reference')`,
    [id, profileId]
  );
  await http.pool.query(
    "INSERT INTO notification_job(outbox_id,channel,status) VALUES ($1,'email','done'),($1,'sms','running')",
    [id]
  );
  async function accept() {
    await http.pool.query(
      `INSERT INTO notification_send_receipts(outbox_id,channel,status,provider_id,transport,idempotency_key,attempt_token,attempt_number,provider_ref,accepted_at)
      VALUES ($1,'email','accepted',$2,'resend',$3,$4,1,$5,NOW())`,
      [id, receiptProvider, randomUUID(), token, messageId]
    );
    await http.pool.query(
      `INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref,send_attempt_token,latency_ms)
      VALUES ($1,'email','delivered',1,$2,$3,123)`,
      [id, messageId, token]
    );
  }
  if (receipt) await accept();
  return { id, token, accept };
}

async function history(id: string, status?: string) {
  const response = await fetch(
    `${http.base}/api/admin/notifications/delivery-logs?notificationId=${id}${status ? `&status=${status}` : ''}`,
    { headers: { Cookie: `barghsa_session=${sessionId}` } }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Array<{
    status: string;
    attemptNumber: number;
    latencyMs: number;
    errorCategory: string | null;
  }>;
}

it('binds callbacks to the accepted email receipt and preserves sibling work and physical attempts', async () => {
  const messageId = randomUUID();
  const row = await queue(messageId);
  expect((await post(payload('email.delivered', { email_id: messageId }))).status).toBe(200);
  expect((await http.pool.query('SELECT outbox_id FROM email_webhook_events')).rows).toEqual([
    { outbox_id: row.id },
  ]);
  expect(
    (await http.pool.query('SELECT status FROM notification_outbox WHERE id=$1', [row.id])).rows[0]
      .status
  ).toBe('sending');
  expect(
    (
      await http.pool.query(
        'SELECT channel,status FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [row.id]
      )
    ).rows
  ).toEqual([
    { channel: 'email', status: 'done' },
    { channel: 'sms', status: 'running' },
  ]);
  expect(await history(row.id)).toMatchObject([
    { status: 'delivered', attemptNumber: 1, latencyMs: 123 },
  ]);
});

it('shows a bounce on the original attempt without changing accepted receipts, adding attempts or reviving work', async () => {
  const messageId = randomUUID();
  const row = await queue(messageId);
  await http.pool.query("UPDATE notification_outbox SET status='delivered' WHERE id=$1", [row.id]);
  expect((await post(payload('email.bounced', { email_id: messageId }))).status).toBe(200);
  expect((await post(payload('email.delivered', { email_id: messageId }))).status).toBe(200);
  expect(
    (await http.pool.query('SELECT status FROM notification_outbox WHERE id=$1', [row.id])).rows[0]
      .status
  ).toBe('delivered');
  expect(
    (
      await http.pool.query('SELECT status FROM notification_send_receipts WHERE outbox_id=$1', [
        row.id,
      ])
    ).rows[0].status
  ).toBe('accepted');
  expect(
    (
      await http.pool.query(
        'SELECT status,attempt_number,latency_ms FROM notification_delivery_log WHERE notification_id=$1',
        [row.id]
      )
    ).rows
  ).toEqual([{ status: 'delivered', attempt_number: 1, latency_ms: 123 }]);
  expect(await history(row.id, 'failed')).toMatchObject([
    { status: 'failed', attemptNumber: 1, latencyMs: 123, errorCategory: 'permanent' },
  ]);
  expect(await history(row.id, 'delivered')).toEqual([]);
});

it('retains early feedback and applies it when the matching receipt becomes durable', async () => {
  const messageId = randomUUID();
  const row = await queue(messageId, false);
  expect((await post(payload('email.bounced', { email_id: messageId }))).status).toBe(200);
  await row.accept();
  expect(await history(row.id)).toMatchObject([{ status: 'failed', attemptNumber: 1 }]);
});

it('does not attach a callback to another provider with a coincidentally equal reference', async () => {
  const messageId = randomUUID();
  const row = await queue(messageId, true, randomUUID());
  await http.pool.query('UPDATE notification_outbox SET provider_ref=$2 WHERE id=$1', [
    row.id,
    messageId,
  ]);
  expect((await post(payload('email.bounced', { email_id: messageId }))).status).toBe(200);
  expect((await http.pool.query('SELECT outbox_id FROM email_webhook_events')).rows).toEqual([
    { outbox_id: null },
  ]);
  expect(await history(row.id)).toMatchObject([{ status: 'delivered', attemptNumber: 1 }]);
});

it('refuses disabled signing configurations and writes no event', async () => {
  try {
    await http.pool.query("UPDATE email_provider_configs SET status='disabled' WHERE id=$1", [
      providerId,
    ]);
    expect((await post(payload())).status).toBe(503);
    expect((await http.pool.query('SELECT id FROM email_webhook_events')).rowCount).toBe(0);
  } finally {
    await http.pool.query("UPDATE email_provider_configs SET status='active' WHERE id=$1", [
      providerId,
    ]);
  }
});

it('retains all verifying versions when configurations share the same endpoint secret', async () => {
  const earlierId = randomUUID();
  await http.pool.query(
    `INSERT INTO email_provider_configs(id,transport,label,status,config,created_by,activated_at)
    SELECT $2,transport,'Earlier version','superseded',config,created_by,NOW() FROM email_provider_configs WHERE id=$1`,
    [providerId, earlierId]
  );
  try {
    const messageId = randomUUID();
    const row = await queue(messageId, true, earlierId);
    expect((await post(payload('email.bounced', { email_id: messageId }))).status).toBe(200);
    const event = (
      await http.pool.query('SELECT outbox_id,verified_provider_ids FROM email_webhook_events')
    ).rows[0];
    expect(event.outbox_id).toBe(row.id);
    expect(new Set(event.verified_provider_ids)).toEqual(new Set([providerId, earlierId]));
    expect(await history(row.id)).toMatchObject([{ status: 'failed' }]);
  } finally {
    await http.pool.query('DELETE FROM email_provider_configs WHERE id=$1', [earlierId]);
  }
});

it('does not invent provider attribution for legacy callback rows', async () => {
  const messageId = randomUUID();
  const row = await queue(messageId);
  await http.pool.query(
    `INSERT INTO email_webhook_events(event_token,event_type,message_id,status,raw)
    VALUES ($1,'email.bounced',$2,'failed',$3)`,
    [randomUUID(), messageId, payload()]
  );
  expect(await history(row.id)).toMatchObject([{ status: 'delivered' }]);
});

it('accepts delayed callbacks from a superseded provider without decrypting its send credential', async () => {
  const messageId = randomUUID();
  const row = await queue(messageId);
  const original = (
    await http.pool.query('SELECT config FROM email_provider_configs WHERE id=$1', [providerId])
  ).rows[0].config;
  try {
    await http.pool.query(
      "UPDATE email_provider_configs SET status='superseded',config=jsonb_set(config,'{api_key}','\"enc:v1:unreadable\"') WHERE id=$1",
      [providerId]
    );
    expect((await post(payload('email.bounced', { email_id: messageId }))).status).toBe(200);
    expect(await history(row.id)).toMatchObject([{ status: 'failed', attemptNumber: 1 }]);
  } finally {
    await http.pool.query(
      "UPDATE email_provider_configs SET config=$2,status='active' WHERE id=$1",
      [providerId, original]
    );
  }
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
