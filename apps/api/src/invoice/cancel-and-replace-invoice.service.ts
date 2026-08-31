/**
 * CancelAndReplaceInvoiceService — pre-payment cancel+replace (T-04.1.05.02).
 *
 * Staff cannot edit issued or paid invoice lines (S-04.1.05 / README
 * §Invoices). Before any confirmed payment, finance cancels the original
 * (with a required reason) and creates a linked corrected invoice whose
 * `replaces_invoice_id` points at the cancelled original.
 *
 * After payment, this path is forbidden: corrections use an adjustment
 * invoice (T-04.1.05.03) or a refund/credit.
 *
 * Flow (one DB transaction):
 *   1. Validate `reason` and `newLines` (pure).
 *   2. Lock the original (`SELECT … FOR UPDATE`).
 *   3. Reject missing invoices, any `paid_amount > 0`, and states other
 *      than Draft / Unpaid / Overdue (the unpaid, cancellable set).
 *   4. Cancel the original via the state machine on this transaction
 *      (`invoice.cancel` audit + `cancelled_at`).
 *   5. Insert a Draft replacement with the new lines, calculation
 *      snapshot, origin FKs copied from the original, and
 *      `replaces_invoice_id` set.
 *   6. Issue the replacement (Draft → Unpaid) on the same transaction so
 *      the customer has a payable corrected invoice and the new lines are
 *      immutable. The spec row "Cancelled + new Draft" is the
 *      intermediate: the replacement is created as Draft, then issued
 *      atomically like ManualInvoiceService.
 *   7. Record `replacedByInvoiceId` on the original metadata so the
 *      correction chain is walkable from both ends.
 *   8. Read the result back inside the transaction, then COMMIT.
 *
 * Replacement `type` is `'manual'` because `newLines` are staff-entered.
 * Copying `'auto'` would collide with `uq_invoices_order_id_type` on the
 * still-present cancelled original. Origin columns (`order_id`,
 * `contract_id`, `consultation_id`, `profile_id`) are copied.
 *
 * Money rules: all amounts are bigint IRR; VAT is half-up per line.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { duePeriodTypeForManual } from '@barghsa/shared/finance'
import { v7 as uuidv7 } from 'uuid'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import type { TransitionResult } from './invoice-state-machine.service.js'
import type { TransactionClient } from './invoice-audit.repository.js'
import type { InvoiceState } from './invoice-state.model.js'
import {
  calculateManualInvoice,
  type ManualInvoiceLineInput,
} from './manual-invoice.calculation.js'
import { buildManualInvoiceCalculationSnapshot } from './invoice-calculation-snapshot.js'
import { DueAtCalculationService } from './due-at.service.js'
import type {
  ManualInvoiceLineResult,
} from './manual-invoice.service.js'

/**
 * Unpaid states from which a pre-payment cancel+replace is allowed.
 *
 * S-04.1.05 correction row lists Draft and Unpaid. Overdue is included
 * because it is still unpaid, Cancel is a legal transition, and the
 * task constraint is "validates no payment".
 */
export const REPLACEABLE_INVOICE_STATES = [
  'Draft',
  'Unpaid',
  'Overdue',
] as const satisfies readonly InvoiceState[]

export type ReplaceableInvoiceState = (typeof REPLACEABLE_INVOICE_STATES)[number]

export const CANCEL_AND_REPLACE_ERRORS = {
  REASON_REQUIRED: () =>
    'A reason is required to cancel and replace an invoice',
  HAS_PAYMENT: (invoiceId: string, paidAmount: bigint) =>
    `Cannot replace invoice ${invoiceId}: confirmed payment ${paidAmount} IRR; use an adjustment or refund instead`,
  STATE_NOT_REPLACEABLE: (invoiceId: string, state: string) =>
    `Cannot replace invoice ${invoiceId} in state '${state}'; only unpaid Draft, Unpaid, or Overdue invoices may be cancelled and replaced`,
} as const

/** Command to cancel one unpaid invoice and issue a linked replacement. */
export interface CancelAndReplaceInvoiceCommand {
  /** Invoice to cancel (must have no confirmed payment). */
  invoiceId: string
  /** Required customer/staff-visible reason (audited). */
  reason: string
  /** Corrected lines that become the replacement invoice. */
  newLines: ManualInvoiceLineInput[]
  /** Finance staff member performing the action (FK `users.userId`). */
  actorUserId: string
  /** Opaque correlation ID for audit linkage. */
  correlationId?: string
  /** Source IP of the staff member (audited). */
  ip?: string
  /** Explicit due date (>= now) for the replacement; defaults to issuedAt + config days. */
  dueAt?: Date
  /** Override "now" for tests. */
  now?: Date
}

/** Result of a successful cancel-and-replace. */
export interface CancelAndReplaceInvoiceResult {
  originalInvoiceId: string
  originalState: InvoiceState
  replacementInvoiceId: string
  replacementState: InvoiceState
  profileId: string
  contractId: string | null
  orderId: string | null
  consultationId: string | null
  replacesInvoiceId: string
  totalAmount: bigint
  lines: ManualInvoiceLineResult[]
  issuedAt: Date
  payableFrom: Date
  dueAt: Date | null
  cancelAuditId: string
  issueAuditId: string
  cancelTransition: TransitionResult
  issueTransition: TransitionResult
}

interface LockedOriginalRow {
  id: string
  profile_id: string
  order_id: string | null
  contract_id: string | null
  consultation_id: string | null
  type: string | null
  state: string
  total_amount: string
  paid_amount: string
  refunded_amount: string
  metadata: unknown
}

/** True when `state` is an unpaid, cancellable state eligible for replace. */
export function isReplaceableInvoiceState(
  state: string,
): state is ReplaceableInvoiceState {
  return (REPLACEABLE_INVOICE_STATES as readonly string[]).includes(state)
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

function requireReason(reason: string): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : ''
  if (trimmed === '') {
    throw new BadRequestException(CANCEL_AND_REPLACE_ERRORS.REASON_REQUIRED())
  }
  return trimmed
}

@Injectable()
export class CancelAndReplaceInvoiceService {
  private readonly logger = new Logger(CancelAndReplaceInvoiceService.name)

  constructor(
    private readonly stateMachine: InvoiceStateMachineService,
    private readonly dueAtCalculation: DueAtCalculationService,
  ) {}

  /**
   * Cancel an unpaid invoice and create a linked replacement with `newLines`.
   *
   * @throws BadRequestException on empty reason, invalid lines, a
   *   non-positive total, or a due date in the past.
   * @throws NotFoundException when the original invoice does not exist.
   * @throws ConflictException when the original has confirmed payment or
   *   is not in a replaceable unpaid state.
   */
  async cancelAndReplaceInvoice(
    cmd: CancelAndReplaceInvoiceCommand,
  ): Promise<CancelAndReplaceInvoiceResult> {
    const reason = requireReason(cmd.reason)

    let calculation
    try {
      calculation = calculateManualInvoice(cmd.newLines)
    } catch (err: unknown) {
      if (err instanceof RangeError) {
        throw new BadRequestException(err.message)
      }
      throw err
    }

    const now = cmd.now ?? new Date()
    if (cmd.dueAt !== undefined && cmd.dueAt.getTime() < now.getTime()) {
      throw new BadRequestException('dueAt cannot be in the past')
    }

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const locked = (await client.query(
        `SELECT id, profile_id, order_id, contract_id, consultation_id, type,
                state, total_amount, paid_amount, refunded_amount, metadata
           FROM invoices
          WHERE id = $1
          FOR UPDATE`,
        [cmd.invoiceId],
      )) as { rows: LockedOriginalRow[] }
      const original = locked.rows[0]
      if (!original) {
        throw new NotFoundException(`Invoice not found: ${cmd.invoiceId}`)
      }

      const paidAmount = BigInt(original.paid_amount)
      if (paidAmount > 0n) {
        throw new ConflictException(
          CANCEL_AND_REPLACE_ERRORS.HAS_PAYMENT(cmd.invoiceId, paidAmount),
        )
      }

      if (!isReplaceableInvoiceState(original.state)) {
        throw new ConflictException(
          CANCEL_AND_REPLACE_ERRORS.STATE_NOT_REPLACEABLE(
            cmd.invoiceId,
            original.state,
          ),
        )
      }

      const cancelTransition = await this.stateMachine.transition(
        cmd.invoiceId,
        original.state,
        'Cancelled',
        {
          actorUserId: cmd.actorUserId,
          reason,
          now,
          client,
          ...(cmd.correlationId !== undefined
            ? { correlationId: cmd.correlationId }
            : {}),
          ...(cmd.ip !== undefined ? { ip: cmd.ip } : {}),
        },
      )

      const due = await this.dueAtCalculation.resolve(client, {
        serviceType: duePeriodTypeForManual(),
        issuedAt: now,
        ...(cmd.dueAt !== undefined ? { staffOverride: cmd.dueAt } : {}),
      })
      const dueAt = due.dueAt

      const replacementId = uuidv7()
      const calculationSnapshot = buildManualInvoiceCalculationSnapshot(
        cmd.newLines,
        calculation,
      )
      const replacementMetadata = JSON.stringify({
        source: 'cancel_and_replace',
        generatedBy: cmd.actorUserId,
        replacesInvoiceId: cmd.invoiceId,
        originalType: original.type,
        reason,
        due: {
          dueAt: dueAt.toISOString(),
          source: due.source,
          configDays: due.configDays,
          serviceType: due.serviceType,
          periodId: due.periodId,
        },
        calculation: {
          lines: calculation.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice.toString(),
            vatRate: l.vatRate,
            isTaxable: l.isTaxable,
            lineTotal: l.lineTotal.toString(),
            vatAmount: l.vatAmount.toString(),
          })),
          totalAmount: calculation.totalAmount.toString(),
          rounding: 'half-up-to-nearest-IRR',
        },
      })

      await client.query(
        `INSERT INTO invoices
           (id, profile_id, order_id, contract_id, consultation_id, type, state,
            total_amount, issued_at, payable_from, due_at, metadata,
            invoice_calculation_snapshot, replaces_invoice_id)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'Draft', $6, NULL, NULL, $7,
                 $8::jsonb, $9::jsonb, $10)`,
        [
          replacementId,
          original.profile_id,
          original.order_id,
          original.contract_id,
          original.consultation_id,
          calculation.totalAmount,
          dueAt,
          replacementMetadata,
          JSON.stringify(calculationSnapshot),
          cmd.invoiceId,
        ],
      )

      for (const [index, line] of calculation.lines.entries()) {
        await client.query(
          `INSERT INTO invoice_lines
             (id, invoice_id, description, quantity, unit_price, line_total,
              vat_rate, vat_amount, is_taxable, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            replacementId,
            line.description,
            line.quantity,
            line.unitPrice,
            line.lineTotal,
            line.vatRate,
            line.vatAmount,
            line.isTaxable,
            index,
          ],
        )
      }

      const issueTransition = await this.stateMachine.transition(
        replacementId,
        'Draft',
        'Unpaid',
        {
          actorUserId: cmd.actorUserId,
          reason,
          now,
          client,
          ...(cmd.correlationId !== undefined
            ? { correlationId: cmd.correlationId }
            : {}),
          ...(cmd.ip !== undefined ? { ip: cmd.ip } : {}),
        },
      )

      const originalMetadata = asMetadataObject(original.metadata)
      const nextOriginalMetadata = {
        ...originalMetadata,
        replacedByInvoiceId: replacementId,
        replacementReason: reason,
      }
      await client.query(
        `UPDATE invoices
            SET metadata = $1::jsonb, updated_at = $2
          WHERE id = $3`,
        [JSON.stringify(nextOriginalMetadata), now, cmd.invoiceId],
      )

      const excerpt = await this.loadReplacementExcerpt(client, replacementId)

      await client.query('COMMIT')
      return {
        originalInvoiceId: cmd.invoiceId,
        originalState: 'Cancelled',
        replacementInvoiceId: replacementId,
        replacementState: excerpt.state,
        profileId: excerpt.profileId,
        contractId: excerpt.contractId,
        orderId: excerpt.orderId,
        consultationId: excerpt.consultationId,
        replacesInvoiceId: excerpt.replacesInvoiceId,
        totalAmount: excerpt.totalAmount,
        lines: excerpt.lines,
        issuedAt: excerpt.issuedAt,
        payableFrom: excerpt.payableFrom,
        dueAt: excerpt.dueAt,
        cancelAuditId: cancelTransition.auditId,
        issueAuditId: issueTransition.auditId,
        cancelTransition,
        issueTransition,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error
      }
      this.logger.error(`Cancel-and-replace failed: ${String(error)}`)
      throw error
    } finally {
      client.release()
    }
  }

  private async loadReplacementExcerpt(
    client: TransactionClient,
    invoiceId: string,
  ): Promise<{
    profileId: string
    contractId: string | null
    orderId: string | null
    consultationId: string | null
    replacesInvoiceId: string
    state: InvoiceState
    totalAmount: bigint
    lines: ManualInvoiceLineResult[]
    issuedAt: Date
    payableFrom: Date
    dueAt: Date | null
  }> {
    const invoiceResult = (await client.query(
      `SELECT id, profile_id, order_id, contract_id, consultation_id, state,
              total_amount, issued_at, payable_from, due_at, replaces_invoice_id
         FROM invoices
        WHERE id = $1`,
      [invoiceId],
    )) as {
      rows: Array<{
        id: string
        profile_id: string
        order_id: string | null
        contract_id: string | null
        consultation_id: string | null
        state: string
        total_amount: string
        issued_at: Date | null
        payable_from: Date | null
        due_at: Date | null
        replaces_invoice_id: string | null
      }>
    }
    const row = invoiceResult.rows[0]
    if (!row) throw new NotFoundException(`Invoice not found: ${invoiceId}`)
    if (!row.replaces_invoice_id) {
      throw new NotFoundException(
        `Replacement invoice ${invoiceId} is missing replaces_invoice_id`,
      )
    }

    const linesResult = (await client.query(
      `SELECT id, description, quantity, unit_price, line_total,
              vat_rate, vat_amount, is_taxable, position
         FROM invoice_lines
        WHERE invoice_id = $1
        ORDER BY position ASC, created_at ASC`,
      [invoiceId],
    )) as {
      rows: Array<{
        id: string
        description: string
        quantity: number
        unit_price: string
        line_total: string
        vat_rate: number
        vat_amount: string
        is_taxable: boolean
        position: number
      }>
    }

    return {
      profileId: row.profile_id,
      contractId: row.contract_id,
      orderId: row.order_id,
      consultationId: row.consultation_id,
      replacesInvoiceId: row.replaces_invoice_id,
      state: row.state as InvoiceState,
      totalAmount: BigInt(row.total_amount),
      issuedAt: row.issued_at ?? new Date(),
      payableFrom: row.payable_from ?? new Date(),
      dueAt: row.due_at,
      lines: linesResult.rows.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitPrice: BigInt(l.unit_price),
        lineTotal: BigInt(l.line_total),
        vatRate: l.vat_rate,
        vatAmount: BigInt(l.vat_amount),
        isTaxable: l.is_taxable,
        position: l.position,
      })),
    }
  }
}
