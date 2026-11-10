import type { PoolClient } from 'pg';

export async function savingHardwareAmendments(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT a.id,COALESCE(a.actor_context,'unknown') AS "actorContext",a.created_at AS "changedAt",a.reason,a.price_delta_irr::text AS "priceDeltaIrR",
              i.id AS "adjustmentInvoiceId",
              a.previous_snapshot->'title' AS "previousTitle",
              a.hardware_snapshot->'title' AS "hardwareTitle",
              a.previous_hardware_id AS "previousHardwareId",a.hardware_id AS "hardwareId"
         FROM saving_hardware_amendments a
         JOIN saving_orders s ON s.id=a.order_id
         LEFT JOIN invoices i ON i.id=a.adjustment_invoice_id AND i.profile_id=s.profile_id
        WHERE a.order_id=$1 ORDER BY a.created_at,a.id`,
      [savingOrderId]
    )
  ).rows;
}
