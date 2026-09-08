import { z } from 'zod';
import type { PoolClient } from 'pg';
import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { validatePostalCode } from '@barghsa/shared/validation';
import { requireAddressGeography } from '../profiles/address-geography.js';
import type { CrmProfileAddress } from './crm-v2.service.js';

export const crmAddressEditSchema = z
  .object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ precision: 6 }),
    provinceId: z.string().uuid(),
    cityId: z.string().uuid(),
    fullAddress: z.string().trim().min(1).max(500),
    postalCode: z.string().trim().refine(validatePostalCode),
  })
  .strict();
export type CrmAddressEdit = z.infer<typeof crmAddressEditSchema>;

/** Caller holds the profile lock and current crm:edit permission through commit. */
export async function editCrmAddress(client: PoolClient, profileId: string, input: CrmAddressEdit) {
  const parsed = crmAddressEditSchema.safeParse(input);
  if (!parsed.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
  const edit = parsed.data;
  const previous = (
    await client.query<CrmProfileAddress>(
      `SELECT id,province_id AS "provinceId",city_id AS "cityId",full_address AS "fullAddress",
       postal_code AS "postalCode",main_address AS "mainAddress",created_at AS "createdAt",
       to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"
     FROM addresses WHERE id=$1 AND profile_id=$2 FOR UPDATE`,
      [edit.id, profileId]
    )
  ).rows[0];
  if (!previous) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
  if (previous.updatedAt !== edit.expectedUpdatedAt)
    throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
  const changed = ['provinceId', 'cityId', 'fullAddress', 'postalCode'].some(
    (field) => previous[field as keyof CrmProfileAddress] !== edit[field as keyof CrmAddressEdit]
  );
  if (changed) {
    if (previous.provinceId !== edit.provinceId || previous.cityId !== edit.cityId)
      await requireAddressGeography(client, edit.provinceId, edit.cityId);
    await client.query(
      `UPDATE addresses SET province_id=$1,city_id=$2,full_address=$3,postal_code=$4,updated_at=NOW()
       WHERE id=$5 AND profile_id=$6`,
      [edit.provinceId, edit.cityId, edit.fullAddress, edit.postalCode, edit.id, profileId]
    );
  }
  const address = (
    await client.query<CrmProfileAddress>(
      `SELECT a.id,a.province_id AS "provinceId",a.city_id AS "cityId",a.full_address AS "fullAddress",
       a.postal_code AS "postalCode",a.main_address AS "mainAddress",a.created_at AS "createdAt",
       to_char(a.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
       json_build_object('nameFa',p.name_fa,'nameEn',p.name_en) AS "provinceName",
       json_build_object('nameFa',c.name_fa,'nameEn',c.name_en) AS "cityName"
     FROM addresses a JOIN provinces p ON p.id=a.province_id JOIN cities c ON c.id=a.city_id
     WHERE a.id=$1 AND a.profile_id=$2`,
      [edit.id, profileId]
    )
  ).rows[0]!;
  const snapshot = (value: CrmProfileAddress) => ({
    id: value.id,
    provinceId: value.provinceId,
    cityId: value.cityId,
    fullAddress: value.fullAddress,
    postalCode: value.postalCode,
  });
  return { changed, address, before: snapshot(previous), after: snapshot(address) };
}
