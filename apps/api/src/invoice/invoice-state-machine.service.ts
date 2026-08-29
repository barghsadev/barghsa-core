/**
 * InvoiceStateMachineService — NestJS service (T-04.1.01.03).
 *
 * Orchestrates invoice state transitions:
 *   1. Validates the transition via the pure model (invoice-state.model).
 *   2. Executes the state update inside a DB transaction (`SELECT ... FOR UPDATE`).
 *   3. Records an audit-trail entry in the `audit_log` table.
 *
 * The service does NOT own complex business logic beyond the state machine
 * validation — that belongs in the calling code (bank receipt confirmation,
 * wallet payment, refund creation, etc.). Each transition method below
 * validates the transition, applies the state change, and emits the audit.
 *
 * Idempotency is delegated to the caller (via idempotency keys on the
 * money-moving operations that call this service).
 */

import { Injectable, InternalServerErrorException, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import {
  type InvoiceState,
  type InvoiceTransition,
  type TransitionContext,
  validateTransition,
  transitionName,
  TRANSITION_LABELS,
} from './invoice-state.model.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'

/** Result returned by every transition method. */
export interface TransitionResult {
  invoiceId: string
  fromState: InvoiceState
  toState: InvoiceState
  transition: InvoiceTransition
  auditId: string
}

export interface TransitionOptions {
  /** The user who performed the action (FK to `users.userId`). */
  actorUserId: string
  /** Opaque correlation ID for linking related events. */
  correlationId?: string
  /** Human-readable reason for the transition (required for cancellations, refunds). */
  reason?: string
  /**
   * Source IP of the requesting user; stored in the audit log.
   * Omit for system-initiated transitions.
   */
  ip?: string
  /** Rich context for amount-based validation rules. */
  financials?: TransitionContext
  /**
   * Override timestamp for the `issued_at` / `cancelled_at` / `paid_at`
   * columns, passed as a mutation callback. The service applies the minimal
   * set of side-effect column updates.
   */
  now?: Date
}

@Injectable()
export class InvoiceStateMachineService {
  private readonly logger = new Logger(InvoiceStateMachineService.name)

  constructor(
    private readonly auditRepository: InvoiceAuditRepository = new InvoiceAuditRepository(),
  ) {}

  /**
   * Transition an invoice from its current state to a new state, recording
   * an audit entry along the way.
   *
   * Steps:
   *   1. Validate the transition structurally + amount-based.
   *   2. Open a transaction, lock the invoice row (`FOR UPDATE`).
   *   3. Re-validate the CURRENT state matches the passed `from` (optimistic).
   *   4. UPDATE the invoice row with the new state + side-effect timestamps.
   *   5. INSERT an audit_log entry.
   *   6. Commit.
   */
  async transition(
    invoiceId: string,
    from: InvoiceState,
    to: InvoiceState,
    opts: TransitionOptions,
  ): Promise<TransitionResult> {
    // --- 1. Pure validation ---
    try {
      validateTransition(from, to, opts.financials)
    } catch (err: unknown) {
      if (err instanceof RangeError || err instanceof Error) {
        throw new BadRequestException(err.message)
      }
      throw err
    }

    const transition = transitionName(from, to)!
    const label = TRANSITION_LABELS[transition]

    // --- 2. DB transaction ---
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the invoice row and verify its current state
      const lockResult = await client.query(
        `SELECT id, state FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId],
      )
      if (lockResult.rows.length === 0) {
        throw new NotFoundException(`Invoice not found: ${invoiceId}`)
      }
      const currentState = lockResult.rows[0].state as InvoiceState
      if (currentState !== from) {
        throw new BadRequestException(
          `Invoice ${invoiceId} state conflict: expected '${from}', current '${currentState}'`,
        )
      }

      // --- 3. Build side-effect column updates ---
      const now = opts.now ?? new Date()
      const sideEffects: { column: string; value: Date | null }[] = []

      if (transition === 'Issue') {
        // Draft → Unpaid: set issuedAt, payableFrom, dueAt
        sideEffects.push({ column: 'issued_at', value: now })
        sideEffects.push({ column: 'payable_from', value: now })
        // dueAt is set by the caller's business logic; we leave it as-is
        // or the caller sets it before calling transition.
      }
      if (transition === 'Cancel') {
        sideEffects.push({ column: 'cancelled_at', value: now })
      }
      if (transition === 'PayFromWallet' || to === 'Paid') {
        sideEffects.push({ column: 'paid_at', value: now })
      }
      if (transition === 'MarkOverdue') {
        sideEffects.push({ column: 'overdue_at', value: now })
      }

      // --- 4. Update invoice state ---
      const setClauses = [`state = $2`]
      const values: unknown[] = [invoiceId, to]
      let paramIdx = 3
      if (opts.reason) {
        // Store reason in metadata JSONB if needed; for now just log it
        this.logger.debug(
          `Transition ${from}→${to} on ${invoiceId}: ${opts.reason}`,
        )
      }
      for (const se of sideEffects) {
        setClauses.push(`${se.column} = $${paramIdx}`)
        values.push(se.value)
        paramIdx++
      }
      setClauses.push(`updated_at = NOW()`)

      await client.query(
        `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $1`,
        values,
      )

      // --- 5. Audit log entry (append-only, same transaction) ---
      const auditId = await this.auditRepository.recordTransition(
        client,
        {
          invoiceId,
          fromState: from,
          toState: to,
          transition,
          actorUserId: opts.actorUserId,
          reason: opts.reason,
          correlationId: opts.correlationId,
          ip: opts.ip,
        },
        now,
      )

      await client.query('COMMIT')

      this.logger.log(
        `Invoice ${invoiceId} ${from} → ${to} (${label}) by ${opts.actorUserId}`,
      )

      return { invoiceId, fromState: from, toState: to, transition, auditId }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      // Re-throw NestJS exceptions as-is; wrap generic errors
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error
      }
      this.logger.error(`Invoice transition failed: ${String(error)}`)
      throw new InternalServerErrorException(
        `Invoice transition failed: ${String(error)}`,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Guard methods — each returns `true` iff the state allows the transition.
   * These are convenience wrappers around `canTransition` from the model for
   * use by callers that need to check before attempting.
   */

  canIssue(from: InvoiceState): boolean {
    return from === 'Draft'
  }

  canSubmitBankReceipt(from: InvoiceState): boolean {
    return from === 'Unpaid' || from === 'PartiallyFunded'
  }

  canConfirmBankReceipt(from: InvoiceState): boolean {
    return from === 'PaymentUnderReview'
  }

  canPayFromWallet(from: InvoiceState): boolean {
    return from === 'Unpaid' || from === 'PartiallyFunded'
  }

  canMarkOverdue(from: InvoiceState): boolean {
    return from === 'Unpaid' || from === 'PartiallyFunded'
  }

  canCancel(from: InvoiceState): boolean {
    return from === 'Draft' || from === 'Unpaid' || from === 'Overdue' || from === 'PartiallyFunded'
  }

  canPartialRefund(from: InvoiceState): boolean {
    return from === 'Paid' || from === 'PartiallyRefunded'
  }

  canFullRefund(from: InvoiceState): boolean {
    return from === 'Paid'
  }
}