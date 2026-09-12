import { randomUUID } from 'node:crypto';
import {
  DeliveryRejected,
  type DeliveryExecutor,
  type DeliveryPool,
} from '@barghsa/shared/notification-delivery';
import type { NotificationSendResult } from '@barghsa/shared/notifications';
import { sanitizeError } from './error-redact.js';

export class DeliveryOutcomeUnknown extends Error {
  constructor() {
    super('Provider outcome unknown; delivery reconciliation required before another send');
  }
}

/** Recover acceptance before recipient/configuration changes can hide a receipt. */
export async function readDeliveryReceipt(
  pool: DeliveryPool,
  outboxId: string,
  channel: 'email' | 'sms'
): Promise<NotificationSendResult | undefined> {
  const result = await pool.query(
    'SELECT status,provider_ref FROM notification_send_receipts WHERE outbox_id=$1 AND channel=$2',
    [outboxId, channel]
  );
  const row = result.rows[0];
  if (!row || row.status === 'rejected') return;
  if (row.status === 'accepted' && typeof row.provider_ref === 'string' && row.provider_ref.trim())
    return { status: 'delivered', providerRef: row.provider_ref };
  throw new DeliveryOutcomeUnknown();
}

/** The claim commits before I/O. A crash or uncertain response can never reopen it. */
export function durableDelivery(
  pool: DeliveryPool,
  outboxId: string,
  channel: 'email' | 'sms',
  idempotencyKey: string
): DeliveryExecutor {
  return async (provider, send) => {
    if (!idempotencyKey.trim() || idempotencyKey.length > 1024)
      throw new Error('Invalid delivery identity');
    const existing = await readDeliveryReceipt(pool, outboxId, channel);
    if (existing) return existing.providerRef;
    const token = randomUUID();
    const claimed = await pool.query(
      `INSERT INTO notification_send_receipts(outbox_id,channel,status,provider_id,transport,idempotency_key,attempt_token)
      VALUES ($1,$2,'sending',$3,$4,$5,$6)
      ON CONFLICT (outbox_id,channel) DO UPDATE SET status='sending',attempt_token=EXCLUDED.attempt_token,last_error=NULL,updated_at=NOW()
      WHERE notification_send_receipts.status='rejected'
        AND notification_send_receipts.provider_id=EXCLUDED.provider_id
        AND notification_send_receipts.transport=EXCLUDED.transport
        AND notification_send_receipts.idempotency_key=EXCLUDED.idempotency_key
      RETURNING attempt_token`,
      [outboxId, channel, provider.id, provider.transport, idempotencyKey, token]
    );
    if (claimed.rows[0]?.attempt_token !== token) {
      const recovered = await readDeliveryReceipt(pool, outboxId, channel);
      if (recovered) return recovered.providerRef;
      throw new DeliveryOutcomeUnknown();
    }
    let receipt: string;
    try {
      receipt = await send();
      if (typeof receipt !== 'string' || !receipt.trim() || receipt.length > 512)
        throw new Error('Provider returned an invalid receipt');
    } catch (error) {
      const rejected = error instanceof DeliveryRejected;
      await pool.query(
        `UPDATE notification_send_receipts SET status=$4,last_error=$5,updated_at=NOW()
        WHERE outbox_id=$1 AND channel=$2 AND attempt_token=$3 AND status='sending'`,
        [
          outboxId,
          channel,
          token,
          rejected ? 'rejected' : 'unknown',
          sanitizeError(error instanceof Error ? error.message : String(error)),
        ]
      );
      if (rejected) throw error;
      throw new DeliveryOutcomeUnknown();
    }
    // Keep a failed/ambiguous write as sending, never as safely rejected. If
    // COMMIT succeeded despite a lost response, a later read recovers acceptance.
    const accepted = await pool.query(
      `UPDATE notification_send_receipts SET status='accepted',provider_ref=$4,accepted_at=NOW(),last_error=NULL,updated_at=NOW()
      WHERE outbox_id=$1 AND channel=$2 AND attempt_token=$3 AND status='sending' RETURNING provider_ref`,
      [outboxId, channel, token, receipt]
    );
    if (accepted.rows[0]?.provider_ref !== receipt) throw new DeliveryOutcomeUnknown();
    return receipt;
  };
}
