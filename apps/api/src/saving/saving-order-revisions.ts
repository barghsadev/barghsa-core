import type { PoolClient } from 'pg';

/** Public order-change facts; internal idempotency keys and request hashes stay private. */
export async function savingOrderRevisions(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT r.id,COALESCE(r.actor_context,'unknown') AS "actorContext",r.created_at AS "changedAt",
              r.previous_snapshot #> '{quote,hardware,title}' AS "previousHardwareTitle",
              r.response #> '{hardware,title}' AS "hardwareTitle",
              r.previous_snapshot #>> '{address,full_address}' AS "previousAddress",
              r.response #>> '{address,full_address}' AS "address",
              r.previous_snapshot #>> '{quote,totalIrR}' AS "previousTotalIrR",
              r.response ->> 'totalIrR' AS "totalIrR"
         FROM saving_order_revisions r
         JOIN saving_orders s ON s.id=r.order_id
         JOIN contract_versions v ON v.id=r.version_id
         JOIN contracts c ON c.id=v.contract_id AND c.order_id=s.order_id
           AND c.profile_id=s.profile_id AND c.service_type='savings'
         JOIN contract_versions previous ON previous.id=r.previous_version_id AND previous.contract_id=c.id
        WHERE r.order_id=$1 ORDER BY r.created_at,r.id`,
      [savingOrderId]
    )
  ).rows;
}
