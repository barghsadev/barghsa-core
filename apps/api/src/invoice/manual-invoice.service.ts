/**
 * ManualInvoiceService — staff-created custom invoices (T-04.1.02.02).
 *
 * Finance staff can create an invoice with N custom description+price
 * lines, optionally linked to a profile and/or contract (S-04.1.02
 * "Manual invoices"). The system:
 *
 *   1. validates the input lines and the target profile;
 *   2. calculates `lineTotal`, per-line `vatAmount` (half-up rounded to
 *      the nearest IRR on taxable lines) and the invoice `totalAmount`;
 *   3. persists the invoice (Draft) + its lines in ONE transaction;
 *   4. issues it (Draft → Unpaid) in the SAME transaction, setting
 *      issuedAt / payableFrom / dueAt and writing the canonical
 *      `invoice.issue` audit entry (S-04.1.01 audit rule).
 *
 * Atomicity: the whole create+issue flow runs on a single DB connection
 * inside one BEGIN/COMMIT, with the state-machine transition joining the
 * caller's transaction via `TransitionOptions.client`. If anything fails
 * (validation, FK, issue), every row rolls back — no orphan Draft.
 *
 * Idempotency: an optional `idempotencyKey` is stored in the invoice
 * `metadata` and replayed inside the transaction (a retry with the same
 * key returns the already-created invoice instead of duplicating it).
 * The durable idempotency-keys framework (unique index, expiry) lands
 * with C-04.CC.01; this is the per-command minimal guard so immediate
 * retries are safe.
 *
 * Money rules: all amounts are bigint IRR; floating point is forbidden;
 * VAT is rounded half-up per line (README §Invoices).
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { v7 as uuidv7 } from 'uuid'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import type { TransitionResult } from './invoice-state-machine.service.js'
import type { TransactionClient } from './invoice-audit.repository.js'
import {
  calculateManualInvoice,
  type CalculatedManualLine,
  type ManualInvoiceLineInput,
} from './manual-invoice.calculation.js'

/**
 * Default due period for manual invoices (days from issue).
 *
 * Pending T-04.1.03.01/.02 (admin-configured `service_due_periods`), a
 * manual invoice is due 7 days after issue. Callers can override via
 * `dueAt`.
 */
export const DEFAULT_MANUAL_DUE_DAYS = 7

/** Command to create and issue one manual invoice. */
export interface CreateManualInvoiceCommand {
  /** Customer profile the invoice is issued to. */
  profileId: string
  /** Optional contract reference (text FK placeholder, S-04.1.02). */
  contractId?: string
  /** Custom lines entered by the staff member. At least one required. */
  lines: ManualInvoiceLineInput[]
  /** The finance staff member performing the action (FK `users.userId`). */
  actorUserId: string
  /** Opaque correlation ID for audit linkage. */
  correlationId?: string
  /** Human-readable reason (audited). */
  reason?: string
  /** Source IP of the staff member (audited). */
  ip?: string
  /**
   * Idempotency key: retrying with the same key returns the existing
   * invoice instead of creating a duplicate.
   */
  idempotencyKey?: string
  /** Explicit due date; defaults to issuedAt + 7 days. */
  dueAt?: Date
  /** Override "now" for tests. */
  now?: Date
}

/** A persisted line as returned to the caller. */
export interface ManualInvoiceLineResult extends CalculatedManualLine {
  id: string
  position: number
}

/** Result of a successful create-and-issue. */
export interface ManualInvoiceResult {
  invoiceId: string
  profileId: string
  contractId: string | null
  state: 'Unpaid'
  totalAmount: bigint
  lines: ManualInvoiceLineResult[]
  issuedAt: Date
  payableFrom: Date
  dueAt: Date | null
  auditId: string
  transition: TransitionResult
}

@Injectable()
export class ManualInvoiceService {
  private readonly logger = new Logger(ManualInvoiceService.name)

  constructor(
    private readonly stateMachine: InvoiceStateMachineService,
  ) {}

  /**
   * Create a manual invoice and issue it atomically.
   *
   * @throws BadRequestException on invalid lines or a non-positive total.
   * @throws NotFoundException when the profile does not exist.
   */
  async createManualInvoice(
    cmd: CreateManualInvoiceCommand,
  ): Promise<ManualInvoiceResult> {
    // --- 1. Pure validation + calculation (throws RangeError) ---
    let calculation
    try {
      calculation = calculateManualInvoice(cmd.lines)
    } catch (err: unknown) {
      if (err instanceof RangeError) {
        throw new BadRequestException(err.message)
      }
      throw err
    }

    const now = cmd.now ?? new Date()
    const dueAt =
      cmd.dueAt ??
      new Date(now.getTime() + DEFAULT_MANUAL_DUE_DAYS * 24 * 60 * 60 * 1000)

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // --- 2. Profile must exist (clean 404 + FK pre-check) ---
      const profileResult = (await client.query(
        `SELECT id FROM profiles WHERE id = $1`,
        [cmd.profileId],
      )) as { rows: Array<{ id: string }> }
      if (profileResult.rows.length === 0) {
        await client.query('ROLLBACK').catch(() => {})
        throw new NotFoundException(`Profile not found: ${cmd.profileId}`)
      }

      // --- 3. Idempotency replay (same key → same invoice) ---
      if (cmd.idempotencyKey) {
        const existing = (await client.query(
          `SELECT id FROM invoices WHERE metadata->>'idempotencyKey' = $1 LIMIT 1`,
          [cmd.idempotencyKey],
        )) as { rows: Array<{ id: string }> }
        if (existing.rows.length > 0) {
          const existingId = existing.rows[0]!.id
          const replayed = await this.loadInvoiceExcerpt(client, existingId)

          // Return the original creation result (C-04.CC.01 cached-response
          // semantics): the issue audit id of the original creation.
          // audit_log.metadata is TEXT holding JSON — cast to jsonb.
          const auditResult = (await client.query(
            `SELECT id FROM audit_log
             WHERE metadata::jsonb->>'invoiceId' = $1
             ORDER BY created_at ASC, id ASC LIMIT 1`,
            [existingId],
          )) as { rows: Array<{ id: string }> }
          const auditId = auditResult.rows[0]?.id ?? ''

          await client.query('COMMIT')
          return {
            ...replayed,
            auditId,
            transition: {
              invoiceId: existingId,
              fromState: 'Draft' as const,
              toState: 'Unpaid' as const,
              transition: 'Issue' as const,
              auditId,
            },
          }
        }
      }

      // --- 4. Insert the invoice (Draft) + calculation snapshot ---
      const invoiceId = uuidv7()
      const metadata = JSON.stringify({
        source: 'manual',
        generatedBy: cmd.actorUserId,
        ...(cmd.idempotencyKey ? { idempotencyKey: cmd.idempotencyKey } : {}),
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
        `INSERT INTO invoices (id, profile_id, contract_id, state, total_amount, issued_at, payable_from, due_at, metadata)
         VALUES ($1, $2, $3, 'Draft', $4, $5, $5, $6, $7::jsonb)`,
        [
          invoiceId,
          cmd.profileId,
          cmd.contractId ?? null,
          calculation.totalAmount,
          now,
          dueAt,
          metadata,
        ],
      )

      // --- 5. Insert the lines (position = entry order) ---
      for (const [index, line] of calculation.lines.entries()) {
        await client.query(
          `INSERT INTO invoice_lines
             (id, invoice_id, description, quantity, unit_price, line_total, vat_rate, vat_amount, is_taxable, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            invoiceId,
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

      // --- 6. Issue: Draft → Unpaid on the SAME transaction ---
      const transition = await this.stateMachine.transition(
        invoiceId,
        'Draft',
        'Unpaid',
        {
          actorUserId: cmd.actorUserId,
          // exactOptionalPropertyTypes: only spread present fields
          ...(cmd.correlationId !== undefined ? { correlationId: cmd.correlationId } : {}),
          ...(cmd.reason !== undefined ? { reason: cmd.reason } : {}),
          ...(cmd.ip !== undefined ? { ip: cmd.ip } : {}),
          now,
          client,
        },
      )

      await client.query('COMMIT')

      const result = await this.loadInvoiceExcerpt(client, invoiceId)
      return { ...result, auditId: transition.auditId, transition }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error
      }
      this.logger.error(`Manual invoice creation failed: ${String(error)}`)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Load one invoice (state/totals/dates) with its lines in display order.
   * Used after COMMIT and for idempotency replay. Queries run on the
   * provided (transaction-scoped or pool) client.
   */
  private async loadInvoiceExcerpt(
    client: TransactionClient,
    invoiceId: string,
  ): Promise<Omit<ManualInvoiceResult, 'auditId' | 'transition'>> {
    const invoiceResult = (await client.query(
      `SELECT id, profile_id, contract_id, state, total_amount,
              issued_at, payable_from, due_at
       FROM invoices WHERE id = $1`,
      [invoiceId],
    )) as {
      rows: Array<{
        id: string
        profile_id: string
        contract_id: string | null
        state: string
        total_amount: string
        issued_at: Date | null
        payable_from: Date | null
        due_at: Date | null
      }>
    }
    const row = invoiceResult.rows[0]
    if (!row) throw new NotFoundException(`Invoice not found: ${invoiceId}`)

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
      invoiceId: row.id,
      profileId: row.profile_id,
      contractId: row.contract_id,
      state: row.state as 'Unpaid',
      totalAmount: BigInt(row.total_amount),
      // issued_at / payable_from are set by the Issue transition; the
      // fallbacks keep the type honest for hypothetical legacy rows.
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