import type { Pool, PoolClient } from 'pg';
import type { BankReceiptState } from '@barghsa/db';
import { activityNames } from '../common/activity-identity.js';

export interface ReceiptStatusHistoryEntry {
  state: BankReceiptState;
  occurredAt: string;
  backfilled: boolean;
  actorType: 'customer' | 'staff' | 'unknown';
  actorName: string | null;
  reason: string | null;
}

/** Only pass receipt IDs already authorized by the caller; internal actor IDs never leave this projection. */
export async function receiptStatusHistory(client: Pool | PoolClient, receiptIds: string[]) {
  const histories = new Map<string, ReceiptStatusHistoryEntry[]>();
  if (!receiptIds.length) return histories;
  const result = await client.query<{
    receipt_id: string;
    state: BankReceiptState;
    occurred_at: Date;
    backfilled: boolean;
    actor_user_id: string | null;
    actor_type: ReceiptStatusHistoryEntry['actorType'];
    reason: string | null;
  }>(
    `SELECT receipt_id,state,occurred_at,backfilled,actor_user_id,actor_type,reason
     FROM bank_receipt_status_events WHERE receipt_id=ANY($1::uuid[]) ORDER BY occurred_at,id`,
    [receiptIds]
  );
  const names = await activityNames(
    client,
    result.rows.map((event) => event.actor_user_id),
    'payment'
  );
  for (const event of result.rows) {
    const history = histories.get(event.receipt_id) ?? [];
    history.push({
      state: event.state,
      occurredAt: event.occurred_at.toISOString(),
      backfilled: event.backfilled,
      actorType: event.actor_type ?? 'unknown',
      actorName: event.actor_user_id ? (names.get(event.actor_user_id) ?? null) : null,
      reason: event.reason ?? null,
    });
    histories.set(event.receipt_id, history);
  }
  return histories;
}
