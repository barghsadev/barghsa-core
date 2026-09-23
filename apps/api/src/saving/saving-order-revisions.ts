import type { PoolClient } from 'pg';

/** Public order-change facts; internal idempotency keys and request hashes stay private. */
export async function savingOrderRevisions(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT r.id,r.created_at AS "changedAt",
              r.previous_snapshot #> '{quote,hardware,title}' AS "previousHardwareTitle",
              r.response #> '{hardware,title}' AS "hardwareTitle",
              r.previous_snapshot #>> '{address,full_address}' AS "previousAddress",
              r.response #>> '{address,full_address}' AS "address",
              r.previous_snapshot #>> '{quote,totalIrR}' AS "previousTotalIrR",
              r.response ->> 'totalIrR' AS "totalIrR"
         FROM saving_order_revisions r
        WHERE r.order_id=$1 ORDER BY r.created_at,r.id`,
      [savingOrderId]
    )
  ).rows;
}
