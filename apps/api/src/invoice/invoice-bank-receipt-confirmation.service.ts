import { createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { classifyNotificationType } from '@barghsa/shared/notifications'
import {
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRM_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
  INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
  INVOICE_BANK_RECEIPT_REJECT_CHANNELS,
  INVOICE_BANK_RECEIPT_REJECT_ERRORS,
  INVOICE_BANK_RECEIPT_REJECTED_EVENT,
  INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY,
  allocateReceiptAgainstInvoice,
  bankReceiptOverpaymentSnapshot,
  buildInvoiceBankReceiptRejectedNotificationPayload,
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REASON,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT,
  invoiceBankReceiptDualApprovalDetails,
  invoiceBankReceiptReasonFromDualApprovalRejection,
  invoiceBankReceiptOverpaymentCreditIdempotencyKey,
  invoiceBankReceiptOverpaymentCreditMetadata,
  invoiceBankReceiptRejectedNotificationIdempotencyKey,
  invoiceBankReceiptRequiresDualApproval,
  invoiceStateAfterBankReceiptAllocation,
  isBankReceiptInvoiceLinkAllowedState,
  isInvoiceBankReceiptConfirmableState,
  isInvoiceBankReceiptRejectableState,
  parseInvoiceBankReceiptRejectReason,
  readInvoiceBankReceiptDualApprovalThreshold,
  readInvoiceBankReceiptOverpaymentFromCreditMetadata,
  receiptIdFromInvoiceBankReceiptDualApprovalDetails,
  remainingForBankReceiptSettlement,
  type BankReceiptOverpaymentSnapshot,
  type InvoiceBankReceiptDualApprovalThresholdRead,
} from '@barghsa/shared/finance'
import type { StorageProvider } from '@barghsa/shared/storage'
import { STORAGE_PROVIDER } from '../storage/storage.constants.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import {
  isInvoiceState,
  type InvoiceState,
} from './invoice-state.model.js'
import {
  WalletService,
  type TransactionRow,
  type WalletQueryClient,
} from '../wallet/wallet.service.js'

const ATTACHMENT_URL_TTL_SECONDS = 15 * 60

const RECEIPT_SELECT = `id, invoice_id, profile_id, amount,
       to_char(payment_date, 'YYYY-MM-DD') AS payment_date,
       payer_reference, attachment_key, customer_note, state,
       confirmed_by, confirmed_at, rejection_reason,
       created_at, updated_at`

interface BankReceiptRow {
  id: string
  invoice_id: string
  profile_id: string
  amount: string | number | bigint
  payment_date: string
  payer_reference: string
  attachment_key: string
  customer_note: string | null
  state: string
  confirmed_by: string | null
  confirmed_at: Date | string | null
  rejection_reason: string | null
  created_at: Date | string
  updated_at: Date | string
}

interface InvoiceRow {
  id: string
  profile_id: string
  state: string
  total_amount: string | number | bigint
  paid_amount: string | number | bigint
  refunded_amount: string | number | bigint
  adjustment_kind: string | null
}

/** Public DTO for the staff confirmation API. */
export interface InvoiceBankReceiptConfirmDto {
  receiptId: string
  invoiceId: string
  profileId: string
  amount: string
  currency: 'IRR'
  state: string
  paymentDate: string
  payerReference: string
  attachmentKey: string
  attachmentUrl: string | null
  customerNote: string | null
  submittedAt: string
  canConfirm: boolean
  canReject: boolean
  confirmedBy: string | null
  confirmedAt: string | null
  rejectionReason: string | null
  invoiceState: string | null
  remaining: string | null
  invoiceAllocation: string | null
  walletCreditAmount: string | null
  overpayment: BankReceiptOverpaymentSnapshot | null
  requiresDualApproval: boolean
  dualApprovalPending: boolean
  dualApprovalRequestId: string | null
  dualApprovalInitiatedBy: string | null
  dualApprovalThresholdIrR: string | null
  auditId?: string
  notificationOutboxId?: string
}

export interface InvoiceBankReceiptAllocationPreviewDto {
  receiptId: string
  invoiceId: string
  invoiceState: string
  receiptAmount: string
  remaining: string
  invoiceAllocation: string
  walletCreditAmount: string
  isOverpayment: boolean
}

export interface ConfirmInvoiceBankReceiptInput {
  receiptId: string
  actorUserId: string
  ip: string
  correlationId?: string
  now?: Date
}

export interface RejectInvoiceBankReceiptInput {
  receiptId: string
  raw: Record<string, unknown>
  actorUserId: string
  ip: string
  correlationId?: string
  now?: Date
}

const CUSTOMER_NOTIFICATION_MAX_ATTEMPTS = 5

/**
 * Staff confirmation of invoice bank receipts (T-04.3.01.03).
 *
 * Confirm (one DB transaction):
 *   1. Lock the Submitted / UnderReview `bank_receipts` row.
 *   2. Ensure + lock the profile wallet, then lock the invoice (same
 *      order as `payInvoiceWithWallet` so concurrent settlement cannot
 *      deadlock).
 *   3. Allocate `min(receipt, remaining)` onto `paid_amount` (never
 *      over-settle). Transition Unpaid / PartiallyFunded through
 *      SubmitBankReceipt into PaymentUnderReview, then ConfirmBankReceipt
 *      to Paid or PartiallyFunded. Closed invoices (Overdue, Draft,
 *      Cancelled, Refunded, PartiallyRefunded) conflict. Paid invoices
 *      have remaining 0, so the whole receipt is wallet excess.
 *   4. Excess is credited via a separate `WalletService.credit()` with
 *      `invoiceBankReceiptOverpaymentCreditIdempotencyKey`.
 *   5. Dual-approval (T-04.3.01.05): if the receipt amount is ≥ the
 *      admin-configured `finance.dual_approval_threshold` (and the
 *      threshold is enabled), the first finance staff confirmation
 *      parks the receipt in UnderReview and inserts a pending
 *      `bank_payment_confirmation` approval request. A second, different
 *      finance staff member must confirm before steps 3–4 and 6 run.
 *      Missing / zero threshold disables the gate. A corrupt stored
 *      threshold fails closed.
 *   6. Mark the receipt Confirmed (`confirmed_by` / `confirmedAt`) and
 *      append an audit row.
 *   Allocation, state transition, wallet credit, receipt confirm, and
 *   audit commit or roll back together. Re-confirm of an already
 *   Confirmed receipt is idempotent. Same-staff retry of a parked
 *   dual-approval confirm is idempotent and does not settle.
 *
 * Reject (T-04.3.01.04, one DB transaction, same advisory lock as confirm):
 *   1. Parse a customer-visible reason before locking.
 *   2. Lock the Submitted / UnderReview row.
 *   3. Write `Rejected` + `rejection_reason`. Never touch `paid_amount`
 *      or the wallet.
 *   4. Enqueue `payment.bank_receipt_rejected` (in-app + email) to the
 *      profile owner. Receipt reject and notify intent commit together.
 *   5. Append an audit row.
 *   Re-reject with the same reason is idempotent.
 */
@Injectable()
export class InvoiceBankReceiptConfirmationService {
  private readonly logger = new Logger(InvoiceBankReceiptConfirmationService.name)
  private readonly invoiceStateMachine: InvoiceStateMachineService

  constructor(
    private readonly walletService: WalletService,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null = null,
    @Optional()
    invoiceStateMachine?: InvoiceStateMachineService,
  ) {
    this.invoiceStateMachine =
      invoiceStateMachine ?? new InvoiceStateMachineService(new InvoiceAuditRepository())
  }

  async listPending(): Promise<InvoiceBankReceiptConfirmDto[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT ${RECEIPT_SELECT}
         FROM bank_receipts
        WHERE state IN ('Submitted', 'UnderReview')
        ORDER BY created_at ASC`,
    )
    const items: InvoiceBankReceiptConfirmDto[] = []
    const dualByReceipt = await this.loadPendingDualApprovalsByReceiptIds(
      pool,
      result.rows.map((row) => (row as BankReceiptRow).id),
    )
    const thresholdRead = await this.loadDualApprovalThreshold(pool)
    for (const row of result.rows as BankReceiptRow[]) {
      const pending = dualByReceipt.get(row.id)
      items.push(
        await this.toDto(row, {
          ...dualApprovalExtrasFromRead(thresholdRead, BigInt(row.amount), pending),
        }),
      )
    }
    return items
  }

  async get(receiptId: string): Promise<InvoiceBankReceiptConfirmDto> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT ${RECEIPT_SELECT} FROM bank_receipts WHERE id = $1`,
      [receiptId],
    )
    const row = (result.rows as BankReceiptRow[])[0]
    if (!row) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Invoice bank receipt not found: ${receiptId}`,
        404,
      )
    }
    const extra = await this.loadCurrentAllocation(pool, row)
    const dual = await this.loadDualApprovalDtoExtras(pool, row)
    return this.toDto(row, { ...extra, ...dual })
  }

  async previewAllocation(receiptId: string): Promise<InvoiceBankReceiptAllocationPreviewDto> {
    const pool = getDbPool()
    const receiptResult = await pool.query(
      `SELECT ${RECEIPT_SELECT} FROM bank_receipts WHERE id = $1`,
      [receiptId],
    )
    const receipt = (receiptResult.rows as BankReceiptRow[])[0]
    if (!receipt) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Invoice bank receipt not found: ${receiptId}`,
        404,
      )
    }
    const invoiceResult = await pool.query(
      `SELECT id, profile_id, state, total_amount, paid_amount, refunded_amount, adjustment_kind
         FROM invoices WHERE id = $1`,
      [receipt.invoice_id],
    )
    const invoice = (invoiceResult.rows as InvoiceRow[])[0]
    if (!invoice) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Invoice not found: ${receipt.invoice_id}`,
        404,
      )
    }
    this.assertInvoiceAcceptsBankReceiptAllocation(invoice)
    const remaining = remainingForBankReceiptSettlement({
      totalAmount: BigInt(invoice.total_amount),
      paidAmount: BigInt(invoice.paid_amount),
      state: invoice.state,
    })
    const allocation = allocateReceiptAgainstInvoice({
      receiptAmount: BigInt(receipt.amount),
      remaining,
    })
    return {
      receiptId: receipt.id,
      invoiceId: invoice.id,
      invoiceState: invoice.state,
      receiptAmount: BigInt(receipt.amount).toString(),
      remaining: remaining.toString(),
      invoiceAllocation: allocation.invoiceAllocation.toString(),
      walletCreditAmount: allocation.walletCreditAmount.toString(),
      isOverpayment: allocation.isOverpayment,
    }
  }

  async confirm(input: ConfirmInvoiceBankReceiptInput): Promise<InvoiceBankReceiptConfirmDto> {
    const now = input.now ?? new Date()
    const pool = getDbPool()
    const client = await pool.connect()
    const lockKeys = invoiceBankReceiptConfirmationLockKeys(input.receiptId)
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys)
      try {
        await client.query('BEGIN')
        const receipt = await this.lockReceipt(client, input.receiptId)

        if (receipt.state === 'Confirmed') {
          const extra = await this.loadConfirmedAllocation(client, receipt)
          await client.query('COMMIT')
          return this.toDto(receipt, extra)
        }

        if (receipt.state === 'Rejected') {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
            409,
          )
        }

        if (!isInvoiceBankReceiptConfirmableState(receipt.state)) {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.NOT_CONFIRMABLE(receipt.state),
            409,
          )
        }

        const thresholdRead = await this.loadDualApprovalThreshold(client)
        if (thresholdRead.status === 'corrupt') {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.CONFIG_CORRUPT(),
            409,
          )
        }

        const latestRequest = await this.lockLatestDualApprovalRequest(client, receipt.id)
        const requiresDual = invoiceBankReceiptRequiresDualApproval(
          thresholdRead,
          receipt.amount,
        )

        if (latestRequest?.status === 'pending') {
          if (latestRequest.initiatorId === input.actorUserId) {
            const parked = await this.ensureUnderReview(client, receipt.id)
            await client.query('COMMIT')
            return this.toDto(parked ?? { ...receipt, state: 'UnderReview' }, {
              ...dualApprovalExtrasFromRead(thresholdRead, receipt.amount, latestRequest),
            })
          }
          await this.markDualApprovalApproved(
            client,
            latestRequest.id,
            input.actorUserId,
            now,
          )
        } else if (latestRequest?.status === 'rejected') {
          await this.synchronizeReceiptWithRejectedDualApproval(client, {
            receipt,
            latestRequest,
            actorUserId: input.actorUserId,
            ip: input.ip,
            ...(input.correlationId !== undefined
              ? { correlationId: input.correlationId }
              : {}),
            now,
          })
          await client.query('COMMIT')
          this.logger.log(
            `Invoice bank receipt ${receipt.id} blocked after dual-approval rejection of ${latestRequest.id}`,
          )
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.APPROVAL_REJECTED(),
            409,
          )
        } else if (latestRequest?.status !== 'approved' && requiresDual) {
          const parked = await this.parkForDualApproval(client, {
            receipt,
            actorUserId: input.actorUserId,
            ip: input.ip,
            ...(input.correlationId !== undefined
              ? { correlationId: input.correlationId }
              : {}),
            now,
            thresholdRead,
          })
          await client.query('COMMIT')
          this.logger.log(
            `Invoice bank receipt ${receipt.id} parked for dual approval by ${input.actorUserId}`,
          )
          return parked
        }

        await this.ensureAndLockWallet(client, receipt.profileId)
        const invoice = await this.lockInvoice(client, receipt.invoiceId)
        if (invoice.profile_id !== receipt.profileId) {
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            BANK_RECEIPT_OVERPAYMENT_ERRORS.PROFILE_MISMATCH(),
            409,
          )
        }
        this.assertInvoiceAcceptsBankReceiptAllocation(invoice)

        const remaining = remainingForBankReceiptSettlement({
          totalAmount: BigInt(invoice.total_amount),
          paidAmount: BigInt(invoice.paid_amount),
          state: invoice.state,
        })
        const allocation = allocateReceiptAgainstInvoice({
          receiptAmount: receipt.amount,
          remaining,
        })

        if (allocation.invoiceAllocation > 0n) {
          await this.applyInvoiceAllocation(client, invoice.id, allocation.invoiceAllocation)
          await this.confirmInvoiceAfterAllocation(client, {
            invoice,
            paidAfter: BigInt(invoice.paid_amount) + allocation.invoiceAllocation,
            actorUserId: input.actorUserId,
            ip: input.ip,
            ...(input.correlationId !== undefined
              ? { correlationId: input.correlationId }
              : {}),
            now,
          })
        }

        let overpaymentCreditId: string | null = null
        if (allocation.walletCreditAmount > 0n) {
          const credit = await this.walletService.credit(
            receipt.profileId,
            allocation.walletCreditAmount,
            {
              type: 'topup',
              refId: receipt.id,
              description: INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
              metadata: invoiceBankReceiptOverpaymentCreditMetadata({
                receiptId: receipt.id,
                invoiceId: invoice.id,
                confirmedBy: input.actorUserId,
                confirmedAt: now,
                invoiceAllocation: allocation.invoiceAllocation,
                walletCreditAmount: allocation.walletCreditAmount,
                remainingBefore: remaining,
              }),
            },
            invoiceBankReceiptOverpaymentCreditIdempotencyKey(receipt.id),
            client,
          )
          overpaymentCreditId = credit.id
        }

        const overpayment = bankReceiptOverpaymentSnapshot({
          invoiceId: invoice.id,
          remainingBefore: remaining,
          invoiceAllocation: allocation.invoiceAllocation,
          walletCreditAmount: allocation.walletCreditAmount,
          overpaymentCreditTransactionId: overpaymentCreditId,
        })

        const updated = await this.markConfirmed(
          client,
          receipt.id,
          input.actorUserId,
          now,
        )
        const dualSettled = dualApprovalExtrasFromRead(
          thresholdRead,
          receipt.amount,
          latestRequest
            ? {
                ...latestRequest,
                status: latestRequest.status === 'pending' ? 'approved' : latestRequest.status,
              }
            : null,
        )
        const auditId = await this.recordAudit(client, {
          event: INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
          actorUserId: input.actorUserId,
          ip: input.ip,
          correlationId: input.correlationId,
          metadata: {
            receiptId: receipt.id,
            invoiceId: invoice.id,
            profileId: receipt.profileId,
            amount: receipt.amount.toString(),
            previousState: receipt.state,
            newState: 'Confirmed',
            invoiceAllocation: overpayment.invoiceAllocation,
            walletCreditAmount: overpayment.walletCreditAmount,
            remainingBefore: overpayment.remainingBefore,
            overpaymentCreditTransactionId: overpayment.overpaymentCreditTransactionId,
            dualApprovalRequestId: dualSettled.dualApprovalRequestId,
            dualApprovalInitiatedBy: dualSettled.dualApprovalInitiatedBy,
            secondConfirmedBy: dualSettled.dualApprovalInitiatedBy
              ? input.actorUserId
              : null,
          },
          occurredAt: now,
        })
        await client.query('COMMIT')

        this.logger.log(
          `Invoice bank receipt ${receipt.id} confirmed against invoice ${invoice.id}; wallet excess ${overpayment.walletCreditAmount}`,
        )
        const destination = invoiceStateAfterConfirm(invoice, allocation.invoiceAllocation)
        return this.toDto(updated ?? { ...receipt, state: 'Confirmed' }, {
          overpayment,
          auditId,
          invoiceState: destination,
          remaining: remainingAfter(remaining, allocation.invoiceAllocation),
          ...dualSettled,
          dualApprovalPending: false,
        })
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys)
      }
    } finally {
      client.release()
    }
  }

  async reject(input: RejectInvoiceBankReceiptInput): Promise<InvoiceBankReceiptConfirmDto> {
    const parsed = parseInvoiceBankReceiptRejectReason(input.raw)
    if (!parsed.ok) {
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, parsed.message, 400)
    }

    const now = input.now ?? new Date()
    const pool = getDbPool()
    const client = await pool.connect()
    const lockKeys = invoiceBankReceiptConfirmationLockKeys(input.receiptId)
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys)
      try {
        await client.query('BEGIN')
        const receipt = await this.lockReceipt(client, input.receiptId)

        if (receipt.state === 'Rejected') {
          if (receipt.rejection_reason === parsed.reason) {
            await client.query('COMMIT')
            return this.toDto(receipt)
          }
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
            409,
          )
        }

        if (receipt.state === 'Confirmed') {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_CONFIRMED(),
            409,
          )
        }

        if (!isInvoiceBankReceiptRejectableState(receipt.state)) {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_REJECT_ERRORS.NOT_REJECTABLE(receipt.state),
            409,
          )
        }

        const ownerUserId = await this.loadProfileOwnerUserId(client, receipt.profileId)
        if (!ownerUserId) {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            INVOICE_BANK_RECEIPT_REJECT_ERRORS.OWNER_UNNOTIFIABLE(),
            409,
          )
        }

        const updated = await this.markRejected(client, receipt.id, parsed.reason)
        await this.markPendingDualApprovalRejected(client, {
          receiptId: receipt.id,
          reviewerUserId: input.actorUserId,
          reason: parsed.reason,
          now,
        })
        const notify = await this.enqueueCustomerRejectionNotice(client, {
          receiptId: receipt.id,
          invoiceId: receipt.invoiceId,
          profileId: receipt.profileId,
          userId: ownerUserId,
          amount: receipt.amount.toString(),
          reason: parsed.reason,
          rejectedAt: now,
        })
        const auditId = await this.recordAudit(client, {
          event: INVOICE_BANK_RECEIPT_REJECTED_EVENT,
          actorUserId: input.actorUserId,
          ip: input.ip,
          correlationId: input.correlationId,
          metadata: {
            receiptId: receipt.id,
            invoiceId: receipt.invoiceId,
            profileId: receipt.profileId,
            amount: receipt.amount.toString(),
            reason: parsed.reason,
            customerVisible: true,
            previousState: receipt.state,
            newState: 'Rejected',
            notificationOutboxId: notify.outboxId,
          },
          occurredAt: now,
        })
        await client.query('COMMIT')

        this.logger.log(
          `Invoice bank receipt ${receipt.id} rejected against invoice ${receipt.invoiceId}`,
        )
        return this.toDto(
          updated ?? {
            ...receipt,
            state: 'Rejected',
            rejection_reason: parsed.reason,
          },
          {
            auditId,
            ...(notify.outboxId ? { notificationOutboxId: notify.outboxId } : {}),
          },
        )
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys)
      }
    } finally {
      client.release()
    }
  }

  private async parkForDualApproval(
    client: WalletQueryClient,
    input: {
      receipt: BankReceiptRow & { invoiceId: string; profileId: string; amount: bigint }
      actorUserId: string
      ip: string
      correlationId?: string
      now: Date
      thresholdRead: InvoiceBankReceiptDualApprovalThresholdRead
    },
  ): Promise<InvoiceBankReceiptConfirmDto> {
    const requestId = uuidv7()
    const details = invoiceBankReceiptDualApprovalDetails({
      receiptId: input.receipt.id,
      invoiceId: input.receipt.invoiceId,
      profileId: input.receipt.profileId,
    })
    await client.query(
      `INSERT INTO approval_requests
         (id, action_type, amount_irr, initiator_id, reason, details, status, created_at, updated_at)
       VALUES ($1, $2, $3::bigint, $4, $5, $6::jsonb, 'pending', $7, $7)`,
      [
        requestId,
        INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
        input.receipt.amount.toString(),
        input.actorUserId,
        INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REASON,
        JSON.stringify(details),
        input.now,
      ],
    )
    const parked = await this.ensureUnderReview(client, input.receipt.id)
    await this.recordAudit(client, {
      event: INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT,
      actorUserId: input.actorUserId,
      ip: input.ip,
      correlationId: input.correlationId,
      metadata: {
        receiptId: input.receipt.id,
        invoiceId: input.receipt.invoiceId,
        profileId: input.receipt.profileId,
        amount: input.receipt.amount.toString(),
        previousState: input.receipt.state,
        newState: 'UnderReview',
        dualApprovalRequestId: requestId,
        dualApprovalInitiatedBy: input.actorUserId,
        dualApprovalThresholdIrR: thresholdIrRLabel(input.thresholdRead),
      },
      occurredAt: input.now,
    })
    const pending: DualApprovalRequestSummary = {
      id: requestId,
      initiatorId: input.actorUserId,
      status: 'pending',
    }
    return this.toDto(parked ?? { ...input.receipt, state: 'UnderReview' }, {
      ...dualApprovalExtrasFromRead(input.thresholdRead, input.receipt.amount, pending),
    })
  }

  private async ensureUnderReview(
    client: WalletQueryClient,
    receiptId: string,
  ): Promise<BankReceiptRow | null> {
    const result = await client.query(
      `UPDATE bank_receipts
          SET state = 'UnderReview'
        WHERE id = $1
          AND state IN ('Submitted', 'UnderReview')
        RETURNING ${RECEIPT_SELECT}`,
      [receiptId],
    )
    return (result.rows as BankReceiptRow[])[0] ?? null
  }

  private async loadDualApprovalThreshold(
    queryable: WalletQueryClient,
  ): Promise<InvoiceBankReceiptDualApprovalThresholdRead> {
    const result = await queryable.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [DUAL_APPROVAL_THRESHOLD_CONFIG_KEY],
    )
    const raw = result.rows[0] as { value?: unknown } | undefined
    return readInvoiceBankReceiptDualApprovalThreshold(
      raw === undefined ? undefined : raw.value,
    )
  }

  private async lockLatestDualApprovalRequest(
    client: WalletQueryClient,
    receiptId: string,
  ): Promise<DualApprovalRequestSummary | null> {
    const result = await client.query(
      `SELECT id, initiator_id, status, review_reason, reviewer_id
         FROM approval_requests
        WHERE action_type = $1
          AND details->>'receiptId' = $2
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE, receiptId],
    )
    return toDualApprovalSummary(result.rows[0])
  }

  private async markDualApprovalApproved(
    client: WalletQueryClient,
    requestId: string,
    reviewerUserId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE approval_requests
          SET status = 'approved',
              reviewer_id = $2,
              reviewed_at = $3,
              updated_at = $3
        WHERE id = $1
          AND status = 'pending'`,
      [requestId, reviewerUserId, now],
    )
  }

  private async markPendingDualApprovalRejected(
    client: WalletQueryClient,
    input: {
      receiptId: string
      reviewerUserId: string
      reason: string
      now: Date
    },
  ): Promise<void> {
    await client.query(
      `UPDATE approval_requests
          SET status = 'rejected',
              reviewer_id = $2,
              review_reason = $3,
              reviewed_at = $4,
              updated_at = $4
        WHERE action_type = $1
          AND status = 'pending'
          AND details->>'receiptId' = $5`,
      [
        INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
        input.reviewerUserId,
        input.reason,
        input.now,
        input.receiptId,
      ],
    )
  }

  /**
   * DualApprovalService can reject the approval-request row without
   * touching `bank_receipts`. A later confirm must not mint a replacement
   * pending request; instead the receipt is synchronized to Rejected so
   * the reviewer's decision is durable.
   */
  private async synchronizeReceiptWithRejectedDualApproval(
    client: WalletQueryClient,
    input: {
      receipt: BankReceiptRow & { invoiceId: string; profileId: string; amount: bigint }
      latestRequest: DualApprovalRequestSummary
      actorUserId: string
      ip: string
      correlationId?: string
      now: Date
    },
  ): Promise<void> {
    const reason = invoiceBankReceiptReasonFromDualApprovalRejection(
      input.latestRequest.reviewReason,
    )
    const updated = await this.markRejected(client, input.receipt.id, reason)
    if (!updated) return

    const ownerUserId = await this.loadProfileOwnerUserId(client, input.receipt.profileId)
    let notificationOutboxId: string | null = null
    if (ownerUserId) {
      const notify = await this.enqueueCustomerRejectionNotice(client, {
        receiptId: input.receipt.id,
        invoiceId: input.receipt.invoiceId,
        profileId: input.receipt.profileId,
        userId: ownerUserId,
        amount: input.receipt.amount.toString(),
        reason,
        rejectedAt: input.now,
      })
      notificationOutboxId = notify.outboxId
    }

    await this.recordAudit(client, {
      event: INVOICE_BANK_RECEIPT_REJECTED_EVENT,
      actorUserId: input.actorUserId,
      ip: input.ip,
      correlationId: input.correlationId,
      metadata: {
        receiptId: input.receipt.id,
        invoiceId: input.receipt.invoiceId,
        profileId: input.receipt.profileId,
        amount: input.receipt.amount.toString(),
        reason,
        customerVisible: Boolean(ownerUserId),
        previousState: input.receipt.state,
        newState: 'Rejected',
        dualApprovalRequestId: input.latestRequest.id,
        dualApprovalInitiatedBy: input.latestRequest.initiatorId,
        dualApprovalRejectedBy: input.latestRequest.reviewerId,
        synchronizedFromDualApprovalRejection: true,
        notificationOutboxId,
      },
      occurredAt: input.now,
    })
  }

  private async loadPendingDualApprovalsByReceiptIds(
    queryable: WalletQueryClient,
    receiptIds: string[],
  ): Promise<Map<string, DualApprovalRequestSummary>> {
    const pending = new Map<string, DualApprovalRequestSummary>()
    if (receiptIds.length === 0) return pending
    const result = await queryable.query(
      `SELECT id, initiator_id, status, details
         FROM approval_requests
        WHERE action_type = $1
          AND status = 'pending'
          AND details->>'receiptId' = ANY($2::text[])`,
      [INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE, receiptIds],
    )
    for (const row of result.rows as Array<{
      id: string
      initiator_id: string
      status: string
      details: unknown
    }>) {
      const receiptId = receiptIdFromInvoiceBankReceiptDualApprovalDetails(row.details)
      if (!receiptId) continue
      pending.set(receiptId, {
        id: row.id,
        initiatorId: row.initiator_id,
        status: row.status,
      })
    }
    return pending
  }

  private async loadDualApprovalDtoExtras(
    queryable: WalletQueryClient,
    row: BankReceiptRow,
  ): Promise<DualApprovalDtoExtras> {
    const thresholdRead = await this.loadDualApprovalThreshold(queryable)
    const latest = await this.loadLatestDualApprovalRequest(queryable, row.id)
    const pending = latest?.status === 'pending' ? latest : null
    return dualApprovalExtrasFromRead(thresholdRead, BigInt(row.amount), pending)
  }

  private async loadLatestDualApprovalRequest(
    queryable: WalletQueryClient,
    receiptId: string,
  ): Promise<DualApprovalRequestSummary | null> {
    const result = await queryable.query(
      `SELECT id, initiator_id, status, review_reason, reviewer_id
         FROM approval_requests
        WHERE action_type = $1
          AND details->>'receiptId' = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE, receiptId],
    )
    return toDualApprovalSummary(result.rows[0])
  }

  private async lockReceipt(
    client: WalletQueryClient,
    receiptId: string,
  ): Promise<BankReceiptRow & { invoiceId: string; profileId: string; amount: bigint }> {
    const result = await client.query(
      `SELECT ${RECEIPT_SELECT} FROM bank_receipts WHERE id = $1 FOR UPDATE`,
      [receiptId],
    )
    const row = (result.rows as BankReceiptRow[])[0]
    if (!row) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Invoice bank receipt not found: ${receiptId}`,
        404,
      )
    }
    return {
      ...row,
      invoiceId: row.invoice_id,
      profileId: row.profile_id,
      amount: BigInt(row.amount),
    }
  }

  private assertInvoiceAcceptsBankReceiptAllocation(invoice: {
    state: string
    adjustment_kind?: string | null
  }): void {
    if (invoice.adjustment_kind === 'credit') {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.CREDIT_NOTE(),
        409,
      )
    }
    if (isBankReceiptInvoiceLinkAllowedState(invoice.state)) return
    httpError(
      ErrorCodes.CONFLICT_STATE.code,
      BANK_RECEIPT_OVERPAYMENT_ERRORS.INVOICE_STATE_NOT_SETTLEABLE(invoice.state),
      409,
    )
  }

  private async ensureAndLockWallet(
    client: WalletQueryClient,
    profileId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO wallets (profile_id) VALUES ($1)
       ON CONFLICT (profile_id) DO NOTHING`,
      [profileId],
    )
    const result = await client.query(
      `SELECT profile_id FROM wallets WHERE profile_id = $1 FOR UPDATE`,
      [profileId],
    )
    if (result.rows.length === 0) {
      httpError(ErrorCodes.NOT_FOUND_RESOURCE.code, `Wallet not found: ${profileId}`, 404)
    }
  }

  private async lockInvoice(client: WalletQueryClient, invoiceId: string): Promise<InvoiceRow> {
    const result = await client.query(
      `SELECT id, profile_id, state, total_amount, paid_amount, refunded_amount, adjustment_kind
         FROM invoices
        WHERE id = $1
        FOR UPDATE`,
      [invoiceId],
    )
    const row = (result.rows as InvoiceRow[])[0]
    if (!row) {
      httpError(ErrorCodes.NOT_FOUND_RESOURCE.code, `Invoice not found: ${invoiceId}`, 404)
    }
    return row
  }

  private async applyInvoiceAllocation(
    client: WalletQueryClient,
    invoiceId: string,
    allocation: bigint,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE invoices
          SET paid_amount = paid_amount + $2::bigint,
              updated_at = NOW()
        WHERE id = $1
          AND paid_amount + $2::bigint <= total_amount
        RETURNING id`,
      [invoiceId, allocation.toString()],
    )
    if (result.rows.length === 0) {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        BANK_RECEIPT_OVERPAYMENT_ERRORS.CANNOT_OVERSETTLE(),
        409,
      )
    }
  }

  /**
   * After paid_amount is incremented, take the validated ConfirmBankReceipt
   * path so state and paid_at match the post-allocation amount.
   * Unpaid / PartiallyFunded first SubmitBankReceipt into
   * PaymentUnderReview; ConfirmBankReceipt then lands on Paid or
   * PartiallyFunded and sets paid_at on full settlement.
   */
  private async confirmInvoiceAfterAllocation(
    client: WalletQueryClient,
    input: {
      invoice: InvoiceRow
      paidAfter: bigint
      actorUserId: string
      ip: string
      correlationId?: string
      now: Date
    },
  ): Promise<void> {
    if (!isInvoiceState(input.invoice.state)) {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        `Invoice ${input.invoice.id} is in an unknown state: ${input.invoice.state}`,
        409,
      )
    }
    const totalAmount = BigInt(input.invoice.total_amount)
    const destination = invoiceStateAfterBankReceiptAllocation({
      paidAmount: input.paidAfter,
      totalAmount,
    })
    const financials = {
      paidAmount: input.paidAfter,
      totalAmount,
      refundedAmount: BigInt(input.invoice.refunded_amount),
      incomingPaidAmount: input.paidAfter,
    }
    const transitionOpts = {
      actorUserId: input.actorUserId,
      ip: input.ip,
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
      now: input.now,
      client,
      financials,
    }

    let from: InvoiceState = input.invoice.state
    if (from !== 'PaymentUnderReview' && from !== 'Unpaid' && from !== 'PartiallyFunded') {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        BANK_RECEIPT_OVERPAYMENT_ERRORS.INVOICE_STATE_NOT_SETTLEABLE(from),
        409,
      )
    }
    if (from !== 'PaymentUnderReview') {
      await this.invoiceStateMachine.transition(
        input.invoice.id,
        from,
        'PaymentUnderReview',
        {
          ...transitionOpts,
          reason: 'Bank receipt applied to invoice',
        },
      )
      from = 'PaymentUnderReview'
    }

    await this.invoiceStateMachine.transition(input.invoice.id, from, destination, {
      ...transitionOpts,
      reason: 'Bank receipt confirmed against invoice',
    })
  }

  private async markConfirmed(
    client: WalletQueryClient,
    receiptId: string,
    actorUserId: string,
    confirmedAt: Date,
  ): Promise<BankReceiptRow | null> {
    const result = await client.query(
      `UPDATE bank_receipts
          SET state = 'Confirmed',
              confirmed_by = $2,
              confirmed_at = $3
        WHERE id = $1
          AND state IN ('Submitted', 'UnderReview')
        RETURNING ${RECEIPT_SELECT}`,
      [receiptId, actorUserId, confirmedAt],
    )
    return (result.rows as BankReceiptRow[])[0] ?? null
  }

  private async markRejected(
    client: WalletQueryClient,
    receiptId: string,
    reason: string,
  ): Promise<BankReceiptRow | null> {
    const result = await client.query(
      `UPDATE bank_receipts
          SET state = 'Rejected',
              rejection_reason = $2
        WHERE id = $1
          AND state IN ('Submitted', 'UnderReview')
        RETURNING ${RECEIPT_SELECT}`,
      [receiptId, reason],
    )
    return (result.rows as BankReceiptRow[])[0] ?? null
  }

  private async loadProfileOwnerUserId(
    client: WalletQueryClient,
    profileId: string,
  ): Promise<string | null> {
    const result = await client.query(
      `SELECT user_id FROM profiles WHERE id = $1`,
      [profileId],
    )
    const userId = (result.rows[0] as { user_id?: string | null } | undefined)?.user_id
    return typeof userId === 'string' && userId.length > 0 ? userId : null
  }

  private async enqueueCustomerRejectionNotice(
    client: WalletQueryClient,
    input: {
      receiptId: string
      invoiceId: string
      profileId: string
      userId: string
      amount: string
      reason: string
      rejectedAt: Date
    },
  ): Promise<{ outboxId: string | null; inserted: boolean }> {
    const channels = [...INVOICE_BANK_RECEIPT_REJECT_CHANNELS]
    const idempotencyKey = invoiceBankReceiptRejectedNotificationIdempotencyKey(input.receiptId)
    const priority =
      classifyNotificationType(INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY) ===
      'immediate'
        ? 'urgent'
        : 'normal'
    const payload = buildInvoiceBankReceiptRejectedNotificationPayload({
      receiptId: input.receiptId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      reason: input.reason,
      rejectedAt: input.rejectedAt,
    })

    const insertResult = await client.query(
      `INSERT INTO notification_outbox
         (profile_id, user_id, event_key, payload, channels, status,
          idempotency_key, max_attempts, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.profileId,
        input.userId,
        INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY,
        payload,
        channels,
        'queued',
        idempotencyKey,
        CUSTOMER_NOTIFICATION_MAX_ATTEMPTS,
        null,
      ],
    )
    const insertedRow = insertResult.rows[0] as { id: string } | undefined
    let outboxId = insertedRow?.id
    const inserted = Boolean(outboxId)
    if (!outboxId) {
      const existing = await client.query(
        `SELECT id FROM notification_outbox WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey],
      )
      outboxId = (existing.rows[0] as { id: string } | undefined)?.id
      if (!outboxId) return { outboxId: null, inserted: false }
    }

    const jobValues: unknown[] = []
    const placeholders: string[] = []
    channels.forEach((channel, i) => {
      const base = i * 5
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`)
      jobValues.push(outboxId, channel, 'queued', priority, CUSTOMER_NOTIFICATION_MAX_ATTEMPTS)
    })
    await client.query(
      `INSERT INTO notification_job
         (outbox_id, channel, status, priority, max_attempts)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (outbox_id, channel) DO NOTHING`,
      jobValues,
    )
    return { outboxId, inserted }
  }

  private async findExistingOverpaymentCredit(
    client: WalletQueryClient,
    receiptId: string,
  ): Promise<TransactionRow | null> {
    const result = await client.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
      [invoiceBankReceiptOverpaymentCreditIdempotencyKey(receiptId)],
    )
    if (result.rows.length === 0) return null
    const row = result.rows[0] as {
      id: string
      wallet_id: string
      type: string
      amount: string | number | bigint
      state: string
      idempotency_key: string
      ref_id?: string | null
      description?: string | null
      metadata?: unknown
      reverses_transaction_id?: string | null
      created_at: Date
      updated_at: Date
    }
    return {
      id: row.id,
      walletId: row.wallet_id,
      type: row.type,
      amount: BigInt(row.amount),
      state: row.state,
      idempotencyKey: row.idempotency_key,
      refId: row.ref_id ?? null,
      description: row.description ?? null,
      metadata: row.metadata ?? null,
      reversesTransactionId: row.reverses_transaction_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private async loadConfirmedAllocation(
    client: WalletQueryClient,
    receipt: BankReceiptRow & { invoiceId: string; amount: bigint },
  ): Promise<{
    overpayment: BankReceiptOverpaymentSnapshot
    invoiceState: string | null
    remaining: string | null
  }> {
    const credit = await this.findExistingOverpaymentCredit(client, receipt.id)
    const fromCredit = readInvoiceBankReceiptOverpaymentFromCreditMetadata(credit?.metadata)
    if (fromCredit) {
      return {
        overpayment: {
          ...fromCredit,
          overpaymentCreditTransactionId: credit?.id ?? fromCredit.overpaymentCreditTransactionId,
        },
        invoiceState: null,
        remaining: null,
      }
    }
    const invoice = await this.loadInvoice(client, receipt.invoiceId)
    const walletCreditAmount = credit?.amount ?? 0n
    const invoiceAllocation = receipt.amount - walletCreditAmount
    return {
      overpayment: bankReceiptOverpaymentSnapshot({
        invoiceId: receipt.invoiceId,
        remainingBefore: invoiceAllocation,
        invoiceAllocation,
        walletCreditAmount,
        overpaymentCreditTransactionId: credit?.id ?? null,
      }),
      invoiceState: invoice?.state ?? null,
      remaining: invoice
        ? remainingForBankReceiptSettlement({
            totalAmount: BigInt(invoice.total_amount),
            paidAmount: BigInt(invoice.paid_amount),
            state: invoice.state,
          }).toString()
        : null,
    }
  }

  private async loadCurrentAllocation(
    queryable: WalletQueryClient,
    row: BankReceiptRow,
  ): Promise<{
    overpayment: BankReceiptOverpaymentSnapshot | null
    invoiceState: string | null
    remaining: string | null
  }> {
    if (row.state === 'Confirmed') {
      const extra = await this.loadConfirmedAllocation(queryable, {
        ...row,
        invoiceId: row.invoice_id,
        amount: BigInt(row.amount),
      })
      return extra
    }
    const invoice = await this.loadInvoice(queryable, row.invoice_id)
    if (!invoice) {
      return { overpayment: null, invoiceState: null, remaining: null }
    }
    if (
      invoice.adjustment_kind === 'credit' ||
      !isBankReceiptInvoiceLinkAllowedState(invoice.state)
    ) {
      return { overpayment: null, invoiceState: invoice.state, remaining: null }
    }
    const remaining = remainingForBankReceiptSettlement({
      totalAmount: BigInt(invoice.total_amount),
      paidAmount: BigInt(invoice.paid_amount),
      state: invoice.state,
    })
    const allocation = allocateReceiptAgainstInvoice({
      receiptAmount: BigInt(row.amount),
      remaining,
    })
    return {
      overpayment: bankReceiptOverpaymentSnapshot({
        invoiceId: invoice.id,
        remainingBefore: remaining,
        invoiceAllocation: allocation.invoiceAllocation,
        walletCreditAmount: allocation.walletCreditAmount,
        overpaymentCreditTransactionId: null,
      }),
      invoiceState: invoice.state,
      remaining: remaining.toString(),
    }
  }

  private async loadInvoice(
    queryable: WalletQueryClient,
    invoiceId: string,
  ): Promise<InvoiceRow | null> {
    const result = await queryable.query(
      `SELECT id, profile_id, state, total_amount, paid_amount, refunded_amount, adjustment_kind
         FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    return (result.rows as InvoiceRow[])[0] ?? null
  }

  private async recordAudit(
    client: WalletQueryClient,
    entry: {
      event: string
      actorUserId: string
      ip: string
      correlationId?: string | undefined
      metadata: Record<string, unknown>
      occurredAt: Date
    },
  ): Promise<string> {
    const auditId = uuidv7()
    await client.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auditId,
        entry.actorUserId,
        entry.event,
        JSON.stringify(entry.metadata),
        entry.correlationId ?? null,
        entry.ip,
        entry.occurredAt,
      ],
    )
    return auditId
  }

  private async toDto(
    row: BankReceiptRow,
    extra: {
      overpayment?: BankReceiptOverpaymentSnapshot | null
      auditId?: string
      invoiceState?: string | null
      remaining?: string | null
      notificationOutboxId?: string
      requiresDualApproval?: boolean
      dualApprovalPending?: boolean
      dualApprovalRequestId?: string | null
      dualApprovalInitiatedBy?: string | null
      dualApprovalThresholdIrR?: string | null
    } = {},
  ): Promise<InvoiceBankReceiptConfirmDto> {
    const overpayment = extra.overpayment ?? null
    return {
      receiptId: row.id,
      invoiceId: row.invoice_id,
      profileId: row.profile_id,
      amount: BigInt(row.amount).toString(),
      currency: 'IRR',
      state: row.state,
      paymentDate: row.payment_date,
      payerReference: row.payer_reference,
      attachmentKey: row.attachment_key,
      attachmentUrl: await this.signAttachmentUrl(row.attachment_key),
      customerNote: row.customer_note,
      submittedAt: toIso(row.created_at),
      canConfirm: isInvoiceBankReceiptConfirmableState(row.state),
      canReject: isInvoiceBankReceiptRejectableState(row.state),
      confirmedBy: row.confirmed_by,
      confirmedAt: row.confirmed_at ? toIso(row.confirmed_at) : null,
      rejectionReason: row.rejection_reason,
      invoiceState: extra.invoiceState ?? null,
      remaining: extra.remaining ?? overpayment?.remainingBefore ?? null,
      invoiceAllocation: overpayment?.invoiceAllocation ?? null,
      walletCreditAmount: overpayment?.walletCreditAmount ?? null,
      overpayment,
      requiresDualApproval: extra.requiresDualApproval ?? false,
      dualApprovalPending: extra.dualApprovalPending ?? false,
      dualApprovalRequestId: extra.dualApprovalRequestId ?? null,
      dualApprovalInitiatedBy: extra.dualApprovalInitiatedBy ?? null,
      dualApprovalThresholdIrR: extra.dualApprovalThresholdIrR ?? null,
      ...(extra.auditId ? { auditId: extra.auditId } : {}),
      ...(extra.notificationOutboxId
        ? { notificationOutboxId: extra.notificationOutboxId }
        : {}),
    }
  }

  private async signAttachmentUrl(attachmentKey: string | null): Promise<string | null> {
    if (!attachmentKey || !this.storage) return null
    try {
      return await this.storage.presignedGetUrl(attachmentKey, ATTACHMENT_URL_TTL_SECONDS)
    } catch (error) {
      this.logger.warn(
        `Could not sign bank-receipt attachment ${attachmentKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      )
      return null
    }
  }
}

export function invoiceBankReceiptConfirmationLockKeys(receiptId: string): [number, number] {
  const digest = createHash('sha256')
    .update(`invoice-bank-receipt-confirm:${receiptId}`)
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

function invoiceStateAfterConfirm(
  invoice: InvoiceRow,
  invoiceAllocation: bigint,
): string {
  if (invoiceAllocation <= 0n) return invoice.state
  return invoiceStateAfterBankReceiptAllocation({
    paidAmount: BigInt(invoice.paid_amount) + invoiceAllocation,
    totalAmount: BigInt(invoice.total_amount),
  })
}

function remainingAfter(remainingBefore: bigint, invoiceAllocation: bigint): string {
  const left = remainingBefore - invoiceAllocation
  return (left > 0n ? left : 0n).toString()
}

interface DualApprovalRequestSummary {
  id: string
  initiatorId: string
  status: string
  reviewReason?: string | null
  reviewerId?: string | null
}

interface DualApprovalDtoExtras {
  requiresDualApproval: boolean
  dualApprovalPending: boolean
  dualApprovalRequestId: string | null
  dualApprovalInitiatedBy: string | null
  dualApprovalThresholdIrR: string | null
}

function dualApprovalExtrasFromRead(
  read: InvoiceBankReceiptDualApprovalThresholdRead,
  amountIrR: bigint,
  pending: DualApprovalRequestSummary | null | undefined,
): DualApprovalDtoExtras {
  const isPending = pending != null && pending.status === 'pending'
  const requires =
    isPending ||
    read.status === 'corrupt' ||
    invoiceBankReceiptRequiresDualApproval(read, amountIrR)
  return {
    requiresDualApproval: requires,
    dualApprovalPending: isPending,
    dualApprovalRequestId: pending?.id ?? null,
    dualApprovalInitiatedBy: pending?.initiatorId ?? null,
    dualApprovalThresholdIrR: thresholdIrRLabel(read),
  }
}

function thresholdIrRLabel(read: InvoiceBankReceiptDualApprovalThresholdRead): string | null {
  if (read.status === 'enabled') return String(read.thresholdIrR)
  if (read.status === 'disabled') return '0'
  return null
}

function toDualApprovalSummary(row: unknown): DualApprovalRequestSummary | null {
  if (!row || typeof row !== 'object') return null
  const record = row as {
    id?: unknown
    initiator_id?: unknown
    status?: unknown
    review_reason?: unknown
    reviewer_id?: unknown
  }
  if (typeof record.id !== 'string' || typeof record.initiator_id !== 'string') {
    return null
  }
  return {
    id: record.id,
    initiatorId: record.initiator_id,
    status: typeof record.status === 'string' ? record.status : 'pending',
    reviewReason: typeof record.review_reason === 'string' ? record.review_reason : null,
    reviewerId: typeof record.reviewer_id === 'string' ? record.reviewer_id : null,
  }
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

function httpError(code: string, message: string, statusCode: number): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}
