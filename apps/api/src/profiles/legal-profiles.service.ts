import { VerifiedAttachmentsService } from '../storage/verified-attachments.service.js';
import { z } from 'zod';
import { requireAddressGeography } from './address-geography.js';
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  validateLegalNationalIdentifier,
  validatePostalCode,
  validateNationalId,
} from '@barghsa/shared/validation';
import { ErrorCodes } from '@barghsa/shared/errors';
import { ProfilesService, type ProfileRow } from './profiles.service.js';

export interface LegalProfileRow {
  id: string;
  legalName: string;
  nationalIdentifier: string;
  registrationNumber: string;
  companyTypeId: string | null;
  registrationDate: string | null;
  economicCode: string | null;
  officialPhone: string | null;
  officialEmail: string | null;
  officialProvinceId: string | null;
  officialCityId: string | null;
  officialFullAddress: string | null;
  officialPostalCode: string | null;
  representativeHonorific: string | null;
  representativeFirstName: string | null;
  representativeLastName: string | null;
  representativeNationalId: string | null;
  representativeProvinceId: string | null;
  representativeCityId: string | null;
  representativeFullAddress: string | null;
  representativePostalCode: string | null;
  representativeTitle: string;
  representativeRelationship: string;
  createdAt: Date;
  updatedAt: Date;
}

function mapLegalProfileRow(row: Record<string, unknown>): LegalProfileRow {
  return {
    id: row.id as string,
    legalName: row.legal_name as string,
    nationalIdentifier: row.national_identifier as string,
    registrationNumber: row.registration_number as string,
    companyTypeId: (row.company_type_id as string) ?? null,
    registrationDate: (row.registration_date as string) ?? null,
    economicCode: (row.economic_code as string) ?? null,
    officialPhone: (row.official_phone as string) ?? null,
    officialEmail: (row.official_email as string) ?? null,
    officialProvinceId: (row.official_province_id as string) ?? null,
    officialCityId: (row.official_city_id as string) ?? null,
    officialFullAddress: (row.official_full_address as string) ?? null,
    officialPostalCode: (row.official_postal_code as string) ?? null,
    representativeHonorific: (row.representative_honorific as string) ?? null,
    representativeFirstName: (row.representative_first_name as string) ?? null,
    representativeLastName: (row.representative_last_name as string) ?? null,
    representativeNationalId: (row.representative_national_id as string) ?? null,
    representativeProvinceId: (row.representative_province_id as string) ?? null,
    representativeCityId: (row.representative_city_id as string) ?? null,
    representativeFullAddress: (row.representative_full_address as string) ?? null,
    representativePostalCode: (row.representative_postal_code as string) ?? null,
    representativeTitle: row.representative_title as string,
    representativeRelationship: row.representative_relationship as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

@Injectable()
export class LegalProfilesService {
  private readonly logger = new Logger(LegalProfilesService.name);

  constructor(
    private readonly profilesService: ProfilesService,
    private readonly attachments: VerifiedAttachmentsService
  ) {}

  async getDocuments(userId: string, profileId: string) {
    const profile = await this.profilesService.getProfileById(profileId);
    if (!profile || profile.userId !== userId || profile.profileType !== 'LEGAL')
      throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    const result = await getDbPool().query('SELECT documents FROM legal_profiles WHERE id=$1', [
      profileId,
    ]);
    const keys = (result.rows[0]?.documents ?? []) as string[];
    const urls = await this.attachments.downloadUrls(keys, 'legal_profile_document');
    if (keys.length && urls.length !== keys.length)
      throw new HttpException({ error: 'STORAGE:UNAVAILABLE' }, 503);
    const records = keys.length
      ? await getDbPool().query(
          'SELECT storage_key,file_name FROM storage_records WHERE storage_key=ANY($1::text[])',
          [keys]
        )
      : { rows: [] };
    return {
      documents: keys.map((key, index) => ({
        key,
        name: records.rows.find((row) => row.storage_key === key)?.file_name ?? 'Document',
        url: urls[index],
      })),
    };
  }

  /**
   * Save legal profile data during onboarding (T-03.02.03).
   *
   * Validates and stores the legal profile fields (legal name, national
   * identifier, registration number, etc.) and the official address.
   * National identifier uniqueness is enforced at the DB level via a
   * unique index.
   *
   * @param userId - The authenticated user's ID.
   * @param profileId - The draft profile ID from onboarding start.
   * @param data - Legal profile fields.
   */
  async saveLegalProfile(userId: string, profileId: string, input: unknown): Promise<ProfileRow> {
    const pool = getDbPool();

    // Validate the profile exists and belongs to the user
    const profile = await this.profilesService.getProfileById(profileId);
    if (!profile || profile.userId !== userId || profile.profileType !== 'LEGAL') {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Profile not found',
        },
        404
      );
    }

    if (profile.status !== 'DRAFT') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Profile is not in draft state',
        },
        400
      );
    }

    const parsed = z
      .object({
        documents: z.array(z.string().min(1).max(512)).max(5).optional(),
        draftVersion: z.number().int().min(0).max(2147483647).optional(),
        legalName: z.string().trim().min(1).max(200),
        nationalIdentifier: z
          .string()
          .trim()
          .refine(validateLegalNationalIdentifier, 'Invalid national identifier format'),
        registrationNumber: z.string().trim().min(1).max(50),
        companyTypeId: z.string().trim().min(1).max(100),
        registrationDate: z.string().date().optional(),
        economicCode: z.string().trim().max(50).optional(),
        officialPhone: z.string().trim().max(30).optional(),
        officialEmail: z.string().trim().email().max(254).optional(),
        officialProvinceId: z.string().uuid(),
        officialCityId: z.string().uuid(),
        officialFullAddress: z.string().trim().min(1).max(500),
        officialPostalCode: z
          .string()
          .trim()
          .refine(validatePostalCode, 'Invalid postal code format'),
        representativeHonorific: z.string().trim().max(50).optional(),
        representativeFirstName: z.string().trim().min(1).max(100),
        representativeLastName: z.string().trim().min(1).max(100),
        representativeNationalId: z
          .string()
          .trim()
          .refine(validateNationalId, 'Invalid representative national ID'),
        representativeProvinceId: z.string().uuid(),
        representativeCityId: z.string().uuid(),
        representativeFullAddress: z.string().trim().min(1).max(500),
        representativePostalCode: z
          .string()
          .trim()
          .refine(validatePostalCode, 'Invalid representative postal code'),
        representativeTitle: z.string().trim().min(1).max(100),
        representativeRelationship: z.string().trim().min(1).max(100),
      })
      .safeParse(input);
    if (!parsed.success) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: parsed.error.issues[0]?.message ?? 'Invalid legal profile data',
        },
        400
      );
    }
    const data = parsed.data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update the base profile with title from legal name
      const profileResult = await client.query(
        `UPDATE profiles
         SET title = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3 AND profile_type='LEGAL' AND status='DRAFT' AND NOT archived
         RETURNING id, user_id, profile_type, is_default, status, title, first_name, last_name, national_id, created_at, updated_at`,
        [data.legalName, profileId, userId]
      );

      if (profileResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new HttpException(
          {
            statusCode: 404,
            error: ErrorCodes.NOT_FOUND_RESOURCE.code,
            message: 'Profile not found',
          },
          404
        );
      }

      if (data.draftVersion !== undefined) {
        const draft = await client.query(
          'SELECT version FROM profile_onboarding_drafts WHERE profile_id=$1',
          [profileId]
        );
        if ((draft.rows[0]?.version ?? 0) !== data.draftVersion)
          throw new HttpException({ error: ErrorCodes.CONFLICT_VERSION.code }, 409);
      }
      await requireAddressGeography(client, data.officialProvinceId, data.officialCityId);
      const companyType = await client.query('SELECT id FROM company_types WHERE id=$1 FOR SHARE', [
        data.companyTypeId,
      ]);
      if (!companyType.rows.length) {
        throw new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'Select an existing company type',
          },
          400
        );
      }

      await requireAddressGeography(
        client,
        data.representativeProvinceId,
        data.representativeCityId
      );

      const documents = data.documents?.length
        ? await this.attachments.seal(
            client,
            data.documents,
            userId,
            profileId,
            'legal_profile_document'
          )
        : [];

      // Create the legal profile record
      await client.query(
        `INSERT INTO legal_profiles (
          id, legal_name, national_identifier, registration_number,
          company_type_id, registration_date, economic_code,
          official_phone, official_email,
          official_province_id, official_city_id, official_full_address, official_postal_code,
          documents, representative_title, representative_relationship,
          representative_honorific, representative_first_name, representative_last_name, representative_national_id, representative_province_id, representative_city_id, representative_full_address, representative_postal_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $24::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
        [
          profileId,
          data.legalName,
          data.nationalIdentifier,
          data.registrationNumber,
          data.companyTypeId ?? null,
          data.registrationDate ?? null,
          data.economicCode ?? null,
          data.officialPhone ?? null,
          data.officialEmail ?? null,
          data.officialProvinceId ?? null,
          data.officialCityId ?? null,
          data.officialFullAddress ?? null,
          data.officialPostalCode ?? null,
          data.representativeTitle,
          data.representativeRelationship,
          data.representativeHonorific ?? null,
          data.representativeFirstName ?? null,
          data.representativeLastName ?? null,
          data.representativeNationalId ?? null,
          data.representativeProvinceId ?? null,
          data.representativeCityId ?? null,
          data.representativeFullAddress ?? null,
          data.representativePostalCode ?? null,
          JSON.stringify(documents),
        ]
      );

      // The profile row is already locked; retain any preliminary address as history.
      await client.query(
        'UPDATE addresses SET main_address=false,updated_at=NOW() WHERE profile_id=$1 AND main_address',
        [profileId]
      );

      // Every completed legal profile has an official main address.
      await client.query(
        `INSERT INTO addresses (profile_id, province_id, city_id, full_address, postal_code, main_address)
           VALUES ($1, $2, $3, $4, $5, true)`,
        [
          profileId,
          data.officialProvinceId,
          data.officialCityId,
          data.officialFullAddress,
          data.officialPostalCode,
        ]
      );

      await client.query(
        `INSERT INTO addresses (profile_id,province_id,city_id,full_address,postal_code,main_address)
         VALUES ($1,$2,$3,$4,$5,false)`,
        [
          profileId,
          data.representativeProvinceId,
          data.representativeCityId,
          data.representativeFullAddress,
          data.representativePostalCode,
        ]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
         VALUES(uuid_generate_v7(),$1,'legal_profile_saved',jsonb_build_object('profileId',$2::text),uuid_generate_v7(),NOW())`,
        [userId, profileId]
      );

      // Transition profile from DRAFT to ACTIVE
      await client.query(`UPDATE profiles SET status = $2, updated_at = NOW() WHERE id = $1`, [
        profileId,
        (await this.profilesService.getVerificationMode()) === 'DISABLED'
          ? 'ACTIVE'
          : 'PENDING_VERIFICATION',
      ]);

      await client.query('DELETE FROM profile_onboarding_drafts WHERE profile_id=$1', [profileId]);
      await client.query('COMMIT');

      this.logger.log(`Legal profile ${profileId} saved for user ${userId}`);

      // Re-fetch the profile to get the updated status (ACTIVE)
      const updatedProfile = await this.profilesService.getProfileById(profileId);
      return updatedProfile ?? (mapLegalProfileRow(profileResult.rows[0]) as unknown as ProfileRow);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Rollback failure is non-critical
      });

      // Re-throw HTTP exceptions as-is
      if (error instanceof HttpException) throw error;

      // Check for unique constraint violation on national_identifier (Pg code 23505)
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_DUPLICATE.code,
            message: 'This national identifier is already registered',
          },
          409
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }
}
