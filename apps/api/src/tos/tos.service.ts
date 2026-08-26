import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

export interface CurrentTosResponse {
  content: string
  versionId: string
  updatedAt: Date | null
  publishedAt: Date | null
}

export interface TosVersionListItem {
  id: string
  versionId: string
  contentFa: string
  contentEn: string
  changeType: 'major' | 'minor'
  status: 'draft' | 'published'
  isActive: boolean
  publishedAt: Date | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface TosVersionDetail extends TosVersionListItem {}

export interface CreateTosVersionInput {
  versionId: string
  contentFa: string
  contentEn: string
}

export interface UpdateTosVersionInput {
  versionId?: string
  contentFa?: string
  contentEn?: string
}

export type UpdateTosVersionFields = Partial<Pick<UpdateTosVersionInput, 'versionId' | 'contentFa' | 'contentEn'>>

export interface PublishTosVersionInput {
  changeType: 'major' | 'minor'
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

  // ───────────────────────────────────────────────────────────────────────
  // Admin: TOS management (T-09.03.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * List all TOS versions, ordered by createdAt DESC.
   */
  async listVersions(): Promise<TosVersionListItem[]> {
    const pool = getDbPool()
    const result = await pool.query<TosVersionListItem>(
      `SELECT id, version_id AS "versionId", content_fa AS "contentFa",
              content_en AS "contentEn", change_type AS "changeType",
              status, is_active AS "isActive", published_at AS "publishedAt",
              created_by AS "createdBy", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM tos_versions
       ORDER BY created_at DESC`,
    )
    return result.rows
  }

  /**
   * Get a single TOS version by id.
   */
  async getVersion(id: string): Promise<TosVersionDetail> {
    const pool = getDbPool()
    const result = await pool.query<TosVersionDetail>(
      `SELECT id, version_id AS "versionId", content_fa AS "contentFa",
              content_en AS "contentEn", change_type AS "changeType",
              status, is_active AS "isActive", published_at AS "publishedAt",
              created_by AS "createdBy", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM tos_versions
       WHERE id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: 'TOS_VERSION_NOT_FOUND', message: 'TOS version not found' },
        404,
      )
    }

    return result.rows[0]!
  }

  /**
   * Create a new draft TOS version.
   * Only one draft can exist at a time — if a draft exists, it returns 409.
   */
  async createVersion(input: CreateTosVersionInput, actorUserId: string): Promise<TosVersionDetail> {
    const pool = getDbPool()

    // Check for existing draft
    const existingDraft = await pool.query(
      `SELECT id FROM tos_versions WHERE status = 'draft' LIMIT 1`,
    )

    if (existingDraft.rows.length > 0) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'TOS_DRAFT_EXISTS',
          message: 'A draft TOS version already exists. Publish or discard it first.',
        },
        409,
      )
    }

    // Check version_id uniqueness
    const existingVersionId = await pool.query(
      `SELECT id FROM tos_versions WHERE version_id = $1`,
      [input.versionId],
    )

    if (existingVersionId.rows.length > 0) {
      throw new HttpException(
        { statusCode: 409, error: 'TOS_VERSION_ID_TAKEN', message: 'Version ID is already in use' },
        409,
      )
    }

    const id = uuidv7()
    const now = new Date()

    const result = await pool.query<TosVersionDetail>(
      `INSERT INTO tos_versions (id, version_id, content_fa, content_en, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)
       RETURNING id, version_id AS "versionId", content_fa AS "contentFa",
                 content_en AS "contentEn", change_type AS "changeType",
                 status, is_active AS "isActive", published_at AS "publishedAt",
                 created_by AS "createdBy", created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [id, input.versionId, input.contentFa, input.contentEn, actorUserId, now, now],
    )

    this.logger.log(`TOS draft created: ${input.versionId} by ${actorUserId}`)

    return result.rows[0]!
  }

  /**
   * Update a draft TOS version.
   * Only draft versions can be updated.
   */
  async updateVersion(id: string, input: UpdateTosVersionFields, actorUserId: string): Promise<TosVersionDetail> {
    const pool = getDbPool()

    // Verify the version exists and is a draft
    const version = await pool.query(
      `SELECT id, status FROM tos_versions WHERE id = $1`,
      [id],
    )

    if (version.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: 'TOS_VERSION_NOT_FOUND', message: 'TOS version not found' },
        404,
      )
    }

    if (version.rows[0]!.status !== 'draft') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'TOS_VERSION_NOT_DRAFT',
          message: 'Only draft versions can be edited',
        },
        400,
      )
    }

    // Build dynamic SET clause
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (input.versionId !== undefined) {
      setClauses.push(`version_id = $${paramIndex++}`)
      params.push(input.versionId)
    }
    if (input.contentFa !== undefined) {
      setClauses.push(`content_fa = $${paramIndex++}`)
      params.push(input.contentFa)
    }
    if (input.contentEn !== undefined) {
      setClauses.push(`content_en = $${paramIndex++}`)
      params.push(input.contentEn)
    }

    if (setClauses.length === 0) {
      // Nothing to update — return current state
      return this.getVersion(id)
    }

    setClauses.push(`created_by = $${paramIndex++}`)
    params.push(actorUserId)

    setClauses.push(`updated_at = $${paramIndex++}`)
    const now = new Date()
    params.push(now)

    params.push(id)

    const result = await pool.query<TosVersionDetail>(
      `UPDATE tos_versions
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, version_id AS "versionId", content_fa AS "contentFa",
                 content_en AS "contentEn", change_type AS "changeType",
                 status, is_active AS "isActive", published_at AS "publishedAt",
                 created_by AS "createdBy", created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      params,
    )

    this.logger.log(`TOS draft updated: ${id} by ${actorUserId}`)

    return result.rows[0]!
  }

  /**
   * Publish a draft TOS version.
   *
   * Publishing sets status to 'published', records change_type and published_at.
   * If change_type is 'major', it deactivates the previously active version
   * and sets this one as the new active version (triggering re-acceptance).
   * If change_type is 'minor', the current active version stays active.
   */
  async publishVersion(id: string, input: PublishTosVersionInput, actorUserId: string): Promise<TosVersionDetail> {
    const pool = getDbPool()

    // Verify the version exists and is a draft
    const version = await pool.query(
      `SELECT id, status FROM tos_versions WHERE id = $1`,
      [id],
    )

    if (version.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: 'TOS_VERSION_NOT_FOUND', message: 'TOS version not found' },
        404,
      )
    }

    if (version.rows[0]!.status !== 'draft') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'TOS_VERSION_ALREADY_PUBLISHED',
          message: 'This TOS version is already published',
        },
        400,
      )
    }

    const now = new Date()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      if (input.changeType === 'major') {
        // Deactivate the currently active version
        await client.query(
          `UPDATE tos_versions SET is_active = false WHERE is_active = true`,
        )
      }

      // Publish this version
      const result = await client.query<TosVersionDetail>(
        `UPDATE tos_versions
         SET status = 'published',
             change_type = $1,
             is_active = $2,
             published_at = $3,
             created_by = $4,
             updated_at = $5
         WHERE id = $6
         RETURNING id, version_id AS "versionId", content_fa AS "contentFa",
                   content_en AS "contentEn", change_type AS "changeType",
                   status, is_active AS "isActive", published_at AS "publishedAt",
                   created_by AS "createdBy", created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          input.changeType,
          input.changeType === 'major',
          now,
          actorUserId,
          now,
          id,
        ],
      )

      // Record audit event
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          uuidv7(),
          actorUserId,
          'tos_updated',
          JSON.stringify({
            versionId: result.rows[0]!.versionId,
            changeType: input.changeType,
          }),
          uuidv7(),
          'admin',
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `TOS version published: ${result.rows[0]!.versionId} (${input.changeType}) by ${actorUserId}`,
      )

      return result.rows[0]!
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof HttpException) throw err
      this.logger.error(`Failed to publish TOS version ${id}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Delete a draft TOS version (discard).
   */
  async deleteVersion(id: string): Promise<void> {
    const pool = getDbPool()

    const version = await pool.query(
      `SELECT id, status FROM tos_versions WHERE id = $1`,
      [id],
    )

    if (version.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: 'TOS_VERSION_NOT_FOUND', message: 'TOS version not found' },
        404,
      )
    }

    if (version.rows[0]!.status !== 'draft') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'TOS_VERSION_PUBLISHED',
          message: 'Published TOS versions cannot be deleted',
        },
        400,
      )
    }

    await pool.query(`DELETE FROM tos_versions WHERE id = $1`, [id])

    this.logger.log(`TOS draft discarded: ${id}`)
  }
}