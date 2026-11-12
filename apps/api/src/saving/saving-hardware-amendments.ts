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
         JOIN contracts c ON c.id=a.contract_id AND c.order_id=s.order_id
           AND c.profile_id=s.profile_id AND c.service_type='savings'
         JOIN contract_versions v ON v.id=a.contract_version_id AND v.contract_id=c.id
         JOIN invoices original ON original.id=a.original_invoice_id
           AND original.order_id=s.order_id AND original.profile_id=s.profile_id
           AND (original.contract_id IS NULL OR original.contract_id=c.id::text)
           AND original.adjustment_for_invoice_id IS NULL
         LEFT JOIN invoices i ON i.id=a.adjustment_invoice_id
           AND i.order_id=s.order_id AND i.profile_id=s.profile_id
           AND i.contract_id IS NOT DISTINCT FROM original.contract_id
           AND i.adjustment_for_invoice_id=original.id AND i.accounting_amount=a.price_delta_irr
           AND ((a.price_delta_irr<0 AND i.adjustment_kind='credit')
             OR (a.price_delta_irr>0 AND i.adjustment_kind='charge'))
        WHERE a.order_id=$1 ORDER BY a.created_at,a.id`,
      [savingOrderId]
    )
  ).rows;
}
