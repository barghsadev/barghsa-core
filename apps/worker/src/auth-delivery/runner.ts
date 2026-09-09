import { randomUUID, createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { decryptAuthDelivery, encryptAuthDelivery } from '@barghsa/shared/auth-delivery';
import {
  loadEmailBranding,
  normalizeEmailBranding,
  type EmailBranding,
} from '@barghsa/shared/notification-delivery';
import { createAuthSender, type AuthMessage } from './providers.js';

interface DeliveryRow {
  id: string;
  challenge_id: string;
  code_hash: string;
  encrypted_payload: string | null;
  attempts: number;
}

/** One durable claim per call. Provider I/O never holds a database transaction. */
export async function runAuthDelivery(
  pool: Pool,
  send = createAuthSender(pool)
): Promise<'idle' | 'sent' | 'cancelled' | 'retry' | 'dead'> {
  const token = randomUUID();
  const claimed = await pool.query<DeliveryRow>(
    `
    WITH candidate AS (
      SELECT id FROM auth_delivery_outbox
      WHERE (status='pending' AND available_at <= NOW()) OR (status='leased' AND lease_until <= NOW())
      ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE auth_delivery_outbox d SET status='leased', lease_token=$1,
      lease_until=NOW()+INTERVAL '60 seconds', attempts=attempts+1
    FROM candidate c WHERE d.id=c.id RETURNING d.*`,
    [token]
  );
  const row = claimed.rows[0];
  if (!row) return 'idle';
  const finish = async (status: string, ref: string | null = null) => {
    const result = await pool.query(
      `UPDATE auth_delivery_outbox SET status=$3, encrypted_payload=NULL,
      lease_token=NULL, lease_until=NULL, provider_ref=$4, last_error=NULL WHERE id=$1 AND lease_token=$2`,
      [row.id, token, status, ref]
    );
    if (result.rowCount !== 1) throw new Error('Auth delivery lease lost');
  };
  const valid = await pool.query<{ purpose: string; destination: string }>(
    `
    SELECT c.purpose,c.destination FROM otp_challenges c JOIN auth_delivery_outbox d ON d.challenge_id=c.challenge_id
    WHERE d.id=$1 AND c.otp_hash=d.code_hash AND c.consumed_at IS NULL
      AND c.expires_at > NOW() AND d.expires_at > NOW() AND c.attempts_remaining > 0
      AND (c.user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.user_id=c.user_id AND u.auth_version=c.auth_version AND u.disabled_at IS NULL))
    UNION ALL
    SELECT 'staff_activation' AS purpose,u.username AS destination FROM auth_delivery_outbox d JOIN users u ON u.user_id=d.user_id
    WHERE d.id=$1 AND d.kind='staff_activation' AND u.activation_token=d.code_hash AND u.is_staff=true
      AND u.disabled_at IS NULL AND u.activation_token_expires_at > NOW() AND d.expires_at > NOW()`,
    [row.id]
  );
  const challenge = valid.rows[0];
  if (!challenge) {
    await finish('cancelled');
    return 'cancelled';
  }
  if (row.attempts > 5) {
    await finish('dead');
    return 'dead';
  }
  try {
    const payload = decryptAuthDelivery(
      row.id,
      row.encrypted_payload ?? ''
    ) as Partial<AuthMessage> | null;
    if (
      !payload ||
      typeof payload.code !== 'string' ||
      payload.destination !== challenge.destination ||
      createHash('sha256').update(payload.code).digest('hex') !== row.code_hash
    )
      throw new Error('Invalid auth delivery payload');
    let emailBranding: EmailBranding | null | undefined;
    if (challenge.destination.includes('@')) {
      if (payload.emailBranding) emailBranding = normalizeEmailBranding(payload.emailBranding);
      else if (payload.emailBranding === null || row.attempts > 1) {
        // A previous app version may have sent this idempotency key already.
        emailBranding = null;
      } else {
        emailBranding = await loadEmailBranding(pool);
        const saved = await pool.query(
          `UPDATE auth_delivery_outbox SET encrypted_payload=$3 WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
          [row.id, token, encryptAuthDelivery(row.id, { ...payload, emailBranding })]
        );
        if (saved.rowCount !== 1) throw new Error('Auth delivery lease lost before rendering');
      }
    }
    const ref = await send({
      id: row.id,
      code: payload.code,
      destination: challenge.destination,
      purpose: challenge.purpose,
      ...(emailBranding !== undefined ? { emailBranding } : {}),
      ...(typeof payload.activationUrl === 'string'
        ? { activationUrl: payload.activationUrl }
        : {}),
    });
    await finish('sent', ref);
    return 'sent';
  } catch {
    const dead = row.attempts >= 5;
    await pool.query(
      `UPDATE auth_delivery_outbox SET status=$3,
      available_at=NOW()+($4 * INTERVAL '1 second'), lease_token=NULL, lease_until=NULL,
      last_error='delivery_failed', encrypted_payload=CASE WHEN $3='dead' THEN NULL ELSE encrypted_payload END
      WHERE id=$1 AND lease_token=$2`,
      [row.id, token, dead ? 'dead' : 'pending', Math.min(120, 5 * 2 ** (row.attempts - 1))]
    );
    return dead ? 'dead' : 'retry';
  }
}
