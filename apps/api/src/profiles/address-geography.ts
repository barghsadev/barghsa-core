import { HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ErrorCodes } from '@barghsa/shared/errors';

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
    throw new HttpException(
      {
        statusCode: 400,
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'Select an active city in the selected province',
      },
      400
    );
  }
}
