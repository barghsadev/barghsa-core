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
 *   3. persists the invoice (Draft, issue timestamps NULL) + its lines
 *      in ONE transaction;
 *   4. issues it (Draft → Unpaid) in the SAME transaction, setting
 *      issuedAt / payableFrom / dueAt and writing the canonical
 *      `invoice.issue` audit entry (S-04.1.01 audit rule);
 *   5. reads the result back INSIDE the transaction (read-your-own-writes)
 *      and only then COMMITs — a read failure can never be reported as a
 *      create failure for an already-committed invoice.
 *
 * Atomicity: the whole create+issue flow runs on a single DB connection
 * inside one BEGIN/COMMIT, with the state-machine transition joining the
 * caller's transaction via `TransitionOptions.client`. If anything fails
 * (validation, FK, issue), every row rolls back — no orphan Draft.
 *
 * Idempotency: an optional `idempotencyKey` is stored in the invoice
 * `metadata` and replayed inside the transaction. The lookup is scoped
 * to the same profile + `source = 'manual'`, and a SHA-256 fingerprint
 * of the normalized payload is stored so a reused key with a DIFFERENT
 * payload is rejected with a 409 instead of silently returning the wrong
 * invoice (no cross-profile disclosure). The durable idempotency-keys
 * framework (unique index, expiry) lands with C-04.CC.01.
 *
 * Money rules: all amounts are bigint IRR; floating point is forbidden;
 * VAT is rounded half-up per line (README §Invoices).
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import { getDbPool } from '@barghsa/db'
import { v7 as uuidv7 } from 'uuid'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import type { TransitionResult } from './invoice-state-machine.service.js'
import type { TransactionClient } from './invoice-audit.repository.js'
import type { InvoiceState } from './invoice-state.model.js'
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
   * Idempotency key: retrying with the same key and the same payload
   * returns the existing invoice instead of creating a duplicate. A key
   * reused with a different payload is rejected with ConflictException.
   */
  idempotencyKey?: string
  /** Explicit due date (>= now); defaults to issuedAt + 7 days. */
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
  state: InvoiceState
  totalAmount: bigint
  lines: ManualInvoiceLineResult[]
  issuedAt: Date
  payableFrom: Date
  dueAt: Date | null
  auditId: string
  transition: TransitionResult
}

/** Normalized payload fingerprint so idempotency keys cannot be reused
 *  for a different invoice. */
export function fingerprintManualInvoice(cmd: {
  profileId: string
  contractId?: string
  actorUserId: string
  lines: ManualInvoiceLineInput[]
}): string {
  const normal = {
    profileId: cmd.profileId,
    contractId: cmd.contractId ?? null,
    lines: cmd.lines.map((l) => ({
      description: l.description.trim(),
      quantity: l.quantity,
      unitPrice: l.unitPrice.toString(),
      vatRate: l.vatRate,
      isTaxable: l.isTaxable !== false,
    })),
  }
  return createHash('sha256').update(JSON.stringify(normal)).digest('hex')
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
   * @throws BadRequestException on invalid lines, a non-positive total,
   *   or a due date in the past.
   * @throws NotFoundException when the profile does not exist.
   * @throws ConflictException when an idempotency key is reused with a
   *   different payload.
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
    if (dueAt.getTime() < now.getTime()) {
      throw new BadRequestException('dueAt cannot be in the past')
    }

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
        throw new NotFoundException(`Profile not found: ${cmd.profileId}`)
      }

      // --- 3. Idempotency replay (same key + same payload → same invoice) ---
      if (cmd.idempotencyKey) {
        const fingerprint = fingerprintManualInvoice(cmd)
        const existing = (await client.query(
          `SELECT id, metadata FROM invoices
           WHERE profile_id = $1
             AND metadata->>'source' = 'manual'
             AND metadata->>'idempotencyKey' = $2
           LIMIT 1`,
          [cmd.profileId, cmd.idempotencyKey],
        )) as { rows: Array<{ id: string; metadata: Record<string, unknown> | null }> }

        if (existing.rows.length > 0) {
          const existingId = existing.rows[0]!.id
          const storedFingerprint =
            (existing.rows[0]!.metadata as Record<string, unknown> | null)
              ?.fingerprint ?? null
          if (storedFingerprint !== null && storedFingerprint !== fingerprint) {
            throw new ConflictException(
              `Idempotency key ${cmd.idempotencyKey} was already used with a different payload`,
            )
          }

          const replayed = await this.loadInvoiceExcerpt(client, existingId)
          const auditId = await this.findIssueAuditId(client, existingId)

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

      // --- 4. Insert the invoice (Draft, issue timestamps NULL) + snapshot ---
      const invoiceId = uuidv7()
      const metadata = JSON.stringify({
        source: 'manual',
        generatedBy: cmd.actorUserId,
        ...(cmd.idempotencyKey
          ? {
              idempotencyKey: cmd.idempotencyKey,
              fingerprint: fingerprintManualInvoice(cmd),
            }
          : {}),
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
         VALUES ($1, $2, $3, 'Draft', $4, NULL, NULL, $5, $6::jsonb)`,
        [
          invoiceId,
          cmd.profileId,
          cmd.contractId ?? null,
          calculation.totalAmount,
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

      // --- 7. Read back INSIDE the transaction (read-your-own-writes):
      //      a read failure here rolls back everything and cannot be
      //      reported as a create failure for a committed invoice. ---
      const excerpt = await this.loadInvoiceExcerpt(client, invoiceId)

      await client.query('COMMIT')
      return { ...excerpt, auditId: transition.auditId, transition }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
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
   * Find the `invoice.issue` audit entry id for an invoice.
   *
   * The lookup narrows on the indexed `event` column FIRST, so the
   * TEXT→jsonb cast on `metadata` is only evaluated for matching rows
   * (audit_log.metadata is TEXT holding JSON; a global cast would 22P02
   * on any non-JSON row written by another service).
   */
  private async findIssueAuditId(
    client: TransactionClient,
    invoiceId: string,
  ): Promise<string> {
    const auditResult = (await client.query(
      `SELECT id FROM audit_log
       WHERE event = 'invoice.issue'
         AND metadata::jsonb->>'invoiceId' = $1
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      [invoiceId],
    )) as { rows: Array<{ id: string }> }
    return auditResult.rows[0]?.id ?? ''
  }

  /**
   * Load one invoice (state/totals/dates) with its lines in display order.
   * Queries run on the provided (transaction-scoped or pool) client.
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
      // The state is read from the DB — never cast. Fresh creates are
      // 'Unpaid' after the Issue transition; replayed invoices may have
      // moved on (paid/cancelled) and are reported truthfully.
      state: row.state as InvoiceState,
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