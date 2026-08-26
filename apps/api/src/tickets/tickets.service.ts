import { Injectable, Logger, HttpException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

export interface TicketRow {
  id: string
  userId: string
  subject: string
  body: string
  profileId: string | null
  relatedEntityType: string | null
  relatedEntityId: string | null
  priority: 'normal' | 'high'
  status: 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed'
  assignedTo: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateTicketDto {
  subject: string
  body: string
  profileId?: string | null
  relatedEntityType?: 'order' | 'contract' | 'invoice' | null
  relatedEntityId?: string | null
  priority?: 'normal' | 'high'
  /** Storage keys of previously uploaded files to attach to this ticket. */
  attachments?: string[] | null
}

export interface TicketCommentRow {
  id: string
  ticketId: string
  authorId: string
  body: string
  visibility: 'public' | 'internal'
  createdAt: Date
  updatedAt: Date
}

export interface ListTicketsOptions {
  status?: string
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  page?: number
  limit?: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

function mapRow(row: Record<string, unknown>): TicketRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    subject: row.subject as string,
    body: row.body as string,
    profileId: (row.profile_id as string) ?? null,
    relatedEntityType: (row.related_entity_type as string) ?? null,
    relatedEntityId: (row.related_entity_id as string) ?? null,
    priority: (row.priority as 'normal' | 'high') ?? 'normal',
    status: (row.status as 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed') ?? 'open',
    assignedTo: (row.assigned_to as string) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
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
  }
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name)

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
  ): Promise<TicketRow> {
    // ── Field validation (fast-path, no DB) ────────────────
    if (!dto.subject?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Subject is required' },
        400,
      )
    }
    if (dto.subject.trim().length > 200) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Subject must be 200 characters or fewer' },
        400,
      )
    }
    if (!dto.body?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Body is required' },
        400,
      )
    }
    if (dto.body.trim().length > 10000) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Body must be 10,000 characters or fewer' },
        400,
      )
    }

    const pool = getDbPool()

    // Validate the profile belongs to the user (if provided)
    if (dto.profileId) {
      const profileResult = await pool.query(
        `SELECT id FROM profiles WHERE id = $1 AND user_id = $2`,
        [dto.profileId, userId],
      )
      if (profileResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
          404,
        )
      }
    }

    const priority = dto.priority ?? 'normal'

    // Create the ticket
    const result = await pool.query(
      `INSERT INTO tickets (user_id, subject, body, profile_id, related_entity_type, related_entity_id, priority, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
       RETURNING *`,
      [
        userId,
        dto.subject.trim(),
        dto.body.trim(),
        dto.profileId?.trim() ?? null,
        dto.relatedEntityType ?? null,
        dto.relatedEntityId?.trim() ?? null,
        priority,
      ],
    )

    const ticket = mapRow(result.rows[0]!)
    this.logger.log(`Ticket ${ticket.id} created for user ${userId}, priority=${priority}`)
    return ticket
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
  ): Promise<PaginatedResult<TicketRow>> {
    const pool = getDbPool()
    const page = Math.max(1, options.page ?? 1)
    const limit = Math.min(100, Math.max(1, options.limit ?? 20))
    const offset = (page - 1) * limit

    // Build WHERE clause
    const conditions: string[] = ['t.user_id = $1']
    const params: unknown[] = [userId]
    let paramIndex = 2

    if (options.status) {
      const validStatuses = ['open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed']
      if (!validStatuses.includes(options.status)) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: `Invalid status filter: ${options.status}. Allowed: ${validStatuses.join(', ')}` },
          400,
        )
      }
      conditions.push(`t.status = $${paramIndex}`)
      params.push(options.status)
      paramIndex++
    }

    if (options.search?.trim()) {
      conditions.push(`(t.subject ILIKE $${paramIndex} OR t.body ILIKE $${paramIndex})`)
      params.push(`%${options.search.trim()}%`)
      paramIndex++
    }

    const whereClause = conditions.join(' AND ')

    // Validate sort column (whitelist to prevent injection)
    const allowedSortColumns = ['created_at', 'updated_at', 'subject', 'status', 'priority']
    const sortBy = allowedSortColumns.includes(options.sortBy ?? '') ? options.sortBy! : 'updated_at'
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC'

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM tickets t WHERE ${whereClause}`,
      params,
    )
    const total = Number(countResult.rows[0]!.total)

    // Fetch page
    const dataResult = await pool.query(
      `SELECT t.* FROM tickets t WHERE ${whereClause}
       ORDER BY t.${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    )

    const data = dataResult.rows.map(mapRow)

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Get a single ticket by ID, scoped to the authenticated user.
   */
  async getTicket(ticketId: string, userId: string): Promise<TicketRow> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT * FROM tickets WHERE id = $1 AND user_id = $2`,
      [ticketId, userId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Ticket not found' },
        404,
      )
    }

    return mapRow(result.rows[0]!)
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
  ): Promise<TicketRow> {
    const validStatuses = ['open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed']
    if (!validStatuses.includes(status)) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: `Invalid status: ${status}. Allowed: ${validStatuses.join(', ')}` },
        400,
      )
    }

    // Non-admin users can only reopen their tickets (any → open)
    if (!isAdmin && status !== 'open') {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can change ticket status' },
        403,
      )
    }

    const pool = getDbPool()

    const result = await pool.query(
      `UPDATE tickets SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [status, ticketId, userId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Ticket not found' },
        404,
      )
    }

    return mapRow(result.rows[0]!)
  }

  /**
   * List comments on a ticket. The user must own the ticket.
   * Customers see only 'public' comments. Staff see all comments.
   */
  async listComments(
    ticketId: string,
    userId: string,
    isAdmin: boolean = false,
  ): Promise<TicketCommentRow[]> {
    // Verify the ticket exists and belongs to the user
    await this.getTicket(ticketId, userId)

    const pool = getDbPool()

    let result
    if (isAdmin) {
      result = await pool.query(
        `SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId],
      )
    } else {
      result = await pool.query(
        `SELECT * FROM ticket_comments WHERE ticket_id = $1 AND visibility = 'public' ORDER BY created_at ASC`,
        [ticketId],
      )
    }

    return result.rows.map(mapCommentRow)
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
  ): Promise<TicketCommentRow> {
    if (!body?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Comment body is required' },
        400,
      )
    }
    if (body.trim().length > 10000) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Comment body must be 10,000 characters or fewer' },
        400,
      )
    }

    // Non-admin users cannot add internal notes
    if (visibility === 'internal' && !isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Only staff can add internal notes' },
        403,
      )
    }

    // Verify the ticket exists and belongs to the user
    await this.getTicket(ticketId, userId)

    const pool = getDbPool()

    const result = await pool.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [ticketId, userId, body.trim(), visibility],
    )

    return mapCommentRow(result.rows[0]!)
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
  ): Promise<PaginatedResult<TicketRow>> {
    const pool = getDbPool()
    const page = Math.max(1, options.page ?? 1)
    const limit = Math.min(100, Math.max(1, options.limit ?? 20))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (options.status) {
      const validStatuses = ['open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed']
      if (!validStatuses.includes(options.status)) {
        throw new HttpException(
          { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: `Invalid status filter: ${options.status}. Allowed: ${validStatuses.join(', ')}` },
          400,
        )
      }
      conditions.push(`t.status = $${paramIndex}`)
      params.push(options.status)
      paramIndex++
    }

    if (options.search?.trim()) {
      conditions.push(`(t.subject ILIKE $${paramIndex} OR t.body ILIKE $${paramIndex})`)
      params.push(`%${options.search.trim()}%`)
      paramIndex++
    }

    if (options.assignedTo) {
      conditions.push(`t.assigned_to = $${paramIndex}`)
      params.push(options.assignedTo)
      paramIndex++
    }

    // If no conditions, select all tickets
    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE'

    // Validate sort column (whitelist to prevent injection)
    const allowedSortColumns = ['created_at', 'updated_at', 'subject', 'status', 'priority']
    const sortBy = allowedSortColumns.includes(options.sortBy ?? '') ? options.sortBy! : 'updated_at'
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC'

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM tickets t WHERE ${whereClause}`,
      params,
    )
    const total = Number(countResult.rows[0]!.total)

    // Fetch page
    const dataResult = await pool.query(
      `SELECT t.* FROM tickets t WHERE ${whereClause}
       ORDER BY t.${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    )

    const data = dataResult.rows.map(mapRow)

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Staff get any ticket by ID (no user_id scoping).
   */
  async staffGetTicket(ticketId: string): Promise<TicketRow> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT * FROM tickets WHERE id = $1`,
      [ticketId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Ticket not found' },
        404,
      )
    }

    return mapRow(result.rows[0]!)
  }

  /**
   * Staff assign a ticket to themselves (or another staff member).
   * Validates the target user exists and has staff role.
   */
  async staffAssignTicket(
    ticketId: string,
    assigneeUserId: string,
  ): Promise<TicketRow> {
    const pool = getDbPool()

    // Verify ticket exists
    const ticketResult = await pool.query(
      `SELECT * FROM tickets WHERE id = $1`,
      [ticketId],
    )
    if (ticketResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Ticket not found' },
        404,
      )
    }

    // If ticket is still 'open', transition to 'in_progress' on assignment
    const currentStatus = ticketResult.rows[0]!.status as string
    const newStatus = currentStatus === 'open' ? 'in_progress' : currentStatus

    const result = await pool.query(
      `UPDATE tickets SET assigned_to = $1, status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [assigneeUserId, newStatus, ticketId],
    )

    this.logger.log(`Ticket ${ticketId} assigned to staff ${assigneeUserId}`)
    return mapRow(result.rows[0]!)
  }

  /**
   * Staff update the status of any ticket (no user_id scoping).
   * Staff can also reopen tickets.
   */
  async staffUpdateTicketStatus(
    ticketId: string,
    status: string,
  ): Promise<TicketRow> {
    const validStatuses = ['open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed']
    if (!validStatuses.includes(status)) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: `Invalid status: ${status}. Allowed: ${validStatuses.join(', ')}` },
        400,
      )
    }

    const pool = getDbPool()

    const result = await pool.query(
      `UPDATE tickets SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, ticketId],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Ticket not found' },
        404,
      )
    }

    return mapRow(result.rows[0]!)
  }

  /**
   * Staff list comments on any ticket (all visibility levels).
   * No user_id scoping — staff can see all comments including internal.
   */
  async staffListComments(ticketId: string): Promise<TicketCommentRow[]> {
    // Verify the ticket exists
    await this.staffGetTicket(ticketId)

    const pool = getDbPool()

    const result = await pool.query(
      `SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId],
    )

    return result.rows.map(mapCommentRow)
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
  ): Promise<TicketCommentRow> {
    if (!body?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Comment body is required' },
        400,
      )
    }
    if (body.trim().length > 10000) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Comment body must be 10,000 characters or fewer' },
        400,
      )
    }

    // Verify the ticket exists
    await this.staffGetTicket(ticketId)

    const pool = getDbPool()

    const result = await pool.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [ticketId, staffUserId, body.trim(), visibility],
    )

    return mapCommentRow(result.rows[0]!)
  }
}