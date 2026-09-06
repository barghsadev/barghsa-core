import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';

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
  sort?: 'createdAt' | null;
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
   * The cursor is a JSON object {id: string, createdAt: string} base64url-encoded.
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
    for (const value of [filters?.dateFrom, filters?.dateTo]) {
      if (value && !Number.isFinite(Date.parse(value)))
        throw new BadRequestException('Invalid registration date filter');
    }
    if (
      filters?.dateFrom &&
      filters?.dateTo &&
      Date.parse(filters.dateFrom) > Date.parse(filters.dateTo)
    )
      throw new BadRequestException('Registration date range is reversed');

    // Decode and validate the composite cursor { id, createdAt }
    let cursorId: string | null = null;
    let cursorCreatedAt: string | null = null;
    if (cursor) {
      try {
        const raw = Buffer.from(cursor, 'base64url').toString('utf-8');
        const parsed = JSON.parse(raw) as { id?: string; createdAt?: string };
        if (
          typeof parsed.id === 'string' &&
          typeof parsed.createdAt === 'string' &&
          parsed.id.length > 0 &&
          parsed.id.length <= 512 &&
          !isNaN(Date.parse(parsed.createdAt))
        ) {
          cursorId = parsed.id;
          cursorCreatedAt = parsed.createdAt;
        }
      } catch {
        throw new BadRequestException('Invalid CRM cursor');
      }
    }

    if (cursor && (!cursorId || !cursorCreatedAt))
      throw new BadRequestException('Invalid CRM cursor');

    // Build WHERE clauses dynamically
    const whereClauses: string[] = [];
    const params: unknown[] = [pageSize + 1]; // $1 = limit (+1 for hasMore)
    let paramIndex = 2;

    // Cursor-based pagination
    if (cursorCreatedAt && cursorId) {
      whereClauses.push(
        `(u.created_at, u.user_id) ${filters?.order === 'asc' ? '>' : '<'} ($${paramIndex}::timestamptz, $${paramIndex + 1}::text)`
      );
      params.push(cursorCreatedAt, cursorId);
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
          // Status is not null and never VERIFIED
          havingClause = ` HAVING NOT COALESCE(bool_or(p.status = 'VERIFIED'), false)`;
          break;
        case 'PENDING':
          havingClause = ` HAVING bool_or(p.status = 'PENDING_VERIFICATION') = true AND NOT bool_or(p.status = 'VERIFIED') = true`;
          break;
        case 'DISABLED':
          havingClause = ` HAVING bool_or(p.status = 'SUSPENDED') = true`;
          break;
      }
    }

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
      const ilikePattern = `%${searchTerm}%`;
      for (let i = 0; i < 7; i++) {
        params.push(i < 6 && i % 2 === 0 ? searchTerm : ilikePattern);
      }
      paramIndex += 7;
    }

    // Sort and order
    const sortColumn =
      filters?.sort === 'createdAt' || !filters?.sort ? 'u.created_at' : 'u.created_at';
    const sortOrder = filters?.order === 'asc' ? 'ASC' : 'DESC';
    const tiebreakerOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.mobile,
        to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS registration_date,
        to_char(u.last_login_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS last_login,
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
      ORDER BY ${sortColumn} ${sortOrder}, u.user_id ${tiebreakerOrder}
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

    // Encode composite cursor: { id, createdAt } base64url
    const nextCursor: string | null =
      hasMore && users.length > 0
        ? Buffer.from(
            JSON.stringify({
              id: users[users.length - 1]!.userId,
              createdAt: users[users.length - 1]!.registrationDate,
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
