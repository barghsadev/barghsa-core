import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

export interface CurrentTosResponse {
  content: string
  versionId: string
  updatedAt: Date
  publishedAt: Date
}

@Injectable()
export class TosService {
  private readonly logger = new Logger(TosService.name)

  /**
   * Returns the currently active TOS version.
   *
   * Supports locale-based content selection via the `locale` parameter.
   * Falls back to Persian content when the requested locale is not available.
   */
  async getCurrent(locale: 'fa' | 'en' = 'fa'): Promise<CurrentTosResponse> {
    const pool = getDbPool()

    const result = await pool.query<{
      id: string
      version_id: string
      content_fa: string
      content_en: string
      is_active: boolean
      published_at: Date
      created_at: Date
      updated_at: Date
    }>(
      `SELECT id, version_id, content_fa, content_en, is_active, published_at, created_at, updated_at
       FROM tos_versions
       WHERE is_active = true
       ORDER BY published_at DESC
       LIMIT 1`,
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { message: 'No active TOS version found', code: 'TOS_NOT_FOUND' },
        HttpStatus.NOT_FOUND,
      )
    }

    const active = result.rows[0]!

    return {
      content: locale === 'en' ? active.content_en : active.content_fa,
      versionId: active.version_id,
      updatedAt: active.updated_at,
      publishedAt: active.published_at,
    }
  }

  /**
   * Check if a user needs to re-accept the Terms of Service (T-04.01.03).
   *
   * Returns `true` when the user's `last_accepted_tos_version` is behind the
   * currently active TOS version (or when they have never accepted).
   *
   * Exempt routes where TOS check does NOT apply:
   *   auth/*, account-recovery, support, legal/*, tos/*
   *
   * @param userId - The UUID of the user to check.
   */
  async requiresReAcceptance(userId: string): Promise<boolean> {
    const pool = getDbPool()

    // Get the current active TOS version id
    const activeResult = await pool.query<{ id: string }>(
      `SELECT id FROM tos_versions
       WHERE is_active = true
       ORDER BY published_at DESC
       LIMIT 1`,
    )

    if (activeResult.rows.length === 0) {
      // No active TOS version — nothing to accept
      return false
    }

    const activeVersionId = activeResult.rows[0]!.id

    // Get the user's last accepted version
    const userResult = await pool.query<{ last_accepted_tos_version: string | null }>(
      `SELECT last_accepted_tos_version FROM users WHERE user_id = $1`,
      [userId],
    )

    if (userResult.rows.length === 0) {
      return false
    }

    const userAccepted = userResult.rows[0]!.last_accepted_tos_version

    // If never accepted, or accepted a different version, re-acceptance is needed
    return userAccepted !== activeVersionId
  }

  /**
   * Record a TOS acceptance (T-04.01.02).
   *
   * Atomically:
   * 1. Verifies the specified TOS version exists.
   * 2. Inserts an immutable acceptance record into `tos_acceptances`.
   * 3. Updates the user's `last_accepted_tos_version`.
   *
   * This is called during registration (T-01.01.04) and re-acceptance (T-04.01.03).
   *
   * @param userId - The UUID of the accepting user.
   * @param versionId - The UUID of the TOS version being accepted.
   * @param ip - The source IP address at acceptance time.
   * @param userAgent - The User-Agent header at acceptance time (optional).
   */
  async recordAcceptance(
    userId: string,
    versionId: string,
    ip: string,
    userAgent?: string,
  ): Promise<void> {
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Verify the TOS version exists and is the current active version
      const versionResult = await client.query(
        `SELECT id FROM tos_versions WHERE id = $1 AND is_active = true FOR UPDATE`,
        [versionId],
      )

      if (versionResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
          400,
        )
      }

      // 2. Insert immutable acceptance record
      const acceptanceId = uuidv7()
      const now = new Date()

      await client.query(
        `INSERT INTO tos_acceptances (id, user_id, version_id, accepted_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [acceptanceId, userId, versionId, now, ip, userAgent ?? null],
      )

      // 3. Update user's last accepted TOS version
      await client.query(
        `UPDATE users
         SET last_accepted_tos_version = $1, updated_at = $2
         WHERE user_id = $3`,
        [versionId, now, userId],
      )

      await client.query('COMMIT')

      this.logger.log(`TOS acceptance recorded: user ${userId} accepted version ${versionId}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof HttpException) throw err
      this.logger.error(`Failed to record TOS acceptance for user ${userId}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }
}