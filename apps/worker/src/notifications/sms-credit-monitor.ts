import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { getDbPool } from '@barghsa/db';
import {
  SmsirConfigSchema,
  decryptProviderSecret,
  getSmsirCredit,
} from '@barghsa/shared/auth-delivery';

export const SMS_CREDIT_POLL_INTERVAL_MS = 60_000;
export const SMS_CREDIT_JOB_TYPE = 'sms_credit_check';

/** Claim at most one due active provider across all worker replicas. */
export async function checkSmsCredit(
  pool: Pool = getDbPool(),
  request: typeof fetch = fetch
): Promise<'idle' | 'checked'> {
  const token = randomUUID();
  const claim = await pool.query<{ id: string; config: unknown }>(
    `WITH candidate AS (
       SELECT id FROM sms_provider_configs
       WHERE status='active' AND last_test_status='passed'
         AND credit_next_check_at<=NOW()
         AND (credit_check_lease_until IS NULL OR credit_check_lease_until<NOW())
       ORDER BY credit_next_check_at LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     UPDATE sms_provider_configs p
     SET credit_check_lease_until=NOW()+INTERVAL '2 minutes', credit_check_lease_token=$1
     FROM candidate c WHERE p.id=c.id RETURNING p.id,p.config`,
    [token]
  );
  const provider = claim.rows[0];
  if (!provider) return 'idle';
  try {
    const config = SmsirConfigSchema.parse(provider.config);
    const balance = await getSmsirCredit(
      decryptProviderSecret(config.api_key),
      process.env.SMSIR_API_BASE || 'https://api.sms.ir',
      request
    );
    const saved = await pool.query(
      `UPDATE sms_provider_configs SET
         low_credit_balance=$1, credit_checked_at=NOW(),
         credit_next_check_at=NOW()+INTERVAL '6 hours',
         credit_check_lease_until=NULL, credit_check_lease_token=NULL,
         low_credit_alert_active=$2
       WHERE id=$3 AND status='active' AND credit_check_lease_token=$4`,
      [
        balance,
        config.low_credit_threshold > 0 && balance < config.low_credit_threshold,
        provider.id,
        token,
      ]
    );
    return saved.rowCount ? 'checked' : 'idle';
  } catch {
    await pool.query(
      `UPDATE sms_provider_configs SET
         credit_next_check_at=NOW()+INTERVAL '15 minutes',
         credit_check_lease_until=NULL, credit_check_lease_token=NULL
       WHERE id=$1 AND credit_check_lease_token=$2`,
      [provider.id, token]
    );
    // Never include provider responses or credential material in job records.
    throw new Error('SMS.ir credit check failed');
  }
}
