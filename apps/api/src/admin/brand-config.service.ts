import { VerifiedAttachmentsService } from '../storage/verified-attachments.service.js';
import { Injectable, ConflictException, Optional, BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import type { BrandConfigDto } from './admin.controller.js';

/**
 * Brand config service (T-09.01.01).
 *
 * Manages immutable draft revisions and explicit publication:
 *   - Draft: work-in-progress, one draft at a time.
 *   - Active: the currently published config, at most one at a time.
 *
 * The config is stored as a JSONB blob in the brand_config table.
 *
 * Note: Uses raw pg pool queries (via getDbPool()) rather than Drizzle ORM
 * query builder for JSONB upserts with RETURNING, consistent with the
 * project's established data-access pattern (see config-cache, crm, otp,
 * health, and other services in apps/api/src/).
 */
@Injectable()
export class BrandConfigService {
  constructor(@Optional() private readonly attachments?: VerifiedAttachmentsService) {}
  /**
   * Map a DB row to a BrandConfigDto.
   */
  private rowToDto(row: {
    id: string;
    config: unknown;
    version: number;
    status: 'draft' | 'active' | 'superseded';
    created_by: string;
    created_at: Date;
    updated_at: Date;
  }): BrandConfigDto {
    return {
      id: row.id,
      config: (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as Record<
        string,
        unknown
      >,
      version: row.version,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  /**
   * Read published branding. Staff may explicitly prefer the latest draft for preview.
   * Public reads use safe defaults until a version has been activated.
   */
  async getActiveConfig(includeDraft = false): Promise<BrandConfigDto> {
    const pool = getDbPool();

    if (includeDraft) {
      const draft = await pool.query(
        `SELECT id,config,version,status,created_by,created_at,updated_at FROM brand_config
         WHERE status='draft' AND version>(SELECT COALESCE(MAX(version),0) FROM brand_config WHERE status='active')
         ORDER BY version DESC,created_at DESC,id DESC LIMIT 1`
      );
      if (draft.rows[0]) return this.rowToDto(draft.rows[0]);
    }
    const active = await pool.query(
      `SELECT id,config,version,status,created_by,created_at,updated_at
       FROM brand_config WHERE status='active' LIMIT 1`
    );
    if (active.rows[0]) return this.rowToDto(active.rows[0]);

    // Return default config
    return {
      id: 'default',
      config: {
        appTitle: 'Barghsa',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: false,
      },
      version: 0,
      status: 'draft',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * List all brand config versions, newest first.
   */
  async listConfigs(): Promise<BrandConfigDto[]> {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT id, config, version, status, created_by, created_at, updated_at
       FROM brand_config
       ORDER BY version DESC, created_at DESC`
    );
    return result.rows.map((row) => this.rowToDto(row));
  }

  /** Save a new immutable revision. Competing editors must reload before saving. */
  async upsertDraft(
    config: Record<string, unknown>,
    userId: string,
    expectedVersion: number,
    logoUploadKey?: string
  ): Promise<BrandConfigDto> {
    return this.withHistoryLock(userId, async (client) => {
      const version = await this.currentVersion(client);
      if (version !== expectedVersion || version >= 2147483647)
        throw new ConflictException('Brand configuration changed');
      let savedConfig = { ...config };
      if (logoUploadKey) {
        if (!this.attachments) throw new BadRequestException('Logo storage is unavailable');
        const [key] = await this.attachments.seal(
          client,
          [logoUploadKey],
          userId,
          null,
          'branding_logo'
        );
        savedConfig = {
          ...savedConfig,
          logoUrl: `/api/public/branding/assets/${key!.slice('branding-assets/'.length)}`,
        };
      } else if (
        typeof config.logoUrl === 'string' &&
        config.logoUrl.startsWith('/api/public/branding/assets/')
      ) {
        const known = await client.query(
          "SELECT 1 FROM brand_config WHERE config->>'logoUrl'=$1 LIMIT 1",
          [config.logoUrl]
        );
        if (!known.rows[0]) throw new BadRequestException('Unknown branding asset');
      }
      await client.query("UPDATE brand_config SET status='superseded' WHERE status='draft'");
      const result = await client.query(
        `INSERT INTO brand_config(id,config,version,status,created_by) VALUES ($1,$2::jsonb,$3,'draft',$4)
         RETURNING id,config,version,status,created_by,created_at,updated_at`,
        [uuidv7(), JSON.stringify(savedConfig), version + 1, userId]
      );
      const dto = this.rowToDto(result.rows[0]);
      await this.audit(client, userId, 'branding.draft_created', dto);
      return dto;
    });
  }

  /** Activate only the exact saved draft the editor reviewed. */
  async activateDraft(
    userId: string,
    draftId: string,
    expectedVersion: number
  ): Promise<BrandConfigDto> {
    return this.withHistoryLock(userId, async (client) => {
      if ((await this.currentVersion(client)) !== expectedVersion)
        throw new ConflictException('Brand configuration changed');
      const draft = await client.query(
        `SELECT id FROM brand_config WHERE id=$1 AND version=$2 AND status='draft'
         AND NOT EXISTS(SELECT 1 FROM brand_config WHERE status='active' AND version>=$2)`,
        [draftId, expectedVersion]
      );
      if (!draft.rows[0])
        throw new ConflictException('Brand draft changed or was already activated');
      await client.query("UPDATE brand_config SET status='superseded' WHERE status='active'");
      const result = await client.query(
        `UPDATE brand_config SET status='active' WHERE id=$1
         RETURNING id,config,version,status,created_by,created_at,updated_at`,
        [draftId]
      );
      const dto = this.rowToDto(result.rows[0]);
      await this.audit(client, userId, 'branding.activated', dto);
      return dto;
    });
  }

  private async currentVersion(client: PoolClient): Promise<number> {
    const result = await client.query<{ version: number }>(
      'SELECT COALESCE(MAX(version),0) AS version FROM brand_config'
    );
    return result.rows[0]!.version;
  }

  private async audit(client: PoolClient, userId: string, event: string, dto: BrandConfigDto) {
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
       VALUES($1,$2,$3,$4::jsonb,$5,NULL)`,
      [
        uuidv7(),
        userId,
        event,
        JSON.stringify({ configId: dto.id, version: dto.version }),
        uuidv7(),
      ]
    );
  }

  private async withHistoryLock<T>(
    userId: string,
    action: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, userId, 'admin:branding:edit');
      // Configuration writes are rare. The table lock also serializes the empty-history case.
      await client.query('LOCK TABLE brand_config IN SHARE ROW EXCLUSIVE MODE');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
