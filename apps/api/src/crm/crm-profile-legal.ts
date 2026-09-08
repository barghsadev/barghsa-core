import { z } from 'zod';
import type { PoolClient } from 'pg';
import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { validateNationalId, validatePostalCode } from '@barghsa/shared/validation';
import { requireAddressGeography } from '../profiles/address-geography.js';
import type { CrmLegalInfo } from './crm-v2.service.js';

export const crmLegalChangesSchema = z
  .object({
    registrationNumber: z.string().trim().min(1).max(50),
    companyTypeId: z.string().trim().min(1).max(100),
    registrationDate: z.string().date().nullable(),
    economicCode: z.string().trim().max(50).nullable(),
    officialPhone: z.string().trim().max(30).nullable(),
    officialEmail: z.string().trim().email().max(254).toLowerCase().nullable(),
    officialProvinceId: z.string().uuid().toLowerCase(),
    officialCityId: z.string().uuid().toLowerCase(),
    officialFullAddress: z.string().trim().min(1).max(500),
    officialPostalCode: z.string().trim().refine(validatePostalCode),
    representativeHonorific: z.string().trim().max(50).nullable(),
    representativeFirstName: z.string().trim().min(1).max(100),
    representativeLastName: z.string().trim().min(1).max(100),
    representativeNationalId: z.string().trim().refine(validateNationalId),
    representativeTitle: z.string().trim().min(1).max(100),
    representativeRelationship: z.string().trim().min(1).max(100),
    representativeProvinceId: z.string().uuid().toLowerCase(),
    representativeCityId: z.string().uuid().toLowerCase(),
    representativeFullAddress: z.string().trim().min(1).max(500),
    representativePostalCode: z.string().trim().refine(validatePostalCode),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const crmLegalEditSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ precision: 6 }),
    changes: crmLegalChangesSchema,
  })
  .strict();
export type CrmLegalEdit = z.infer<typeof crmLegalEditSchema>;

const columns = {
  registrationNumber: 'registration_number',
  companyTypeId: 'company_type_id',
  registrationDate: 'registration_date',
  economicCode: 'economic_code',
  officialPhone: 'official_phone',
  officialEmail: 'official_email',
  officialProvinceId: 'official_province_id',
  officialCityId: 'official_city_id',
  officialFullAddress: 'official_full_address',
  officialPostalCode: 'official_postal_code',
  representativeHonorific: 'representative_honorific',
  representativeFirstName: 'representative_first_name',
  representativeLastName: 'representative_last_name',
  representativeNationalId: 'representative_national_id',
  representativeTitle: 'representative_title',
  representativeRelationship: 'representative_relationship',
  representativeProvinceId: 'representative_province_id',
  representativeCityId: 'representative_city_id',
  representativeFullAddress: 'representative_full_address',
  representativePostalCode: 'representative_postal_code',
} as const satisfies Record<keyof CrmLegalEdit['changes'], string>;

export async function readCrmLegalInfo(
  client: Pick<PoolClient, 'query'>,
  profileId: string
): Promise<CrmLegalInfo | null> {
  return (
    (
      await client.query<CrmLegalInfo>(
        `SELECT l.legal_name AS "legalName", l.national_identifier AS "nationalIdentifier",
      ${Object.entries(columns)
        .map(
          ([key, column]) =>
            `${key === 'officialProvinceId' || key === 'officialCityId' ? `LOWER(l.${column})` : `l.${column}`} AS "${key}"`
        )
        .join(',')},
      l.created_at AS "createdAt",
      to_char(l.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
      ${[
        ['ct', 'companyTypeName'],
        ['op', 'officialProvinceName'],
        ['oc', 'officialCityName'],
        ['rp', 'representativeProvinceName'],
        ['rc', 'representativeCityName'],
      ]
        .map(
          ([alias, key]) =>
            `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('nameFa',${alias}.name_fa,'nameEn',${alias}.name_en) END AS "${key}"`
        )
        .join(',')}
    FROM legal_profiles l
    LEFT JOIN company_types ct ON ct.id=l.company_type_id
    LEFT JOIN provinces op ON op.id::text=LOWER(l.official_province_id)
    LEFT JOIN cities oc ON oc.id::text=LOWER(l.official_city_id) AND oc.province_id=op.id
    LEFT JOIN provinces rp ON rp.id=l.representative_province_id
    LEFT JOIN cities rc ON rc.id=l.representative_city_id AND rc.province_id=rp.id
    WHERE l.id=$1`,
        [profileId]
      )
    ).rows[0] ?? null
  );
}

/** Caller holds the profile lock and current crm:edit permission through commit. */
export async function editCrmLegalInfo(client: PoolClient, profileId: string, input: CrmLegalEdit) {
  const parsed = crmLegalEditSchema.safeParse(input);
  if (!parsed.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
  const edit = parsed.data;
  const locked = await client.query('SELECT id FROM legal_profiles WHERE id=$1 FOR UPDATE', [
    profileId,
  ]);
  if (!locked.rows.length)
    throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
  const previous = (await readCrmLegalInfo(client, profileId))!;
  if (previous.updatedAt !== edit.expectedUpdatedAt)
    throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
  const entries = (Object.keys(columns) as (keyof typeof columns)[])
    .filter((key) => edit.changes[key] !== undefined && edit.changes[key] !== previous[key])
    .map((key) => [key, edit.changes[key]!] as const);
  for (const prefix of ['official', 'representative'] as const) {
    const province = `${prefix}ProvinceId` as const,
      city = `${prefix}CityId` as const;
    if (entries.some(([key]) => key === province || key === city)) {
      const p = edit.changes[province] ?? previous[province],
        c = edit.changes[city] ?? previous[city];
      if (!p || !c)
        throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
      await requireAddressGeography(client, p, c);
    }
  }
  if (entries.some(([key]) => key === 'companyTypeId')) {
    const company = await client.query('SELECT id FROM company_types WHERE id=$1 FOR SHARE', [
      edit.changes.companyTypeId,
    ]);
    if (!company.rows.length)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
  }
  if (entries.length)
    await client.query(
      `UPDATE legal_profiles SET ${entries.map(([key], index) => `${columns[key]}=$${index + 1}`).join(',')},updated_at=NOW() WHERE id=$${entries.length + 1}`,
      [...entries.map(([, value]) => value), profileId]
    );
  return {
    changed: entries.length > 0,
    before: Object.fromEntries(entries.map(([key]) => [key, previous[key]])),
    after: Object.fromEntries(entries),
    legalInfo: (await readCrmLegalInfo(client, profileId))!,
  };
}
