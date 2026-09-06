import { notificationLink } from '@barghsa/shared/notifications'
import { NotificationCenterService, notificationScope } from './notification-center.service.js'
import { Injectable, Logger, HttpException } from '@nestjs/common'
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
   * Writes to the canonical notification center, including private account notices.
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
      `INSERT INTO in_app_notifications (id,recipient_user_id,profile_id,type,title_i18n_key,body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
       VALUES ($1::uuid,$2,$3,$4,'notifications.legacy.title','notifications.legacy.body',
       jsonb_build_object('original',jsonb_build_object('title',$5::text,'body',COALESCE($6::text,''))),$7,false,$8,'direct:'||$1::text)`,
      [
        id,
        params.userId,
        params.profileId ?? null,
        params.type,
        params.title,
        params.body ?? null,
        notificationLink(params.link),
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
      link: notificationLink(params.link),
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

    const center = new NotificationCenterService(pool)
    const profileId = await center.resolveActiveProfileId(userId)
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 50
    const safeOffset = Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0
    const counts = (await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE NOT is_read)::int AS unread FROM in_app_notifications WHERE ${notificationScope}`, [profileId, userId])).rows[0]
    const rows = await pool.query(`SELECT id,profile_id AS "profileId",type,
      COALESCE(localized_content->'original'->>'title',localized_content->'fa'->>'title',title_i18n_key) AS title,
      COALESCE(localized_content->'original'->>'body',localized_content->'fa'->>'body',body_i18n_key) AS body,
      link_route AS link,is_read AS read,read_at AS "readAt",created_at AS "createdAt",created_at AS "updatedAt"
      FROM in_app_notifications WHERE ${notificationScope} ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`, [profileId,userId,safeLimit,safeOffset])
    return { notifications: rows.rows.map(row => ({ ...row, userId })), total: counts?.total ?? 0, unreadCount: counts?.unread ?? 0 }
  }

  async countUnread(userId: string): Promise<number> {
    const center = new NotificationCenterService(getDbPool())
    return center.countUnread(await center.resolveActiveProfileId(userId), userId)
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const center = new NotificationCenterService(getDbPool())
    await center.markRead(await center.resolveActiveProfileId(userId), notificationId, userId)
  }

  async markAllAsRead(userId: string): Promise<void> {
    const center = new NotificationCenterService(getDbPool())
    await center.markAllRead(await center.resolveActiveProfileId(userId), userId)
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

  /** A single dead-letter row surfaced to the admin panel (E-05, T-05.01.06). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listDeadLetters(options: {
    status?: 'open' | 'retried' | 'resolved' | 'dismissed'
    severity?: 'error' | 'critical'
    channel?: 'in_app' | 'email' | 'sms'
    limit?: number
    offset?: number
  }): Promise<any[]> {
    const pool = getDbPool()
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const offset = Math.max(options.offset ?? 0, 0)

    const conditions: string[] = []
    const params: unknown[] = []
    const push = (column: string, value: string) => {
      params.push(value)
      conditions.push(`${column} = $${params.length}`)
    }
    if (options.status) push('status', options.status)
    if (options.severity) push('severity', options.severity)
    if (options.channel) push('channel', options.channel)

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const limitIdx = params.length + 1
    const offsetIdx = params.length + 2
    const rows = await pool.query(
      `SELECT id,
              outbox_id AS "outboxId",
              job_id AS "jobId",
              channel,
              event_key AS "eventKey",
              severity,
              profile_id AS "profileId",
              user_id AS "userId",
              cause,
              error_category AS "errorCategory",
              attempts,
              max_attempts AS "maxAttempts",
              idempotency_key AS "idempotencyKey",
              status,
              resolved_at AS "resolvedAt",
              resolved_by AS "resolvedBy",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM notification_dead_letter
       ${where}
       ORDER BY
         /* Open/retried first, then critical severity, then newest. */
         CASE status WHEN 'open' THEN 0 WHEN 'retried' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
         CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    )
    return rows.rows
  }

  /**
   * Apply a triage action to a dead-letter record (E-05, T-05.01.06).
   *
   * - `retry`   re-queues the underlying `notification_job` (same idempotency
   *             key, so re-processing cannot double-deliver) and re-queues the
   *             parent outbox row so the worker picks it up. Marked 'retried'.
   * - `resolve` marks the record final (no further retry) — 'resolved'.
   * - `dismiss` acknowledges/dismisses the record from the active view —
   *             'dismissed'.
   *
   * Idempotent: acting on a record already resolved/dismissed/retried is a
   * no-op that returns the current row. Returns the updated record.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async deadLetterAction(
    id: string,
    action: 'retry' | 'resolve' | 'dismiss',
    actor: string,
  ): Promise<any | null> {
    const pool = getDbPool()
    const current = await pool.query<{
      id: string
      jobId: string
      outboxId: string
      status: string
    }>(
      `SELECT id, job_id AS "jobId", outbox_id AS "outboxId", status
         FROM notification_dead_letter WHERE id = $1`,
      [id],
    )
    if (current.rows.length === 0) return null

    const row = current.rows[0]
    if (!row) return null

    // Map the requested action to the persisted status (matches the
    // chk_ndl_status CHECK constraint).
    const nextStatus =
      action === 'retry' ? 'retried' : action === 'resolve' ? 'resolved' : 'dismissed'

    // The retry re-queue touches three tables; acquire a dedicated client and
    // run it as a single transaction so a crash mid-way cannot leave the job
    // re-queued while the dead-letter row stays open (or vice versa). A
    // dedicated client is required — multi-statement `pool.query('BEGIN')`
    // does not pin a connection across statements.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Match worker lock order: parent outbox, then delivery record/job.
      const parent = (await client.query(`SELECT status,locked_until > clock_timestamp() AS leased
        FROM notification_outbox WHERE id=$1 FOR UPDATE`, [row.outboxId])).rows[0]
      const locked = (await client.query(`SELECT id,status FROM notification_dead_letter
        WHERE id=$1 FOR UPDATE`, [id])).rows[0]
      if (!locked || locked.status !== 'open') {
        await client.query('COMMIT')
        return locked ?? null
      }
      if (action === 'retry') {
        if (!parent || parent.leased || parent.status === 'cancelled' || parent.status === 'delivered') {
          throw new HttpException({ error: 'NOTIFICATION_RETRY_CONFLICT' }, 409)
        }
        const job = await client.query(`UPDATE notification_job SET status='queued',run_after=NULL,attempts=0,
          last_error=NULL,updated_at=NOW() WHERE id=$1 AND outbox_id=$2 AND status='dead_letter' RETURNING id`, [row.jobId, row.outboxId])
        if (job.rows.length !== 1) throw new HttpException({ error: 'NOTIFICATION_RETRY_CONFLICT' }, 409)
        await client.query(`UPDATE notification_outbox SET status='queued',locked_until=NULL,lease_token=NULL,
          scheduled_for=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1`, [row.outboxId])
      }

      const updated = await client.query(
        `UPDATE notification_dead_letter
            SET status = $1, resolved_at = NOW(), resolved_by = $2, updated_at = NOW()
          WHERE id = $3 AND status = 'open'
          RETURNING id,
                    outbox_id AS "outboxId",
                    job_id AS "jobId",
                    channel,
                    event_key AS "eventKey",
                    severity,
                    profile_id AS "profileId",
                    user_id AS "userId",
                    cause,
                    error_category AS "errorCategory",
                    attempts,
                    max_attempts AS "maxAttempts",
                    idempotency_key AS "idempotencyKey",
                    status,
                    resolved_at AS "resolvedAt",
                    resolved_by AS "resolvedBy",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"`,
        [nextStatus, actor, id],
      )

      await client.query(`INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
        VALUES ($1,$2,'notification_dead_letter_action',$3::jsonb,$4,NOW())`,
        [uuidv7(),actor,JSON.stringify({ deadLetterId: id, outboxId: row.outboxId, jobId: row.jobId, action }),uuidv7()])
      await client.query('COMMIT')

      // If the row was already acted upon (status != 'open'), the guarded
      // UPDATE affected zero rows: report the terminal state so the caller
      // treats it as an idempotent no-op.
      if (updated.rows.length === 0) {
        return { id: row.id, status: row.status }
      }
      return updated.rows[0]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}
