import { Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'

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

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name)

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
}
