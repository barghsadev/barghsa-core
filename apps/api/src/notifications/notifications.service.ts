import { notificationLink } from '@barghsa/shared/notifications';
import { NotificationCenterService, notificationScope } from './notification-center.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';

export interface CreateNotificationParams {
  userId: string;
  profileId?: string;
  type:
    | 'verification_status'
    | 'profile_verified'
    | 'profile_unverified'
    | 'profile_pending'
    | 'general';
  title: string;
  localizedContent?: Record<'fa' | 'en', { title: string; body: string }>;
  body?: string;
  link?: string;
}

export interface NotificationResult {
  id: string;
  userId: string;
  profileId: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A single delivery-log row surfaced to the admin panel (E-05, T-05.01.05). */
export interface DeliveryLogRow {
  id: string;
  notificationId: string;
  channel: 'in_app' | 'email' | 'sms';
  status: 'delivered' | 'failed';
  attemptNumber: number;
  providerRef: string | null;
  latencyMs: number | null;
  errorCategory: string | null;
  errorDetail: string | null;
  createdAt: Date;
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
  private readonly logger = new Logger(NotificationsService.name);

  /**
   * Create a new in-app notification for a user.
   *
   * Writes to the canonical notification center, including private account notices.
   * Future E-05 infrastructure will handle out-of-app delivery
   * (email/SMS) based on user preferences.
   *
   * @param params - Notification creation parameters.
   * @returns The created notification record.
   */
  async create(
    params: CreateNotificationParams,
    transaction?: { query: (sql: string, params?: unknown[]) => Promise<unknown> }
  ): Promise<NotificationResult> {
    const pool = transaction ?? getDbPool();
    const id = uuidv7();
    const now = new Date();

    await pool.query(
      `INSERT INTO in_app_notifications (id,recipient_user_id,profile_id,type,title_i18n_key,body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
       VALUES ($1::uuid,$2,$3,$4,'notifications.legacy.title','notifications.legacy.body',
       COALESCE($9::jsonb,jsonb_build_object('original',jsonb_build_object('title',$5::text,'body',COALESCE($6::text,'')))),$7,false,$8,'direct:'||$1::text)`,
      [
        id,
        params.userId,
        params.profileId ?? null,
        params.type,
        params.title,
        params.body ?? null,
        notificationLink(params.link),
        now,
        params.localizedContent ? JSON.stringify(params.localizedContent) : null,
      ]
    );

    this.logger.log(`Notification created: id=${id} type=${params.type} user=${params.userId}`);

    return {
      id,
      userId: params.userId,
      profileId: params.profileId ?? null,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      link: notificationLink(params.link),
      read: false,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    };
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
    offset: number = 0
  ): Promise<{ notifications: NotificationResult[]; total: number; unreadCount: number }> {
    const pool = getDbPool();

    const center = new NotificationCenterService(pool);
    const profileId = await center.resolveActiveProfileId(userId);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 50;
    const safeOffset = Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0;
    const counts = (
      await pool.query(
        `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE NOT is_read)::int AS unread FROM in_app_notifications WHERE ${notificationScope}`,
        [profileId, userId]
      )
    ).rows[0];
    const rows = await pool.query(
      `SELECT id,profile_id AS "profileId",type,
      COALESCE(localized_content->'original'->>'title',localized_content->'fa'->>'title',title_i18n_key) AS title,
      COALESCE(localized_content->'original'->>'body',localized_content->'fa'->>'body',body_i18n_key) AS body,
      link_route AS link,is_read AS read,read_at AS "readAt",created_at AS "createdAt",created_at AS "updatedAt"
      FROM in_app_notifications WHERE ${notificationScope} ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
      [profileId, userId, safeLimit, safeOffset]
    );
    return {
      notifications: rows.rows.map((row) => ({ ...row, userId })),
      total: counts?.total ?? 0,
      unreadCount: counts?.unread ?? 0,
    };
  }

  async countUnread(userId: string): Promise<number> {
    const center = new NotificationCenterService(getDbPool());
    return center.countUnread(await center.resolveActiveProfileId(userId), userId);
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const center = new NotificationCenterService(getDbPool());
    await center.markRead(await center.resolveActiveProfileId(userId), notificationId, userId);
  }

  async markAllAsRead(userId: string): Promise<void> {
    const center = new NotificationCenterService(getDbPool());
    await center.markAllRead(await center.resolveActiveProfileId(userId), userId);
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
    notificationId?: string;
    channel?: 'in_app' | 'email' | 'sms';
    status?: 'delivered' | 'failed';
    limit?: number;
    offset?: number;
  }): Promise<DeliveryLogRow[]> {
    const pool = getDbPool();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];
    // Counter-based placeholder builder. Each filter appends its value and a
    // fresh `$N` placeholder, so conditions never share or misnumber indexes.
    const push = (column: string, value: string) => {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    };

    if (options.notificationId) push('notification_id', options.notificationId);
    if (options.channel) push('channel', options.channel);
    if (options.status) push('status', options.status);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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
      [...params, limit, offset]
    );
    return rowsResult.rows;
  }
}
