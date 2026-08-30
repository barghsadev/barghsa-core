/**
 * Staff dueAt override service (T-04.1.03.03).
 *
 * Finance staff may replace an invoice `dueAt` when they hold the
 * explicit override permission (enforced at the controller) and supply
 * a customer-visible reason. The new due instant is written to
 * `invoices.due_at`, the reason + previous/new values land in invoice
 * metadata, and an append-only `invoice.due_at.override` audit row is
 * recorded in the same transaction.
 *
 * Overridable states: Unpaid, PaymentUnderReview, PartiallyFunded,
 * Overdue. Terminal / settled invoices keep their original due date.
 */

import { HttpException, Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  DUE_AT_OVERRIDE_ERRORS,
  buildDueAtOverrideSnapshot,
  isDueAtOverrideableState,
  parseDueAtOverrideBody,
  readDueAtOverrideSnapshot,
  type InvoiceDueAtOverrideSnapshot,
} from '@barghsa/shared/finance'
import type { InvoiceState } from './invoice-state.model.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import type { TransactionClient } from './invoice-audit.repository.js'

/** Public DTO returned by get / override. */
export interface InvoiceDueAtDto {
  invoiceId: string
  state: InvoiceState
  issuedAt: string | null
  payableFrom: string | null
  dueAt: string | null
  canOverride: boolean
  dueAtOverride: InvoiceDueAtOverrideSnapshot | null
  auditId?: string
}

export interface OverrideInvoiceDueAtInput {
  invoiceId: string
  raw: unknown
  actorUserId: string
  ip: string
  correlationId?: string
  now?: Date
}

interface InvoiceDueAtRow {
  id: string
  state: InvoiceState
  issued_at: Date | null
  payable_from: Date | null
  due_at: Date | null
  metadata: unknown
}

function httpError(code: string, message: string, statusCode: number): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      /* ignore malformed JSON */
    }
  }
  return {}
}

function toDto(row: InvoiceDueAtRow, extra: { auditId?: string } = {}): InvoiceDueAtDto {
  const metadata = asMetadataObject(row.metadata)
  return {
    invoiceId: row.id,
    state: row.state,
    issuedAt: iso(row.issued_at),
    payableFrom: iso(row.payable_from),
    dueAt: iso(row.due_at),
    canOverride: isDueAtOverrideableState(row.state),
    dueAtOverride: readDueAtOverrideSnapshot(metadata),
    ...(extra.auditId ? { auditId: extra.auditId } : {}),
  }
}

@Injectable()
export class DueAtOverrideService {
  private readonly logger = new Logger(DueAtOverrideService.name)

  constructor(private readonly auditRepository: InvoiceAuditRepository) {}

  /**
   * Load the current due-date snapshot for the staff override UI.
   */
  async get(invoiceId: string): Promise<InvoiceDueAtDto> {
    const pool = getDbPool()
    const result = (await pool.query(
      `SELECT id, state, issued_at, payable_from, due_at, metadata
       FROM invoices WHERE id = $1`,
      [invoiceId],
    )) as { rows: InvoiceDueAtRow[] }
    const row = result.rows[0]
    if (!row) {
      httpError(ErrorCodes.NOT_FOUND_RESOURCE.code, `Invoice not found: ${invoiceId}`, 404)
    }
    return toDto(row)
  }

  /**
   * Apply a staff dueAt override: validate input + state, lock the
   * invoice row, persist due_at + metadata, write the audit entry.
   */
  async override(input: OverrideInvoiceDueAtInput): Promise<InvoiceDueAtDto> {
    const parsed = parseDueAtOverrideBody(input.raw)
    if (!parsed.ok) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        parsed.issues.join('; '),
        400,
      )
    }

    const now = input.now ?? new Date()
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const locked = (await client.query(
        `SELECT id, state, issued_at, payable_from, due_at, metadata
         FROM invoices WHERE id = $1 FOR UPDATE`,
        [input.invoiceId],
      )) as { rows: InvoiceDueAtRow[] }
      const row = locked.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        httpError(
          ErrorCodes.NOT_FOUND_RESOURCE.code,
          `Invoice not found: ${input.invoiceId}`,
          404,
        )
      }

      if (!isDueAtOverrideableState(row.state)) {
        await client.query('ROLLBACK')
        httpError(
          ErrorCodes.CONFLICT_STATE.code,
          DUE_AT_OVERRIDE_ERRORS.STATE_NOT_OVERRIDEABLE(row.state),
          409,
        )
      }

      if (row.issued_at && parsed.value.dueAt.getTime() < row.issued_at.getTime()) {
        await client.query('ROLLBACK')
        httpError(
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          DUE_AT_OVERRIDE_ERRORS.BEFORE_ISSUED_AT(),
          400,
        )
      }

      if (row.due_at && parsed.value.dueAt.getTime() === row.due_at.getTime()) {
        await client.query('ROLLBACK')
        httpError(
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          DUE_AT_OVERRIDE_ERRORS.UNCHANGED(),
          400,
        )
      }

      const snapshot = buildDueAtOverrideSnapshot({
        dueAt: parsed.value.dueAt,
        previousDueAt: row.due_at,
        reason: parsed.value.reason,
        actorUserId: input.actorUserId,
        overriddenAt: now,
      })

      const metadata = asMetadataObject(row.metadata)
      const existingDue =
        metadata.due && typeof metadata.due === 'object' && !Array.isArray(metadata.due)
          ? (metadata.due as Record<string, unknown>)
          : {}
      const history = Array.isArray(metadata.dueAtOverrides)
        ? (metadata.dueAtOverrides as unknown[])
        : []
      const nextMetadata = {
        ...metadata,
        due: {
          ...existingDue,
          dueAt: snapshot.dueAt,
          source: 'staff_override',
          configDays: null,
        },
        dueAtOverride: snapshot,
        dueAtOverrides: [...history, snapshot],
      }

      await client.query(
        `UPDATE invoices
         SET due_at = $1, metadata = $2::jsonb, updated_at = $3
         WHERE id = $4`,
        [parsed.value.dueAt, JSON.stringify(nextMetadata), now, input.invoiceId],
      )

      const auditId = await this.auditRepository.recordDueAtOverride(
        client as TransactionClient,
        {
          invoiceId: input.invoiceId,
          actorUserId: input.actorUserId,
          snapshot,
          invoiceState: row.state,
          correlationId: input.correlationId,
          ip: input.ip,
        },
        now,
      )

      await client.query('COMMIT')

      this.logger.log(
        `Staff ${input.actorUserId} overrode dueAt on invoice ${input.invoiceId} → ${snapshot.dueAt}`,
      )

      return toDto(
        {
          ...row,
          due_at: parsed.value.dueAt,
          metadata: nextMetadata,
        },
        { auditId },
      )
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* rollback of a failed TX is best-effort */
      }
      throw err
    } finally {
      client.release()
    }
  }
}
