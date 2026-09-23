import type { PoolClient } from 'pg';

export async function savingAddressAmendments(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT id,created_at AS "changedAt",reason,
              previous_snapshot->>'full_address' AS "previousAddress",
              address_snapshot->>'full_address' AS "address",
              previous_snapshot->>'postal_code' AS "previousPostalCode",
              address_snapshot->>'postal_code' AS "postalCode"
         FROM saving_address_amendments WHERE order_id=$1 ORDER BY created_at,id`,
      [savingOrderId]
    )
  ).rows;
}
