import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { PoolClient } from 'pg';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';

const ADMIN_VERSION_COLUMNS = `id, version_id AS "versionId", content_fa AS "contentFa",
 content_en AS "contentEn", change_type AS "changeType", status, is_active AS "isActive",
 published_at AS "publishedAt", created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface CurrentTosResponse {
  id: string;
  content: string;
  versionId: string;
  updatedAt: Date | null;
  publishedAt: Date | null;
}

export interface TosVersionListItem {
  id: string;
  versionId: string;
  contentFa: string;
  contentEn: string;
  changeType: 'major' | 'minor';
  status: 'draft' | 'published';
  isActive: boolean;
  publishedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TosVersionDetail = TosVersionListItem;

export interface CreateTosVersionInput {
  versionId: string;
  contentFa: string;
  contentEn: string;
}

export interface UpdateTosVersionInput {
  versionId?: string;
  contentFa?: string;
  contentEn?: string;
}

export type UpdateTosVersionFields = Partial<
  Pick<UpdateTosVersionInput, 'versionId' | 'contentFa' | 'contentEn'>
>;

export interface PublishTosVersionInput {
  changeType: 'major' | 'minor';
}

@Injectable()
export class TosService {
  private readonly logger = new Logger(TosService.name);

  /**
   * Returns the currently active TOS version.
   *
   * Supports locale-based content selection via the `locale` parameter.
   * Falls back to Persian content when the requested locale is not available.
   */
  async getCurrent(locale: 'fa' | 'en' = 'fa'): Promise<CurrentTosResponse> {
    const pool = getDbPool();

    const result = await pool.query<{
      id: string;
      version_id: string;
      content_fa: string;
      content_en: string;
      is_active: boolean;
      published_at: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, version_id, content_fa, content_en, is_active, published_at, created_at, updated_at
       FROM tos_versions
       WHERE is_active = true AND status = 'published' AND published_at IS NOT NULL
       ORDER BY published_at DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      throw new HttpException(
        { message: 'No active TOS version found', code: 'TOS_NOT_FOUND' },
        HttpStatus.NOT_FOUND
      );
    }

    const active = result.rows[0]!;

    return {
      id: active.id,
      content: locale === 'en' ? active.content_en : active.content_fa,
      versionId: active.version_id,
      updatedAt: active.updated_at,
      publishedAt: active.published_at,
    };
  }

  /**
   * Check if a user needs to re-accept the Terms of Service (T-04.01.03).
   *
   * Returns `true` when the accepted document predates the latest material
   * publication, or the user has never accepted a published document.
   *
   * Exempt routes where TOS check does NOT apply:
   *   auth/*, account-recovery, support, legal/*, tos/*
   *
   * @param userId - The UUID of the user to check.
   */
  async requiresReAcceptance(userId: string): Promise<boolean> {
    const pool = getDbPool();

    // One snapshot binds the active document, material boundary and accepted version.
    const result = await pool.query<{ required: boolean }>(
      `WITH active AS (
         SELECT id,published_at FROM tos_versions
         WHERE is_active=true AND status='published' AND published_at IS NOT NULL
         ORDER BY published_at DESC LIMIT 1
       ), material AS (
         SELECT v.id,v.published_at FROM tos_versions v, active a
         WHERE v.status='published' AND COALESCE(v.change_type,'major')='major'
           AND v.published_at <= a.published_at
         ORDER BY v.published_at DESC,(v.id=a.id) DESC,v.id DESC LIMIT 1
       )
       SELECT (accepted.id IS NULL OR
         (accepted.id<>active.id AND accepted.id<>material.id
           AND material.published_at IS NOT NULL AND accepted.published_at <= material.published_at)
       ) AS required
       FROM users u CROSS JOIN active LEFT JOIN material ON true
       LEFT JOIN tos_versions accepted ON accepted.id::text=u.last_accepted_tos_version
         AND accepted.status='published' AND accepted.published_at IS NOT NULL
       WHERE u.user_id=$1`,
      [userId]
    );
    return result.rows[0]?.required ?? false;
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
    userAgent?: string
  ): Promise<void> {
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Match administrator mutations: lock the account before any version row.
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [userId]);

      // 1. Verify the TOS version exists and is the current active version
      const versionResult = await client.query(
        `SELECT id FROM tos_versions WHERE id::text = $1 AND is_active = true AND status = 'published' AND published_at IS NOT NULL FOR UPDATE`,
        [versionId]
      );

      if (versionResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
          400
        );
      }

      // 2. Insert immutable acceptance record
      const acceptanceId = uuidv7();
      const now = new Date();

      await client.query(
        `INSERT INTO tos_acceptances (id, user_id, version_id, accepted_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [acceptanceId, userId, versionId, now, ip, userAgent ?? null]
      );

      // 3. Update user's last accepted TOS version
      await client.query(
        `UPDATE users
         SET last_accepted_tos_version = $1, updated_at = $2
         WHERE user_id = $3`,
        [versionId, now, userId]
      );

      await client.query('COMMIT');

      this.logger.log(`TOS acceptance recorded: user ${userId} accepted version ${versionId}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof HttpException) throw err;
      this.logger.error(`Failed to record TOS acceptance for user ${userId}: ${String(err)}`);
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Admin: TOS management (T-09.03.01)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * List all TOS versions, ordered by createdAt DESC.
   */
  async listVersions(): Promise<TosVersionListItem[]> {
    const pool = getDbPool();
    const result = await pool.query<TosVersionListItem>(
      `SELECT id, version_id AS "versionId", content_fa AS "contentFa",
              content_en AS "contentEn", change_type AS "changeType",
              status, is_active AS "isActive", published_at AS "publishedAt",
              created_by AS "createdBy", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM tos_versions
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  /**
   * Get a single TOS version by id.
   */
  async getVersion(id: string): Promise<TosVersionDetail> {
    const pool = getDbPool();
    const result = await pool.query<TosVersionDetail>(
      `SELECT id, version_id AS "versionId", content_fa AS "contentFa",
              content_en AS "contentEn", change_type AS "changeType",
              status, is_active AS "isActive", published_at AS "publishedAt",
              created_by AS "createdBy", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM tos_versions
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: 'TOS_VERSION_NOT_FOUND', message: 'TOS version not found' },
        404
      );
    }

    return result.rows[0]!;
  }

  /**
   * Create a new draft TOS version.
   * Only one draft can exist at a time — if a draft exists, it returns 409.
   */
  async createVersion(
    input: CreateTosVersionInput,
    actorUserId: string,
    ip = 'unknown'
  ): Promise<TosVersionDetail> {
    return this.adminTransaction(actorUserId, async (client) => {
      const existing = await client.query(
        "SELECT id FROM tos_versions WHERE status='draft' LIMIT 1"
      );
      if (existing.rows.length)
        throw new HttpException({ statusCode: 409, error: 'TOS_DRAFT_EXISTS' }, 409);
      const result = await client.query<TosVersionDetail>(
        `INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,created_by)
         VALUES ($1,$2,$3,$4,'draft',$5) RETURNING ${ADMIN_VERSION_COLUMNS}`,
        [uuidv7(), input.versionId, input.contentFa, input.contentEn, actorUserId]
      );
      const version = result.rows[0]!;
      await this.auditAdminWrite(client, actorUserId, ip, 'create', version);
      return version;
    });
  }

  async updateVersion(
    id: string,
    input: UpdateTosVersionFields,
    actorUserId: string,
    ip = 'unknown'
  ): Promise<TosVersionDetail> {
    return this.adminTransaction(actorUserId, async (client) => {
      const current = await this.lockDraft(client, id, 'TOS_VERSION_NOT_DRAFT');
      const result = await client.query<TosVersionDetail>(
        `UPDATE tos_versions SET version_id=$1, content_fa=$2, content_en=$3, created_by=$4, updated_at=NOW()
         WHERE id=$5 AND status='draft' RETURNING ${ADMIN_VERSION_COLUMNS}`,
        [
          input.versionId ?? current.versionId,
          input.contentFa ?? current.contentFa,
          input.contentEn ?? current.contentEn,
          actorUserId,
          id,
        ]
      );
      const version = result.rows[0]!;
      await this.auditAdminWrite(client, actorUserId, ip, 'edit', version);
      return version;
    });
  }

  async publishVersion(
    id: string,
    input: PublishTosVersionInput,
    actorUserId: string,
    ip = 'unknown'
  ): Promise<TosVersionDetail> {
    return this.adminTransaction(actorUserId, async (client) => {
      await this.lockDraft(client, id, 'TOS_VERSION_ALREADY_PUBLISHED');
      await client.query('UPDATE tos_versions SET is_active=false WHERE is_active=true');
      const result = await client.query<TosVersionDetail>(
        `UPDATE tos_versions SET status='published',change_type=$1,is_active=$2,
         published_at=clock_timestamp(),created_by=$3,updated_at=clock_timestamp() WHERE id=$4
         RETURNING ${ADMIN_VERSION_COLUMNS}`,
        [input.changeType, true, actorUserId, id]
      );
      const version = result.rows[0]!;
      await this.auditAdminWrite(client, actorUserId, ip, 'publish', version);
      return version;
    });
  }

  async deleteVersion(id: string, actorUserId: string, ip = 'unknown'): Promise<void> {
    await this.adminTransaction(actorUserId, async (client) => {
      const version = await this.lockDraft(client, id, 'TOS_VERSION_PUBLISHED');
      await client.query("DELETE FROM tos_versions WHERE id=$1 AND status='draft'", [id]);
      await this.auditAdminWrite(client, actorUserId, ip, 'discard', version);
    });
  }

  private async lockDraft(
    client: PoolClient,
    id: string,
    error: string
  ): Promise<TosVersionDetail> {
    const result = await client.query<TosVersionDetail>(
      `SELECT ${ADMIN_VERSION_COLUMNS} FROM tos_versions WHERE id=$1 FOR UPDATE`,
      [id]
    );
    const version = result.rows[0];
    if (!version) throw new HttpException({ statusCode: 404, error: 'TOS_VERSION_NOT_FOUND' }, 404);
    if (version.status !== 'draft') throw new HttpException({ statusCode: 400, error }, 400);
    return version;
  }

  private async auditAdminWrite(
    client: PoolClient,
    actorUserId: string,
    ip: string,
    action: 'create' | 'edit' | 'publish' | 'discard',
    version: TosVersionDetail
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
       VALUES ($1,$2,'tos_updated',$3::jsonb,$4,$5,NOW())`,
      [
        uuidv7(),
        actorUserId,
        JSON.stringify({
          action,
          id: version.id,
          versionId: version.versionId,
          changeType: version.changeType,
        }),
        uuidv7(),
        ip,
      ]
    );
  }

  private async adminTransaction<T>(
    actorUserId: string,
    run: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actorUserId, 'admin:tos:edit');
      // The single-draft and active-version decisions are shared across all editors.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('barghsa:tos:admin',0))");
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505')
          throw new HttpException({ statusCode: 409, error: 'TOS_VERSION_ID_TAKEN' }, 409);
        if (error.code === '22P02')
          throw new HttpException(
            { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
            400
          );
      }
      throw new HttpException({ statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code }, 500);
    } finally {
      client.release();
    }
  }
}
