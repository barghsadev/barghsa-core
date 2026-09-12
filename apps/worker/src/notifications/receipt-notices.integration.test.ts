import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import {
  buildBankReceiptTopUpCompletedNotificationPayload,
  buildBankReceiptTopUpFailedNotificationPayload,
  buildInvoiceBankReceiptRejectedNotificationPayload,
  onlineTopUpExpiryNoticeReason,
} from '@barghsa/shared/finance';
import { buildSeedTemplates } from '../../../../packages/db/dist/seed/notification-templates.js';
import { expireStaleOnlineTopUps } from '../wallet/online-topup-expiry-scanner.js';
import { enqueueOutbox } from './outbox-writer.js';
import { runOutboxPoll } from './outbox-runner.js';
import { EmailNotificationTransport } from './email-transport.js';
import { InAppNotificationTransport } from './in-app-transport.js';

const name = `test_receipt_notices_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool;
const templates = buildSeedTemplates().filter((t) =>
  [
    'payment.wallet_topup_completed',
    'payment.wallet_topup_failed',
    'payment.bank_receipt_rejected',
  ].includes(t.eventKey)
);
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  pool = new Pool({ connectionString: url.toString(), max: 5 });
  const folder = resolve(__dirname, '../../../../packages/db/drizzle/production');
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries)
    await pool.query(readFileSync(resolve(folder, `${entry.tag}.sql`), 'utf8'));
  for (const t of templates) {
    await pool.query(
      "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key=$1 AND channel=$2 AND locale=$3",
      [t.eventKey, t.channel, t.locale]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,version,subject,body_template,variables,status,is_active)
    VALUES($1,$2,$3,900,$4,$5,$6,'active',true)`,
      [t.eventKey, t.channel, t.locale, t.subject, t.bodyTemplate, JSON.stringify(t.variables)]
    );
  }
}, 30000);
beforeEach(async () => {
  await pool.query(
    "UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')"
  );
  await pool.query("UPDATE email_provider_configs SET status='superseded' WHERE status='active'");
});
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${name}"`);
    await management.end();
  }
});
async function customer(locale: 'fa' | 'en') {
  const userId = randomUUID(),
    email = `${userId}@example.test`;
  await pool.query(
    "INSERT INTO users(user_id,username,email,password_hash,locale,notification_preferences) VALUES($1,$2,$2,'fixture-only',$3,'IN_APP,EMAIL')",
    [userId, email, locale]
  );
  await pool.query(
    "UPDATE account_login_identifiers SET verified_at=NOW() WHERE destination=$2 AND user_id=$1 AND kind='email'",
    [userId, email]
  );
  const profileId = (
    await pool.query('INSERT INTO profiles(user_id) VALUES($1) RETURNING id', [userId])
  ).rows[0].id as string;
  await pool.query(
    `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Receipt fixture','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
    [JSON.stringify({ api_key: 'fixture-only', from_email: 'sender@example.test' }), userId]
  );
  return { userId, email, profileId };
}
async function pendingTopup(profileId: string) {
  await pool.query('INSERT INTO wallets(profile_id) VALUES($1) ON CONFLICT DO NOTHING', [
    profileId,
  ]);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,metadata,created_at)
 VALUES($1::uuid,$2,'topup',75000,'Pending',$1::text,'{"channel":"online","gateway":{"authority":"retained"}}',NOW()-INTERVAL '1 hour')`,
    [id, profileId]
  );
  return id;
}
for (const locale of ['fa', 'en'] as const) {
  for (const kind of ['completed', 'failed', 'rejected', 'expiry'] as const) {
    it(`delivers the real ${kind} template in ${locale} with the producer payload and one receipt`, async () => {
      const r = await customer(locale),
        transactionId = randomUUID(),
        reason = locale === 'fa' ? 'تصویر رسید خوانا نیست' : 'The receipt image is unclear';
      const eventKey =
        kind === 'completed'
          ? 'payment.wallet_topup_completed'
          : kind === 'rejected'
            ? 'payment.bank_receipt_rejected'
            : 'payment.wallet_topup_failed';
      let outboxId: string;
      if (kind === 'expiry') {
        await pendingTopup(r.profileId);
        const options = { pool, actorUserId: r.userId };
        expect((await expireStaleOnlineTopUps(options)).rejected).toBe(1);
        expect((await expireStaleOnlineTopUps(options)).rejected).toBe(0);
        const rows = (
          await pool.query('SELECT id,payload FROM notification_outbox WHERE profile_id=$1', [
            r.profileId,
          ])
        ).rows;
        expect(rows).toHaveLength(1);
        outboxId = rows[0].id;
        expect(rows[0].payload.reason).toBe(onlineTopUpExpiryNoticeReason(locale));
        expect(
          (
            await pool.query(
              'SELECT posted_balance::text,reserved_balance::text FROM wallets WHERE profile_id=$1',
              [r.profileId]
            )
          ).rows[0]
        ).toEqual({ posted_balance: '0', reserved_balance: '0' });
      } else {
        const payload =
          kind === 'completed'
            ? {
                ...buildBankReceiptTopUpCompletedNotificationPayload({
                  amount: '75000',
                  creditTransactionId: transactionId,
                  pendingTransactionId: randomUUID(),
                }),
              }
            : kind === 'failed'
              ? {
                  ...buildBankReceiptTopUpFailedNotificationPayload({
                    amount: '75000',
                    reason,
                    pendingTransactionId: transactionId,
                  }),
                }
              : {
                  ...buildInvoiceBankReceiptRejectedNotificationPayload({
                    receiptId: transactionId,
                    invoiceId: randomUUID(),
                    amount: '75000',
                    reason,
                    rejectedAt: new Date(),
                  }),
                };
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const input = {
            ...r,
            eventKey,
            payload,
            channels: ['in_app', 'email'] as ('in_app' | 'email')[],
            idempotencyKey: `${eventKey}:${transactionId}`,
          };
          const queued = await enqueueOutbox(client, input);
          expect(queued.inserted).toBe(true);
          expect((await enqueueOutbox(client, input)).inserted).toBe(false);
          outboxId = queued.outboxId!;
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      }
      const request = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ id: randomUUID() }), { status: 200 })
      );
      const options = {
        pool,
        deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
        transports: {
          in_app: new InAppNotificationTransport(pool),
          email: new EmailNotificationTransport(pool, request),
        },
      };
      expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
      expect(request).toHaveBeenCalledOnce();
      const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
      expect(sent.to).toEqual([r.email]);
      expect(sent.subject).toBe(
        templates.find(
          (t) => t.eventKey === eventKey && t.locale === locale && t.channel === 'email'
        )?.subject
      );
      expect(sent.html).toContain('75000');
      expect(sent.html).not.toContain('{{');
      if (kind === 'failed' || kind === 'rejected') expect(sent.html).toContain(reason);
      if (kind === 'expiry') expect(sent.html).toContain(onlineTopUpExpiryNoticeReason(locale));
      const job = (
        await pool.query(
          "SELECT delivery_payload,status FROM notification_job WHERE outbox_id=$1 AND channel='email'",
          [outboxId]
        )
      ).rows[0];
      expect(job).toMatchObject({ status: 'done', delivery_payload: { templateVersion: 900 } });
      expect(
        (
          await pool.query(
            'SELECT recipient_user_id AS user_id,profile_id FROM in_app_notifications WHERE delivery_key=$1',
            [`outbox:${outboxId}`]
          )
        ).rows
      ).toEqual([{ user_id: r.userId, profile_id: r.profileId }]);
      expect(await runOutboxPoll(options)).toEqual({ leased: 0, delivered: 0, failed: 0 });
      expect(request).toHaveBeenCalledOnce();
    });
  }
}
