import type { PoolClient } from 'pg';
import { InputFieldException } from '../common/input-field.exception.js';

/** Validate a newly selected address pair inside its owning transaction. */
export async function requireAddressGeography(
  client: PoolClient,
  provinceId: string,
  cityId: string
): Promise<void> {
  const result = await client.query(
    `SELECT c.id FROM provinces p JOIN cities c ON c.province_id=p.id
     WHERE p.id=$1 AND c.id=$2 AND p.status='active' AND c.status='active'
     FOR SHARE OF p,c`,
    [provinceId, cityId]
  );
  if (!result.rows.length) {
    throw new InputFieldException(['provinceId', 'cityId']);
  }
}
