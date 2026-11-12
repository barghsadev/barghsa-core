import type { PoolClient } from 'pg';

interface ElectricityInvoiceScope {
  id: string;
  profile_id: string;
  order_id: string;
  version_id: string;
}

/** Match the activation rule's contract or order origin within the same profile. */
export async function loadElectricityInitialInvoice(
  client: PoolClient,
  scope: ElectricityInvoiceScope,
  lock?: 'SHARE' | 'UPDATE'
) {
  const result = await client.query<{
    id: string;
    state: string;
    total_amount: string;
    paid_amount: string;
    refunded_amount: string;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT i.id,i.state,i.total_amount::text,i.paid_amount::text,
       i.refunded_amount::text,i.metadata FROM contract_activation_requirements r
       JOIN invoices i ON i.id=r.initial_invoice_id AND i.profile_id=$3
       WHERE r.version_id=$1 AND r.contract_id=$2 AND i.adjustment_for_invoice_id IS NULL
         AND (i.contract_id=$2::uuid::text OR (i.order_id=$4 AND i.contract_id IS NULL))
       ${lock ? `FOR ${lock} OF i NOWAIT` : ''}`,
    [scope.version_id, scope.id, scope.profile_id, scope.order_id]
  );
  return result.rows[0] ?? null;
}
