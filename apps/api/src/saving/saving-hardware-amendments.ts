import type { PoolClient } from 'pg';

export async function savingHardwareAmendments(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT id,created_at AS "changedAt",reason,price_delta_irr::text AS "priceDeltaIrR",
              adjustment_invoice_id AS "adjustmentInvoiceId",
              previous_snapshot->'title' AS "previousTitle",
              hardware_snapshot->'title' AS "hardwareTitle",
              previous_hardware_id AS "previousHardwareId",hardware_id AS "hardwareId"
         FROM saving_hardware_amendments WHERE order_id=$1 ORDER BY created_at,id`,
      [savingOrderId]
    )
  ).rows;
}
