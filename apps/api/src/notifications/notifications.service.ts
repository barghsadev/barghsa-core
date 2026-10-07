import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { classifyNotificationType, notificationLink } from '@barghsa/shared/notifications';
import { NotificationCenterService, notificationScope } from './notification-center.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import type { OperatingContext, ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import type { PoolClient } from 'pg';

export type ContractCustomerEvent =
  | 'contract.created'
  | 'contract.awaiting_acceptance'
  | 'contract.accepted'
  | 'contract.signed'
  | 'contract.active'
  | 'contract.cancelled'
  | 'contract.changes_requested';

export interface CreateNotificationParams {
  userId: string;
  profileId?: string;
  operatingContext: OperatingContext | 'account';
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
  status: 'delivered' | 'failed' | 'sending' | 'unknown';
  attemptNumber: number;
  providerRef: string | null;
  latencyMs: number | null;
  errorCategory: string | null;
  errorDetail: string | null;
  createdAt: Date;
}

/** Canonical inbox writes and transactional delivery for verification notices. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /**
   * Create a new in-app notification for a user.
   *
   * Writes to the canonical notification center, including private account notices.
   *
   * @param params - Notification creation parameters.
   * @returns The created notification record.
   */
  async create(
    params: CreateNotificationParams,
    transaction?: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    delivery?: { outboxId: string; eventKey: ContractCustomerEvent }
  ): Promise<NotificationResult> {
    const pool = transaction ?? getDbPool();
    const id = uuidv7();
    const now = new Date();

    const inserted = await pool.query(
      `INSERT INTO in_app_notifications (id,recipient_user_id,profile_id,operating_context,type,title_i18n_key,body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
       VALUES ($1::uuid,$2,$3,$4,$5,'notifications.legacy.title','notifications.legacy.body',
       COALESCE($10::jsonb,jsonb_build_object('original',jsonb_build_object('title',$6::text,'body',COALESCE($7::text,'')))),$8,false,$9,COALESCE($11::text,'direct:'||$1::text)) RETURNING id`,
      [
        id,
        params.userId,
        params.profileId ?? null,
        params.operatingContext,
        delivery?.eventKey ?? params.type,
        params.title,
        params.body ?? null,
        notificationLink(params.link),
        now,
        params.localizedContent ? JSON.stringify(params.localizedContent) : null,
        delivery ? `outbox:${delivery.outboxId}` : null,
      ]
    );
    if (delivery && !(inserted as { rows: { id: string }[] }).rows.some((row) => row.id === id))
      throw new Error('Mandatory inbox delivery was not stored');

    this.logger.log(`Notification created: id=${id} type=${params.type} user=${params.userId}`);

    return {
      id,
      userId: params.userId,
      profileId: params.profileId ?? null,
      type: delivery?.eventKey ?? params.type,
      title: params.title,
      body: params.body ?? null,
      link: notificationLink(params.link),
      read: false,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** The caller owns the native business transaction and its stable occurrence identity. */
  async createCustomerBusinessEvent(
    params: CreateNotificationParams & {
      profileId: string;
      eventKey: ContractCustomerEvent;
      occurrenceKey: string;
      payload: Record<string, string>;
    },
    transaction: PoolClient
  ): Promise<void> {
    if (params.operatingContext !== 'customer' || !params.occurrenceKey.trim())
      throw new Error('Customer business delivery requires a private scope and occurrence key');
    const payload = {
      ...params.payload,
      ...(params.link ? { link_route: notificationLink(params.link) } : {}),
    };
    const outboxId = uuidv7();
    const inserted = await transaction.query(
      `INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,status,idempotency_key,max_attempts,correlation_id)
       VALUES($1,$2,$3,$4,$5,ARRAY['in_app','email'],'queued',$6,5,$7)
       ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
      [
        outboxId,
        params.profileId,
        params.userId,
        params.eventKey,
        payload,
        params.occurrenceKey,
        correlationIdStorage.getStore() ?? null,
      ]
    );
    if (!inserted.rows[0]) {
      const existing = await transaction.query(
        `SELECT ob.id FROM notification_outbox ob JOIN in_app_notifications n ON n.delivery_key='outbox:'||ob.id::text
         WHERE ob.idempotency_key=$1 AND ob.profile_id=$2 AND ob.user_id=$3 AND ob.event_key=$4 AND ob.payload=$5::jsonb
         AND ob.channels=ARRAY['in_app','email'] AND n.profile_id=ob.profile_id AND n.recipient_user_id=ob.user_id
         AND n.operating_context='customer' AND n.type=ob.event_key`,
        [params.occurrenceKey, params.profileId, params.userId, params.eventKey, payload]
      );
      if (!existing.rows[0])
        throw new Error('Business notification occurrence conflicts with saved delivery');
      return;
    }
    const notice = await this.create(params, transaction, { outboxId, eventKey: params.eventKey });
    const priority =
      classifyNotificationType(params.eventKey) === 'immediate' ? 'urgent' : 'normal';
    // In-app delivery is immediate and already persisted; only email awaits the worker/window.
    const jobs = await transaction.query(
      `INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
       VALUES($1,'in_app','done',$2,5,1,$3,$4),($1,'email','queued',$2,5,0,NULL,NULL)`,
      [outboxId, priority, notice.id, payload]
    );
    if (jobs.rowCount !== 2) throw new Error('Business delivery jobs were not stored');
    const history = await transaction.query(
      `INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
       VALUES($1,'in_app','delivered',1,$2)`,
      [outboxId, notice.id]
    );
    if (history.rowCount !== 1) throw new Error('Business inbox delivery history was not stored');
  }

  /** Queue external verification channels in the caller's status-change transaction. */
  async createVerification(
    params: Omit<CreateNotificationParams, 'operatingContext'> & {
      profileId: string;
      profileName: string;
      status: string;
      localizedContent: NonNullable<CreateNotificationParams['localizedContent']>;
    },
    transaction: { query(sql: string, params?: unknown[]): Promise<unknown> }
  ): Promise<NotificationResult> {
    const notice = await this.create({ ...params, operatingContext: 'customer' }, transaction);
    const outboxId = uuidv7();
    const eventKey = 'profile.verification_status';
    // The inbox entry already exists; external workers enforce current recipients/preferences.
    await transaction.query(
      `INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,status,idempotency_key,max_attempts,correlation_id)
       VALUES($1,$2,$3,$4,$5,ARRAY['email','sms'],'queued',$6,5,$7)`,
      [
        outboxId,
        params.profileId,
        params.userId,
        eventKey,
        {
          profileName: params.profileName,
          status: params.status,
          messageFa: params.localizedContent.fa.body,
          messageEn: params.localizedContent.en.body,
        },
        `verification-notice:${notice.id}`,
        correlationIdStorage.getStore() ?? null,
      ]
    );
    const priority = classifyNotificationType(eventKey) === 'immediate' ? 'urgent' : 'normal';
    await transaction.query(
      `INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts)
       VALUES($1,'email','queued',$2,5),($1,'sms','queued',$2,5)`,
      [outboxId, priority]
    );
    return notice;
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
    context: OperatingContext = 'customer'
  ): Promise<{ notifications: NotificationResult[]; total: number; unreadCount: number }> {
    const pool = getDbPool();

    const center = new NotificationCenterService(pool);
    const profileId = context === 'customer' ? await center.resolveActiveProfileId(userId) : null;
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 50;
    const safeOffset = Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0;
    const counts = (
      await pool.query(
        `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE NOT is_read)::int AS unread FROM in_app_notifications WHERE ${notificationScope}`,
        [profileId, userId, context]
      )
    ).rows[0];
    const rows = await pool.query(
      `SELECT id,profile_id AS "profileId",type,
      COALESCE(localized_content->'original'->>'title',localized_content->'fa'->>'title',title_i18n_key) AS title,
      COALESCE(localized_content->'original'->>'body',localized_content->'fa'->>'body',body_i18n_key) AS body,
      link_route AS link,is_read AS read,read_at AS "readAt",created_at AS "createdAt",created_at AS "updatedAt"
      FROM in_app_notifications WHERE ${notificationScope} ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
      [profileId, userId, context, safeLimit, safeOffset]
    );
    return {
      notifications: rows.rows.map((row) => ({ ...row, userId })),
      total: counts?.total ?? 0,
      unreadCount: counts?.unread ?? 0,
    };
  }

  async countUnread(userId: string, context: OperatingContext = 'customer'): Promise<number> {
    const center = new NotificationCenterService(getDbPool());
    return center.countUnread(
      context === 'customer' ? await center.resolveActiveProfileId(userId) : null,
      userId,
      context
    );
  }

  async markAsRead(
    notificationId: string,
    userId: string,
    context: OperatingContext = 'customer'
  ): Promise<void> {
    const center = new NotificationCenterService(getDbPool());
    await center.markRead(
      context === 'customer' ? await center.resolveActiveProfileId(userId) : null,
      notificationId,
      userId,
      context
    );
  }

  async markAllAsRead(userId: string, context: OperatingContext = 'customer'): Promise<void> {
    const center = new NotificationCenterService(getDbPool());
    await center.markAllRead(
      context === 'customer' ? await center.resolveActiveProfileId(userId) : null,
      userId,
      context
    );
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
  async findDeliveryLogs(
    options: {
      notificationId?: string;
      channel?: 'in_app' | 'email' | 'sms';
      status?: 'delivered' | 'failed' | 'sending' | 'unknown';
      limit?: number;
      offset?: number;
    },
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
  ): Promise<DeliveryLogRow[]> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:jobs:view');
      await requireCurrentSession(client, actor);
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
      const rowsResult = await client.query<DeliveryLogRow>(
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
       FROM (
         SELECT l.id,l.notification_id,l.channel,l.attempt_number,l.provider_ref,l.latency_ms,l.created_at,
           CASE WHEN feedback.event_type IS NOT NULL THEN 'failed' ELSE l.status END AS status,
           CASE WHEN feedback.event_type IS NULL THEN l.error_category
                WHEN feedback.raw->'data'->'bounce'->>'type'='Permanent' THEN 'permanent'
                WHEN feedback.raw->'data'->'bounce'->>'type'='Temporary' THEN 'transient'
                ELSE 'provider' END AS error_category,
           CASE WHEN feedback.event_type IS NOT NULL THEN 'Provider reported bounce' ELSE l.error_detail END AS error_detail
         FROM notification_delivery_log l
         LEFT JOIN notification_send_receipts r
           ON r.outbox_id=l.notification_id AND r.channel=l.channel AND r.attempt_token=l.send_attempt_token
           AND r.status='accepted' AND r.transport='resend' AND r.provider_ref=l.provider_ref
         LEFT JOIN LATERAL (
           SELECT e.event_type,e.raw FROM email_webhook_events e
           WHERE e.message_id=r.provider_ref AND r.provider_id=ANY(e.verified_provider_ids)
             AND e.event_type='email.bounced'
           ORDER BY (e.raw->'data'->'bounce'->>'type'='Permanent') DESC NULLS LAST,e.created_at DESC,e.id DESC
           LIMIT 1
         ) feedback ON true
       ) history
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return rowsResult.rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
