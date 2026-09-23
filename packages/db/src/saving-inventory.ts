import type { Pool } from 'pg';

/** Release timed-out saving-order reservations. The SQL function locks each product
 * before its reservation, matching order and payment mutations. */
export async function expireSavingInventory(pool: Pool, batchSize = 100) {
  const result = await pool.query<{ expired: number }>(
    'SELECT expire_saving_inventory_reservations($1) AS expired',
    [batchSize]
  );
  return { expired: result.rows[0]?.expired ?? 0 };
}
