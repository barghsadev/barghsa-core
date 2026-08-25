import { Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'

/**
 * A single user record returned by the CRM users list endpoint.
 */
export interface CrmUserRow {
  userId: string
  username: string
  email: string | null
  mobile: string | null
  registrationDate: string
  lastLogin: string | null
  profileCount: number
  hasIndividualProfile: boolean
  hasLegalProfile: boolean
  hasVerifiedProfile: boolean
}

/**
 * Paginated response envelope for the CRM users list.
 */
export interface CrmUsersResponse {
  users: CrmUserRow[]
  cursor: string | null
  hasMore: boolean
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name)

  /**
   * GET /api/crm/users
   *
   * Returns a cursor-paginated list of all registered users with their
   * profile summary. Staff and admin only (permission enforced at the
   * controller guard level).
   *
   * Columns returned per user:
   *   - userId, username, email, mobile
   *   - registrationDate, lastLogin
   *   - profileCount, hasIndividualProfile, hasLegalProfile, hasVerifiedProfile
   *
   * @param cursor  Opaque cursor from a previous page (base64-encoded userId).
   * @param limit   Max results per page (default 20, max 100).
   */
  async listUsers(
    cursor?: string | null,
    limit: number = 20,
  ): Promise<CrmUsersResponse> {
    const pool = getDbPool()
    const pageSize = Math.min(Math.max(1, limit), 100)

    let decodedCursor: string | null = null
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf-8')
        // Validate: decoded cursor must be a UUID v7 (36 chars with hyphens)
        if (/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(decoded)) {
          decodedCursor = decoded
        }
      } catch {
        // Invalid cursor — treat as no cursor
      }
    }

    // Query: list users with aggregated profile data.
    // The join on profiles is a LEFT JOIN so users without profiles
    // still appear (edge case — every user should have at least one).
    const query = `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.mobile,
        u.created_at AT TIME ZONE 'UTC' AS registration_date,
        u.last_login_at AT TIME ZONE 'UTC' AS last_login,
        COUNT(p.id)::int AS profile_count,
        bool_or(p.profile_type = 'INDIVIDUAL') AS has_individual_profile,
        bool_or(p.profile_type = 'LEGAL') AS has_legal_profile,
        bool_or(p.status = 'VERIFIED') AS has_verified_profile
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.user_id
      ${decodedCursor ? 'WHERE u.user_id > $2' : ''}
      GROUP BY u.user_id, u.username, u.email, u.mobile, u.created_at, u.last_login_at
      ORDER BY u.created_at DESC
      LIMIT $1
    `

    const params: unknown[] = [pageSize + 1] // +1 to detect hasMore
    if (decodedCursor) {
      params.push(decodedCursor)
    }

    const result = await pool.query(query, params)

    const hasMore = result.rows.length > pageSize
    const rows = result.rows.slice(0, pageSize)

    const users: CrmUserRow[] = rows.map((row: Record<string, unknown>) => ({
      userId: row.user_id as string,
      username: row.username as string,
      email: (row.email as string) ?? null,
      mobile: (row.mobile as string) ?? null,
      registrationDate: (row.registration_date as string) ?? '',
      lastLogin: (row.last_login as string) ?? null,
      profileCount: (row.profile_count as number) ?? 0,
      hasIndividualProfile: (row.has_individual_profile as boolean) ?? false,
      hasLegalProfile: (row.has_legal_profile as boolean) ?? false,
      hasVerifiedProfile: (row.has_verified_profile as boolean) ?? false,
    }))

    const nextCursor: string | null =
      hasMore && users.length > 0
        ? Buffer.from(users[users.length - 1]!.userId, 'utf-8').toString('base64url')
        : null

    return {
      users,
      cursor: nextCursor,
      hasMore,
    }
  }
}