import type { PoolClient } from 'pg';

export async function savingHardwareUpgrades(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT u.id,u.status,u.created_at AS "createdAt",u.applied_at AS "appliedAt",
              u.closed_at AS "closedAt",u.reason,
              u.price_delta_irr::text AS "priceDeltaIrR",
              u.adjustment_invoice_id AS "adjustmentInvoiceId",
              i.state AS "invoiceState",i.paid_amount::text AS "paidIrR",
              u.previous_snapshot->'title' AS "previousTitle",
              u.hardware_snapshot->'title' AS "hardwareTitle"
         FROM saving_hardware_upgrade_requests u JOIN invoices i ON i.id=u.adjustment_invoice_id
        WHERE u.order_id=$1 ORDER BY u.created_at,u.id`,
      [savingOrderId]
    )
  ).rows;
}
