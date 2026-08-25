import { Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
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
      `SELECT id, user_id, profile_type, is_default, status, title, first_name, last_name, created_at, updated_at
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
      `SELECT id, user_id, profile_type, is_default, status, title, first_name, last_name, created_at, updated_at
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
    if (method && method !== 'api') {
      throw new Error(
        `Cannot auto-verify: verification method is '${method}', not 'api'`,
      )
    }

    await pool.query(
      `UPDATE profiles SET status = 'VERIFIED', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [profileId, userId],
    )

    this.logger.log(`Profile ${profileId} auto-verified for user ${userId}`)
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