import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import type { BrandConfigDto } from './admin.controller.js'

/**
 * Brand config service (T-09.01.01).
 *
 * Manages brand configuration with a Draft → Active lifecycle:
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
  private readonly logger = new Logger(BrandConfigService.name)

  /**
   * Map a DB row to a BrandConfigDto.
   */
  private rowToDto(row: {
    id: string
    config: unknown
    version: number
    status: 'draft' | 'active'
    created_by: string
    created_at: Date
    updated_at: Date
  }): BrandConfigDto {
    return {
      id: row.id,
      config: (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as Record<string, unknown>,
      version: row.version,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  /**
   * Get the active brand config, or the latest draft if none active.
   * Returns a default config if no config exists at all.
   */
  async getActiveConfig(): Promise<BrandConfigDto> {
    const pool = getDbPool()

    // Try active first
    const activeResult = await pool.query(
      `SELECT id, config, version, status, created_by, created_at, updated_at
       FROM brand_config
       WHERE status = 'active'
       LIMIT 1`,
    )

    if (activeResult.rows.length > 0) {
      return this.rowToDto(activeResult.rows[0])
    }

    // Fall back to latest draft
    const draftResult = await pool.query(
      `SELECT id, config, version, status, created_by, created_at, updated_at
       FROM brand_config
       ORDER BY version DESC, created_at DESC
       LIMIT 1`,
    )

    if (draftResult.rows.length > 0) {
      return this.rowToDto(draftResult.rows[0])
    }

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
    }
  }

  /**
   * List all brand config versions, newest first.
   */
  async listConfigs(): Promise<BrandConfigDto[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, config, version, status, created_by, created_at, updated_at
       FROM brand_config
       ORDER BY version DESC, created_at DESC`,
    )
    return result.rows.map((row) => this.rowToDto(row))
  }

  /**
   * Create or update a draft config.
   *
   * If a draft exists, updates it. If no draft exists, creates a new draft
   * version based on the active config (or a fresh default if nothing is active).
   */
  async upsertDraft(config: Record<string, unknown>, userId: string): Promise<BrandConfigDto> {
    const pool = getDbPool()

    // Check if a draft already exists
    const existingDraft = await pool.query(
      `SELECT id, version FROM brand_config WHERE status = 'draft' LIMIT 1`,
    )

    const now = new Date()

    if (existingDraft.rows.length > 0) {
      // Update existing draft
      const result = await pool.query(
        `UPDATE brand_config
         SET config = $1::jsonb, updated_at = $2, created_by = $3
         WHERE id = $4
         RETURNING id, config, version, status, created_by, created_at, updated_at`,
        [JSON.stringify(config), now, userId, existingDraft.rows[0].id],
      )
      this.logger.log(`Brand draft config updated: id=${existingDraft.rows[0].id}, version=${existingDraft.rows[0].version}`)
      return this.rowToDto(result.rows[0])
    }

    // Find the latest version number
    const maxVersion = await pool.query(
      `SELECT COALESCE(MAX(version), 0) AS max_ver FROM brand_config`,
    )
    const nextVersion = (maxVersion.rows[0].max_ver as number) + 1

    // Create a new draft
    const id = uuidv7()
    const result = await pool.query(
      `INSERT INTO brand_config (id, config, version, status, created_by, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, 'draft', $4, $5, $6)
       RETURNING id, config, version, status, created_by, created_at, updated_at`,
      [id, JSON.stringify(config), nextVersion, userId, now, now],
    )
    this.logger.log(`Brand draft config created: id=${id}, version=${nextVersion}`)
    return this.rowToDto(result.rows[0])
  }

  /**
   * Activate the current draft config.
   *
   * Sets the previous active config to draft (version history preserved),
   * then promotes the current draft to active. If no draft exists, throws 400.
   */
  async activateDraft(userId: string): Promise<BrandConfigDto> {
    const pool = getDbPool()

    // Find the draft
    const draftResult = await pool.query(
      `SELECT id, config, version FROM brand_config WHERE status = 'draft' LIMIT 1`,
    )

    if (draftResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 400, error: 'NO_DRAFT_CONFIG', message: 'No draft config to activate' },
        400,
      )
    }

    const draft = draftResult.rows[0]
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Lock the brand_config rows to serialize concurrent activations.
      // This prevents a race where two activations could both deactivate the
      // active config and both promote their draft, which would violate the
      // unique partial index uq_brand_config_active.
      await client.query(
        `SELECT id FROM brand_config WHERE status IN ('active', 'draft') FOR UPDATE`,
      )

      // Deactivate active config (set to draft to preserve history)
      await client.query(
        `UPDATE brand_config SET status = 'draft', updated_at = $1
         WHERE status = 'active'`,
        [new Date()],
      )

      // Activate the draft
      const result = await client.query(
        `UPDATE brand_config
         SET status = 'active', updated_at = $1, created_by = $2
         WHERE id = $3
         RETURNING id, config, version, status, created_by, created_at, updated_at`,
        [new Date(), userId, draft.id],
      )

      await client.query('COMMIT')

      this.logger.log(`Brand draft activated: id=${draft.id}, version=${draft.version}`)
      return this.rowToDto(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to activate brand draft: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to activate brand config' },
        500,
      )
    } finally {
      client.release()
    }
  }
}