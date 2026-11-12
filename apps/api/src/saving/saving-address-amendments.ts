import type { PoolClient } from 'pg';

export async function savingAddressAmendments(client: PoolClient, savingOrderId: string) {
  return (
    await client.query(
      `SELECT a.id,COALESCE(a.actor_context,'unknown') AS "actorContext",a.created_at AS "changedAt",a.reason,
              a.previous_snapshot->>'full_address' AS "previousAddress",
              a.address_snapshot->>'full_address' AS "address",
              a.previous_snapshot->>'postal_code' AS "previousPostalCode",
              a.address_snapshot->>'postal_code' AS "postalCode"
         FROM saving_address_amendments a
         JOIN saving_orders s ON s.id=a.order_id
         JOIN contracts c ON c.id=a.contract_id AND c.order_id=s.order_id
           AND c.profile_id=s.profile_id AND c.service_type='savings'
         JOIN contract_versions v ON v.id=a.contract_version_id AND v.contract_id=c.id
         JOIN addresses old_address ON old_address.id=a.previous_address_id AND old_address.profile_id=s.profile_id
         JOIN addresses new_address ON new_address.id=a.address_id AND new_address.profile_id=s.profile_id
        WHERE a.order_id=$1 ORDER BY a.created_at,a.id`,
      [savingOrderId]
    )
  ).rows;
}
