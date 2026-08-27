import { Injectable, Logger, HttpException, Optional, Inject } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

/**
 * Notification-center API service (E-05, T-05.02.02).
 *
 * Reads and mutates read-state on `in_app_notifications` — the profile-scoped
 * table written by the in-app transport when the outbox worker dispatches an
 * `in_app` channel (T-05.02.01). This service is the durable read/write layer
 * behind the notification center UI.
 *
 * Scoping: rows are owned by a `profile_id`. The controller resolves the
 * caller's active (default) profile, and every query here is profile-scoped to
 * guarantee a user can only ever see or mutate their own notifications.
 *
 * Read state (`is_read` / `read_at`) is the only mutable column on the row, so
 * mutators flip exactly that — the table is otherwise append-only.
 */

export type NotificationFilter = 'all' | 'unread'
export type CursorDirection = 'older' | 'newer'

/** A single notification as surfaced by the center. */
export interface NotificationCenterItem {
  id: string
  type: string
  titleI18nKey: string
  bodyI18nKey: string
  /** JSON interpolation variables for rendering title/body placeholders. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>
  linkRoute: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkParams: Record<string, any> | null
  isRead: boolean
  readAt: Date | null
  createdAt: Date
}

/** A cursor-keyed page of notifications plus the unread count. */
export interface NotificationCenterPage {
  data: NotificationCenterItem[]
  /** Opaque cursor for the next page; null when there are no more. */
  next_cursor: string | null
  unread_count: number
}

export interface ListNotificationsOptions {
  cursor?: string
  limit?: number
  filter?: NotificationFilter
  direction?: CursorDirection
}

/** Minimal query-pool surface used by the service (testable + typed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface NotificationCenterQueryPool {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: any[]; rowCount?: number | null }>
}

/**
 * Injection token for an optional query-pool override. Not registered in the
 * module, so Nest resolves it to `undefined` (thanks to `@Optional()`) and the
 * service falls back to the shared `getDbPool()` pool. Tests construct the
 * service directly with a mock pool as the first constructor argument.
 */
export const NOTIFICATION_CENTER_POOL = Symbol('NOTIFICATION_CENTER_POOL')

// Column list used by the list query — snake_case DB columns aliased to the
// camelCase NotificationCenterItem shape (the `pg` driver does not auto-convert).
const SELECT_COLUMNS = `id,
  type,
  title_i18n_key AS "titleI18nKey",
  body_i18n_key AS "bodyI18nKey",
  params,
  link_route AS "linkRoute",
  link_params AS "linkParams",
  is_read AS "isRead",
  read_at AS "readAt",
  created_at AS "createdAt"`

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * Encode a (created_at, id) position into an opaque, URL-safe cursor.
 *
 * The id separator `|` is chosen because neither a UUID nor an ISO-8601
 * timestamp can contain it, so decoding with `split('|')` is unambiguous.
 */
export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : createdAt
  return Buffer.from(`${iso}|${id}`, 'utf8').toString('base64url')
}

/**
 * Decode an opaque cursor into its `{ createdAt, id }` position.
 * Throws on any malformed input so the controller can 400 it.
 */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  let raw: string
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    throw new HttpException(
      {
        statusCode: 400,
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'Invalid notification cursor',
      },
      400,
    )
  }
  const idx = raw.indexOf('|')
  if (idx <= 0) {
    throw new HttpException(
      {
        statusCode: 400,
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'Invalid notification cursor',
      },
      400,
    )
  }
  const iso = raw.slice(0, idx)
  const id = raw.slice(idx + 1)
  const createdAt = new Date(iso)
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw new HttpException(
      {
        statusCode: 400,
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'Invalid notification cursor',
      },
      400,
    )
  }
  return { createdAt, id }
}

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name)

  /**
   * @param injectedPool Optional query-pool override (tests). Not registered
   *   in the module, so in production Nest injects `undefined` and the service
   *   uses the shared `getDbPool()` pool.
   */
  constructor(
    @Optional()
    @Inject(NOTIFICATION_CENTER_POOL)
    private readonly injectedPool?: NotificationCenterQueryPool,
  ) {}

  private get db(): NotificationCenterQueryPool {
    return this.injectedPool ?? getDbPool()
  }

  /**
   * Resolve the caller's active profile. The active profile is their default
   * profile; falling back to their earliest profile when no default is set.
   * Returns null when the user has no profiles at all (treated as empty center).
   */
  async resolveActiveProfileId(userId: string): Promise<string | null> {
    const result = await this.db.query(
      `SELECT id FROM profiles
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
      [userId],
    )
    return (result.rows[0] as { id: string } | undefined)?.id ?? null
  }

  /**
   * Keyset-paginated, newest-first list of a profile's notifications.
   *
   * `filter=unread` narrows to unread rows. No cursor returns the newest page.
   * A cursor continues from that position in the given `direction`:
   *   - `older` (default): rows strictly older than the cursor position.
   *   - `newer`:            rows strictly newer than the cursor position (used
   *     to refresh the list with anything that arrived since a loaded page).
   *
   * Both directions fetch newest-first with the same `ORDER BY`; the only
   * difference is the row-comparison operator (`<` for older, `>` for newer).
   * This keeps pagination symmetric and free of duplicates:
   *   - older: `next_cursor` anchors on the oldest kept row so the next page
   *     continues with rows strictly older than it.
   *   - newer: `next_cursor` anchors on the newest kept row so the next page
   *     continues with rows strictly newer than it.
   *
   * Fetches `limit + 1` rows to detect a following page and emits an opaque
   * `next_cursor` for it. `unread_count` is the profile's total unread always.
   */
  async list(
    profileId: string,
    options: ListNotificationsOptions = {},
  ): Promise<NotificationCenterPage> {
    const db = this.db
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    )
    const filter: NotificationFilter = options.filter ?? 'all'
    const direction: CursorDirection = options.direction ?? 'older'

    const conditions: string[] = ['profile_id = $1']
    const params: unknown[] = [profileId]
    let paramIndex = 1

    if (filter === 'unread') {
      conditions.push('is_read = false')
    }

    if (options.cursor) {
      const cursorPosition = decodeCursor(options.cursor)
      const op = direction === 'older' ? '<' : '>'
      conditions.push(
        `(created_at, id) ${op} ($${++paramIndex}, $${++paramIndex})`,
      )
      params.push(cursorPosition.createdAt, cursorPosition.id)
    }

    const limitIdx = ++paramIndex
    params.push(limit + 1)

    const rows = await db.query(
      `SELECT ${SELECT_COLUMNS}
         FROM in_app_notifications
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitIdx}`,
      params,
    )

    const data = rows.rows as NotificationCenterItem[]
    const hasMore = data.length > limit
    const page = hasMore ? data.slice(0, limit) : data

    // Continue in the direction of travel, anchored on the boundary row that
    // a following page is strictly beyond (no overlap / no skipped rows):
    //   - older: the last (oldest) kept row.
    //   - newer: the first (newest) kept row.
    const boundaryRow = direction === 'older' ? page[page.length - 1] : page[0]
    const next_cursor =
      hasMore && boundaryRow
        ? encodeCursor(boundaryRow.createdAt, boundaryRow.id)
        : null

    const unread_count = await this.countUnread(profileId)

    return { data: page, next_cursor, unread_count }
  }

  /** Total unread count for a profile (used for the badge & response). */
  async countUnread(profileId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(*) AS n FROM in_app_notifications
        WHERE profile_id = $1 AND is_read = false`,
      [profileId],
    )
    return parseInt(
      (result.rows[0] as { n: string } | undefined)?.n ?? '0',
      10,
    )
  }

  /**
   * Mark one notification read. Profile-scoped so a user can only affect their
   * own rows; throws 404 when the row does not exist for the given profile.
   */
  async markRead(profileId: string, notificationId: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE in_app_notifications
          SET is_read = true, read_at = NOW()
        WHERE id = $1 AND profile_id = $2`,
      [notificationId, profileId],
    )
    if (result.rowCount === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Notification not found',
        },
        404,
      )
    }
  }

  /** Mark every unread notification for the profile as read. */
  async markAllRead(profileId: string): Promise<number> {
    const result = await this.db.query(
      `UPDATE in_app_notifications
          SET is_read = true, read_at = NOW()
        WHERE profile_id = $1 AND is_read = false`,
      [profileId],
    )
    return result.rowCount ?? 0
  }
}
