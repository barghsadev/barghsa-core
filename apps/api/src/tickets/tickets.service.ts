import { notifySessionsRevoked } from '../auth/session-notifications.js';
import { ticketReply, ticketPagination, type TicketReplyOptions } from './ticket-input.js';
import { parseTicketFormInput, optionalTicketCommandKey } from './ticket-form-input-fields.js';
import { idempotentMutation } from '../database/idempotency.js';
import { withRelatedTicketRecords, type RelatedTicketRecord } from './ticket-related-records.js';
import {
  authorizeTicketAccess,
  authorizeTicketMutation,
  type TicketActor,
  type TicketAccess,
} from './ticket-actor.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { SessionService } from '../session/session.service.js';
import {
  SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
  toServiceResponseTargets,
} from '@barghsa/shared/admin';
import { StaffAssignmentService } from '../staff-assignment/staff-assignment.service.js';
import { t } from '@barghsa/i18n';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { TicketAttachmentsService } from './ticket-attachments.service.js';
import { createHash, randomUUID } from 'node:crypto';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import {
  Injectable,
  Logger,
  HttpException,
  Inject,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ensureDocumentPreview, readPreviewObject } from '../documents/document-preview.js';
import { getDbPool, loadStoredStorageConfiguration } from '@barghsa/db';
import { runtimeStorageProvider, type StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { ErrorCodes } from '@barghsa/shared/errors';

export interface TicketRow {
  id: string;
  userId: string;
  subject: string;
  body: string;
  category: 'general' | 'billing' | 'orders' | 'privacy';
  privacyRequestType?: PrivacyRequestType | null;
  privacyClosureCompletedAt?: Date | null;
  privacyClosureAnonymized?: boolean | null;
  privacyClosureRetained?: Record<string, number> | null;
  privacyClosureExportTicketId?: string | null;
  profileId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  relatedRecord?: RelatedTicketRecord | null;
  priority: 'normal' | 'high';
  status: 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed';
  attachments: string[];
  attachmentDownloadUrls?: string[];
  attachmentFiles?: {
    key: string;
    fileName: string;
    contentType: string;
    url: string;
    fileIndex: number;
  }[];
  assignedTeamId: string | null;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTicketDto {
  idempotencyKey?: string;
  subject: string;
  body: string;
  category?: TicketRow['category'];
  profileId?: string | null;
  relatedEntityType?: 'order' | 'contract' | 'invoice' | null;
  relatedEntityId?: string | null;
  priority?: 'normal' | 'high';
  /** Storage keys of previously uploaded files to attach to this ticket. */
  attachments?: string[] | null;
}

export interface TicketCustomer {
  userId: string;
  username: string;
  email: string | null;
  mobile: string | null;
  profile: { id: string; title: string | null } | null;
}

export interface TicketCommentRow {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  visibility: 'public' | 'internal';
  bodyFormat: 'plain' | 'markdown';
  authorContext: 'customer' | 'staff' | 'unknown';
  author?: { displayName: string | null; avatarUrl: string | null } | null;
  attachments: {
    key: string;
    fileName: string;
    contentType: string;
    url: string;
    fileIndex: number;
  }[];
  attachmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListTicketsOptions {
  status?: string;
  profileId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type PrivacyRequestType = 'export' | 'closure';
export interface ClosureBlocker {
  code:
    | 'legalHold'
    | 'unpaidInvoice'
    | 'pendingRefund'
    | 'walletBalance'
    | 'activeContract'
    | 'activeOrder'
    | 'pendingVerification'
    | 'pendingWalletTransaction'
    | 'activeProductWorkflow'
    | 'pendingProfileAccess'
    | 'securityReview'
    | 'pendingExport'
    | 'profileOwnershipChanged';
  count: number;
  owner: 'legal' | 'finance' | 'customer' | 'contracts' | 'privacy';
  nextStep: string;
}

function mapRow(row: Record<string, unknown>): TicketRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    subject: row.subject as string,
    body: row.body as string,
    category: (row.category as TicketRow['category']) ?? 'general',
    privacyRequestType: (row.privacy_request_type as PrivacyRequestType) ?? null,
    privacyClosureCompletedAt: (row.privacy_closure_completed_at as Date) ?? null,
    privacyClosureAnonymized: (row.privacy_closure_anonymized as boolean) ?? null,
    privacyClosureRetained: (row.privacy_closure_retained as Record<string, number>) ?? null,
    privacyClosureExportTicketId: (row.privacy_closure_export_ticket_id as string) ?? null,
    profileId: (row.profile_id as string) ?? null,
    relatedEntityType: (row.related_entity_type as string) ?? null,
    relatedEntityId: (row.related_entity_id as string) ?? null,
    priority: (row.priority as 'normal' | 'high') ?? 'normal',
    status:
      (row.status as
        'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed') ??
      'open',
    attachments: Array.isArray(row.attachments) ? (row.attachments as string[]) : [],
    assignedTeamId: (row.assigned_team_id as string) ?? null,
    assignedTo: (row.assigned_to as string) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapCommentRow(row: Record<string, unknown>): TicketCommentRow {
  return {
    id: row.id as string,
    ticketId: row.ticket_id as string,
    authorId: row.author_id as string,
    body: row.body as string,
    visibility: (row.visibility as 'public' | 'internal') ?? 'public',
    bodyFormat: row.body_format === 'markdown' ? 'markdown' : 'plain',
    authorContext:
      row.author_context === 'customer' || row.author_context === 'staff'
        ? row.author_context
        : 'unknown',
    attachments: [],
    attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly attachmentService: TicketAttachmentsService = new TicketAttachmentsService(),
    private readonly notifications: NotificationsService = new NotificationsService(),
    private readonly assignmentService: StaffAssignmentService = new StaffAssignmentService(),
    @Inject(STORAGE_PROVIDER)
    private readonly exportStorage: StorageProvider = runtimeStorageProvider(
      loadStoredStorageConfiguration
    ),
    private readonly sessions: SessionService = new SessionService()
  ) {}

  private readonly logger = new Logger(TicketsService.name);

  async readAs<T>(
    actor: TicketActor,
    permission: false | 'read' | 'write',
    read: (client: PoolClient, access: TicketAccess) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const access = await authorizeTicketAccess(client, actor, actor.userId, permission);
      const result = await read(client, access);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async notifyTicket(
    client: PoolClient,
    ticket: TicketRow,
    actorId: string,
    event: 'created' | 'status' | 'reply' | 'internal' | 'assigned',
    occurrenceId?: string
  ) {
    const recipients: Array<{ userId: string; staff: boolean }> = [];
    if (event !== 'internal' && ticket.userId !== actorId)
      recipients.push({ userId: ticket.userId, staff: false });
    if (ticket.assignedTo && ticket.assignedTo !== actorId) {
      const user = (
        await client.query(
          `SELECT u.is_admin,
        ARRAY(SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id) AS role_permissions
        FROM users u WHERE user_id=$1 AND disabled_at IS NULL AND activation_token IS NULL`,
          [ticket.assignedTo]
        )
      ).rows[0];
      if (
        user &&
        (user.is_admin ||
          resolveStaffPermissions(user.role_permissions).some((permission) =>
            ['*', 'tickets:*', 'tickets:read', 'tickets:assigned'].includes(permission)
          ))
      )
        recipients.push({ userId: ticket.assignedTo, staff: true });
    }
    if (!ticket.assignedTo && (event === 'created' || actorId === ticket.userId)) {
      const staff = (
        await client.query(
          `SELECT u.user_id,u.is_admin,
        ARRAY(SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id) AS role_permissions
        FROM users u WHERE disabled_at IS NULL AND activation_token IS NULL AND user_id<>$1
          AND (u.is_admin OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.user_id))`,
          [actorId]
        )
      ).rows;
      for (const user of staff) {
        if (
          user.is_admin ||
          resolveStaffPermissions(user.role_permissions).some((permission) =>
            ['*', 'tickets:*', 'tickets:read'].includes(permission)
          )
        )
          recipients.push({ userId: user.user_id, staff: true });
      }
    }
    for (const { userId, staff } of recipients) {
      const localizedContent = Object.fromEntries(
        (['fa', 'en'] as const).map((locale) => [
          locale,
          {
            title: t(`tickets.notice.${event}`, locale),
            // Never copy conversation contents into notices, including internal notes.
            body: `${ticket.subject} · ${t(`tickets.${ticket.status}`, locale)}`,
          },
        ])
      ) as Record<'fa' | 'en', { title: string; body: string }>;
      const params = {
        userId,
        operatingContext: staff ? 'staff' : 'customer',
        type: 'general',
        title: localizedContent.en.title,
        body: localizedContent.en.body,
        localizedContent,
        link: `${staff ? '/admin' : ''}/tickets?ticketId=${ticket.id}`,
      } as const;
      const eventKey =
        event === 'reply'
          ? 'ticket.new_reply'
          : staff && (event === 'assigned' || (event === 'created' && ticket.assignedTo === userId))
            ? 'ticket.assigned'
            : null;
      if (eventKey) {
        const occurrence = event === 'created' ? 'created' : occurrenceId;
        if (!occurrence) throw new Error('Ticket notice requires the saved occurrence');
        await this.notifications.createTicketBusinessEvent(
          {
            ...params,
            eventKey,
            payload: { ticketNumber: ticket.id },
            occurrenceKey: `${eventKey}:${ticket.id}:${occurrence}:${userId}`,
          },
          client
        );
      } else await this.notifications.create(params, client);
    }
  }

  async responseTargetHours(client?: PoolClient): Promise<number | null> {
    const row = (
      await (client ?? getDbPool()).query('SELECT value FROM app_config WHERE key=$1', [
        SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
      ])
    ).rows[0];
    return toServiceResponseTargets(row?.value).ticket;
  }

  async assignmentTeams(client?: PoolClient) {
    return (
      await (client ?? getDbPool())
        .query(`SELECT t.id,t.name,ARRAY(SELECT m.user_id FROM staff_team_members m WHERE m.team_id=t.id ORDER BY m.user_id) AS members
      FROM staff_teams t WHERE is_active ORDER BY name,id`)
    ).rows;
  }

  async creationOptions(userId: string, profileId?: string, recordPage = 1, client?: PoolClient) {
    if (!Number.isSafeInteger(recordPage) || recordPage < 1 || recordPage > 100000)
      throw new HttpException('Invalid record page', 400);
    if (profileId && !z.uuid().safeParse(profileId).success)
      throw new HttpException('Invalid profile', 400);
    const pool = client ?? getDbPool();
    const profiles = (
      await pool.query(
        `SELECT id,COALESCE(NULLIF(title,''),NULLIF(concat_ws(' ',first_name,last_name),'')) AS title
      FROM profiles WHERE user_id=$1 AND NOT archived ORDER BY created_at,id`,
        [userId]
      )
    ).rows;
    if (!profileId) return { profiles, records: [] };
    if (!profiles.some((profile) => profile.id === profileId))
      throw new HttpException('Profile not found', 404);
    const records = (
      await pool.query(
        `SELECT * FROM (
      SELECT id,'order' AS type,created_at FROM orders WHERE profile_id=$1
        UNION ALL SELECT id,'invoice' AS type,created_at FROM invoices WHERE profile_id=$1
        UNION ALL SELECT id,'contract' AS type,created_at FROM contracts WHERE profile_id=$1
          AND EXISTS (SELECT 1 FROM contract_publications WHERE contract_id=contracts.id)
      ) records WHERE EXISTS (SELECT 1 FROM profiles WHERE id=$1 AND user_id=$3 AND NOT archived)
      ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2`,
        [profileId, (recordPage - 1) * 20, userId]
      )
    ).rows;
    return { profiles, records: records.slice(0, 20), hasMoreRecords: records.length > 20 };
  }

  async eligibleAssignees(client?: PoolClient) {
    const users = (
      await (client ?? getDbPool()).query(`SELECT u.user_id AS id,u.username AS name,u.is_admin,
      ARRAY(SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id) AS role_permissions
      FROM users u WHERE u.disabled_at IS NULL AND u.activation_token IS NULL
        AND (u.is_admin OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.user_id)) ORDER BY u.username,u.user_id`)
    ).rows;
    return users
      .filter(
        (user) =>
          user.is_admin ||
          resolveStaffPermissions(user.role_permissions).some((permission) =>
            ['*', 'tickets:*', 'tickets:write', 'tickets:assigned'].includes(permission)
          )
      )
      .map((user) => ({ id: user.id as string, name: user.name as string }));
  }

  private async activeOwnedProfile(
    client: PoolClient,
    userId: string,
    lock = true
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT p.id FROM profiles p
       JOIN users u ON u.user_id=p.user_id AND u.disabled_at IS NULL
       LEFT JOIN user_profile_contexts c ON c.user_id=u.user_id
       WHERE p.user_id=$1 AND NOT p.archived
         AND ((c.user_id IS NULL AND p.is_default) OR p.id=c.profile_id)
       ${lock ? 'FOR UPDATE OF p' : ''}`,
      [userId]
    );
    if (!result.rows[0]) throw new HttpException('Active owned profile required', 403);
    return result.rows[0].id;
  }

  private async closureBlockers(client: PoolClient, profileId: string): Promise<ClosureBlocker[]> {
    const counts = (
      await client.query<{
        legal_holds: number;
        unpaid_invoices: number;
        pending_refunds: number;
        wallet_balances: number;
        active_contracts: number;
        active_orders: number;
        pending_verification: number;
        pending_wallet_transactions: number;
        active_product_workflows: number;
        pending_profile_access: number;
      }>(
        `SELECT
          GREATEST(
            (SELECT count(*)::int FROM document_legal_holds h
             WHERE h.released_at IS NULL AND (h.expires_at IS NULL OR h.expires_at>now())
               AND (h.profile_id=$1 OR EXISTS (
                 SELECT 1 FROM documents d WHERE d.id=h.document_id AND d.profile_id=$1))),
            (SELECT CASE WHEN EXISTS (
              SELECT 1 FROM documents d WHERE d.profile_id=$1 AND document_is_held(d.id)
            ) THEN 1 ELSE 0 END)
          ) AS legal_holds,
          (SELECT count(*)::int FROM invoices WHERE profile_id=$1
           AND state IN ('Unpaid','Overdue','PaymentUnderReview','PartiallyFunded')) AS unpaid_invoices,
          (SELECT count(*)::int FROM refunds WHERE profile_id=$1
           AND state IN ('Requested','Approved','Processing','Failed')) AS pending_refunds,
          (SELECT count(*)::int FROM wallets WHERE profile_id=$1
           AND (posted_balance<>0 OR reserved_balance<>0)) AS wallet_balances,
          (SELECT count(*)::int FROM contracts WHERE profile_id=$1
           AND state NOT IN ('Completed','Cancelled')) AS active_contracts,
          (SELECT count(*)::int FROM orders o WHERE o.profile_id=$1
           AND (o.status IN ('DRAFT','PENDING') OR
             (o.status='CONFIRMED' AND NOT EXISTS (
               SELECT 1 FROM contracts c WHERE c.order_id=o.id
               AND c.state IN ('Completed','Cancelled'))))) AS active_orders,
          (SELECT count(*)::int FROM verification_cases WHERE profile_id=$1
           AND status IN ('Open','Under Review')) AS pending_verification,
          (SELECT count(*)::int FROM wallet_transactions wt
           JOIN wallets w ON w.profile_id=wt.wallet_id WHERE w.profile_id=$1
           AND wt.state IN ('Pending','Reserved')) AS pending_wallet_transactions,
          (SELECT count(*)::int FROM electricity_orders WHERE profile_id=$1
           AND status NOT IN ('completed','rejected','cancelled'))
          + (SELECT count(*)::int FROM saving_orders WHERE profile_id=$1
             AND status NOT IN ('completed','rejected','cancelled'))
          + (SELECT count(*)::int FROM solar_construction_requests WHERE profile_id=$1
             AND status NOT IN ('contract_created','rejected','cancelled'))
          + (SELECT count(*)::int FROM consultation_requests WHERE profile_id=$1
             AND status NOT IN ('completed','offer_declined','rejected','cancelled'))
          + (SELECT count(*)::int FROM electricity_quantity_increase_requests WHERE profile_id=$1
             AND status NOT IN ('effective','rejected','expired'))
          + (SELECT count(*)::int FROM electricity_price_adjustments WHERE profile_id=$1
             AND status='proposed') AS active_product_workflows,
          (SELECT count(*)::int FROM profile_invitations WHERE profile_id=$1 AND status='Pending')
          + (SELECT count(*)::int FROM profile_ownership_transfers WHERE profile_id=$1 AND status='Pending')
            AS pending_profile_access`,
        [profileId]
      )
    ).rows[0]!;
    return [
      { code: 'legalHold', count: counts.legal_holds, owner: 'legal', nextStep: 'contactSupport' },
      {
        code: 'unpaidInvoice',
        count: counts.unpaid_invoices,
        owner: 'finance',
        nextStep: 'payInvoice',
      },
      {
        code: 'pendingRefund',
        count: counts.pending_refunds,
        owner: 'finance',
        nextStep: 'resolveRefund',
      },
      {
        code: 'walletBalance',
        count: counts.wallet_balances,
        owner: 'customer',
        nextStep: 'settleWallet',
      },
      {
        code: 'activeContract',
        count: counts.active_contracts,
        owner: 'contracts',
        nextStep: 'completeContract',
      },
      {
        code: 'activeOrder',
        count: counts.active_orders,
        owner: 'contracts',
        nextStep: 'completeContract',
      },
      {
        code: 'pendingVerification',
        count: counts.pending_verification,
        owner: 'privacy',
        nextStep: 'staffReview',
      },
      {
        code: 'pendingWalletTransaction',
        count: counts.pending_wallet_transactions,
        owner: 'finance',
        nextStep: 'settleWallet',
      },
      {
        code: 'activeProductWorkflow',
        count: counts.active_product_workflows,
        owner: 'contracts',
        nextStep: 'completeContract',
      },
      {
        code: 'pendingProfileAccess',
        count: counts.pending_profile_access,
        owner: 'privacy',
        nextStep: 'staffReview',
      },
      { code: 'securityReview', count: 1, owner: 'privacy', nextStep: 'staffReview' },
    ];
  }

  async lifecyclePreview(actor: TicketActor) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await authorizeTicketMutation(client, actor, actor.userId, false);
      const profileId = await this.activeOwnedProfile(client, actor.userId);
      const blockers = await this.closureBlockers(client, profileId);
      const requests = (
        await client.query<{
          id: string;
          privacy_request_type: PrivacyRequestType;
          status: TicketRow['status'];
          created_at: Date;
          privacy_export_job_id: string | null;
          privacy_export_expires_at: Date | null;
        }>(
          `SELECT id,privacy_request_type,status,created_at,privacy_export_job_id,privacy_export_expires_at FROM tickets
           WHERE profile_id=$1 AND user_id=$2 AND privacy_request_type IS NOT NULL
           ORDER BY created_at DESC,id DESC LIMIT 10`,
          [profileId, actor.userId]
        )
      ).rows.map((row) => ({
        ticketId: row.id,
        type: row.privacy_request_type,
        status: row.status,
        createdAt: row.created_at,
        exportJobId: row.privacy_export_job_id,
        exportExpiresAt: row.privacy_export_expires_at,
      }));
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { profileId, blockers, requests };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createLifecycleRequest(
    actor: TicketActor,
    type: PrivacyRequestType,
    idempotencyKey: string,
    locale: 'fa' | 'en'
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `profile-lifecycle:${actor.userId}:${idempotencyKey}`,
      ]);
      const profileHint = await this.activeOwnedProfile(client, actor.userId, false);
      const previous = (
        await client.query<{
          id: string;
          profile_id: string;
          privacy_request_type: PrivacyRequestType;
        }>(
          `SELECT id,profile_id,privacy_request_type FROM tickets
           WHERE user_id=$1 AND privacy_request_key=$2`,
          [actor.userId, idempotencyKey]
        )
      ).rows[0];
      const ticketId = randomUUID();
      const assignment = previous
        ? null
        : await this.assignmentService.choose(
            client,
            'ticket',
            ticketId,
            actor.userId,
            ['privacy'],
            [actor.userId]
          );
      await authorizeTicketMutation(client, actor, actor.userId, false);
      const profileId = await this.activeOwnedProfile(client, actor.userId);
      if (profileId !== profileHint)
        throw new HttpException('Active owned profile changed; refresh and retry', 409);
      if (previous && (previous.profile_id !== profileId || previous.privacy_request_type !== type))
        throw new HttpException('Idempotency key belongs to a different request', 409);
      if (previous) {
        await requireCurrentSession(client, actor);
        await client.query('COMMIT');
        return { ticketId: previous.id, profileId, type, created: false };
      }
      const ticket = mapRow(
        (
          await client.query(
            `INSERT INTO tickets(id,user_id,profile_id,subject,body,category,priority,status,
             assigned_to,assigned_team_id,privacy_request_type,privacy_request_key)
           VALUES($1,$2,$3,$4,$5,'privacy','normal',
             CASE WHEN $6::text IS NULL THEN 'open' ELSE 'in_progress' END,$6,$7,$8,$9)
           RETURNING *`,
            [
              ticketId,
              actor.userId,
              profileId,
              t(`tickets.privacy.${type}.subject`, locale),
              t(`tickets.privacy.${type}.body`, locale),
              assignment?.userId ?? null,
              assignment?.teamId ?? null,
              type,
              idempotencyKey,
            ]
          )
        ).rows[0]
      );
      const blockers = type === 'closure' ? await this.closureBlockers(client, profileId) : [];
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata)
         VALUES($1,$2,'profile_lifecycle_requested',$3::jsonb)`,
        [
          randomUUID(),
          actor.userId,
          JSON.stringify({
            ticketId,
            profileId,
            type,
            blockers: blockers
              .filter((blocker) => blocker.count > 0)
              .map(({ code, count }) => ({ code, count })),
          }),
        ]
      );
      await this.notifyTicket(client, ticket, actor.userId, 'created');
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { ticketId, profileId, type, created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async closureExecutionPreview(client: PoolClient, ticketId: string) {
    const request = (
      await client.query<{
        id: string;
        user_id: string;
        profile_id: string;
        status: TicketRow['status'];
        privacy_closure_completed_at: Date | null;
        privacy_closure_anonymized: boolean | null;
        profile_type: 'INDIVIDUAL' | 'LEGAL';
        archived: boolean;
        profile_updated_at: Date;
        profile_owner_user_id: string;
      }>(
        `SELECT t.id,t.user_id,t.profile_id,t.status,t.privacy_closure_completed_at,
           t.privacy_closure_anonymized,p.profile_type,p.archived,p.updated_at AS profile_updated_at,
           p.user_id AS profile_owner_user_id
         FROM tickets t JOIN profiles p ON p.id=t.profile_id
         WHERE t.id=$1 AND t.privacy_request_type='closure'`,
        [ticketId]
      )
    ).rows[0];
    if (!request) throw new HttpException('Closure request not found', 404);
    const blockers = await this.closureBlockers(client, request.profile_id);
    const retained = (
      await client.query<{
        orders: number;
        contracts: number;
        invoices: number;
        wallets: number;
        refunds: number;
        documents: number;
        verification_cases: number;
        electricity_orders: number;
        saving_orders: number;
        solar_requests: number;
        consultations: number;
        electricity_increases: number;
        price_adjustments: number;
      }>(
        `SELECT
          (SELECT count(*)::int FROM orders WHERE profile_id=$1) AS orders,
          (SELECT count(*)::int FROM contracts WHERE profile_id=$1) AS contracts,
          (SELECT count(*)::int FROM invoices WHERE profile_id=$1) AS invoices,
          (SELECT count(*)::int FROM wallets WHERE profile_id=$1) AS wallets,
          (SELECT count(*)::int FROM refunds WHERE profile_id=$1) AS refunds,
          (SELECT count(*)::int FROM documents WHERE profile_id=$1) AS documents,
          (SELECT count(*)::int FROM verification_cases WHERE profile_id=$1) AS verification_cases,
          (SELECT count(*)::int FROM electricity_orders WHERE profile_id=$1) AS electricity_orders,
          (SELECT count(*)::int FROM saving_orders WHERE profile_id=$1) AS saving_orders,
          (SELECT count(*)::int FROM solar_construction_requests WHERE profile_id=$1) AS solar_requests,
          (SELECT count(*)::int FROM consultation_requests WHERE profile_id=$1) AS consultations,
          (SELECT count(*)::int FROM electricity_quantity_increase_requests WHERE profile_id=$1) AS electricity_increases,
          (SELECT count(*)::int FROM electricity_price_adjustments WHERE profile_id=$1) AS price_adjustments`,
        [request.profile_id]
      )
    ).rows[0]!;
    const exportRequest = (
      await client.query<{
        id: string;
        privacy_export_expires_at: Date | null;
        privacy_export_job_id: string | null;
        privacy_export_storage_key: string | null;
        ready: boolean;
      }>(
        `SELECT t.id,t.privacy_export_expires_at,t.privacy_export_job_id,t.privacy_export_storage_key,
           (j.status='completed' AND t.privacy_export_storage_key IS NOT NULL
             AND t.privacy_export_expires_at>clock_timestamp()) IS TRUE AS ready
         FROM tickets t LEFT JOIN async_jobs j ON j.id=t.privacy_export_job_id
         WHERE t.profile_id=$1 AND t.user_id=$2 AND t.privacy_request_type='export'
         ORDER BY t.created_at DESC,t.id DESC LIMIT 1 FOR SHARE OF t`,
        [request.profile_id, request.user_id]
      )
    ).rows[0];
    blockers.push(
      {
        code: 'pendingExport',
        count:
          !request.privacy_closure_completed_at && exportRequest && !exportRequest.ready ? 1 : 0,
        owner: 'customer',
        nextStep: 'prepareExport',
      },
      {
        code: 'profileOwnershipChanged',
        count: request.profile_owner_user_id !== request.user_id ? 1 : 0,
        owner: 'privacy',
        nextStep: 'staffReview',
      }
    );
    const anonymizeProfile =
      request.profile_type === 'INDIVIDUAL' &&
      Object.values(retained).every((count) => count === 0);
    const eligible =
      !request.archived &&
      !request.privacy_closure_completed_at &&
      !['resolved', 'closed'].includes(request.status) &&
      blockers.every((blocker) => blocker.code === 'securityReview' || blocker.count === 0);
    const previewVersion = createHash('sha256')
      .update(
        JSON.stringify({
          ticketId,
          status: request.status,
          profileUpdatedAt: request.profile_updated_at,
          archived: request.archived,
          blockers,
          retained,
          exportTicketId: exportRequest?.id ?? null,
          exportJobId: exportRequest?.privacy_export_job_id ?? null,
          exportExpiresAt: exportRequest?.privacy_export_expires_at ?? null,
          exportStorageKey: exportRequest?.privacy_export_storage_key ?? null,
          profileOwnerUserId: request.profile_owner_user_id,
        })
      )
      .digest('hex');
    return {
      ticketId,
      profileId: request.profile_id,
      ownerUserId: request.user_id,
      completedAt: request.privacy_closure_completed_at,
      anonymized: request.privacy_closure_anonymized,
      eligible,
      blockers,
      retained,
      anonymizeProfile,
      exportTicketId: exportRequest?.id ?? null,
      exportExpiresAt: exportRequest?.privacy_export_expires_at ?? null,
      previewVersion,
    };
  }

  async staffClosurePreview(actor: TicketActor, ticketId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:users:edit');
      const access = await authorizeTicketAccess(client, actor, actor.userId, 'write');
      if (!access.canAssignOthers) throw new HttpException('Full ticket access required', 403);
      const preview = await this.closureExecutionPreview(client, ticketId);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return preview;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async staffExecuteClosure(actor: TicketActor, ticketId: string, previewVersion: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const request = (
        await client.query<{ profile_id: string; user_id: string }>(
          `SELECT profile_id,user_id FROM tickets WHERE id=$1 AND privacy_request_type='closure'`,
          [ticketId]
        )
      ).rows[0];
      if (!request) throw new HttpException('Closure request not found', 404);
      if (request.user_id === actor.userId)
        throw new HttpException('A different staff member must approve this closure', 403);
      await requireStaffMutationPermission(
        client,
        actor.userId,
        'admin:users:edit',
        request.user_id
      );
      const access = await authorizeTicketAccess(client, actor, actor.userId, 'write');
      if (!access.canAssignOthers) throw new HttpException('Full ticket access required', 403);
      await requireSessionStepUp(client, actor);
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [request.profile_id]);
      await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [ticketId]);
      const preview = await this.closureExecutionPreview(client, ticketId);
      if (preview.completedAt) {
        await requireSessionStepUp(client, actor);
        await client.query('COMMIT');
        return { ...preview, created: false };
      }
      if (!preview.eligible || preview.previewVersion !== previewVersion)
        throw new HttpException('Closure preview changed or blockers remain', 409);
      const now = new Date();
      if (preview.anonymizeProfile) {
        await client.query(
          `UPDATE profiles SET title=NULL,contact_email=NULL,contact_mobile=NULL,
             first_name=NULL,last_name=NULL,national_id=NULL,updated_at=$2
           WHERE id=$1`,
          [preview.profileId, now]
        );
        await client.query(
          `UPDATE addresses SET full_address='[redacted]',postal_code='0000000000',
             updated_at=$2 WHERE profile_id=$1`,
          [preview.profileId, now]
        );
      }
      await client.query(
        `UPDATE profiles SET archived=true,archived_at=$2,archived_reason='privacy_closure',
           is_default=false,updated_at=$2 WHERE id=$1`,
        [preview.profileId, now]
      );
      await client.query('UPDATE user_profile_contexts SET profile_id=NULL WHERE profile_id=$1', [
        preview.profileId,
      ]);
      const changedSessionCount = await this.sessions.revokeAllUserSessions(
        preview.ownerUserId,
        undefined,
        client
      );
      await client.query(
        `UPDATE tickets SET status='closed',privacy_closure_completed_at=$2,
           privacy_closure_actor_id=$3,privacy_closure_anonymized=$4,
           privacy_closure_retained=$5::jsonb,privacy_closure_export_ticket_id=$6,
           updated_at=$2 WHERE id=$1`,
        [
          ticketId,
          now,
          actor.userId,
          preview.anonymizeProfile,
          JSON.stringify(preview.retained),
          preview.exportTicketId,
        ]
      );
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata) VALUES($1,$2,'profile_closure_executed',$3::jsonb)`,
        [
          auditId,
          actor.userId,
          JSON.stringify({
            ticketId,
            profileId: preview.profileId,
            ownerUserId: preview.ownerUserId,
            retained: preview.retained,
            anonymizedProfileFields: preview.anonymizeProfile,
            exportTicketId: preview.exportTicketId,
          }),
        ]
      );
      if (changedSessionCount > 0)
        await notifySessionsRevoked(client, preview.ownerUserId, auditId);
      // Recheck the clock after all writes/lock waits; an expired export must not
      // be stranded by a newly committed closure. The export request row is held.
      if (preview.exportTicketId) {
        const ready = await client.query(
          `SELECT t.id FROM tickets t JOIN async_jobs j ON j.id=t.privacy_export_job_id
           WHERE t.id=$1 AND t.profile_id=$2 AND t.user_id=$3 AND t.privacy_request_type='export'
             AND j.status='completed' AND t.privacy_export_storage_key IS NOT NULL
             AND t.privacy_export_expires_at>clock_timestamp()`,
          [preview.exportTicketId, preview.profileId, preview.ownerUserId]
        );
        if (ready.rowCount !== 1)
          throw new HttpException('Export expired; refresh the closure preview', 409);
      }
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return { ...preview, completedAt: now, anonymized: preview.anonymizeProfile, created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '40001')
        throw new HttpException('Closure changed; refresh the preview', 409);
      throw error;
    } finally {
      client.release();
    }
  }

  async startProfileExport(actor: TicketActor, ticketId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await authorizeTicketMutation(client, actor, actor.userId, false);
      const profileId = await this.activeOwnedProfile(client, actor.userId);
      const request = (
        await client.query<{ privacy_export_job_id: string | null }>(
          `SELECT privacy_export_job_id FROM tickets
           WHERE id=$1 AND user_id=$2 AND profile_id=$3 AND privacy_request_type='export'
           FOR UPDATE`,
          [ticketId, actor.userId, profileId]
        )
      ).rows[0];
      if (!request) throw new HttpException('Export request not found', 404);
      const jobId = request.privacy_export_job_id ?? randomUUID();
      if (!request.privacy_export_job_id) {
        await client.query(
          `INSERT INTO async_jobs(id,type,payload,created_by,operating_context)
           VALUES($1,'profile-export',$2::jsonb,$3,'customer')`,
          [jobId, JSON.stringify({ ticketId, profileId, userId: actor.userId }), actor.userId]
        );
        await client.query(`UPDATE tickets SET privacy_export_job_id=$2 WHERE id=$1`, [
          ticketId,
          jobId,
        ]);
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata)
           VALUES($1,$2,'profile_export_queued',$3::jsonb)`,
          [
            randomUUID(),
            actor.userId,
            JSON.stringify({ ticketId, profileId, jobId, operatingContext: 'customer' }),
          ]
        );
      }
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { ticketId, jobId, created: !request.privacy_export_job_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async downloadProfileExport(actor: TicketActor, ticketId: string): Promise<string> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await authorizeTicketMutation(client, actor, actor.userId, false);
      const profileId = await this.activeOwnedProfile(client, actor.userId);
      const request = (
        await client.query<{ privacy_export_storage_key: string; privacy_export_expires_at: Date }>(
          `SELECT t.privacy_export_storage_key,t.privacy_export_expires_at FROM tickets t
           JOIN async_jobs j ON j.id=t.privacy_export_job_id AND j.status='completed'
           WHERE t.id=$1 AND t.user_id=$2 AND t.profile_id=$3
             AND t.privacy_request_type='export' AND t.privacy_export_storage_key IS NOT NULL
             AND t.privacy_export_expires_at>now() FOR UPDATE OF t`,
          [ticketId, actor.userId, profileId]
        )
      ).rows[0];
      if (!request) throw new HttpException('Export unavailable or expired', 404);
      const seconds = Math.min(
        300,
        Math.floor((request.privacy_export_expires_at.getTime() - Date.now()) / 1000)
      );
      if (seconds < 1) throw new HttpException('Export expired', 404);
      const url = await this.exportStorage.presignedGetUrl(
        request.privacy_export_storage_key,
        seconds
      );
      await client.query(`UPDATE tickets SET privacy_export_downloaded_at=now() WHERE id=$1`, [
        ticketId,
      ]);
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata)
         VALUES($1,$2,'profile_export_downloaded',$3::jsonb)`,
        [randomUUID(), actor.userId, JSON.stringify({ ticketId, profileId })]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return url;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create a new support ticket.
   *
   * Validates required fields, checks profile ownership when provided,
   * and creates the ticket record. Attachments (storage keys) are stored
   * as a JSON array on the ticket for later linking.
   */
  private async requireOwnedTicketProfile(client: PoolClient, userId: string, profileId: string) {
    const profile = await client.query(
      'SELECT id FROM profiles WHERE id=$1 AND user_id=$2 AND archived=false FOR UPDATE',
      [profileId, userId]
    );
    if (!profile.rows.length) throw new HttpException('Profile not found', 404);
  }

  async assertCanCreateTicket(actor: TicketActor, input: Record<string, unknown>): Promise<void> {
    if (
      (input.profileId != null && !z.uuid().safeParse(input.profileId).success) ||
      (input.relatedEntityType != null &&
        !['order', 'contract', 'invoice'].includes(input.relatedEntityType as string)) ||
      Boolean(input.relatedEntityType) !== Boolean(input.relatedEntityId) ||
      (input.relatedEntityId && !input.profileId) ||
      (input.relatedEntityId && !z.uuid().safeParse(input.relatedEntityId).success)
    )
      throw new HttpException('Invalid ticket fields', 400);
    await this.readAs(actor, false, async (client) => {
      if (input.profileId)
        await this.requireOwnedTicketProfile(client, actor.userId, input.profileId as string);
      if (input.relatedEntityId) {
        const table =
          input.relatedEntityType === 'order'
            ? 'orders'
            : input.relatedEntityType === 'contract'
              ? 'contracts'
              : 'invoices';
        const related = await client.query(
          `SELECT id FROM ${table} WHERE id=$1 AND profile_id=$2
           ${table === 'contracts' ? 'AND EXISTS (SELECT 1 FROM contract_publications WHERE contract_id=contracts.id)' : ''}
           FOR SHARE`,
          [input.relatedEntityId, input.profileId]
        );
        if (!related.rows.length)
          throw new HttpException('Related record not found in this profile', 404);
      }
    });
  }

  async assertTicketFormAuthority(
    actor: TicketActor,
    ticketId: string,
    staff: boolean
  ): Promise<void> {
    if (!z.uuid().safeParse(ticketId).success) throw new HttpException('Ticket not found', 404);
    await this.readAs(actor, staff ? 'write' : false, async (client, access) => {
      const current = await client.query(
        'SELECT id FROM tickets WHERE id=$1 AND ($2::text IS NULL OR user_id=$2) AND ($3::text IS NULL OR assigned_to=$3) FOR SHARE',
        [ticketId, staff ? null : actor.userId, access.scope ?? null]
      );
      if (!current.rows.length) throw new HttpException('Ticket not found', 404);
    });
  }

  async createTicket(
    userId: string,
    dto: CreateTicketDto,
    actor?: TicketActor
  ): Promise<TicketRow> {
    const data = await parseTicketFormInput(
      z
        .object({
          idempotencyKey: z.uuid().optional(),
          subject: z.string().trim().min(1).max(200),
          body: z.string().trim().min(1).max(10000),
          category: z.enum(['general', 'billing', 'orders', 'privacy']).default('general'),
          profileId: z.uuid().nullable().optional(),
          relatedEntityType: z.enum(['order', 'contract', 'invoice']).nullable().optional(),
          relatedEntityId: z.string().trim().min(1).max(512).nullable().optional(),
          priority: z.enum(['normal', 'high']).default('normal'),
          attachments: z.array(z.string().min(1).max(512)).max(5).nullable().optional(),
        })
        .strict(),
      dto,
      ['subject', 'body'],
      async (input) => {
        if (!actor) throw new HttpException('Invalid ticket fields', 400);
        await this.assertCanCreateTicket(actor, input);
      },
      'Invalid ticket fields'
    );
    if (
      Boolean(data.relatedEntityType) !== Boolean(data.relatedEntityId) ||
      (data.relatedEntityId && !data.profileId)
    ) {
      throw new HttpException('Related records require their type, identifier and profile', 400);
    }
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const work = async () => {
        const id = randomUUID();
        const assignment = await this.assignmentService.choose(
          client,
          'ticket',
          id,
          userId,
          [data.relatedEntityType ?? 'support'],
          actor ? [userId] : []
        );
        if (actor) await authorizeTicketMutation(client, actor, userId, false);
        if (data.profileId) {
          const profile = await client.query(
            'SELECT id FROM profiles WHERE id=$1 AND user_id=$2 AND archived=false FOR UPDATE',
            [data.profileId, userId]
          );
          if (!profile.rows.length) throw new HttpException('Profile not found', 404);
        }
        if (data.relatedEntityId) {
          if (!z.uuid().safeParse(data.relatedEntityId).success)
            throw new HttpException('Invalid related record identifier', 400);
          const table =
            data.relatedEntityType === 'order'
              ? 'orders'
              : data.relatedEntityType === 'contract'
                ? 'contracts'
                : 'invoices';
          const related = await client.query(
            `SELECT id FROM ${table} WHERE id=$1 AND profile_id=$2
             ${table === 'contracts' ? 'AND EXISTS (SELECT 1 FROM contract_publications WHERE contract_id=contracts.id)' : ''}
             FOR SHARE`,
            [data.relatedEntityId, data.profileId]
          );
          if (!related.rows.length)
            throw new HttpException('Related record not found in this profile', 404);
        }
        const attachments = data.attachments?.length
          ? await this.attachmentService.seal(
              client,
              data.attachments,
              userId,
              data.profileId ?? null
            )
          : [];
        const result = await client.query(
          `INSERT INTO tickets(user_id,subject,body,profile_id,related_entity_type,related_entity_id,priority,status,attachments,id,assigned_to,assigned_team_id,category)
          VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $10::text IS NULL THEN 'open' ELSE 'in_progress' END,$8::jsonb,$9,$10,$11,$12) RETURNING *`,
          [
            userId,
            data.subject,
            data.body,
            data.profileId ?? null,
            data.relatedEntityType ?? null,
            data.relatedEntityId ?? null,
            data.priority,
            JSON.stringify(attachments),
            id,
            assignment?.userId ?? null,
            assignment?.teamId ?? null,
            data.category,
          ]
        );
        const ticket = mapRow(result.rows[0]);
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,'ticket_created',$3::jsonb)`,
          [
            randomUUID(),
            userId,
            JSON.stringify({
              ticketId: ticket.id,
              profileId: ticket.profileId,
              attachmentCount: attachments.length,
              category: ticket.category,
            }),
          ]
        );
        await this.notifyTicket(client, ticket, userId, 'created');
        if (actor) await requireCurrentSession(client, actor);
        return ticket;
      };
      const ticket = data.idempotencyKey
        ? await idempotentMutation(
            client,
            'ticket_create',
            {
              ...data,
              profileId: data.profileId ?? null,
              relatedEntityType: data.relatedEntityType ?? null,
              relatedEntityId: data.relatedEntityId ?? null,
              attachments: data.attachments ?? [],
              idempotencyKey: data.idempotencyKey,
            },
            actor ?? { userId },
            work
          )
        : await work();
      if (data.idempotencyKey) {
        // Replay must retain current authority without choosing or sealing a second time.
        if (actor) await authorizeTicketMutation(client, actor, userId, false);
        if (data.profileId) await this.requireOwnedTicketProfile(client, userId, data.profileId);
        if (actor) await requireCurrentSession(client, actor);
      }
      await client.query('COMMIT');
      return ticket;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * List tickets for a user with pagination, search, and status filter.
   *
   * Customers see only their own tickets. Results are ordered by
   * updated_at descending by default.
   */
  async listTickets(
    userId: string,
    options: Partial<ListTicketsOptions> = {},
    client?: PoolClient
  ): Promise<PaginatedResult<TicketRow>> {
    const pool = client ?? getDbPool();
    const { page, limit, offset } = ticketPagination(options.page, options.limit);

    // Build WHERE clause
    const conditions: string[] = ['t.user_id = $1'];
    const params: unknown[] = [userId];
    let paramIndex = 2;

    if (options.profileId) {
      conditions.push(`t.profile_id = $${paramIndex}`);
      params.push(options.profileId);
      paramIndex++;
    }

    if (options.status) {
      if (options.status === 'active') {
        conditions.push("t.status IN ('open','in_progress','waiting_customer','waiting_staff')");
      } else {
        const validStatuses = [
          'open',
          'in_progress',
          'waiting_customer',
          'waiting_staff',
          'resolved',
          'closed',
        ];
        if (!validStatuses.includes(options.status)) {
          throw new HttpException(
            {
              statusCode: 400,
              error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
              message: `Invalid status filter: ${options.status}. Allowed: ${validStatuses.join(', ')}`,
            },
            400
          );
        }
        conditions.push(`t.status = $${paramIndex}`);
        params.push(options.status);
        paramIndex++;
      }
    }

    if (options.search?.trim()) {
      conditions.push(`(t.subject ILIKE $${paramIndex} OR t.body ILIKE $${paramIndex})`);
      params.push(`%${options.search.trim()}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Validate sort column (whitelist to prevent injection)
    const allowedSortColumns = ['created_at', 'updated_at', 'subject', 'status', 'priority'];
    const sortBy = allowedSortColumns.includes(options.sortBy ?? '')
      ? options.sortBy!
      : 'updated_at';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM tickets t WHERE ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]!.total);

    // Fetch page
    const dataResult = await pool.query(
      `SELECT t.* FROM tickets t WHERE ${whereClause}
       ORDER BY t.${sortBy} ${sortOrder}, t.id ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const data = await withRelatedTicketRecords(dataResult.rows.map(mapRow), pool);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single ticket by ID, scoped to the authenticated user.
   */
  async getTicket(ticketId: string, userId: string, client?: PoolClient): Promise<TicketRow> {
    const pool = client ?? getDbPool();

    const result = await pool.query(
      `SELECT * FROM tickets WHERE id = $1 AND user_id = $2${client ? ' FOR SHARE' : ''}`,
      [ticketId, userId]
    );

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Ticket not found' },
        404
      );
    }

    const ticket = mapRow(result.rows[0]!);
    return {
      ...(await withRelatedTicketRecords([ticket], pool))[0]!,
      ...(await this.initialAttachmentFiles(ticket, pool)),
    };
  }

  /**
   * Update the status of a ticket. The user must own the ticket.
   * Validates that the new status is a known status value.
   */
  async updateTicketStatus(
    ticketId: string,
    userId: string,
    status: string,
    isAdmin: boolean = false,
    actor?: TicketActor,
    idempotencyKey?: string
  ): Promise<TicketRow> {
    if (!isAdmin && status !== 'open') {
      if (
        !['in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed'].includes(status)
      ) {
        throw new HttpException('Invalid status', 400);
      }
      throw new HttpException('Only staff can change ticket status', 403);
    }
    return this.changeStatus(
      ticketId,
      status,
      userId,
      userId,
      undefined,
      actor,
      undefined,
      idempotencyKey
    );
  }

  private async changeStatus(
    ticketId: string,
    status: string,
    actorId: string,
    ownerId?: string,
    assignedTo?: string,
    actor?: TicketActor,
    reason?: string,
    idempotencyKey?: string
  ): Promise<TicketRow> {
    if (
      reason !== undefined &&
      (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000)
    )
      throw new HttpException('Status reason must be 1 to 2,000 characters', 400);
    const transitions: Record<string, string[]> = {
      open: ['in_progress'],
      in_progress: ['waiting_customer', 'waiting_staff', 'resolved'],
      waiting_customer: ['in_progress'],
      waiting_staff: ['in_progress'],
      resolved: ['closed'],
      closed: [],
    };
    if (!Object.hasOwn(transitions, status)) throw new HttpException('Invalid status', 400);
    const key = optionalTicketCommandKey(idempotencyKey);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      if (actor) assignedTo = await authorizeTicketMutation(client, actor, actorId, !ownerId);
      const row = (
        await client.query(
          `SELECT * FROM tickets WHERE id=$1
        AND ($2::text IS NULL OR user_id=$2) AND ($3::text IS NULL OR assigned_to=$3) FOR UPDATE`,
          [ticketId, ownerId ?? null, assignedTo ?? null]
        )
      ).rows[0];
      if (!row) throw new HttpException('Ticket not found', 404);
      const work = async () => {
        if (row.privacy_closure_completed_at && row.status !== status)
          throw new HttpException('Completed closure requests cannot be reopened', 409);
        if (row.status === status) {
          if (actor) await requireCurrentSession(client, actor);
          return mapRow(row);
        }
        if (
          status !== 'open' &&
          (!transitions[row.status]?.includes(status) ||
            (status === 'in_progress' && !row.assigned_to))
        ) {
          throw new HttpException('Invalid ticket status transition', 409);
        }
        const result = await client.query(
          'UPDATE tickets SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',
          [status, ticketId]
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,'ticket_status_changed',$3::jsonb)`,
          [
            randomUUID(),
            actorId,
            JSON.stringify({
              ticketId,
              from: row.status,
              to: status,
              ...(reason !== undefined ? { reason: reason.trim() } : {}),
            }),
          ]
        );
        await this.notifyTicket(client, mapRow(result.rows[0]), actorId, 'status');
        if (actor) await requireCurrentSession(client, actor);
        return mapRow(result.rows[0]);
      };
      const result = key
        ? await idempotentMutation(
            client,
            ownerId ? 'ticket_customer_status' : 'ticket_staff_status',
            {
              ticketId,
              status,
              ...(reason === undefined ? {} : { reason: reason.trim() }),
              idempotencyKey: key,
            },
            actor ?? { userId: actorId },
            work
          )
        : await work();
      if (key && actor) await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * List comments on a ticket. The user must own the ticket.
   * Customers see only 'public' comments. Staff see all comments.
   */
  async listComments(
    ticketId: string,
    userId: string,
    isAdmin: boolean = false,
    client?: PoolClient
  ): Promise<TicketCommentRow[]> {
    // Verify the ticket exists and belongs to the user
    await this.getTicket(ticketId, userId, client);

    const pool = client ?? getDbPool();

    let result;
    if (isAdmin) {
      result = await pool.query(
        `SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC, id ASC`,
        [ticketId]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM ticket_comments WHERE ticket_id = $1 AND visibility = 'public' ORDER BY created_at ASC, id ASC`,
        [ticketId]
      );
    }

    return this.commentRecords(result.rows, pool);
  }

  /**
   * Add a comment to a ticket. The user must own the ticket.
   * Customers can only add public comments. Staff can add internal notes.
   */
  async addComment(
    ticketId: string,
    userId: string,
    body: string,
    visibility: 'public' | 'internal' = 'public',
    isAdmin: boolean = false,
    actor?: TicketActor,
    options: TicketReplyOptions = {}
  ): Promise<TicketCommentRow> {
    if (!isAdmin && visibility !== 'public')
      throw new HttpException('Only staff can add internal notes', 403);
    return this.insertComment(
      ticketId,
      userId,
      body,
      visibility,
      userId,
      undefined,
      actor,
      options
    );
  }

  async ticketAttachmentPreview(
    ticketId: string,
    commentId: string | null,
    fileIndex: number,
    userId: string,
    staff: boolean,
    assignedTo: string | undefined,
    client: PoolClient
  ): Promise<Buffer> {
    if (!Number.isSafeInteger(fileIndex) || fileIndex < 0 || fileIndex > 4)
      throw new BadRequestException('Invalid attachment index');
    const ticket = staff
      ? await this.staffGetTicket(ticketId, assignedTo, client)
      : await this.getTicket(ticketId, userId, client);
    const comment = commentId
      ? (
          await client.query(
            `SELECT attachments FROM ticket_comments WHERE id=$1 AND ticket_id=$2
       AND ($3::boolean OR visibility='public') FOR SHARE`,
            [commentId, ticketId, staff]
          )
        ).rows[0]
      : ticket;
    const purpose = commentId ? 'ticket_reply_attachment' : 'ticket_attachment';
    const prefix = commentId ? 'ticket-reply-attachments/' : 'ticket-attachments/';
    const key: unknown = Array.isArray(comment?.attachments)
      ? comment.attachments[fileIndex]
      : null;
    if (typeof key !== 'string' || !key.startsWith(prefix))
      throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    const record = (
      await client.query(
        `SELECT content_type FROM storage_records WHERE storage_key=$1 AND status='immutable'
       AND metadata->>'purpose'=$3 AND ($3='ticket_attachment' OR metadata->>'ticketId'=$2) FOR SHARE`,
        [key, ticketId, purpose]
      )
    ).rows[0];
    if (!record) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    try {
      const previewKey = await ensureDocumentPreview(
        this.exportStorage,
        `${commentId ? 'ticket-comment' : 'ticket-root'}-${commentId ?? ticketId}-${fileIndex}`,
        key,
        record.content_type as string
      );
      return await readPreviewObject(this.exportStorage, previewKey, 5 * 1024 * 1024);
    } catch {
      throw new ServiceUnavailableException('Attachment preview is unavailable');
    }
  }

  private async initialAttachmentFiles(ticket: TicketRow, client: Pick<PoolClient, 'query'>) {
    const keys = ticket.attachments.filter(
      (key) => typeof key === 'string' && key.startsWith('ticket-attachments/')
    );
    const records = keys.length
      ? (
          await client.query(
            `SELECT storage_key,file_name,content_type FROM storage_records WHERE storage_key=ANY($1::text[])
       AND status='immutable' AND metadata->>'purpose'='ticket_attachment'`,
            [keys]
          )
        ).rows
      : [];
    const details = new Map(records.map((row) => [row.storage_key, row]));
    const available = keys.filter((key) => details.has(key));
    const urls = await this.attachmentService.downloadUrls(available);
    const links = new Map(available.map((key, index) => [key, urls[index]]));
    return {
      attachmentDownloadUrls: urls,
      attachmentFiles: ticket.attachments.flatMap((key, fileIndex) => {
        const record = details.get(key),
          url = links.get(key);
        return record && url
          ? [
              {
                key,
                fileName: record.file_name as string,
                contentType: record.content_type as string,
                url,
                fileIndex,
              },
            ]
          : [];
      }),
    };
  }

  private async commentRecords(
    rows: Record<string, unknown>[],
    client: Pick<PoolClient, 'query'>
  ): Promise<TicketCommentRow[]> {
    // These rows have already passed ticket authorization and visibility filtering.
    // Project only explicitly shared identity, never login/contact columns.
    const identities = rows.length
      ? (
          await client.query(
            `SELECT i.user_id,i.display_name,s.storage_key AS avatar_key FROM conversation_identities i
       JOIN users u ON u.user_id=i.user_id AND u.disabled_at IS NULL AND u.activation_token IS NULL
       LEFT JOIN storage_records s ON s.storage_key=i.avatar_key AND s.status='immutable'
       AND s.metadata->>'purpose'='conversation_avatar' AND s.metadata->>'uploadedBy'=i.user_id
       WHERE i.user_id=ANY($1::text[])`,
            [[...new Set(rows.map((row) => row.author_id))]]
          )
        ).rows
      : [];
    const avatarRows = identities.filter(
      (identity) =>
        typeof identity.avatar_key === 'string' &&
        identity.avatar_key.startsWith('conversation-avatars/')
    );
    const avatarUrls = await this.attachmentService.downloadUrls(
      avatarRows.map((identity) => identity.avatar_key as string),
      'conversation_avatar'
    );
    const avatars = new Map(
      avatarRows.map((identity, index) => [identity.user_id, avatarUrls[index] ?? null])
    );
    const authors = new Map(
      identities.map((identity) => [
        identity.user_id,
        {
          displayName: identity.display_name as string | null,
          avatarUrl: avatars.get(identity.user_id) ?? null,
        },
      ])
    );
    const keys = rows.flatMap((row) =>
      Array.isArray(row.attachments)
        ? row.attachments.filter(
            (key): key is string =>
              typeof key === 'string' && key.startsWith('ticket-reply-attachments/')
          )
        : []
    );
    const files = keys.length
      ? (
          await client.query(
            `SELECT storage_key,file_name,content_type FROM storage_records WHERE storage_key=ANY($1::text[]) AND status='immutable' AND metadata->>'purpose'='ticket_reply_attachment' AND metadata->>'ticketId'=ANY($2::text[])`,
            [keys, rows.map((row) => row.ticket_id)]
          )
        ).rows
      : [];
    const urls = await this.attachmentService.downloadUrls(
      files.map((file) => file.storage_key as string),
      'ticket_reply_attachment'
    );
    const details = new Map(
      files.map((file, index) => [
        file.storage_key,
        {
          key: file.storage_key as string,
          fileName: file.file_name as string,
          contentType: file.content_type as string,
          url: urls[index],
        },
      ])
    );
    return rows.map((row) => ({
      ...mapCommentRow(row),
      author: authors.get(row.author_id) ?? null,
      attachments: (Array.isArray(row.attachments) ? row.attachments : []).flatMap(
        (key, fileIndex) => {
          const file = details.get(key);
          return file?.url
            ? [{ ...file, fileIndex } as TicketCommentRow['attachments'][number]]
            : [];
        }
      ),
    }));
  }

  private async insertComment(
    ticketId: string,
    actorId: string,
    body: string,
    visibility: string,
    ownerId?: string,
    assignedTo?: string,
    actor?: TicketActor,
    options: TicketReplyOptions = {}
  ): Promise<TicketCommentRow> {
    const input = ticketReply({ body, visibility, ...options });
    const bodyFormat = input.bodyFormat ?? 'plain';
    const attachmentKeys = input.attachments ?? [];
    const authorContext = ownerId ? 'customer' : 'staff';
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          body: input.body.trim(),
          visibility: input.visibility ?? 'public',
          bodyFormat,
          attachmentKeys,
          authorContext,
        })
      )
      .digest('hex');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      if (actor) assignedTo = await authorizeTicketMutation(client, actor, actorId, !ownerId);
      const ticket = (
        await client.query(
          `SELECT * FROM tickets WHERE id=$1 AND ($2::text IS NULL OR user_id=$2)
         AND ($3::text IS NULL OR assigned_to=$3) FOR UPDATE`,
          [ticketId, ownerId ?? null, assignedTo ?? null]
        )
      ).rows[0];
      if (!ticket) throw new HttpException('Ticket not found', 404);
      if (input.submissionId) {
        const prior = (
          await client.query(
            'SELECT * FROM ticket_comments WHERE ticket_id=$1 AND author_id=$2 AND submission_id=$3',
            [ticketId, actorId, input.submissionId]
          )
        ).rows[0];
        if (prior) {
          if (prior.submission_hash !== hash)
            throw new HttpException(
              'This reply submission was already used for different content',
              409
            );
          const records = await this.commentRecords([prior], client);
          if (actor) await requireCurrentSession(client, actor);
          await client.query('COMMIT');
          return records[0]!;
        }
      }
      if (ticket.status === 'closed' || ticket.status === 'resolved')
        throw new HttpException('Reopen the ticket before replying', 409);
      const sealed = attachmentKeys.length
        ? await this.attachmentService.seal(
            client,
            attachmentKeys,
            actorId,
            ticket.profile_id ?? null,
            'ticket_reply_attachment',
            ticketId
          )
        : [];
      const result = await client.query(
        `INSERT INTO ticket_comments(ticket_id,author_id,body,visibility,body_format,author_context,attachments,submission_id,submission_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
        [
          ticketId,
          actorId,
          input.body.trim(),
          visibility,
          bodyFormat,
          authorContext,
          JSON.stringify(sealed),
          input.submissionId ?? null,
          input.submissionId ? hash : null,
        ]
      );
      const status =
        ownerId && visibility === 'public' && ticket.status === 'waiting_customer'
          ? 'in_progress'
          : ticket.status;
      await client.query('UPDATE tickets SET status=$1,updated_at=NOW() WHERE id=$2', [
        status,
        ticketId,
      ]);
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,'ticket_comment_added',$3::jsonb)`,
        [
          randomUUID(),
          actorId,
          JSON.stringify({
            ticketId,
            commentId: result.rows[0].id,
            visibility,
            attachmentCount: sealed.length,
            from: ticket.status,
            to: status,
          }),
        ]
      );
      await this.notifyTicket(
        client,
        mapRow({ ...ticket, status }),
        actorId,
        visibility === 'internal' ? 'internal' : 'reply',
        result.rows[0].id
      );
      if (actor) await requireCurrentSession(client, actor);
      const records = await this.commentRecords(result.rows, client);
      await client.query('COMMIT');
      return records[0]!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  Staff methods (T-06.01.03)
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * Staff list all tickets with pagination, filters, and search.
   * Unlike the user-scoped listTickets, this returns tickets across all users.
   * Supports additional filter: assignedTo (staff user ID).
   */
  async staffListTickets(
    options: Partial<ListTicketsOptions & { assignedTo?: string }> = {},
    client?: PoolClient
  ): Promise<PaginatedResult<TicketRow>> {
    const pool = client ?? getDbPool();
    const { page, limit, offset } = ticketPagination(options.page, options.limit);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.status) {
      const validStatuses = [
        'active',
        'open',
        'in_progress',
        'waiting_customer',
        'waiting_staff',
        'resolved',
        'closed',
      ];
      if (!validStatuses.includes(options.status)) {
        throw new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: `Invalid status filter: ${options.status}. Allowed: ${validStatuses.join(', ')}`,
          },
          400
        );
      }
      if (options.status === 'active') {
        conditions.push("t.status IN ('open','in_progress','waiting_customer','waiting_staff')");
      } else {
        conditions.push(`t.status = $${paramIndex}`);
        params.push(options.status);
        paramIndex++;
      }
    }

    if (options.search?.trim()) {
      conditions.push(`(t.subject ILIKE $${paramIndex} OR t.body ILIKE $${paramIndex})`);
      params.push(`%${options.search.trim()}%`);
      paramIndex++;
    }

    if (options.assignedTo) {
      conditions.push(`t.assigned_to = $${paramIndex}`);
      params.push(options.assignedTo);
      paramIndex++;
    }

    // If no conditions, select all tickets
    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';

    // Validate sort column (whitelist to prevent injection)
    const allowedSortColumns = ['created_at', 'updated_at', 'subject', 'status', 'priority'];
    const sortBy = allowedSortColumns.includes(options.sortBy ?? '')
      ? options.sortBy!
      : 'updated_at';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM tickets t WHERE ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]!.total);

    // Fetch page
    const dataResult = await pool.query(
      `SELECT t.* FROM tickets t WHERE ${whereClause}
       ORDER BY t.${sortBy} ${sortOrder}, t.id ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const data = await withRelatedTicketRecords(dataResult.rows.map(mapRow), pool);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Staff get any ticket by ID (no user_id scoping).
   */
  async staffGetTicket(
    ticketId: string,
    assignedTo?: string,
    client?: PoolClient
  ): Promise<TicketRow & { customer: TicketCustomer }> {
    const pool = client ?? getDbPool();

    const result = await pool.query(
      `SELECT t.*,u.username AS customer_username,u.email AS customer_email,u.mobile AS customer_mobile,
       p.id AS customer_profile_id,
       COALESCE(NULLIF(p.title,''),CASE WHEN p.profile_type='LEGAL' THEN lp.legal_name
         ELSE NULLIF(CONCAT_WS(' ',p.first_name,p.last_name),'') END) AS customer_profile_title
       FROM tickets t JOIN users u ON u.user_id=t.user_id
       LEFT JOIN profiles p ON p.id=t.profile_id AND p.user_id=t.user_id AND NOT p.archived
       LEFT JOIN legal_profiles lp ON lp.id=p.id
       WHERE t.id=$1 AND ($2::text IS NULL OR t.assigned_to=$2)${client ? ' FOR SHARE OF t' : ''}`,
      [ticketId, assignedTo ?? null]
    );

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Ticket not found' },
        404
      );
    }

    const ticket = mapRow(result.rows[0]!);
    return {
      ...(await withRelatedTicketRecords([ticket], pool))[0]!,
      customer: {
        userId: ticket.userId,
        username: result.rows[0].customer_username as string,
        email: result.rows[0].customer_email ?? null,
        mobile: result.rows[0].customer_mobile ?? null,
        profile: result.rows[0].customer_profile_id
          ? {
              id: result.rows[0].customer_profile_id as string,
              title: result.rows[0].customer_profile_title ?? null,
            }
          : null,
      },
      ...(await this.initialAttachmentFiles(ticket, pool)),
    };
  }

  /**
   * Staff assign a ticket to themselves (or another staff member).
   * Validates the target user exists and has staff role.
   */
  async staffAssignTicket(
    ticketId: string,
    assigneeUserId: string,
    actorId: string,
    assignedTo?: string,
    teamId?: string,
    actor?: TicketActor,
    idempotencyKey?: string
  ): Promise<TicketRow> {
    if (
      typeof assigneeUserId !== 'string' ||
      !assigneeUserId.trim() ||
      assigneeUserId.length > 512
    ) {
      throw new HttpException('Invalid assignee', 400);
    }
    if (teamId && !z.uuid().safeParse(teamId).success) throw new HttpException('Invalid team', 400);
    const key = optionalTicketCommandKey(idempotencyKey);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const work = async () => {
        if (teamId) {
          const team = await client.query(
            'SELECT id FROM staff_teams WHERE id=$1 AND is_active FOR SHARE',
            [teamId]
          );
          if (!team.rows.length) throw new HttpException('Active team not found', 404);
          const member = await client.query(
            'SELECT id FROM staff_team_members WHERE team_id=$1 AND user_id=$2',
            [teamId, assigneeUserId]
          );
          if (!member.rows.length)
            throw new HttpException('Assignee is not a member of this team', 409);
        }
        if (actor) {
          assignedTo = await authorizeTicketMutation(client, actor, actorId, true, assigneeUserId);
          if (assignedTo && (assigneeUserId !== assignedTo || teamId))
            throw new HttpException('Assigned-only staff cannot reassign another user', 403);
        }
        // Lock the account before the ticket, matching staff account changes.
        const account = (
          await client.query(
            `SELECT u.is_admin, u.disabled_at, u.activation_token
          FROM users u WHERE u.user_id=$1 FOR NO KEY UPDATE OF u`,
            [assigneeUserId]
          )
        ).rows[0];
        const roles = await client.query(
          `SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id
           WHERE ur.user_id=$1 ORDER BY r.role_id FOR SHARE OF ur,r`,
          [assigneeUserId]
        );
        const permissions = resolveStaffPermissions(roles.rows.map((row) => row.permissions));
        if (
          !account ||
          account.disabled_at ||
          account.activation_token ||
          !(
            account.is_admin ||
            permissions.includes('*') ||
            permissions.includes('tickets:write') ||
            permissions.includes('tickets:*') ||
            permissions.includes('tickets:assigned')
          )
        ) {
          throw new HttpException('Assignee must be active staff with ticket access', 400);
        }
        const result = await client.query(
          `UPDATE tickets SET assigned_to=$1,assigned_team_id=$4,
          status=CASE WHEN status='open' THEN 'in_progress' ELSE status END, updated_at=NOW()
          WHERE id=$2 AND ($3::text IS NULL OR assigned_to=$3) RETURNING *`,
          [assigneeUserId, ticketId, assignedTo ?? null, teamId ?? null]
        );
        if (!result.rows[0]) throw new HttpException('Ticket not found', 404);
        const assignmentId = randomUUID();
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata)
          VALUES ($1,$2,'ticket_assigned',$3::jsonb)`,
          [
            assignmentId,
            actorId,
            JSON.stringify({
              ticketId,
              assigneeUserId,
              teamId: teamId ?? null,
              status: result.rows[0].status,
            }),
          ]
        );
        await this.notifyTicket(client, mapRow(result.rows[0]), actorId, 'assigned', assignmentId);
        if (actor) await requireCurrentSession(client, actor);
        return mapRow(result.rows[0]);
      };
      const ticket = key
        ? await idempotentMutation(
            client,
            'ticket_assignment',
            { ticketId, assigneeUserId, teamId: teamId ?? null, idempotencyKey: key },
            actor ?? { userId: actorId },
            work
          )
        : await work();
      if (key) {
        // Team and target eligibility belong to the original attempt; live access does not.
        const scope = actor
          ? await authorizeTicketMutation(client, actor, actorId, true, assigneeUserId)
          : assignedTo;
        if (scope && (assigneeUserId !== scope || teamId))
          throw new HttpException('Assigned-only staff cannot reassign another user', 403);
        const current = await client.query(
          'SELECT id FROM tickets WHERE id=$1 AND ($2::text IS NULL OR assigned_to=$2) FOR UPDATE',
          [ticketId, scope ?? null]
        );
        if (!current.rows.length) throw new HttpException('Ticket not found', 404);
        if (actor) await requireCurrentSession(client, actor);
      }
      await client.query('COMMIT');
      return ticket;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Staff update the status of any ticket (no user_id scoping).
   * Staff can also reopen tickets.
   */
  async staffUpdateTicketStatus(
    ticketId: string,
    status: string,
    actorId: string,
    assignedTo?: string,
    actor?: TicketActor,
    reason?: string,
    idempotencyKey?: string
  ): Promise<TicketRow> {
    return this.changeStatus(
      ticketId,
      status,
      actorId,
      undefined,
      assignedTo,
      actor,
      reason,
      idempotencyKey
    );
  }

  /**
   * Staff list comments on any ticket (all visibility levels).
   * No user_id scoping — staff can see all comments including internal.
   */
  async staffListComments(
    ticketId: string,
    assignedTo?: string,
    client?: PoolClient
  ): Promise<TicketCommentRow[]> {
    // Verify the ticket exists
    await this.staffGetTicket(ticketId, assignedTo, client);

    const pool = client ?? getDbPool();

    const result = await pool.query(
      `SELECT * FROM ticket_comments WHERE ticket_id = $1 AND EXISTS (SELECT 1 FROM tickets t WHERE t.id=ticket_id AND ($2::text IS NULL OR t.assigned_to=$2)) ORDER BY created_at ASC, id ASC`,
      [ticketId, assignedTo ?? null]
    );

    return this.commentRecords(result.rows, pool);
  }

  /**
   * Staff add a comment to any ticket (public or internal).
   * No user_id scoping — staff can comment on any ticket.
   */
  async staffAddComment(
    ticketId: string,
    staffUserId: string,
    body: string,
    visibility: 'public' | 'internal' = 'public',
    assignedTo?: string,
    actor?: TicketActor,
    options: TicketReplyOptions = {}
  ): Promise<TicketCommentRow> {
    return this.insertComment(
      ticketId,
      staffUserId,
      body,
      visibility,
      undefined,
      assignedTo,
      actor,
      options
    );
  }
}
