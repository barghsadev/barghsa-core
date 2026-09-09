import { ticketPagination } from './ticket-input.js';
import {
  authorizeTicketAccess,
  authorizeTicketMutation,
  type TicketActor,
  type TicketAccess,
} from './ticket-actor.js';
import { requireCurrentSession } from '../session/session-step-up.js';
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
import { randomUUID } from 'node:crypto';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';

export interface TicketRow {
  id: string;
  userId: string;
  subject: string;
  body: string;
  category: 'general' | 'billing' | 'orders';
  profileId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  priority: 'normal' | 'high';
  status: 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed';
  attachments: string[];
  attachmentDownloadUrls?: string[];
  assignedTeamId: string | null;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTicketDto {
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

export interface TicketCommentRow {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  visibility: 'public' | 'internal';
  createdAt: Date;
  updatedAt: Date;
}

export interface ListTicketsOptions {
  status?: string;
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

function mapRow(row: Record<string, unknown>): TicketRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    subject: row.subject as string,
    body: row.body as string,
    category: (row.category as TicketRow['category']) ?? 'general',
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
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly attachmentService: TicketAttachmentsService = new TicketAttachmentsService(),
    private readonly notifications: NotificationsService = new NotificationsService(),
    private readonly assignmentService: StaffAssignmentService = new StaffAssignmentService()
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
    event: 'created' | 'status' | 'reply' | 'internal' | 'assigned'
  ) {
    const recipients = new Map<string, boolean>();
    if (event !== 'internal' && ticket.userId !== actorId) recipients.set(ticket.userId, false);
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
        recipients.set(ticket.assignedTo, true);
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
          recipients.set(user.user_id, true);
      }
    }
    for (const [userId, staff] of recipients) {
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
      await this.notifications.create(
        {
          userId,
          type: 'general',
          title: localizedContent.en.title,
          body: localizedContent.en.body,
          localizedContent,
          link: `${staff ? '/admin' : ''}/tickets?ticketId=${ticket.id}`,
        },
        client
      );
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

  /**
   * Create a new support ticket.
   *
   * Validates required fields, checks profile ownership when provided,
   * and creates the ticket record. Attachments (storage keys) are stored
   * as a JSON array on the ticket for later linking.
   */
  async createTicket(
    userId: string,
    dto: CreateTicketDto,
    actor?: TicketActor
  ): Promise<TicketRow> {
    const parsed = z
      .object({
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(10000),
        category: z.enum(['general', 'billing', 'orders']).default('general'),
        profileId: z.uuid().nullable().optional(),
        relatedEntityType: z.enum(['order', 'contract', 'invoice']).nullable().optional(),
        relatedEntityId: z.string().trim().min(1).max(512).nullable().optional(),
        priority: z.enum(['normal', 'high']).default('normal'),
        attachments: z.array(z.string().min(1).max(512)).max(5).nullable().optional(),
      })
      .strict()
      .safeParse(dto);
    if (!parsed.success) throw new HttpException('Invalid ticket fields', 400);
    const data = parsed.data;
    if (
      Boolean(data.relatedEntityType) !== Boolean(data.relatedEntityId) ||
      (data.relatedEntityId && !data.profileId)
    ) {
      throw new HttpException('Related records require their type, identifier and profile', 400);
    }
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      if (data.profileId) {
        const profile = await client.query(
          'SELECT id FROM profiles WHERE id=$1 AND user_id=$2 AND archived=false FOR UPDATE',
          [data.profileId, userId]
        );
        if (!profile.rows.length) throw new HttpException('Profile not found', 404);
      }
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
      if (data.relatedEntityId) {
        // Contracts are not implemented in this schema. Never accept unverifiable links.
        if (data.relatedEntityType === 'contract')
          throw new HttpException('Contract linking is unavailable', 409);
        if (!z.uuid().safeParse(data.relatedEntityId).success)
          throw new HttpException('Invalid related record identifier', 400);
        const table = data.relatedEntityType === 'order' ? 'orders' : 'invoices';
        const related = await client.query(
          `SELECT id FROM ${table} WHERE id=$1 AND profile_id=$2 FOR SHARE`,
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

    if (options.status) {
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

    const data = dataResult.rows.map(mapRow);

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
      ...ticket,
      attachmentDownloadUrls: await this.attachmentService.downloadUrls(ticket.attachments),
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
    actor?: TicketActor
  ): Promise<TicketRow> {
    if (!isAdmin && status !== 'open') {
      if (
        !['in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed'].includes(status)
      ) {
        throw new HttpException('Invalid status', 400);
      }
      throw new HttpException('Only staff can change ticket status', 403);
    }
    return this.changeStatus(ticketId, status, userId, userId, undefined, actor);
  }

  private async changeStatus(
    ticketId: string,
    status: string,
    actorId: string,
    ownerId?: string,
    assignedTo?: string,
    actor?: TicketActor
  ): Promise<TicketRow> {
    const transitions: Record<string, string[]> = {
      open: ['in_progress'],
      in_progress: ['waiting_customer', 'waiting_staff', 'resolved'],
      waiting_customer: ['in_progress'],
      waiting_staff: ['in_progress'],
      resolved: ['closed'],
      closed: [],
    };
    if (!Object.hasOwn(transitions, status)) throw new HttpException('Invalid status', 400);
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
      if (row.status === status) {
        if (actor) await requireCurrentSession(client, actor);
        await client.query('COMMIT');
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
        [randomUUID(), actorId, JSON.stringify({ ticketId, from: row.status, to: status })]
      );
      await this.notifyTicket(client, mapRow(result.rows[0]), actorId, 'status');
      if (actor) await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return mapRow(result.rows[0]);
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

    return result.rows.map(mapCommentRow);
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
    actor?: TicketActor
  ): Promise<TicketCommentRow> {
    if (!isAdmin && visibility !== 'public')
      throw new HttpException('Only staff can add internal notes', 403);
    return this.insertComment(ticketId, userId, body, visibility, userId, undefined, actor);
  }

  private async insertComment(
    ticketId: string,
    actorId: string,
    body: string,
    visibility: string,
    ownerId?: string,
    assignedTo?: string,
    actor?: TicketActor
  ): Promise<TicketCommentRow> {
    if (typeof body !== 'string' || !body.trim())
      throw new HttpException('Comment body is required', 400);
    if (body.trim().length > 10000)
      throw new HttpException('Comment body must be 10,000 characters or fewer', 400);
    if (visibility !== 'public' && visibility !== 'internal')
      throw new HttpException('Invalid comment visibility', 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      if (actor) assignedTo = await authorizeTicketMutation(client, actor, actorId, !ownerId);
      const ticket = (
        await client.query(
          `SELECT * FROM tickets WHERE id=$1
        AND ($2::text IS NULL OR user_id=$2) AND ($3::text IS NULL OR assigned_to=$3) FOR UPDATE`,
          [ticketId, ownerId ?? null, assignedTo ?? null]
        )
      ).rows[0];
      if (!ticket) throw new HttpException('Ticket not found', 404);
      if (ticket.status === 'closed' || ticket.status === 'resolved')
        throw new HttpException('Reopen the ticket before replying', 409);
      const result = await client.query(
        `INSERT INTO ticket_comments(ticket_id,author_id,body,visibility)
        VALUES ($1,$2,$3,$4) RETURNING *`,
        [ticketId, actorId, body.trim(), visibility]
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
            from: ticket.status,
            to: status,
          }),
        ]
      );
      await this.notifyTicket(
        client,
        mapRow({ ...ticket, status }),
        actorId,
        visibility === 'internal' ? 'internal' : 'reply'
      );
      if (actor) await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return mapCommentRow(result.rows[0]);
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

    const data = dataResult.rows.map(mapRow);

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
  ): Promise<TicketRow> {
    const pool = client ?? getDbPool();

    const result = await pool.query(
      `SELECT * FROM tickets WHERE id = $1 AND ($2::text IS NULL OR assigned_to=$2)${client ? ' FOR SHARE' : ''}`,
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
      ...ticket,
      attachmentDownloadUrls: await this.attachmentService.downloadUrls(ticket.attachments),
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
    actor?: TicketActor
  ): Promise<TicketRow> {
    if (
      typeof assigneeUserId !== 'string' ||
      !assigneeUserId.trim() ||
      assigneeUserId.length > 512
    ) {
      throw new HttpException('Invalid assignee', 400);
    }
    if (teamId && !z.uuid().safeParse(teamId).success) throw new HttpException('Invalid team', 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
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
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata)
        VALUES ($1,$2,'ticket_assigned',$3::jsonb)`,
        [
          randomUUID(),
          actorId,
          JSON.stringify({
            ticketId,
            assigneeUserId,
            teamId: teamId ?? null,
            status: result.rows[0].status,
          }),
        ]
      );
      await this.notifyTicket(client, mapRow(result.rows[0]), actorId, 'assigned');
      if (actor) await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return mapRow(result.rows[0]);
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
    actor?: TicketActor
  ): Promise<TicketRow> {
    return this.changeStatus(ticketId, status, actorId, undefined, assignedTo, actor);
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

    return result.rows.map(mapCommentRow);
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
    actor?: TicketActor
  ): Promise<TicketCommentRow> {
    return this.insertComment(
      ticketId,
      staffUserId,
      body,
      visibility,
      undefined,
      assignedTo,
      actor
    );
  }
}
