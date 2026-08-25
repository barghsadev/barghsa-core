import { Injectable, Logger, HttpException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { validateLegalNationalIdentifier, validatePostalCode } from '@barghsa/shared/validation'
import { ErrorCodes } from '@barghsa/shared/errors'
import { ProfilesService, type ProfileRow } from './profiles.service.js'

export interface LegalProfileRow {
  id: string
  legalName: string
  nationalIdentifier: string
  registrationNumber: string
  companyTypeId: string | null
  registrationDate: string | null
  economicCode: string | null
  officialPhone: string | null
  officialEmail: string | null
  officialProvinceId: string | null
  officialCityId: string | null
  officialFullAddress: string | null
  officialPostalCode: string | null
  representativeTitle: string
  representativeRelationship: string
  createdAt: Date
  updatedAt: Date
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
    representativeTitle: row.representative_title as string,
    representativeRelationship: row.representative_relationship as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
}

@Injectable()
export class LegalProfilesService {
  private readonly logger = new Logger(LegalProfilesService.name)

  constructor(private readonly profilesService: ProfilesService) {}

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
  async saveLegalProfile(
    userId: string,
    profileId: string,
    data: {
      legalName: string
      nationalIdentifier: string
      registrationNumber: string
      companyTypeId?: string | undefined
      registrationDate?: string | undefined
      economicCode?: string | undefined
      officialPhone?: string | undefined
      officialEmail?: string | undefined
      officialProvinceId?: string | undefined
      officialCityId?: string | undefined
      officialFullAddress?: string | undefined
      officialPostalCode?: string | undefined
      representativeTitle: string
      representativeRelationship: string
    },
  ): Promise<ProfileRow> {
    const pool = getDbPool()

    // Validate the profile exists and belongs to the user
    const profile = await this.profilesService.getProfileById(profileId)
    if (!profile || profile.userId !== userId) {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Profile not found',
        },
        404,
      )
    }

    if (profile.status !== 'DRAFT') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Profile is not in draft state',
        },
        400,
      )
    }

    // Validate national identifier format
    if (!validateLegalNationalIdentifier(data.nationalIdentifier)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Invalid national identifier format',
        },
        400,
      )
    }

    // Validate postal code if provided
    if (data.officialPostalCode && !validatePostalCode(data.officialPostalCode)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Invalid postal code format',
        },
        400,
      )
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Update the base profile with title from legal name
      const profileResult = await client.query(
        `UPDATE profiles
         SET title = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id, user_id, profile_type, is_default, status, title, first_name, last_name, national_id, created_at, updated_at`,
        [data.legalName, profileId, userId],
      )

      if (profileResult.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new HttpException(
          {
            statusCode: 404,
            error: ErrorCodes.NOT_FOUND_RESOURCE.code,
            message: 'Profile not found',
          },
          404,
        )
      }

      // Create the legal profile record
      await client.query(
        `INSERT INTO legal_profiles (
          id, legal_name, national_identifier, registration_number,
          company_type_id, registration_date, economic_code,
          official_phone, official_email,
          official_province_id, official_city_id, official_full_address, official_postal_code,
          representative_title, representative_relationship
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
        ],
      )

      // Create the main address record if official address is provided
      if (data.officialProvinceId && data.officialCityId && data.officialFullAddress && data.officialPostalCode) {
        await client.query(
          `INSERT INTO addresses (profile_id, province_id, city_id, full_address, postal_code, main_address)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [
            profileId,
            data.officialProvinceId,
            data.officialCityId,
            data.officialFullAddress,
            data.officialPostalCode,
          ],
        )
      }

      // Transition profile from DRAFT to ACTIVE
      await client.query(
        `UPDATE profiles SET status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
        [profileId],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Legal profile ${profileId} saved for user ${userId}`,
      )

      // Re-fetch the profile to get the updated status (ACTIVE)
      const updatedProfile = await this.profilesService.getProfileById(profileId)
      return updatedProfile ?? mapLegalProfileRow(profileResult.rows[0]) as unknown as ProfileRow
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Rollback failure is non-critical
      })

      // Re-throw HTTP exceptions as-is
      if (error instanceof HttpException) throw error

      // Check for unique constraint violation on national_identifier (Pg code 23505)
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_DUPLICATE.code,
            message: 'This national identifier is already registered',
          },
          409,
        )
      }

      throw error
    } finally {
      client.release()
    }
  }
}