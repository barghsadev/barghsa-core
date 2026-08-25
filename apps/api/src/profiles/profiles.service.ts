import { Injectable, Logger, HttpException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { validateNationalId, validatePostalCode } from '@barghsa/shared/validation'
import { ErrorCodes } from '@barghsa/shared/errors'
import { ConfigCacheService } from '../config-cache/config-cache.service.js'

export interface ProfileRow {
  id: string
  userId: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  isDefault: boolean
  status: 'DRAFT' | 'ACTIVE' | 'VERIFIED' | 'SUSPENDED'
  title: string | null
  firstName: string | null
  lastName: string | null
  nationalId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ProfileDto {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  isDefault: boolean
  status: 'DRAFT' | 'ACTIVE' | 'VERIFIED' | 'SUSPENDED'
  title: string | null
  firstName: string | null
  lastName: string | null
  nationalId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ProfilesResponseDto {
  profiles: ProfileDto[]
  hasDefault: boolean
  activeProfileId: string | null
}

export interface VerificationStatusDto {
  activeProfileId: string | null
  profileStatus: string | null
  isVerified: boolean
  verificationRequired: boolean
  verificationMethod: 'api' | 'manual'
  canAutoVerify: boolean
}

function mapRow(row: Record<string, unknown>): ProfileRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    profileType: row.profile_type as 'INDIVIDUAL' | 'LEGAL',
    isDefault: row.is_default as boolean,
    status: row.status as 'DRAFT' | 'ACTIVE' | 'VERIFIED' | 'SUSPENDED',
    title: (row.title as string) ?? null,
    firstName: (row.first_name as string) ?? null,
    lastName: (row.last_name as string) ?? null,
    nationalId: (row.national_id as string) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
}

function mapToDto(row: ProfileRow): ProfileDto {
  return {
    id: row.id,
    profileType: row.profileType,
    isDefault: row.isDefault,
    status: row.status,
    title: row.title,
    firstName: row.firstName,
    lastName: row.lastName,
    nationalId: row.nationalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Config key for verification enforcement flag. */
const VERIFICATION_REQUIRED_KEY = 'verification.required'

/** Config key for verification method ('api' or 'manual'). */
const VERIFICATION_METHOD_KEY = 'verification.method'

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name)

  constructor(
    private readonly configCache: ConfigCacheService,
  ) {}

  async getProfilesByUserId(userId: string): Promise<ProfilesResponseDto> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT id, user_id, profile_type, is_default, status, title, first_name, last_name, national_id, created_at, updated_at
       FROM profiles
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [userId],
    )

    const profiles = result.rows.map(mapRow).map(mapToDto)
    const defaultProfile = profiles.find((p) => p.isDefault)

    return {
      profiles,
      hasDefault: !!defaultProfile,
      activeProfileId: defaultProfile?.id ?? null,
    }
  }

  async getProfileById(profileId: string): Promise<ProfileRow | null> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT id, user_id, profile_type, is_default, status, title, first_name, last_name, national_id, created_at, updated_at
       FROM profiles
       WHERE id = $1`,
      [profileId],
    )

    if (result.rows.length === 0) return null
    return mapRow(result.rows[0])
  }

  /**
   * Set a profile as the user's default within a transaction.
   *
   * Two updates (clear all defaults, then set one) are wrapped in a
   * transaction to prevent concurrent requests from leaving the user
   * with zero or multiple default profiles.
   */
  async setDefaultProfile(userId: string, profileId: string): Promise<void> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Clear any existing default for this user
      await client.query(
        `UPDATE profiles SET is_default = false, updated_at = NOW() WHERE user_id = $1`,
        [userId],
      )

      // Set the specified profile as default
      const result = await client.query(
        `UPDATE profiles SET is_default = true, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
        [profileId, userId],
      )

      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new Error(`Profile ${profileId} not found for user ${userId}`)
      }

      await client.query('COMMIT')
      this.logger.debug(`Default profile set to ${profileId} for user ${userId}`)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Rollback failure is non-critical
      })
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get the verification context for the user's active (default) profile.
   *
   * Reads system config to determine whether verification is required
   * and the configured verification method. Returns the profile's current
   * verification status along with the enforcement context.
   *
   * Config keys (sourced from app_config, defaulting when absent):
   * - `verification.required` — boolean, default false
   * - `verification.method` — 'api' | 'manual', default 'manual'
   *
   * Dependencies: T-03.01.01 (profiles), E-07 (verification settings UI).
   */
  async getVerificationStatus(userId: string): Promise<VerificationStatusDto> {
    const profiles = await this.getProfilesByUserId(userId)
    const defaultProfile = profiles.profiles.find((p) => p.isDefault)

    if (!defaultProfile) {
      // No default profile — no verification context
      return {
        activeProfileId: null,
        profileStatus: null,
        isVerified: false,
        verificationRequired: false,
        verificationMethod: 'manual',
        canAutoVerify: false,
      }
    }

    const isVerified = defaultProfile.status === 'VERIFIED'

    // Read verification enforcement config (default: not enforced)
    const verificationRequired =
      (await this.configCache.get<boolean>(VERIFICATION_REQUIRED_KEY)) ?? false

    // Read verification method config (default: manual)
    const verificationMethod: 'api' | 'manual' =
      (await this.configCache.get<'api' | 'manual'>(VERIFICATION_METHOD_KEY)) ?? 'manual'

    return {
      activeProfileId: defaultProfile.id,
      profileStatus: defaultProfile.status,
      isVerified,
      verificationRequired,
      verificationMethod,
      canAutoVerify: !isVerified && verificationRequired && verificationMethod === 'api',
    }
  }

  /**
   * Auto-verify a profile via the API verification method.
   *
   * This is a lightweight stub that marks the profile as VERIFIED,
   * intended for the `api` verification method (E-07 integration
   * will replace this with an external API call).
   *
   * Only works when the system verification method is 'api' and
   * the profile is not already verified.
   */
  async verifyProfileApi(userId: string, profileId: string): Promise<void> {
    const pool = getDbPool()

    const profile = await this.getProfileById(profileId)
    if (!profile || profile.userId !== userId) {
      throw new Error(`Profile ${profileId} not found for user ${userId}`)
    }

    if (profile.status === 'VERIFIED') {
      this.logger.debug(`Profile ${profileId} is already verified`)
      return
    }

    // Verify the system method is 'api'
    const method = await this.configCache.get<string>(VERIFICATION_METHOD_KEY)
    const resolvedMethod = method ?? 'manual'
    if (resolvedMethod !== 'api') {
      throw new Error(
        `Cannot auto-verify: verification method is '${resolvedMethod}', not 'api'`,
      )
    }

    await pool.query(
      `UPDATE profiles SET status = 'VERIFIED', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [profileId, userId],
    )

    this.logger.log(`Profile ${profileId} auto-verified for user ${userId}`)
  }

  /**
   * Create a new draft profile for the user during onboarding.
   *
   * Used by `POST /api/onboarding/start` (T-03.02.01). The profile
   * starts in DRAFT state. If the user has no default profile yet,
   * the newly created profile is set as default so the app-level
   * profile check (T-03.01.01) proceeds past onboarding.
   */
  async createProfile(
    userId: string,
    profileType: 'INDIVIDUAL' | 'LEGAL',
  ): Promise<ProfileRow> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // If the user has no default profile yet, set this one as default.
      const existing = await client.query(
        `SELECT id FROM profiles WHERE user_id = $1 AND is_default = true LIMIT 1`,
        [userId],
      )
      const becomesDefault = existing.rows.length === 0

      const result = await client.query(
        `INSERT INTO profiles (user_id, profile_type, is_default, status)
         VALUES ($1, $2, $3, 'DRAFT')
         RETURNING id, user_id, profile_type, is_default, status, title, first_name, last_name, national_id, created_at, updated_at`,
        [userId, profileType, becomesDefault],
      )

      const row = mapRow(result.rows[0])

      await client.query('COMMIT')
      this.logger.log(
        `Profile ${row.id} (${profileType}) created for user ${userId}${becomesDefault ? ' as default' : ''}`,
      )
      return row
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Rollback failure is non-critical
      })
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Save individual profile data during onboarding (T-03.02.02).
   *
   * Validates and stores the individual profile fields (title, first name,
   * last name, national ID) and the main address (province, city, full
   * address, postal code). National ID uniqueness is enforced at the DB
   * level via a partial unique index on active profiles.
   *
   * @param userId - The authenticated user's ID.
   * @param profileId - The draft profile ID from onboarding start.
   * @param data - Individual profile fields.
   */
  async saveIndividualProfile(
    userId: string,
    profileId: string,
    data: {
      title?: string | undefined
      firstName: string
      lastName: string
      nationalId: string
      provinceId: string
      cityId: string
      fullAddress: string
      postalCode: string
    },
  ): Promise<ProfileRow> {
    const pool = getDbPool()

    // Validate the profile exists and belongs to the user
    const profile = await this.getProfileById(profileId)
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

    // Validate national ID format and checksum
    if (!validateNationalId(data.nationalId)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Invalid national ID format',
        },
        400,
      )
    }

    // Validate postal code
    if (!validatePostalCode(data.postalCode)) {
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

      // Update profile with individual fields
      const profileResult = await client.query(
        `UPDATE profiles
         SET title = $1, first_name = $2, last_name = $3, national_id = $4, updated_at = NOW()
         WHERE id = $5 AND user_id = $6
         RETURNING id, user_id, profile_type, is_default, status, title, first_name, last_name, national_id, created_at, updated_at`,
        [
          data.title ?? null,
          data.firstName,
          data.lastName,
          data.nationalId,
          profileId,
          userId,
        ],
      )

      if (profileResult.rows.length === 0) {
        await client.query('ROLLBACK')
        // Should not happen since we validated ownership above
        throw new HttpException(
          {
            statusCode: 404,
            error: ErrorCodes.NOT_FOUND_RESOURCE.code,
            message: 'Profile not found',
          },
          404,
        )
      }

      // Create the main address record
      await client.query(
        `INSERT INTO addresses (profile_id, province_id, city_id, full_address, postal_code, main_address)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          profileId,
          data.provinceId,
          data.cityId,
          data.fullAddress,
          data.postalCode,
        ],
      )

      // Transition profile from DRAFT to ACTIVE
      await client.query(
        `UPDATE profiles SET status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
        [profileId],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Individual profile ${profileId} saved for user ${userId}`,
      )

      // Re-fetch the profile to get the updated status (ACTIVE)
      const updatedProfile = await this.getProfileById(profileId)
      return updatedProfile ?? mapRow(profileResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Rollback failure is non-critical
      })

      // Re-throw HTTP exceptions as-is
      if (error instanceof HttpException) throw error

      // Check for unique constraint violation on national_id (PostgreSQL code 23505)
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_DUPLICATE.code,
            message: 'This national ID is already registered',
          },
          409,
        )
      }

      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Check whether the user's active profile is allowed to place
   * commercial orders.
   *
   * Returns true when one of:
   * - the active profile is verified, OR
   * - the system does not require verification
   *
   * Used by ProfileVerifiedGuard and order submission endpoints.
   */
  async canPlaceCommercialOrder(userId: string): Promise<boolean> {
    const status = await this.getVerificationStatus(userId)
    // If verification is not required, commercial orders are allowed
    if (!status.verificationRequired) return true
    // If verification is required, the profile must be verified
    return status.isVerified
  }
}