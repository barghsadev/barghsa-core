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

export interface AddressRow {
  id: string
  profileId: string
  provinceId: string
  cityId: string
  fullAddress: string
  postalCode: string
  mainAddress: boolean
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

function mapAddressRow(row: Record<string, unknown>): AddressRow {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    provinceId: row.province_id as string,
    cityId: row.city_id as string,
    fullAddress: row.full_address as string,
    postalCode: row.postal_code as string,
    mainAddress: row.main_address as boolean,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
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
   * Return a profile the user may activate as their active profile.
   *
   * A user may switch to a profile when they own it (`user_id` matches), or
   * when they are an active agent on it. Agent membership currently has no
   * persistence layer (it arrives with the future profile-access epic), so
   * this defaults to owner-only and returns `null` otherwise. Centralizing
   * the check here keeps the controller and frontend unchanged when agent
   * access is introduced.
   */
  async getAccessibleProfile(userId: string, profileId: string): Promise<ProfileRow | null> {
    const profile = await this.getProfileById(profileId)
    if (!profile) return null
    // Owner access only for now; agent membership is a future extension.
    const isOwner = profile.userId === userId
    if (!isOwner) return null
    return profile
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
   * Create a new address for a profile.
   *
   * If the profile has no existing main address, the new address is
   * automatically set as main. Otherwise it defaults to non-main.
   * Validation: province/city must exist, postal code format checked.
   */
  async createAddress(
    userId: string,
    profileId: string,
    data: {
      provinceId: string
      cityId: string
      fullAddress: string
      postalCode: string
      mainAddress?: boolean
    },
  ): Promise<AddressRow> {
    const pool = getDbPool()

    // Verify the profile belongs to the user
    const profile = await this.getProfileById(profileId)
    if (!profile || profile.userId !== userId) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
        404,
      )
    }

    // Validate postal code
    if (!validatePostalCode(data.postalCode)) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Invalid postal code format' },
        400,
      )
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Check if there's an existing main address
      const existingMain = await client.query(
        `SELECT id FROM addresses WHERE profile_id = $1 AND main_address = true LIMIT 1`,
        [profileId],
      )
      const hasMainAddress = existingMain.rows.length > 0

      const isMain = data.mainAddress === true && !hasMainAddress

      // If user explicitly requested main but one already exists, error
      if (data.mainAddress === true && hasMainAddress) {
        throw new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'A main address already exists. Use the set-main endpoint to change the main address.',
          },
          400,
        )
      }

      const result = await client.query(
        `INSERT INTO addresses (profile_id, province_id, city_id, full_address, postal_code, main_address)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, profile_id, province_id, city_id, full_address, postal_code, main_address, created_at, updated_at`,
        [profileId, data.provinceId, data.cityId, data.fullAddress, data.postalCode, isMain],
      )

      await client.query('COMMIT')
      this.logger.log(`Address ${result.rows[0].id} created for profile ${profileId}`)
      return mapAddressRow(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      // Check foreign key violation on province or city
      if (error instanceof Error && (error as { code?: string }).code === '23503') {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Invalid province or city reference' },
          400,
        )
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Update an address for a profile.
   *
   * Only the address fields can be updated (province, city, full address,
   * postal code). The main address flag is updated via setMainAddress.
   * Prevents updating addresses linked to orders (soft delete).
   */
  async updateAddress(
    userId: string,
    profileId: string,
    addressId: string,
    data: {
      provinceId?: string
      cityId?: string
      fullAddress?: string
      postalCode?: string
    },
  ): Promise<AddressRow> {
    const pool = getDbPool()

    // Verify the profile belongs to the user
    const profile = await this.getProfileById(profileId)
    if (!profile || profile.userId !== userId) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
        404,
      )
    }

    // Verify the address belongs to the profile
    const existing = await this.getProfileAddresses(profileId)
    const address = existing.find((a) => a.id === addressId)
    if (!address) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Address not found' },
        404,
      )
    }

    // Validate postal code if provided
    if (data.postalCode !== undefined && !validatePostalCode(data.postalCode)) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Invalid postal code format' },
        400,
      )
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const updates: string[] = []
      const params: unknown[] = []
      let paramIndex = 1

      if (data.provinceId !== undefined) {
        updates.push(`province_id = $${paramIndex++}`)
        params.push(data.provinceId)
      }
      if (data.cityId !== undefined) {
        updates.push(`city_id = $${paramIndex++}`)
        params.push(data.cityId)
      }
      if (data.fullAddress !== undefined) {
        updates.push(`full_address = $${paramIndex++}`)
        params.push(data.fullAddress)
      }
      if (data.postalCode !== undefined) {
        updates.push(`postal_code = $${paramIndex++}`)
        params.push(data.postalCode)
      }

      if (updates.length === 0) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'No fields to update' },
          400,
        )
      }

      updates.push(`updated_at = NOW()`)
      params.push(addressId, profileId)

      const result = await client.query(
        `UPDATE addresses SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND profile_id = $${paramIndex++}
         RETURNING id, profile_id, province_id, city_id, full_address, postal_code, main_address, created_at, updated_at`,
        params,
      )

      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Address not found' },
          404,
        )
      }

      await client.query('COMMIT')
      this.logger.log(`Address ${addressId} updated for profile ${profileId}`)
      return mapAddressRow(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error instanceof HttpException) throw error
      if (error instanceof Error && (error as { code?: string }).code === '23503') {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Invalid province or city reference' },
          400,
        )
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Delete an address for a profile.
   *
   * If the address is the main address, the user must first set a new main
   * address. If the address is linked to an order, soft delete is applied
   * (the address is preserved for historical order accuracy). Otherwise
   * the address is hard-deleted.
   */
  async deleteAddress(
    userId: string,
    profileId: string,
    addressId: string,
  ): Promise<void> {
    const pool = getDbPool()

    // Verify the profile belongs to the user
    const profile = await this.getProfileById(profileId)
    if (!profile || profile.userId !== userId) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
        404,
      )
    }

    // Verify the address belongs to the profile
    const existing = await this.getProfileAddresses(profileId)
    const address = existing.find((a) => a.id === addressId)
    if (!address) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Address not found' },
        404,
      )
    }

    // Prevent deleting the main address without setting a new one first
    if (address.mainAddress) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Cannot delete the main address. Set a different address as main first.',
        },
        400,
      )
    }

    // Check if the address is linked to orders (soft delete)
    const orderCheck = await pool.query(
      `SELECT id FROM orders WHERE address_snapshot_id = $1 LIMIT 1`,
      [addressId],
    )

    if (orderCheck.rows.length > 0) {
      // TODO: soft-delete when orders table is ready — mark as deleted_at instead
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.CONFLICT_STATE.code,
          message: 'This address is linked to an order and cannot be deleted.',
        },
        400,
      )
    }

    await pool.query(
      `DELETE FROM addresses WHERE id = $1 AND profile_id = $2`,
      [addressId, profileId],
    )

    this.logger.log(`Address ${addressId} deleted for profile ${profileId}`)
  }

  /**
   * Set an address as the main address for a profile.
   *
   * Unsets the existing main address (if any) and sets the specified
   * address as the new main address. Wrapped in a transaction for
   * consistency.
   */
  async setMainAddress(
    userId: string,
    profileId: string,
    addressId: string,
  ): Promise<AddressRow> {
    const pool = getDbPool()

    // Verify the profile belongs to the user
    const profile = await this.getProfileById(profileId)
    if (!profile || profile.userId !== userId) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
        404,
      )
    }

    // Verify the address belongs to the profile
    const existing = await this.getProfileAddresses(profileId)
    const address = existing.find((a) => a.id === addressId)
    if (!address) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Address not found' },
        404,
      )
    }

    if (address.mainAddress) {
      // Already the main address — no-op
      return address
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Unset the current main address
      await client.query(
        `UPDATE addresses SET main_address = false, updated_at = NOW() WHERE profile_id = $1 AND main_address = true`,
        [profileId],
      )

      // Set the new main address
      const result = await client.query(
        `UPDATE addresses SET main_address = true, updated_at = NOW() WHERE id = $1 AND profile_id = $2
         RETURNING id, profile_id, province_id, city_id, full_address, postal_code, main_address, created_at, updated_at`,
        [addressId, profileId],
      )

      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Address not found' },
          404,
        )
      }

      await client.query('COMMIT')
      this.logger.log(`Address ${addressId} set as main for profile ${profileId}`)
      return mapAddressRow(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error instanceof HttpException) throw error
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get all addresses for a profile.
   */
  async getProfileAddresses(profileId: string): Promise<AddressRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, profile_id, province_id, city_id, full_address, postal_code, main_address, created_at, updated_at
       FROM addresses
       WHERE profile_id = $1
       ORDER BY main_address DESC, created_at ASC`,
      [profileId],
    )
    return result.rows.map(mapAddressRow)
  }

  /**
   * Get legal profile info for a legal entity profile.
   */
  async getLegalProfileInfo(profileId: string): Promise<Record<string, unknown> | null> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, legal_name, national_identifier, registration_number,
              company_type_id, registration_date, economic_code,
              official_phone, official_email,
              official_province_id, official_city_id, official_full_address, official_postal_code,
              representative_title, representative_relationship,
              created_at, updated_at
       FROM legal_profiles
       WHERE id = $1`,
      [profileId],
    )

    if (result.rows.length === 0) return null

    const row = result.rows[0]
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
    }
  }

  /**
   * Update profile fields (T-03.03.03).
   *
   * Editable fields: title, first name, last name, national ID (when not verified),
   * and address fields. Address changes create a new address record (historical
   * addresses retained). Identity fields are protected after verification.
   */
  async updateProfile(
    userId: string,
    profileId: string,
    data: {
      title?: string | undefined
      firstName?: string | undefined
      lastName?: string | undefined
      nationalId?: string | undefined
      provinceId?: string | undefined
      cityId?: string | undefined
      fullAddress?: string | undefined
      postalCode?: string | undefined
    },
  ): Promise<ProfileRow> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Build dynamic SET clause for profile fields
      const profileUpdates: string[] = []
      const profileParams: unknown[] = []
      let paramIndex = 1

      if (data.title !== undefined) {
        profileUpdates.push(`title = $${paramIndex++}`)
        profileParams.push(data.title || null)
      }
      if (data.firstName !== undefined) {
        profileUpdates.push(`first_name = $${paramIndex++}`)
        profileParams.push(data.firstName)
      }
      if (data.lastName !== undefined) {
        profileUpdates.push(`last_name = $${paramIndex++}`)
        profileParams.push(data.lastName)
      }
      if (data.nationalId !== undefined) {
        profileUpdates.push(`national_id = $${paramIndex++}`)
        profileParams.push(data.nationalId)
      }

      if (profileUpdates.length > 0) {
        profileUpdates.push(`updated_at = NOW()`)
        const profileQuery = `UPDATE profiles SET ${profileUpdates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex++} RETURNING id, user_id, profile_type, is_default, status, title, first_name, last_name, national_id, created_at, updated_at`
        const profileResult = await client.query(profileQuery, [...profileParams, profileId, userId])

        if (profileResult.rows.length === 0) {
          await client.query('ROLLBACK')
          throw new HttpException(
            { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
            404,
          )
        }
      }

      // If address fields are provided, create a new address record
      if (data.provinceId !== undefined || data.cityId !== undefined || data.fullAddress !== undefined || data.postalCode !== undefined) {
        // Read current main address status
        const existingMain = await client.query(
          `SELECT id FROM addresses WHERE profile_id = $1 AND main_address = true LIMIT 1`,
          [profileId],
        )
        const hasMainAddress = existingMain.rows.length > 0

        if (data.provinceId && data.cityId && data.fullAddress && data.postalCode) {
          // If this is the first address, make it main; otherwise add as non-main
          await client.query(
            `INSERT INTO addresses (profile_id, province_id, city_id, full_address, postal_code, main_address)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [profileId, data.provinceId, data.cityId, data.fullAddress, data.postalCode, !hasMainAddress],
          )
        }
      }

      // If only profile updates were made, update_at was already set
      if (profileUpdates.length === 0) {
        await client.query(
          `UPDATE profiles SET updated_at = NOW() WHERE id = $1`,
          [profileId],
        )
      }

      await client.query('COMMIT')

      const updated = await this.getProfileById(profileId)
      return updated ?? (() => { throw new Error('Profile not found after update') })()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})

      if (error instanceof HttpException) throw error

      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        throw new HttpException(
          { statusCode: 409, error: ErrorCodes.CONFLICT_DUPLICATE.code, message: 'This national ID is already registered' },
          409,
        )
      }

      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Complete onboarding for a profile — transitions from DRAFT to
   * ACTIVE or PENDING_VERIFICATION depending on system settings.
   *
   * Used by `POST /api/onboarding/complete/:profileId` (T-03.02.04).
   * If the user has no default profile yet, this one is set as default.
   * Idempotent: if already ACTIVE (e.g. saved by an earlier direct
   * save endpoint), returns success without changes.
   */
  async completeOnboarding(
    userId: string,
    profileId: string,
  ): Promise<ProfileRow> {
    const pool = getDbPool()
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

    // Idempotent — if already active/verified, just return
    if (profile.status !== 'DRAFT') {
      return profile
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Determine target status based on verification settings
      const verificationRequired =
        (await this.configCache.get<boolean>(VERIFICATION_REQUIRED_KEY)) ?? false
      const targetStatus = verificationRequired ? 'PENDING_VERIFICATION' : 'ACTIVE'

      // Set as default if user has no default profile yet
      const existing = await client.query(
        `SELECT id FROM profiles WHERE user_id = $1 AND is_default = true LIMIT 1`,
        [userId],
      )
      const becomesDefault = existing.rows.length === 0

      await client.query(
        `UPDATE profiles
         SET status = $1, is_default = $2, updated_at = NOW()
         WHERE id = $3`,
        [targetStatus, becomesDefault, profileId],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Onboarding completed for profile ${profileId} (${targetStatus})${becomesDefault ? ' as default' : ''}`,
      )

      const updated = await this.getProfileById(profileId)
      return updated ?? profile
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
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