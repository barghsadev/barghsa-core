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
}
