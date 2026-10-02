import type { PoolClient } from 'pg';
import { activityNames } from '../common/activity-identity.js';

/** Caller must authorize the order before resolving its recorded staff identities. */
export async function savingFulfillmentHistory(client: PoolClient, orderId: string) {
  const result = await client.query<{
    id: string;
    stage: string;
    from_status: string;
    to_status: string;
    actor_user_id: string;
    explanation: string;
    handover_description: string | null;
    created_at: Date;
  }>(
    `SELECT id,stage,from_status,to_status,actor_user_id,explanation,handover_description,created_at
     FROM saving_fulfillment_events WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 201`,
    [orderId]
  );
  const rows = result.rows.slice(0, 200).reverse();
  const names = await activityNames(
    client,
    rows.map((event) => event.actor_user_id)
  );
  return {
    events: rows.map(({ actor_user_id, ...event }) => ({
      ...event,
      actorName: names.get(actor_user_id) ?? null,
      noteKind:
        event.from_status === 'pending' && event.to_status === 'in_progress'
          ? ('started' as const)
          : event.stage === 'request_confirmation' &&
              event.from_status === 'pending' &&
              event.to_status === 'completed' &&
              event.explanation === 'Staff approved request'
            ? ('confirmed' as const)
            : ('recorded' as const),
    })),
    eventsTruncated: result.rows.length > 200,
  };
}
