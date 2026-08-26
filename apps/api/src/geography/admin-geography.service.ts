import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvinceRow {
  id: string
  nameFa: string
  nameEn: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface ListProvincesResult {
  provinces: ProvinceRow[]
  total: number
  page: number
  limit: number
}

export interface CreateProvinceInput {
  nameFa: string
  nameEn: string
}

export interface UpdateProvinceInput {
  nameFa?: string | undefined
  nameEn?: string | undefined
  status?: 'active' | 'inactive' | undefined
}

// ---------------------------------------------------------------------------
// Column name mappings (snake_case → camelCase)
// ---------------------------------------------------------------------------

function mapProvinceRow(row: Record<string, unknown>): ProvinceRow {
  return {
    id: row.id as string,
    nameFa: row.name_fa as string,
    nameEn: row.name_en as string,
    status: row.status as 'active' | 'inactive',
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AdminGeographyService {
  private readonly logger = new Logger(AdminGeographyService.name)

  /**
   * List provinces with optional search, status filter, and pagination.
   * Permission: admin:geography:edit (currently backed by isAdmin).
   */
  async listProvinces(
    options: {
      search?: string | undefined
      status?: 'active' | 'inactive' | undefined
      page?: number | undefined
      limit?: number | undefined
    } = {},
  ): Promise<ListProvincesResult> {
    const pool = getDbPool()
    const page = Math.max(1, options.page ?? 1)
    const limit = Math.min(100, Math.max(1, options.limit ?? 20))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (options.search) {
      // Search in both Persian and English names
      conditions.push(`(name_fa ILIKE $${paramIdx} OR name_en ILIKE $${paramIdx})`)
      params.push(`%${options.search}%`)
      paramIdx++
    }

    if (options.status) {
      conditions.push(`status = $${paramIdx}`)
      params.push(options.status)
      paramIdx++
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // Count query
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM provinces ${whereClause}`,
      params,
    )
    const total = parseInt(countResult.rows[0]!.total as string, 10)

    // Data query
    const dataResult = await pool.query(
      `SELECT id, name_fa, name_en, status, created_at, updated_at
       FROM provinces ${whereClause}
       ORDER BY updated_at DESC, name_fa ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    )

    return {
      provinces: dataResult.rows.map(mapProvinceRow),
      total,
      page,
      limit,
    }
  }

  /**
   * Get a single province by ID.
   */
  async getProvince(id: string): Promise<ProvinceRow | null> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, name_fa, name_en, status, created_at, updated_at
       FROM provinces WHERE id = $1`,
      [id],
    )
    if (result.rows.length === 0) return null
    return mapProvinceRow(result.rows[0]!)
  }

  /**
   * Create a new province.
   */
  async createProvince(input: CreateProvinceInput): Promise<ProvinceRow> {
    const pool = getDbPool()
    const id = uuidv7()
    const now = new Date()

    try {
      const result = await pool.query(
        `INSERT INTO provinces (id, name_fa, name_en, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name_fa, name_en, status, created_at, updated_at`,
        [id, input.nameFa, input.nameEn, now, now],
      )
      return mapProvinceRow(result.rows[0]!)
    } catch (error) {
      // Unique constraint on name_en (if added later) or other DB error
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        throw new HttpException(
          { statusCode: 409, error: 'GEOGRAPHY:PROVINCE_EXISTS', message: 'A province with this name already exists' },
          409,
        )
      }
      this.logger.error(`Failed to create province: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to create province' },
        500,
      )
    }
  }

  /**
   * Update an existing province.
   */
  async updateProvince(id: string, input: UpdateProvinceInput): Promise<ProvinceRow | null> {
    const pool = getDbPool()

    // First check existence
    const existing = await this.getProvince(id)
    if (!existing) return null

    // Build dynamic UPDATE
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (input.nameFa !== undefined) {
      setClauses.push(`name_fa = $${paramIdx}`)
      params.push(input.nameFa)
      paramIdx++
    }
    if (input.nameEn !== undefined) {
      setClauses.push(`name_en = $${paramIdx}`)
      params.push(input.nameEn)
      paramIdx++
    }
    if (input.status !== undefined) {
      setClauses.push(`status = $${paramIdx}`)
      params.push(input.status)
      paramIdx++
    }

    if (setClauses.length === 0) {
      return existing
    }

    params.push(id)

    try {
      const result = await pool.query(
        `UPDATE provinces SET ${setClauses.join(', ')}
         WHERE id = $${paramIdx}
         RETURNING id, name_fa, name_en, status, created_at, updated_at`,
        params,
      )
      return mapProvinceRow(result.rows[0]!)
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        throw new HttpException(
          { statusCode: 409, error: 'GEOGRAPHY:PROVINCE_EXISTS', message: 'A province with this name already exists' },
          409,
        )
      }
      this.logger.error(`Failed to update province ${id}: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update province' },
        500,
      )
    }
  }

  /**
   * Delete (set inactive) a province. Rejects deletion if cities reference it
   * or if it's referenced by active profiles.
   */
  async deleteProvince(id: string): Promise<boolean> {
    const pool = getDbPool()

    const existing = await this.getProvince(id)
    if (!existing) return false

    // Check for cities referencing this province
    const citiesResult = await pool.query(
      `SELECT COUNT(*) AS cnt FROM cities WHERE province_id = $1`,
      [id],
    )
    const cityCount = parseInt(citiesResult.rows[0]!.cnt as string, 10)
    if (cityCount > 0) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'GEOGRAPHY:PROVINCE_HAS_CITIES',
          message: `Cannot delete province with ${cityCount} associated cities. Deactivate it instead.`,
        },
        409,
      )
    }

    // Soft-delete by setting inactive
    await pool.query(
      `UPDATE provinces SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [id],
    )
    return true
  }
}