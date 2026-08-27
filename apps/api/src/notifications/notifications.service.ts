import { Injectable, Logger } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'

export interface CreateNotificationParams {
  userId: string
  profileId?: string
  type: 'verification_status' | 'profile_verified' | 'profile_unverified' | 'profile_pending' | 'general'
  title: string
  body?: string
  link?: string
}

export interface NotificationResult {
  id: string
  userId: string
  profileId: string | null
  type: string
  title: string
  body: string | null
  link: string | null
  read: boolean
  readAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** A single delivery-log row surfaced to the admin panel (E-05, T-05.01.05). */
export interface DeliveryLogRow {
  id: string
  notificationId: string
  channel: 'in_app' | 'email' | 'sms'
  status: 'delivered' | 'failed'
  attemptNumber: number
  providerRef: string | null
  latencyMs: number | null
  errorCategory: string | null
  errorDetail: string | null
  createdAt: Date
}

/**
 * In-app notification service (minimal stub for E-02 scope).
 *
 * Responsible for creating and retrieving in-app notifications.
 * The full delivery infrastructure (email/SMS transport, outbox,
 * worker) belongs to E-05.
 *
 * T-07.01.03 — Verification notification to user.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  /**
   * Create a new in-app notification for a user.
   *
   * Inserts a notification record into the `notifications` table.
   * Future E-05 infrastructure will handle out-of-app delivery
   * (email/SMS) based on user preferences.
   *
   * @param params - Notification creation parameters.
   * @returns The created notification record.
   */
  async create(params: CreateNotificationParams): Promise<NotificationResult> {
    const pool = getDbPool()
    const id = uuidv7()
    const now = new Date()

    await pool.query(
      `INSERT INTO notifications (id, user_id, profile_id, type, title, body, link, read, created_at, updated_at)
       VALUES ($1, $2, $3, $4::notification_type, $5, $6, $7, false, $8, $8)`,
      [
        id,
        params.userId,
        params.profileId ?? null,
        params.type,
        params.title,
        params.body ?? null,
        params.link ?? null,
        now,
      ],
    )

    this.logger.log(`Notification created: id=${id} type=${params.type} user=${params.userId}`)

    return {
      id,
      userId: params.userId,
      profileId: params.profileId ?? null,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      link: params.link ?? null,
      read: false,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Get notifications for a user, most recent first.
   *
   * @param userId - The user's UUID.
   * @param limit - Max notifications to return (default 50).
   * @param offset - Pagination offset (default 0).
   * @returns List of notifications.
   */
  async findByUser(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ notifications: NotificationResult[]; total: number; unreadCount: number }> {
    const pool = getDbPool()

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1`,
      [userId],
    )

    const unreadResult = await pool.query<{ unread: string }>(
      `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND read = false`,
      [userId],
    )

    const rowsResult = await pool.query<NotificationResult>(
      `SELECT id, user_id, profile_id, type, title, body, link, read, read_at, created_at, updated_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    )

    return {
      notifications: rowsResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      unreadCount: parseInt(unreadResult.rows[0]?.unread ?? '0', 10),
    }
  }

  /**
   * Get count of unread notifications for a user.
   *
   * @param userId - The user's UUID.
   */
  async countUnread(userId: string): Promise<number> {
    const pool = getDbPool()
    const result = await pool.query<{ unread: string }>(
      `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND read = false`,
      [userId],
    )
    return parseInt(result.rows[0]?.unread ?? '0', 10)
  }

  /**
   * Mark a single notification as read.
   *
   * @param notificationId - The notification UUID.
   * @param userId - The user's UUID (for authorization check).
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const pool = getDbPool()
    await pool.query(
      `UPDATE notifications SET read = true, read_at = $1, updated_at = $1
       WHERE id = $2 AND user_id = $3`,
      [new Date(), notificationId, userId],
    )
  }

  /**
   * Mark all notifications as read for a user.
   *
   * @param userId - The user's UUID.
   */
  async markAllAsRead(userId: string): Promise<void> {
    const pool = getDbPool()
    const now = new Date()
    await pool.query(
      `UPDATE notifications SET read = true, read_at = $1, updated_at = $1
       WHERE user_id = $2 AND read = false`,
      [now, userId],
    )
  }

  /**
   * List delivery-log rows for the admin panel (E-05, T-05.01.05).
   *
   * Filters by optional notification id / channel / status/error, ordered
   * newest-first, with limit + offset pagination. Rows are read directly from
   * the append-only `notification_delivery_log` table written by the worker.
   * DB snake_case columns are aliased to camelCase so runtime rows match the
   * returned `DeliveryLogRow` shape.
   *
   * @param options - Optional filters and pagination.
   */
  async findDeliveryLogs(options: {
    notificationId?: string
    channel?: 'in_app' | 'email' | 'sms'
    status?: 'delivered' | 'failed'
    limit?: number
    offset?: number
  }): Promise<DeliveryLogRow[]> {
    const pool = getDbPool()
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const offset = Math.max(options.offset ?? 0, 0)

    const conditions: string[] = []
    const params: unknown[] = []
    // Counter-based placeholder builder. Each filter appends its value and a
    // fresh `$N` placeholder, so conditions never share or misnumber indexes.
    const push = (column: string, value: string) => {
      params.push(value)
      conditions.push(`${column} = $${params.length}`)
    }

    if (options.notificationId) push('notification_id', options.notificationId)
    if (options.channel) push('channel', options.channel)
    if (options.status) push('status', options.status)

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    // Alias snake_case DB columns to camelCase so runtime rows match the
    // declared DeliveryLogRow shape (the `pg` driver does not auto-convert).
    const rowsResult = await pool.query<DeliveryLogRow>(
      `SELECT id,
              notification_id AS "notificationId",
              channel,
              status,
              attempt_number AS "attemptNumber",
              provider_ref AS "providerRef",
              latency_ms AS "latencyMs",
              error_category AS "errorCategory",
              error_detail AS "errorDetail",
              created_at AS "createdAt"
       FROM notification_delivery_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    )
    return rowsResult.rows
  }
}
