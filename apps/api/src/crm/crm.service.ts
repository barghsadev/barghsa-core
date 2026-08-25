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
   * The cursor is a JSON object {id: string, createdAt: string} base64url-encoded.
   * This composite cursor ensures correct multi-page results when ordering
   * by created_at DESC — the sort column and the cursor token columns match.
   *
   * @param cursor  Opaque pagination cursor from a previous page.
   * @param limit   Max results per page (default 20, max 100).
   */
  async listUsers(
    cursor?: string | null,
    limit: number = 20,
  ): Promise<CrmUsersResponse> {
    const pool = getDbPool()
    const pageSize = Math.min(Math.max(1, limit), 100)

    // Decode and validate the composite cursor { id, createdAt }
    let cursorId: string | null = null
    let cursorCreatedAt: string | null = null
    if (cursor) {
      try {
        const raw = Buffer.from(cursor, 'base64url').toString('utf-8')
        const parsed = JSON.parse(raw) as { id?: string; createdAt?: string }
        if (
          typeof parsed.id === 'string' &&
          typeof parsed.createdAt === 'string' &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(parsed.id) &&
          !isNaN(Date.parse(parsed.createdAt))
        ) {
          cursorId = parsed.id
          cursorCreatedAt = parsed.createdAt
        }
      } catch {
        // Invalid cursor — treat as no cursor
      }
    }

    // Query: list users with aggregated profile data.
    // The join on profiles is a LEFT JOIN so users without profiles
    // still appear (edge case — every user should have at least one).
    // For DESC order, the cursor filter is: (created_at, user_id) < ($createdAt, $id)
    const cursorClause =
      cursorCreatedAt && cursorId
        ? 'WHERE (u.created_at, u.user_id) < ($2::timestamptz, $3::uuid)'
        : ''
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
      ${cursorClause}
      GROUP BY u.user_id, u.username, u.email, u.mobile, u.created_at, u.last_login_at
      ORDER BY u.created_at DESC, u.user_id DESC
      LIMIT $1
    `

    const params: unknown[] = [pageSize + 1] // +1 to detect hasMore
    if (cursorCreatedAt && cursorId) {
      params.push(cursorCreatedAt, cursorId)
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

    // Encode composite cursor: { id, createdAt } base64url
    const nextCursor: string | null =
      hasMore && users.length > 0
        ? Buffer.from(
            JSON.stringify({
              id: users[users.length - 1]!.userId,
              createdAt: users[users.length - 1]!.registrationDate,
            }),
            'utf-8',
          ).toString('base64url')
        : null

    return {
      users,
      cursor: nextCursor,
      hasMore,
    }
  }
}