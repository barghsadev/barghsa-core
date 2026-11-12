import type { PoolClient } from 'pg';

// The caller supplies the upgrade (u) and its saving order (s).
export const savingHardwareUpgradeInvoiceScope = `
  JOIN contracts upgrade_contract ON upgrade_contract.id=u.contract_id
    AND upgrade_contract.order_id=s.order_id AND upgrade_contract.profile_id=s.profile_id
    AND upgrade_contract.service_type='savings'
  JOIN contract_versions upgrade_version ON upgrade_version.id=u.contract_version_id
    AND upgrade_version.contract_id=upgrade_contract.id
  JOIN invoices original ON original.id=u.original_invoice_id
    AND original.order_id=s.order_id AND original.profile_id=s.profile_id
    AND (original.contract_id IS NULL OR original.contract_id=upgrade_contract.id::text)
    AND original.adjustment_for_invoice_id IS NULL
  JOIN invoices charge ON charge.id=u.adjustment_invoice_id
    AND charge.order_id=s.order_id AND charge.profile_id=s.profile_id
    AND charge.contract_id IS NOT DISTINCT FROM original.contract_id
    AND charge.adjustment_for_invoice_id=original.id AND charge.adjustment_kind='charge'
    AND charge.accounting_amount=u.price_delta_irr`;

export async function savingHardwareUpgrades(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT u.id,COALESCE(u.actor_context,'unknown') AS "actorContext",u.status,u.created_at AS "createdAt",u.applied_at AS "appliedAt",
              u.closed_at AS "closedAt",u.reason,
              u.price_delta_irr::text AS "priceDeltaIrR",
              charge.id AS "adjustmentInvoiceId",
              charge.state AS "invoiceState",charge.paid_amount::text AS "paidIrR",
              u.previous_snapshot->'title' AS "previousTitle",
              u.hardware_snapshot->'title' AS "hardwareTitle"
         FROM saving_hardware_upgrade_requests u
         JOIN saving_orders s ON s.id=u.order_id
         ${savingHardwareUpgradeInvoiceScope}
        WHERE u.order_id=$1 ORDER BY u.created_at,u.id`,
      [savingOrderId]
    )
  ).rows;
}
