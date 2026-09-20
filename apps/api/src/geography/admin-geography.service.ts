import type { Pool, PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvinceRow {
  id: string;
  nameFa: string;
  nameEn: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface ListProvincesResult {
  provinces: ProvinceRow[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateProvinceInput {
  nameFa: string;
  nameEn: string;
}

export interface UpdateProvinceInput {
  nameFa?: string | undefined;
  nameEn?: string | undefined;
  status?: 'active' | 'inactive' | undefined;
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
  };
}

// ---------------------------------------------------------------------------
// City types
// ---------------------------------------------------------------------------

export interface CityRow {
  id: string;
  provinceId: string;
  nameFa: string;
  nameEn: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface ListCitiesResult {
  cities: CityRow[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateCityInput {
  nameFa: string;
  nameEn: string;
}

export interface UpdateCityInput {
  nameFa?: string | undefined;
  nameEn?: string | undefined;
  status?: 'active' | 'inactive' | undefined;
}

function mapCityRow(row: Record<string, unknown>): CityRow {
  return {
    id: row.id as string,
    provinceId: row.province_id as string,
    nameFa: row.name_fa as string,
    nameEn: row.name_en as string,
    status: row.status as 'active' | 'inactive',
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AdminGeographyService {
  private readonly logger = new Logger(AdminGeographyService.name);

  /**
   * List provinces with optional search, status filter, and pagination.
   * Permission: admin:geography:edit (currently backed by isAdmin).
   */
  async listProvinces(
    options: {
      search?: string | undefined;
      status?: 'active' | 'inactive' | undefined;
      page?: number | undefined;
      limit?: number | undefined;
    } = {}
  ): Promise<ListProvincesResult> {
    const pool = getDbPool();
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (options.search) {
      // Search in both Persian and English names
      conditions.push(`(name_fa ILIKE $${paramIdx} OR name_en ILIKE $${paramIdx})`);
      params.push(`%${options.search}%`);
      paramIdx++;
    }

    if (options.status) {
      conditions.push(`status = $${paramIdx}`);
      params.push(options.status);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count query
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM provinces ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]!.total as string, 10);

    // Data query
    const dataResult = await pool.query(
      `SELECT id, name_fa, name_en, status, created_at, updated_at
       FROM provinces ${whereClause}
       ORDER BY updated_at DESC, name_fa ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return {
      provinces: dataResult.rows.map(mapProvinceRow),
      total,
      page,
      limit,
    };
  }

  /**
   * Get a single province by ID.
   */
  async getProvince(
    id: string,
    pool: Pick<Pool, 'query'> = getDbPool()
  ): Promise<ProvinceRow | null> {
    const result = await pool.query(
      `SELECT id, name_fa, name_en, status, created_at, updated_at
       FROM provinces WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapProvinceRow(result.rows[0]!);
  }

  /**
   * Create a new province.
   */
  async createProvince(
    input: CreateProvinceInput,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ): Promise<ProvinceRow> {
    return this.withMutation(actor, ip, 'provinces', null, async (pool) => {
      const id = uuidv7();
      const now = new Date();

      try {
        const result = await pool.query(
          `INSERT INTO provinces (id, name_fa, name_en, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name_fa, name_en, status, created_at, updated_at`,
          [id, input.nameFa, input.nameEn, now, now]
        );
        return mapProvinceRow(result.rows[0]!);
      } catch (error) {
        // Unique constraint on name_en (if added later) or other DB error
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === '23505'
        ) {
          throw new HttpException(
            {
              statusCode: 409,
              error: 'GEOGRAPHY:PROVINCE_EXISTS',
              message: 'A province with this name already exists',
            },
            409
          );
        }
        this.logger.error(`Failed to create province: ${String(error)}`);
        throw new HttpException(
          { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to create province' },
          500
        );
      }
    });
  }

  /**
   * Update an existing province.
   */
  async updateProvince(
    id: string,
    input: UpdateProvinceInput,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ): Promise<ProvinceRow | null> {
    return this.withMutation(actor, ip, 'provinces', id, async (pool) => {
      // First check existence
      const existing = await this.getProvince(id, pool);
      if (!existing) return null;

      // Build dynamic UPDATE
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.nameFa !== undefined) {
        setClauses.push(`name_fa = $${paramIdx}`);
        params.push(input.nameFa);
        paramIdx++;
      }
      if (input.nameEn !== undefined) {
        setClauses.push(`name_en = $${paramIdx}`);
        params.push(input.nameEn);
        paramIdx++;
      }
      if (input.status !== undefined) {
        setClauses.push(`status = $${paramIdx}`);
        params.push(input.status);
        paramIdx++;
      }

      if (setClauses.length === 0) {
        return existing;
      }

      params.push(id);

      try {
        const result = await pool.query(
          `UPDATE provinces SET ${setClauses.join(', ')}, updated_at=clock_timestamp()
         WHERE id = $${paramIdx}
         RETURNING id, name_fa, name_en, status, created_at, updated_at`,
          params
        );
        return mapProvinceRow(result.rows[0]!);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === '23505'
        ) {
          throw new HttpException(
            {
              statusCode: 409,
              error: 'GEOGRAPHY:PROVINCE_EXISTS',
              message: 'A province with this name already exists',
            },
            409
          );
        }
        this.logger.error(`Failed to update province ${id}: ${String(error)}`);
        throw new HttpException(
          { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update province' },
          500
        );
      }
    });
  }

  /**
   * Delete (set inactive) a province. Rejects deletion if cities reference it
   * or if it's referenced by active profiles.
   */
  async deleteProvince(
    id: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ): Promise<boolean> {
    return this.withMutation(actor, ip, 'provinces', id, async (pool) => {
      const existing = await this.getProvince(id, pool);
      if (!existing) return false;

      // Check for cities referencing this province
      const citiesResult = await pool.query(
        `SELECT COUNT(*) AS cnt FROM cities WHERE province_id = $1`,
        [id]
      );
      const cityCount = parseInt(citiesResult.rows[0]!.cnt as string, 10);
      if (cityCount > 0) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'GEOGRAPHY:PROVINCE_HAS_CITIES',
            message: `Cannot delete province with ${cityCount} associated cities. Deactivate it instead.`,
          },
          409
        );
      }

      // Soft-delete by setting inactive
      await pool.query(
        `UPDATE provinces SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
        [id]
      );
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // City CRUD
  // ---------------------------------------------------------------------------

  /**
   * List cities for a province with optional search, status filter, and pagination.
   */
  async listCities(
    provinceId: string,
    options: {
      search?: string | undefined;
      status?: 'active' | 'inactive' | undefined;
      page?: number | undefined;
      limit?: number | undefined;
    } = {}
  ): Promise<ListCitiesResult> {
    const pool = getDbPool();
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['province_id = $1'];
    const params: unknown[] = [provinceId];
    let paramIdx = 2;

    if (options.search) {
      conditions.push(`(name_fa ILIKE $${paramIdx} OR name_en ILIKE $${paramIdx})`);
      params.push(`%${options.search}%`);
      paramIdx++;
    }

    if (options.status) {
      conditions.push(`status = $${paramIdx}`);
      params.push(options.status);
      paramIdx++;
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM cities ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]!.total as string, 10);

    const dataResult = await pool.query(
      `SELECT id, province_id, name_fa, name_en, status, created_at, updated_at
       FROM cities ${whereClause}
       ORDER BY updated_at DESC, name_fa ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return {
      cities: dataResult.rows.map(mapCityRow),
      total,
      page,
      limit,
    };
  }

  /**
   * Get a single city by ID.
   */
  async getCity(id: string, pool: Pick<Pool, 'query'> = getDbPool()): Promise<CityRow | null> {
    const result = await pool.query(
      `SELECT id, province_id, name_fa, name_en, status, created_at, updated_at
       FROM cities WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapCityRow(result.rows[0]!);
  }

  /**
   * Create a new city in a province.
   */
  async createCity(
    provinceId: string,
    input: CreateCityInput,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ): Promise<CityRow> {
    return this.withMutation(actor, ip, 'cities', null, async (pool) => {
      return this.insertCity(pool, provinceId, input);
    });
  }

  async importCities(
    provinceId: string,
    inputs: CreateCityInput[],
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ) {
    return this.withMutation(actor, ip, 'cities', null, async (pool) => {
      const cities: CityRow[] = [];
      for (const input of inputs) cities.push(await this.insertCity(pool, provinceId, input));
      return { cities, imported: cities.length };
    });
  }

  private async insertCity(
    pool: PoolClient,
    provinceId: string,
    input: CreateCityInput
  ): Promise<CityRow> {
    const id = uuidv7();
    const now = new Date();

    // Verify province exists
    const provResult = await pool.query(`SELECT id FROM provinces WHERE id = $1`, [provinceId]);
    if (provResult.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'GEOGRAPHY:PROVINCE_NOT_FOUND',
          message: 'Parent province not found',
        },
        404
      );
    }

    try {
      const result = await pool.query(
        `INSERT INTO cities (id, province_id, name_fa, name_en, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, province_id, name_fa, name_en, status, created_at, updated_at`,
        [id, provinceId, input.nameFa, input.nameEn, now, now]
      );
      return mapCityRow(result.rows[0]!);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'GEOGRAPHY:CITY_EXISTS',
            message: 'A city with this English name already exists in this province',
          },
          409
        );
      }
      this.logger.error(`Failed to create city: ${String(error)}`);
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to create city' },
        500
      );
    }
  }

  /**
   * Update an existing city.
   */
  async updateCity(
    id: string,
    input: UpdateCityInput,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ): Promise<CityRow | null> {
    return this.withMutation(actor, ip, 'cities', id, async (pool) => {
      const existing = await this.getCity(id, pool);
      if (!existing) return null;

      if (input.status === 'inactive' && existing.status !== 'inactive') {
        await this.requireUnreferencedCity(pool, id);
      }

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.nameFa !== undefined) {
        setClauses.push(`name_fa = $${paramIdx}`);
        params.push(input.nameFa);
        paramIdx++;
      }
      if (input.nameEn !== undefined) {
        setClauses.push(`name_en = $${paramIdx}`);
        params.push(input.nameEn);
        paramIdx++;
      }
      if (input.status !== undefined) {
        setClauses.push(`status = $${paramIdx}`);
        params.push(input.status);
        paramIdx++;
      }

      if (setClauses.length === 0) {
        return existing;
      }

      params.push(id);

      try {
        const result = await pool.query(
          `UPDATE cities SET ${setClauses.join(', ')}, updated_at=clock_timestamp()
         WHERE id = $${paramIdx}
         RETURNING id, province_id, name_fa, name_en, status, created_at, updated_at`,
          params
        );
        return mapCityRow(result.rows[0]!);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === '23505'
        ) {
          throw new HttpException(
            {
              statusCode: 409,
              error: 'GEOGRAPHY:CITY_EXISTS',
              message: 'A city with this English name already exists in this province',
            },
            409
          );
        }
        this.logger.error(`Failed to update city ${id}: ${String(error)}`);
        throw new HttpException(
          { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update city' },
          500
        );
      }
    });
  }

  /**
   * Delete (set inactive) a city. Rejects deletion if the city is referenced
   * by active customer profiles (soft delete).
   */
  async deleteCity(
    id: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ): Promise<boolean> {
    return this.withMutation(actor, ip, 'cities', id, async (pool) => {
      const existing = await this.getCity(id, pool);
      if (!existing) return false;

      await this.requireUnreferencedCity(pool, id);

      // Soft-delete by setting inactive
      await pool.query(`UPDATE cities SET status = 'inactive', updated_at = NOW() WHERE id = $1`, [
        id,
      ]);
      return true;
    });
  }

  private async requireUnreferencedCity(pool: PoolClient, id: string): Promise<void> {
    const references = await pool.query(
      `SELECT EXISTS (
      SELECT 1 FROM addresses a JOIN profiles p ON p.id=a.profile_id
        WHERE a.city_id=$1::uuid AND p.archived_at IS NULL
      UNION ALL
      SELECT 1 FROM legal_profiles l JOIN profiles p ON p.id=l.id
        WHERE l.official_city_id=$1::text AND p.archived_at IS NULL
    ) AS referenced`,
      [id]
    );
    if (references.rows[0]?.referenced)
      throw new HttpException({ statusCode: 409, error: 'CONFLICT:STATE' }, 409);
  }

  private async withMutation<T>(
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string,
    table: 'provinces' | 'cities',
    id: string | null,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:geography:edit');
      await requireCurrentSession(client, actor);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('admin-geography'))");
      const before =
        id === null
          ? null
          : ((
              await client.query(
                `SELECT to_jsonb(g) AS previous FROM ${table} g WHERE id=$1 FOR UPDATE`,
                [id]
              )
            ).rows[0]?.previous ?? null);
      const result = await fn(client);
      if (result !== null && result !== false) {
        await client.query(
          "UPDATE config_version SET version=version+1,updated_at=clock_timestamp() WHERE id='global'"
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
           VALUES ($1,$2,'config_change',$3::jsonb,$4,$5)`,
          [
            uuidv7(),
            actor.userId,
            JSON.stringify({ entity: table, id, before, after: result }),
            correlationIdStorage.getStore() ?? uuidv7(),
            ip,
          ]
        );
      }
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
