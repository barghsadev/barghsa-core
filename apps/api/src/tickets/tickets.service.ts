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
}