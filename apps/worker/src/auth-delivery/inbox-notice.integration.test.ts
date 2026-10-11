import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { encryptAuthDelivery } from '@barghsa/shared/auth-delivery';
import { runAuthDelivery } from './runner.js';
import { publishAuthDeliveryNotice } from './inbox-notice.js';
import { runOutboxPoll } from '../notifications/outbox-runner.js';
import { InAppNotificationTransport } from '../notifications/in-app-transport.js';

let pool: Pool, management: Pool;
let historical: string;
const database = `test_auth_notice_${randomUUID().replaceAll('-', '')}`;
const folder = resolve(__dirname, '../../../../packages/db/drizzle/production');
const destination = 'notice@example.test',
  code = '123456';
beforeAll(async () => {
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'fixture-notice-key');
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries) {
    if (entry.tag === '0276_auth_delivery_notices') {
      await pool.query(
        "INSERT INTO users(user_id,username,password_hash) VALUES ('notice-user',$1,'fixture-only')",
        [destination]
      );
      historical = await queue();
      await pool.query(
        "UPDATE auth_delivery_outbox SET status='sent',encrypted_payload=NULL WHERE id=$1",
        [historical]
      );
      await pool.query(
        `INSERT INTO notification_templates(id,event_key,channel,locale,body_template,variables,status,is_active)
        VALUES($1,'auth.otp_sent','in_app','fa','{{verificationCode}}','[{"name":"verificationCode"}]','active',true)`,
        [randomUUID()]
      );
    }
    await pool.query(readFileSync(resolve(folder, entry.tag + '.sql'), 'utf8'));
  }
}, 30000);
afterAll(async () => {
  await pool?.end();
  await management?.query(`DROP DATABASE IF EXISTS "${database}"`);
  await management?.end();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  vi.stubEnv('AUTH_DELIVERY_ENCRYPTION_KEY', 'fixture-notice-key');
  await pool.query('DELETE FROM notification_outbox');
  await pool.query('DELETE FROM in_app_notifications');
});
async function queue(user = 'notice-user', purpose = 'login') {
  const id = randomUUID(),
    challenge = randomUUID();
  const hash = createHash('sha256').update(code).digest('hex');
  await pool.query(
    `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,purpose,user_id,expires_at,password_hash,tos_version_id)
    VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes',$6,$7)`,
    [
      challenge,
      destination,
      hash,
      purpose,
      user || null,
      purpose === 'registration' ? 'fixture-only' : null,
      purpose === 'registration' ? 'fixture-terms' : null,
    ]
  );
  await pool.query(
    `INSERT INTO auth_delivery_outbox(id,challenge_id,code_hash,encrypted_payload,expires_at)
    VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')`,
    [id, challenge, hash, encryptAuthDelivery(id, { code, destination })]
  );
  return id;
}
async function successful() {
  const id = await queue();
  const send = vi.fn(async () => 'accepted-otp-receipt');
  expect(await runAuthDelivery(pool, send)).toBe('sent');
  return { id, send };
}
it('upgrades without replaying old successful sends and preserves secret template lineage', async () => {
  expect(
    (
      await pool.query(
        'SELECT sent_at,notice_user_id,inbox_notice_pending FROM auth_delivery_outbox WHERE id=$1',
        [historical]
      )
    ).rows[0]
  ).toEqual({ sent_at: null, notice_user_id: null, inbox_notice_pending: false });
  const templates = (
    await pool.query(
      "SELECT version,status,is_active,supersedes_version,body_template FROM notification_templates WHERE event_key='auth.otp_sent' ORDER BY version"
    )
  ).rows;
  expect(templates).toHaveLength(2);
  expect(templates[0]).toMatchObject({
    version: 1,
    status: 'archived',
    is_active: false,
    body_template: '{{verificationCode}}',
  });
  expect(templates[1]).toMatchObject({
    version: 2,
    status: 'active',
    is_active: true,
    supersedes_version: 1,
  });
  expect(templates[1].body_template).not.toContain('verificationCode');
  expect(await publishAuthDeliveryNotice(pool)).toBe('idle');
});
it('publishes once after confirmed delivery and the real worker delivers a private bilingual notice', async () => {
  const { id, send } = await successful();
  expect(await publishAuthDeliveryNotice(pool)).toBe('published');
  expect(await publishAuthDeliveryNotice(pool)).toBe('idle');
  const event = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='auth.otp_sent' AND idempotency_key=$1",
      [`auth.otp_sent:${id}:notice-user`]
    )
  ).rows[0];
  expect(event).toMatchObject({ profile_id: null, user_id: 'notice-user', channels: ['in_app'] });
  expect(Object.keys(event.payload).sort()).toEqual(['channel', 'purpose', 'sentAt']);
  expect(event.payload).toMatchObject({
    channel: 'ایمیل / Email',
    purpose: 'ورود / Sign-in',
    sentAt: expect.any(String),
  });
  expect(
    await runOutboxPoll({ pool, transports: { in_app: new InAppNotificationTransport(pool) } })
  ).toMatchObject({ delivered: 1, failed: 0 });
  const notice = (await pool.query("SELECT * FROM in_app_notifications WHERE type='auth.otp_sent'"))
    .rows[0];
  expect(notice).toMatchObject({
    profile_id: null,
    recipient_user_id: 'notice-user',
    operating_context: 'account',
    link_route: '/settings/security',
  });
  expect(notice.localized_content.fa.body).toContain('ورود');
  expect(notice.localized_content.en.body).toContain('Sign-in');
  expect(JSON.stringify([event.payload, notice.params, notice.localized_content])).not.toMatch(
    /123456|notice@example|accepted-otp-receipt|otp_hash|encrypted_payload/
  );
  await pool.query('UPDATE in_app_notifications SET is_read=true WHERE id=$1', [notice.id]);
  const snapshot = JSON.stringify((await pool.query('SELECT * FROM in_app_notifications')).rows);
  expect(await runAuthDelivery(pool, send)).toBe('idle');
  expect(send).toHaveBeenCalledOnce();
  expect(await publishAuthDeliveryNotice(pool)).toBe('idle');
  expect(JSON.stringify((await pool.query('SELECT * FROM in_app_notifications')).rows)).toBe(
    snapshot
  );
});
it.each(['raise', 'suppress'])(
  'rolls back a %s job insert and retries only the inbox intent, never provider I/O',
  async (failure) => {
    const { id, send } = await successful();
    await pool.query(`CREATE FUNCTION reject_notice_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${failure === 'raise' ? "RAISE EXCEPTION 'injected job failure';" : 'RETURN NULL;'} END $$;
    CREATE TRIGGER reject_notice_job BEFORE INSERT ON notification_job FOR EACH ROW EXECUTE FUNCTION reject_notice_job()`);
    try {
      await expect(publishAuthDeliveryNotice(pool)).rejects.toThrow(
        failure === 'raise' ? 'injected job failure' : 'Auth delivery notice intent was not stored'
      );
    } finally {
      await pool.query(
        'DROP TRIGGER reject_notice_job ON notification_job; DROP FUNCTION reject_notice_job()'
      );
    }
    expect(
      (
        await pool.query(
          'SELECT status,encrypted_payload,inbox_notice_pending FROM auth_delivery_outbox WHERE id=$1',
          [id]
        )
      ).rows[0]
    ).toEqual({ status: 'sent', encrypted_payload: null, inbox_notice_pending: true });
    expect(
      (await pool.query("SELECT id FROM notification_outbox WHERE event_key='auth.otp_sent'"))
        .rowCount
    ).toBe(0);
    expect(await runAuthDelivery(pool, send)).toBe('idle');
    expect(await publishAuthDeliveryNotice(pool)).toBe('published');
    expect(send).toHaveBeenCalledOnce();
  }
);
it('serializes competing notice publishers and never resolves a different current contact owner', async () => {
  const { id } = await successful();
  await pool.query("UPDATE users SET username='changed@example.test' WHERE user_id='notice-user'");
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('new-contact-owner',$1,'fixture-only')",
    [destination]
  );
  const outcomes = await Promise.all([
    publishAuthDeliveryNotice(pool),
    publishAuthDeliveryNotice(pool),
  ]);
  expect(outcomes.sort()).toEqual(['idle', 'published']);
  const events = (
    await pool.query('SELECT user_id FROM notification_outbox WHERE idempotency_key=$1', [
      `auth.otp_sent:${id}:notice-user`,
    ])
  ).rows;
  expect(events).toEqual([{ user_id: 'notice-user' }]);
});
it('keeps anonymous registration private until its exact verified account is bound', async () => {
  const id = await queue('', 'registration');
  await pool.query(
    "UPDATE auth_delivery_outbox SET status='sent',encrypted_payload=NULL WHERE id=$1",
    [id]
  );
  expect(await publishAuthDeliveryNotice(pool)).toBe('idle');
  await pool.query('UPDATE auth_delivery_outbox SET notice_user_id=$2 WHERE id=$1', [
    id,
    'notice-user',
  ]);
  expect(await publishAuthDeliveryNotice(pool)).toBe('published');
  expect(
    (
      await pool.query('SELECT user_id FROM notification_outbox WHERE idempotency_key=$1', [
        `auth.otp_sent:${id}:notice-user`,
      ])
    ).rows
  ).toEqual([{ user_id: 'notice-user' }]);
});

it('publishes no success notice for a failed or pending physical delivery', async () => {
  await queue();
  const send = vi.fn(async () => {
    throw new Error('Provider unavailable');
  });
  expect(await runAuthDelivery(pool, send)).toBe('retry');
  expect(await publishAuthDeliveryNotice(pool)).toBe('idle');
  expect(
    (await pool.query("SELECT id FROM notification_outbox WHERE event_key='auth.otp_sent'"))
      .rowCount
  ).toBe(0);
});
