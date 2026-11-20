import type { Pool } from 'pg';
import {
  decryptProviderSecret,
  getSmsirDeliveryReport,
  SmsirConfigSchema,
} from '@barghsa/shared/auth-delivery';

interface SmsReportClaim {
  outbox_id: string;
  provider_id: string;
  provider_ref: string;
  accepted_at: Date;
  lease_until: string;
  expired: boolean;
  config: unknown;
  destination: string | null;
  sender: string | null;
}

/** Claim one due report. The provider call holds no connection or row lock. */
export async function pollSmsDeliveryReport(
  pool: Pool,
  request: typeof fetch = fetch
): Promise<void> {
  const claim = await pool.query<SmsReportClaim>(
    `WITH candidate AS (
       SELECT outbox_id FROM notification_send_receipts
       WHERE channel='sms' AND status='accepted' AND transport='smsir' AND sms_report_due_at<=NOW()
       ORDER BY sms_report_due_at,outbox_id LIMIT 1 FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE notification_send_receipts r SET sms_report_due_at=NOW()+INTERVAL '2 minutes'
       FROM candidate c WHERE r.outbox_id=c.outbox_id AND r.channel='sms'
       RETURNING r.outbox_id,r.provider_id,r.provider_ref,r.idempotency_key,r.accepted_at,
                 r.sms_report_due_at::text AS lease_until
     )
     SELECT c.outbox_id,c.provider_id,c.provider_ref,c.accepted_at,c.lease_until,
            c.accepted_at<=NOW()-INTERVAL '24 hours' AS expired,p.config,
            j.delivery_payload->'message'->>'destination' AS destination,
            j.delivery_payload->'message'->>'sender' AS sender
     FROM claimed c
     LEFT JOIN sms_provider_configs p ON p.id=c.provider_id AND p.transport='smsir'
       AND p.status='active' AND p.last_test_status='passed'
     LEFT JOIN notification_job j ON j.outbox_id=c.outbox_id AND j.channel='sms'
       AND j.delivery_payload->>'idempotencyKey'=c.idempotency_key
       AND j.delivery_payload->'message'->>'providerId'=c.provider_id::text`
  );
  const row = claim.rows[0];
  if (!row) return;

  const identity = [row.outbox_id, row.lease_until, row.provider_id, row.provider_ref];
  if (row.expired || !row.config || !row.destination) {
    await pool.query(
      `UPDATE notification_send_receipts SET sms_report_due_at=NULL
       WHERE outbox_id=$1 AND channel='sms' AND sms_report_due_at=$2
         AND status='accepted' AND provider_id=$3 AND provider_ref=$4`,
      identity
    );
    return;
  }

  try {
    const config = SmsirConfigSchema.parse(row.config);
    const quota = await pool.query<{ allowed: boolean }>(
      'SELECT count BETWEEN 1 AND $3 AS allowed FROM rate_limit_rolling(true,$1,$2,$3,true)',
      [`provider:smsir:reports:${row.provider_id}`, 60_000, Math.min(30, config.throughput_limit)]
    );
    if (quota.rows[0]?.allowed !== true) return;
    const report = await getSmsirDeliveryReport(
      decryptProviderSecret(config.api_key),
      process.env.SMSIR_API_BASE || 'https://api.sms.ir',
      {
        messageId: row.provider_ref,
        destination: row.destination,
        ...(row.sender === null ? {} : { sender: row.sender }),
        acceptedAt: row.accepted_at,
      },
      request,
      config.timeout * 1000
    );
    await pool.query(
      `UPDATE notification_send_receipts
       SET sms_report_state=$5::integer,sms_report_delivered_at=$6,sms_report_checked_at=NOW(),
           sms_report_due_at=CASE WHEN $5::integer IS NULL OR $5 IN (3,5) THEN NOW()+INTERVAL '10 minutes' END
       WHERE outbox_id=$1 AND channel='sms' AND sms_report_due_at=$2
         AND sms_report_due_at>NOW() AND status='accepted' AND provider_id=$3 AND provider_ref=$4
         AND EXISTS (SELECT 1 FROM sms_provider_configs p WHERE p.id=$3 AND p.transport='smsir'
           AND p.status='active' AND p.last_test_status='passed')`,
      [...identity, report.state, report.deliveredAt]
    );
  } catch {
    // The lease makes a failed lookup retryable. Keep provider response data out of logs.
    throw new Error('SMS.ir delivery report check failed');
  }
}
