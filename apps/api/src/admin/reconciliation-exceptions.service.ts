import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  isReconciliationStatus,
  isReconciliationSeverity,
  type ReconciliationStatus,
  type ReconciliationSeverity,
  type ReconciliationExceptionType,
} from '@barghsa/shared/admin'

/** A reconciliation exception as returned by the admin API (S-09.09, T-09.09.01). */
export interface ReconciliationExceptionDto {
  id: string
  exceptionType: ReconciliationExceptionType
  severity: ReconciliationSeverity
  status: ReconciliationStatus
  description: string
  details: Record<string, unknown> | null
  assignedToId: string | null
  assignedToUsername: string | null
  resolvedById: string | null
  resolvedByUsername: string | null
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Options for the reconciliation list view. */
export interface ListReconciliationExceptionsOptions {
  status?: ReconciliationStatus
  severity?: ReconciliationSeverity
  limit?: number
  offset?: number
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const MAX_RESOLUTION_NOTE_LENGTH = 1000

/**
 * Reconciliation exception review service (S-09.09, T-09.09.01).
 *
 * Owns the admin/staff lifecycle of a reconciliation exception:
 *
 * - {@link listReconciliationExceptions} — the review queue view, optionally
 *   filtered by status and severity, newest first.
 * - {@link investigateReconciliationException} — `open` → `investigating`.
 * - {@link resolveReconciliationException} — `open`/`investigating` →
 *   `resolved`, with a mandatory explainer.
 * - {@link closeReconciliationException} — `open`/`investigating`/`resolved`
 *   → `closed`, with a mandatory explainer.
 *
 * Every state change writes an `audit_log` row (`reconciliation_status_changed`
 * for investigate, `resolution_recorded` for resolve/close) in the same
 * transaction as the state change, so the durable audit trail can never
 * diverge from the live ledger. A terminal item (`resolved`/`closed`) can
 * never be transitioned again (409).
 *
 * The rows themselves are produced by the finance reconciliation system
 * (a later epic dependency); this service is the review/state surface on top,
 * following the same pattern as the S-09.07 dual-approval lifecycle.
 */
@Injectable()
export class ReconciliationExceptionsService {
  private readonly logger = new Logger(ReconciliationExceptionsService.name)

  /**
   * List reconciliation exceptions, optionally filtered by status/severity,
   * newest first.
   *
   * @throws 400 when an invalid status or severity filter is supplied.
   */
  async listReconciliationExceptions(
    options: ListReconciliationExceptionsOptions = {},
  ): Promise<ReconciliationExceptionDto[]> {
    const limit = sanitizeLimit(options.limit)
    const offset = sanitizeOffset(options.offset)
    const status = options.status ?? null
    const severity = options.severity ?? null

    if (status !== null && !isReconciliationStatus(status)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'status must be one of open, investigating, resolved, closed',
        },
        400,
      )
    }

    if (severity !== null && !isReconciliationSeverity(severity)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'severity must be one of low, medium, high, critical',
        },
        400,
      )
    }

    const pool = getDbPool()
    const result = await pool.query(
      `SELECT rex.*, assignee.username AS assigned_to_username, resolver.username AS resolved_by_username
       FROM reconciliation_exceptions rex
       LEFT JOIN users assignee ON assignee.user_id = rex.assigned_to_id
       LEFT JOIN users resolver ON resolver.user_id = rex.resolved_by_id
       WHERE ($1::text IS NULL OR rex.status = $1)
         AND ($2::text IS NULL OR rex.severity = $2)
       ORDER BY rex.created_at DESC, rex.id DESC
       LIMIT $3 OFFSET $4`,
      [status, severity, limit, offset],
    )

    return result.rows.map(toReconciliationExceptionDto)
  }

  /**
   * Mark an open reconciliation exception `investigating`.
   *
   * @throws 404 when the item does not exist, 409 when it is not `open`.
   */
  async investigateReconciliationException(
    exceptionId: string,
    actorUserId: string,
    ip: string,
  ): Promise<ReconciliationExceptionDto> {
    return this.transition(exceptionId, actorUserId, ip, 'investigating', {
      allowedFrom: ['open'],
      event: 'reconciliation_status_changed',
      note: null,
    })
  }

  /**
   * Resolve an open/investigating reconciliation exception with a note.
   *
   * @throws 400 when the note is missing/overlong, 404 when the item does
   *   not exist, 409 when it is already terminal.
   */
  async resolveReconciliationException(
    exceptionId: string,
    actorUserId: string,
    ip: string,
    note: unknown,
  ): Promise<ReconciliationExceptionDto> {
    const parsed = validateResolutionNote(note)
    if (!parsed.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: parsed.issues.join('; '),
        },
        400,
      )
    }
    return this.transition(exceptionId, actorUserId, ip, 'resolved', {
      allowedFrom: ['open', 'investigating'],
      event: 'resolution_recorded',
      note: parsed.note ?? null,
    })
  }

  /**
   * Close an open/investigating/resolved reconciliation exception with a note.
   *
   * @throws 400 when the note is missing/overlong, 404 when the item does
   *   not exist, 409 when it is already closed.
   */
  async closeReconciliationException(
    exceptionId: string,
    actorUserId: string,
    ip: string,
    note: unknown,
  ): Promise<ReconciliationExceptionDto> {
    const parsed = validateResolutionNote(note)
    if (!parsed.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: parsed.issues.join('; '),
        },
        400,
      )
    }
    return this.transition(exceptionId, actorUserId, ip, 'closed', {
      allowedFrom: ['open', 'investigating', 'resolved'],
      event: 'resolution_recorded',
      note: parsed.note ?? null,
    })
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Shared state-transition path. All state changes and their audit rows
   * commit atomically under a row lock, so a concurrent double-resolve can
   * never produce two audit records for one resolution.
   */
  private async transition(
    exceptionId: string,
    actorUserId: string,
    ip: string,
    toStatus: ReconciliationStatus,
    opts: {
      allowedFrom: ReconciliationStatus[]
      event: string
      note: string | null
    },
  ): Promise<ReconciliationExceptionDto> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const result = await client.query(
        `SELECT exc.*, assignee.username AS assigned_to_username, resolver.username AS resolved_by_username
         FROM reconciliation_exceptions exc
         LEFT JOIN users assignee ON assignee.user_id = exc.assigned_to_id
         LEFT JOIN users resolver ON resolver.user_id = exc.resolved_by_id
         WHERE exc.id = $1
         FOR UPDATE OF exc`,
        [exceptionId],
      )

      const row = result.rows[0] as
        | (Record<string, unknown> & { status: string; exception_type: string })
        | undefined

      if (!row) {
        await client.query('ROLLBACK')
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Reconciliation exception not found' },
          404,
        )
      }

      if (!opts.allowedFrom.includes(row.status as ReconciliationStatus)) {
        await client.query('ROLLBACK')
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: `Reconciliation exception status '${row.status}' cannot be changed to '${toStatus}'`,
          },
          409,
        )
      }

      await client.query(
        `UPDATE reconciliation_exceptions
         SET status = $1, resolved_by_id = $2, resolution_note = $3, resolved_at = $4, updated_at = $4
         WHERE id = $5`,
        [toStatus, actorUserId, opts.note, now, exceptionId],
      )

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          uuidv7(),
          actorUserId,
          opts.event,
          JSON.stringify({
            reconciliationExceptionId: exceptionId,
            exceptionType: row.exception_type,
            fromStatus: row.status,
            toStatus,
            ...(opts.note !== null ? { resolutionNote: opts.note } : {}),
          }),
          uuidv7(),
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Reconciliation exception ${exceptionId} ${toStatus} by ${actorUserId}`,
      )

      return await this.getExceptionDto(exceptionId)
    } catch (error) {
      if (error instanceof HttpException) throw error
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to resolve reconciliation exception: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code, message: 'Failed to resolve reconciliation exception' },
        500,
      )
    } finally {
      client.release()
    }
  }

  /** Fetch a single exception by id (post-commit read for the DTO). */
  private async getExceptionDto(id: string): Promise<ReconciliationExceptionDto> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT exc.*, assignee.username AS assigned_to_username, resolver.username AS resolved_by_username
       FROM reconciliation_exceptions exc
       LEFT JOIN users assignee ON assignee.user_id = exc.assigned_to_id
       LEFT JOIN users resolver ON resolver.user_id = exc.resolved_by_id
       WHERE exc.id = $1`,
      [id],
    )
    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Reconciliation exception not found' },
        404,
      )
    }
    return toReconciliationExceptionDto(result.rows[0]!)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Validate and normalize a mandatory resolution/close explainer. */
export function validateResolutionNote(raw: unknown): {
  ok: boolean
  note?: string
  issues: string[]
} {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, issues: ['note is required'] }
  }
  const note = raw.trim()
  if (note.length > MAX_RESOLUTION_NOTE_LENGTH) {
    return {
      ok: false,
      issues: [`note must not exceed ${MAX_RESOLUTION_NOTE_LENGTH} characters`],
    }
  }
  return { ok: true, note, issues: [] }
}

/** Map a raw pg row to the API DTO. */
export function toReconciliationExceptionDto(
  row: Record<string, unknown>,
): ReconciliationExceptionDto {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))
  const resolvedAt =
    row.resolved_at === null || row.resolved_at === undefined
      ? null
      : row.resolved_at instanceof Date
        ? row.resolved_at
        : new Date(String(row.resolved_at))

  return {
    id: String(row.id),
    exceptionType: row.exception_type as ReconciliationExceptionType,
    severity: row.severity as ReconciliationSeverity,
    status: row.status as ReconciliationStatus,
    description: String(row.description),
    details:
      row.details === null || row.details === undefined
        ? null
        : (row.details as Record<string, unknown>),
    assignedToId:
      row.assigned_to_id === null || row.assigned_to_id === undefined
        ? null
        : String(row.assigned_to_id),
    assignedToUsername:
      row.assigned_to_username === null || row.assigned_to_username === undefined
        ? null
        : String(row.assigned_to_username),
    resolvedById:
      row.resolved_by_id === null || row.resolved_by_id === undefined
        ? null
        : String(row.resolved_by_id),
    resolvedByUsername:
      row.resolved_by_username === null || row.resolved_by_username === undefined
        ? null
        : String(row.resolved_by_username),
    resolutionNote:
      row.resolution_note === null || row.resolution_note === undefined
        ? null
        : String(row.resolution_note),
    resolvedAt: resolvedAt === null ? null : resolvedAt.toISOString(),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

/** Clamp a list limit to the documented bounds. */
export function sanitizeLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_LIST_LIMIT
  return Math.min(raw, MAX_LIST_LIMIT)
}

/** Clamp a list offset to a non-negative integer. */
export function sanitizeOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isInteger(raw) || raw < 0) return 0
  return raw
}