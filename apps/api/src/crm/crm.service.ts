import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const crmSortFields = ['createdAt', 'username', 'lastLogin', 'profileCount'] as const;
const timestamp = z.string().datetime({ offset: true });

/**
 * A single user record returned by the CRM users list endpoint.
 */
export interface CrmUserRow {
  userId: string;
  username: string;
  email: string | null;
  mobile: string | null;
  registrationDate: string;
  lastLogin: string | null;
  profiles: { id: string; profileType: string; status: string; title: string | null }[];
  profileCount: number;
  hasIndividualProfile: boolean;
  hasLegalProfile: boolean;
  hasVerifiedProfile: boolean;
}

/**
 * Paginated response envelope for the CRM users list.
 */
export interface CrmUsersResponse {
  users: CrmUserRow[];
  cursor: string | null;
  hasMore: boolean;
}

/**
 * Filters accepted by the CRM users list endpoint.
 */
export interface CrmListUsersFilters {
  /** Profile type filter: INDIVIDUAL or LEGAL. */
  type?: 'INDIVIDUAL' | 'LEGAL' | null;
  /** Verification status filter. */
  verification?: 'VERIFIED' | 'UNVERIFIED' | 'PENDING' | 'DISABLED' | null;
  /** Free-text search across username, individual name, and legal name. */
  search?: string | null;
  /** Earliest registration date (inclusive). */
  dateFrom?: string | null;
  /** Latest registration date (inclusive). */
  dateTo?: string | null;
  staffOnly?: boolean;
  /** Sort column. Default: createdAt. */
  sort?: (typeof crmSortFields)[number] | null;
  /** Sort order. Default: desc. */
  order?: 'asc' | 'desc' | null;
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  /**
   * GET /api/crm/users
   *
   * Returns a cursor-paginated list of all registered users with their
   * profile summary. Supports filtering by profile type, verification
   * status, date range, and free-text search.
   *
   * New cursors bind the sort value, direction and filters. Legacy registration
   * cursors remain readable for the default column.
   *
   * @param cursor  Opaque pagination cursor from a previous page.
   * @param limit   Max results per page (default 20, max 100).
   * @param filters Optional filters and search criteria.
   */
  async listUsers(
    cursor?: string | null,
    limit: number = 20,
    filters?: CrmListUsersFilters
  ): Promise<CrmUsersResponse> {
    const pool = getDbPool();
    const pageSize = Math.min(Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 20), 100);
    const sort = filters?.sort ?? 'createdAt';
    const sortOrder = filters?.order === 'asc' ? 'ASC' : 'DESC';
    const comparison = sortOrder === 'ASC' ? '>' : '<';
    const sortColumn = {
      createdAt: 'u.created_at',
      username: 'u.username',
      lastLogin: 'u.last_login_at',
      profileCount: 'COUNT(p.id)',
    }[sort];
    for (const value of [filters?.dateFrom, filters?.dateTo]) {
      if (value && !timestamp.or(z.string().date()).safeParse(value).success)
        throw new BadRequestException('Invalid registration date filter');
    }
    if (
      filters?.dateFrom &&
      filters?.dateTo &&
      Date.parse(filters.dateFrom) > Date.parse(filters.dateTo)
    )
      throw new BadRequestException('Registration date range is reversed');

    const queryBinding = createHash('sha256')
      .update(
        JSON.stringify([
          filters?.type ?? '',
          filters?.verification ?? '',
          filters?.search?.trim() ?? '',
          filters?.dateFrom ?? '',
          filters?.dateTo ?? '',
          filters?.staffOnly === true,
        ])
      )
      .digest('hex');

    // Values remain parameters. SQL column names come only from the fixed map.
    let cursorId: string | null = null;
    let cursorValue: string | number | null = null;
    if (cursor) {
      try {
        if (cursor.length > 4096) throw new Error('Cursor too long');
        const raw = Buffer.from(cursor, 'base64url').toString('utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          typeof parsed.id !== 'string' ||
          !parsed.id.length ||
          parsed.id.length > 512
        )
          throw new Error('Invalid identity');
        const legacy = !('sort' in parsed);
        if (
          legacy
            ? sort !== 'createdAt'
            : parsed.sort !== sort || parsed.order !== sortOrder || parsed.query !== queryBinding
        )
          throw new Error('Cursor does not match this query');
        const value = legacy ? parsed.createdAt : parsed.value;
        const valid =
          sort === 'profileCount'
            ? typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= 0 &&
              value <= 2147483647
            : sort === 'username'
              ? typeof value === 'string' && value.length > 0 && value.length <= 512
              : (sort === 'lastLogin' && value === null) || timestamp.safeParse(value).success;
        if (!valid) throw new Error('Invalid sort value');
        cursorId = parsed.id;
        cursorValue = value as string | number | null;
      } catch {
        throw new BadRequestException('Invalid CRM cursor');
      }
    }

    // Build WHERE clauses dynamically
    const whereClauses: string[] = [];
    const params: unknown[] = [pageSize + 1]; // $1 = limit (+1 for hasMore)
    let paramIndex = 2;

    // Cursor-based pagination
    let aggregateCursor = '';
    if (cursorId) {
      const cast =
        sort === 'profileCount' ? 'integer' : sort === 'username' ? 'text' : 'timestamptz';
      const value = `$${paramIndex}::${cast}`,
        id = `$${paramIndex + 1}::text`;
      const clause = `(${sortColumn}, u.user_id) ${comparison} (${value}, ${id})`;
      if (sort === 'profileCount') aggregateCursor = clause;
      else if (sort === 'lastLogin')
        whereClauses.push(
          cursorValue === null
            ? `(${value} IS NULL AND u.last_login_at IS NULL AND u.user_id ${comparison} ${id})`
            : `(${clause} OR u.last_login_at IS NULL)`
        );
      else whereClauses.push(clause);
      params.push(cursorValue, cursorId);
      paramIndex += 2;
    }

    // Profile type filter — applied as WHERE on profiles join
    if (filters?.type) {
      whereClauses.push(
        `EXISTS (SELECT 1 FROM profiles fp WHERE fp.user_id=u.user_id AND fp.archived=false AND fp.profile_type = $${paramIndex})`
      );
      params.push(filters.type);
      paramIndex++;
    }

    // Verification status filter — applied as HAVING after GROUP BY
    let havingClause = '';
    if (filters?.verification) {
      switch (filters.verification) {
        case 'VERIFIED':
          havingClause = ` HAVING bool_or(p.status = 'VERIFIED') = true`;
          break;
        case 'UNVERIFIED':
          // Match the displayed status: neither verified nor pending, including no profiles.
          havingClause = ` HAVING NOT COALESCE(bool_or(p.status IN ('VERIFIED','PENDING_VERIFICATION')), false)`;
          break;
        case 'PENDING':
          havingClause = ` HAVING bool_or(p.status = 'PENDING_VERIFICATION') = true AND NOT bool_or(p.status = 'VERIFIED') = true`;
          break;
        case 'DISABLED':
          havingClause = ` HAVING bool_or(p.status = 'SUSPENDED') = true`;
          break;
      }
    }
    if (aggregateCursor) havingClause += `${havingClause ? ' AND' : ' HAVING'} ${aggregateCursor}`;

    if (filters?.staffOnly) whereClauses.push('u.is_staff = true');

    // Date range filter
    if (filters?.dateFrom) {
      whereClauses.push(`u.created_at >= $${paramIndex}::timestamptz`);
      params.push(filters.dateFrom);
      paramIndex++;
    }
    if (filters?.dateTo) {
      whereClauses.push(`u.created_at <= $${paramIndex}::timestamptz`);
      params.push(filters.dateTo);
      paramIndex++;
    }

    // Search — full-text search across username, individual name, legal name

    if (filters?.search) {
      // Join legal_profiles for legal_name search

      // Use PostgreSQL full-text search for structured fields
      // Combined with ILIKE for fallback/partial matching
      const searchTerm = filters.search.trim();
      whereClauses.push(`(
        to_tsvector('simple', u.username) @@ plainto_tsquery('simple', $${paramIndex})
        OR u.username ILIKE $${paramIndex + 1}
        OR EXISTS (SELECT 1 FROM profiles sp LEFT JOIN legal_profiles lp ON lp.id=sp.id
          WHERE sp.user_id=u.user_id AND sp.archived=false AND (to_tsvector('simple', COALESCE(sp.first_name, '')) @@ plainto_tsquery('simple', $${paramIndex + 2})
        OR sp.first_name ILIKE $${paramIndex + 3}
        OR to_tsvector('simple', COALESCE(sp.last_name, '')) @@ plainto_tsquery('simple', $${paramIndex + 4})
        OR sp.last_name ILIKE $${paramIndex + 5}
        OR COALESCE(lp.legal_name, '') ILIKE $${paramIndex + 6}))
      )`);
      const ilikePattern = `%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`;
      for (let i = 0; i < 7; i++) {
        params.push(i < 6 && i % 2 === 0 ? searchTerm : ilikePattern);
      }
      paramIndex += 7;
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.mobile,
        to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS registration_date,
        to_char(u.last_login_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_login,
        COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'profileType',p.profile_type,'status',p.status,'title',p.title) ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) AS profiles,
        COUNT(p.id)::int AS profile_count,
        bool_or(p.profile_type = 'INDIVIDUAL') AS has_individual_profile,
        bool_or(p.profile_type = 'LEGAL') AS has_legal_profile,
        bool_or(p.status = 'VERIFIED') AS has_verified_profile
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.user_id AND p.archived = false
      ${whereClause}
      GROUP BY u.user_id, u.username, u.email, u.mobile, u.created_at, u.last_login_at
      ${havingClause}
      ORDER BY ${sortColumn} ${sortOrder}${sort === 'lastLogin' ? ' NULLS LAST' : ''}, u.user_id ${sortOrder}
      LIMIT $1
    `;

    const result = await pool.query(query, params);

    const hasMore = result.rows.length > pageSize;
    const rows = result.rows.slice(0, pageSize);

    const users: CrmUserRow[] = rows.map((row: Record<string, unknown>) => ({
      userId: row.user_id as string,
      username: row.username as string,
      email: (row.email as string) ?? null,
      mobile: (row.mobile as string) ?? null,
      registrationDate: (row.registration_date as string) ?? '',
      lastLogin: (row.last_login as string) ?? null,
      profiles: (row.profiles as CrmUserRow['profiles']) ?? [],
      profileCount: (row.profile_count as number) ?? 0,
      hasIndividualProfile: (row.has_individual_profile as boolean) ?? false,
      hasLegalProfile: (row.has_legal_profile as boolean) ?? false,
      hasVerifiedProfile: (row.has_verified_profile as boolean) ?? false,
    }));

    const last = users.at(-1);
    // Preserve timestamp strings, including PostgreSQL microseconds.
    const nextCursor: string | null =
      hasMore && users.length > 0
        ? Buffer.from(
            JSON.stringify({
              id: users[users.length - 1]!.userId,
              createdAt: users[users.length - 1]!.registrationDate,
              sort,
              order: sortOrder,
              query: queryBinding,
              value: sort === 'createdAt' ? last!.registrationDate : last![sort],
            }),
            'utf-8'
          ).toString('base64url')
        : null;

    return {
      users,
      cursor: nextCursor,
      hasMore,
    };
  }
}
