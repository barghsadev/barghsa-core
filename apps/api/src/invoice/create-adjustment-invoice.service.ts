/**
 * CreateAdjustmentInvoiceService — post-payment adjustment (T-04.1.05.03).
 *
 * Staff cannot edit issued or paid invoice lines (S-04.1.05 / README
 * §Invoices). After confirmed payment, finance creates a linked
 * adjustment invoice whose `adjustment_for_invoice_id` points at the
 * paid original. The original rows are never rewritten.
 *
 * Before payment, this path is forbidden: corrections use cancel+replace
 * (T-04.1.05.02).
 *
 * Sign of `amount` (bigint IRR):
 *   - positive → additional charge: issued Unpaid invoice the customer
 *     must pay; `due_at` is resolved like a manual invoice.
 *   - negative → credit: issued Unpaid credit-note invoice whose stored
 *     `total_amount` is `abs(amount)` (DB CHECK `total_amount >= 0`);
 *     `due_at` is left NULL so reminder/overdue workers do not treat it
 *     as a customer payable. The signed amount lives in metadata and
 *     the command result. Refunds/wallet application are S-04.4.01.
 *   - zero is rejected.
 *
 * Flow (one DB transaction):
 *   1. Validate `reason` and non-zero `amount` (pure).
 *   2. Lock the original (`SELECT … FOR UPDATE`).
 *   3. Reject missing invoices, `paid_amount = 0`, and states other
 *      than Paid / PartiallyFunded / PartiallyRefunded / Refunded.
 *   4. Insert a Draft adjustment with one non-taxable line (the signed
 *      amount as an absolute IRR total), calculation snapshot, origin
 *      FKs copied from the original, and `adjustment_for_invoice_id`.
 *   5. Issue the adjustment (Draft → Unpaid) on the same transaction.
 *   6. Record `adjustedByInvoiceIds` on the original metadata so the
 *      correction chain is walkable from both ends. Do not change the
 *      original's state, amounts, or lines.
 *   7. Read the result back inside the transaction, then COMMIT.
 *
 * Adjustment `type` is `'manual'` because the amount is staff-entered.
 * Origin columns (`order_id`, `contract_id`, `consultation_id`,
 * `profile_id`) are copied. `uq_invoices_order_id_type` is a partial
 * unique index over rows with both correction FKs NULL (migration
 * 0066), so the adjustment — which sets `adjustment_for_invoice_id` —
 * does not collide with the paid original or a sibling ordinary invoice
 * of the same type.
 *
 * Money rules: all amounts are bigint IRR; the adjustment line is
 * non-taxable so `amount` is the invoice total as entered.
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
import type { ManualInvoiceLineResult } from './manual-invoice.service.js'

/**
 * Post-payment states from which an adjustment invoice is allowed.
 *
 * S-04.1.05: after payment, corrections use an adjustment (or refund).
 * PartiallyFunded / PartiallyRefunded / Refunded all imply confirmed
 * payment has occurred. Unpaid / Draft / Overdue use cancel+replace.
 */
export const ADJUSTABLE_INVOICE_STATES = [
  'Paid',
  'PartiallyFunded',
  'PartiallyRefunded',
  'Refunded',
] as const satisfies readonly InvoiceState[]

export type AdjustableInvoiceState = (typeof ADJUSTABLE_INVOICE_STATES)[number]

export type AdjustmentKind = 'charge' | 'credit'

export const CREATE_ADJUSTMENT_ERRORS = {
  REASON_REQUIRED: () => 'A reason is required to create an adjustment invoice',
  AMOUNT_ZERO: () => 'Adjustment amount cannot be zero',
  NO_PAYMENT: (invoiceId: string) =>
    `Cannot adjust invoice ${invoiceId}: no confirmed payment; use cancel-and-replace before payment`,
  STATE_NOT_ADJUSTABLE: (invoiceId: string, state: string) =>
    `Cannot adjust invoice ${invoiceId} in state '${state}'; only Paid, PartiallyFunded, PartiallyRefunded, or Refunded invoices may receive an adjustment`,
} as const

/** Command to create a linked post-payment adjustment invoice. */
export interface CreateAdjustmentInvoiceCommand {
  /** Paid invoice this adjustment corrects (never edited). */
  originalInvoiceId: string
  /**
   * Signed IRR amount. Positive = additional charge; negative = credit.
   * The stored invoice `total_amount` is always `abs(amount)`.
   */
  amount: bigint
  /** Required customer/staff-visible reason (audited, used as line text). */
  reason: string
  /** Finance staff member performing the action (FK `users.userId`). */
  actorUserId: string
  /** Opaque correlation ID for audit linkage. */
  correlationId?: string
  /** Source IP of the staff member (audited). */
  ip?: string
  /** Explicit due date (>= now) for a charge; ignored for credits. */
  dueAt?: Date
  /** Override "now" for tests. */
  now?: Date
}

/** Result of a successful adjustment create. */
export interface CreateAdjustmentInvoiceResult {
  originalInvoiceId: string
  originalState: InvoiceState
  adjustmentInvoiceId: string
  adjustmentState: InvoiceState
  kind: AdjustmentKind
  /** Signed IRR amount as submitted. */
  amount: bigint
  /** Stored invoice total (`abs(amount)`). */
  totalAmount: bigint
  adjustmentForInvoiceId: string
  profileId: string
  contractId: string | null
  orderId: string | null
  consultationId: string | null
  lines: ManualInvoiceLineResult[]
  issuedAt: Date
  payableFrom: Date
  dueAt: Date | null
  issueAuditId: string
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

/** True when `state` is a post-payment state eligible for adjustment. */
export function isAdjustableInvoiceState(
  state: string,
): state is AdjustableInvoiceState {
  return (ADJUSTABLE_INVOICE_STATES as readonly string[]).includes(state)
}

export function adjustmentKindForAmount(amount: bigint): AdjustmentKind {
  return amount > 0n ? 'charge' : 'credit'
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
    throw new BadRequestException(CREATE_ADJUSTMENT_ERRORS.REASON_REQUIRED())
  }
  return trimmed
}

function requireNonZeroAmount(amount: bigint): bigint {
  if (amount === 0n) {
    throw new BadRequestException(CREATE_ADJUSTMENT_ERRORS.AMOUNT_ZERO())
  }
  return amount
}

function appendAdjustedByInvoiceId(
  metadata: Record<string, unknown>,
  adjustmentInvoiceId: string,
): Record<string, unknown> {
  const existing = metadata.adjustedByInvoiceIds
  const list = Array.isArray(existing)
    ? existing.filter((id): id is string => typeof id === 'string')
    : []
  if (!list.includes(adjustmentInvoiceId)) list.push(adjustmentInvoiceId)
  return { ...metadata, adjustedByInvoiceIds: list }
}

function adjustmentLine(reason: string, absAmount: bigint): ManualInvoiceLineInput {
  return {
    description: reason,
    quantity: 1,
    unitPrice: absAmount,
    vatRate: 0,
    isTaxable: false,
  }
}

@Injectable()
export class CreateAdjustmentInvoiceService {
  private readonly logger = new Logger(CreateAdjustmentInvoiceService.name)

  constructor(
    private readonly stateMachine: InvoiceStateMachineService,
    private readonly dueAtCalculation: DueAtCalculationService,
  ) {}

  /**
   * Create a linked adjustment invoice for a paid original.
   *
   * @throws BadRequestException on empty reason, zero amount, or a charge
   *   due date in the past.
   * @throws NotFoundException when the original invoice does not exist.
   * @throws ConflictException when the original has no confirmed payment
   *   or is not in an adjustable post-payment state.
   */
  async createAdjustmentInvoice(
    cmd: CreateAdjustmentInvoiceCommand,
  ): Promise<CreateAdjustmentInvoiceResult> {
    const reason = requireReason(cmd.reason)
    const amount = requireNonZeroAmount(cmd.amount)
    const kind = adjustmentKindForAmount(amount)
    const absAmount = amount < 0n ? -amount : amount
    const line = adjustmentLine(reason, absAmount)
    const calculation = calculateManualInvoice([line])
    const now = cmd.now ?? new Date()

    if (kind === 'charge' && cmd.dueAt !== undefined && cmd.dueAt.getTime() < now.getTime()) {
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
        [cmd.originalInvoiceId],
      )) as { rows: LockedOriginalRow[] }
      const original = locked.rows[0]
      if (!original) {
        throw new NotFoundException(`Invoice not found: ${cmd.originalInvoiceId}`)
      }

      const paidAmount = BigInt(original.paid_amount)
      if (paidAmount <= 0n) {
        throw new ConflictException(
          CREATE_ADJUSTMENT_ERRORS.NO_PAYMENT(cmd.originalInvoiceId),
        )
      }

      if (!isAdjustableInvoiceState(original.state)) {
        throw new ConflictException(
          CREATE_ADJUSTMENT_ERRORS.STATE_NOT_ADJUSTABLE(
            cmd.originalInvoiceId,
            original.state,
          ),
        )
      }

      let dueAt: Date | null = null
      let dueMeta: Record<string, unknown> | null = null
      if (kind === 'charge') {
        const due = await this.dueAtCalculation.resolve(client, {
          serviceType: duePeriodTypeForManual(),
          issuedAt: now,
          ...(cmd.dueAt !== undefined ? { staffOverride: cmd.dueAt } : {}),
        })
        dueAt = due.dueAt
        dueMeta = {
          dueAt: dueAt.toISOString(),
          source: due.source,
          configDays: due.configDays,
          serviceType: due.serviceType,
          periodId: due.periodId,
        }
      }

      const adjustmentId = uuidv7()
      const calculationSnapshot = buildManualInvoiceCalculationSnapshot(
        [line],
        calculation,
      )
      const adjustmentMetadata = JSON.stringify({
        source: 'adjustment',
        kind,
        generatedBy: cmd.actorUserId,
        adjustmentForInvoiceId: cmd.originalInvoiceId,
        originalType: original.type,
        reason,
        amount: amount.toString(),
        ...(dueMeta !== null ? { due: dueMeta } : {}),
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
            invoice_calculation_snapshot, adjustment_for_invoice_id)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'Draft', $6, NULL, NULL, $7,
                 $8::jsonb, $9::jsonb, $10)`,
        [
          adjustmentId,
          original.profile_id,
          original.order_id,
          original.contract_id,
          original.consultation_id,
          calculation.totalAmount,
          dueAt,
          adjustmentMetadata,
          JSON.stringify(calculationSnapshot),
          cmd.originalInvoiceId,
        ],
      )

      for (const [index, calculated] of calculation.lines.entries()) {
        await client.query(
          `INSERT INTO invoice_lines
             (id, invoice_id, description, quantity, unit_price, line_total,
              vat_rate, vat_amount, is_taxable, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            adjustmentId,
            calculated.description,
            calculated.quantity,
            calculated.unitPrice,
            calculated.lineTotal,
            calculated.vatRate,
            calculated.vatAmount,
            calculated.isTaxable,
            index,
          ],
        )
      }

      const issueTransition = await this.stateMachine.transition(
        adjustmentId,
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
      const nextOriginalMetadata = appendAdjustedByInvoiceId(
        originalMetadata,
        adjustmentId,
      )
      await client.query(
        `UPDATE invoices
            SET metadata = $1::jsonb, updated_at = $2
          WHERE id = $3`,
        [JSON.stringify(nextOriginalMetadata), now, cmd.originalInvoiceId],
      )

      const excerpt = await this.loadAdjustmentExcerpt(client, adjustmentId)

      await client.query('COMMIT')
      return {
        originalInvoiceId: cmd.originalInvoiceId,
        originalState: original.state as InvoiceState,
        adjustmentInvoiceId: adjustmentId,
        adjustmentState: excerpt.state,
        kind,
        amount,
        totalAmount: excerpt.totalAmount,
        adjustmentForInvoiceId: excerpt.adjustmentForInvoiceId,
        profileId: excerpt.profileId,
        contractId: excerpt.contractId,
        orderId: excerpt.orderId,
        consultationId: excerpt.consultationId,
        lines: excerpt.lines,
        issuedAt: excerpt.issuedAt,
        payableFrom: excerpt.payableFrom,
        dueAt: excerpt.dueAt,
        issueAuditId: issueTransition.auditId,
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
      this.logger.error(`Create adjustment invoice failed: ${String(error)}`)
      throw error
    } finally {
      client.release()
    }
  }

  private async loadAdjustmentExcerpt(
    client: TransactionClient,
    invoiceId: string,
  ): Promise<{
    profileId: string
    contractId: string | null
    orderId: string | null
    consultationId: string | null
    adjustmentForInvoiceId: string
    state: InvoiceState
    totalAmount: bigint
    lines: ManualInvoiceLineResult[]
    issuedAt: Date
    payableFrom: Date
    dueAt: Date | null
  }> {
    const invoiceResult = (await client.query(
      `SELECT id, profile_id, order_id, contract_id, consultation_id, state,
              total_amount, issued_at, payable_from, due_at,
              adjustment_for_invoice_id
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
        adjustment_for_invoice_id: string | null
      }>
    }
    const row = invoiceResult.rows[0]
    if (!row) throw new NotFoundException(`Invoice not found: ${invoiceId}`)
    if (!row.adjustment_for_invoice_id) {
      throw new NotFoundException(
        `Adjustment invoice ${invoiceId} is missing adjustment_for_invoice_id`,
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
      adjustmentForInvoiceId: row.adjustment_for_invoice_id,
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
