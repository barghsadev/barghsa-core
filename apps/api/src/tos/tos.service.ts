import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'

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
}