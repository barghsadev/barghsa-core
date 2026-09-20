import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { getDbPool } from '@barghsa/db';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  readInvoiceBankReceiptDualApprovalThreshold,
} from '@barghsa/shared/finance';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentFinancePermission } from '../admin/approval-permissions.js';
import { lockDualApprovalThreshold } from '../admin/dual-approval-threshold-lock.js';
import { notifyApprovalRequested } from '../admin/approval-notifications.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { lockWalletProfile, assertWalletProfileWritable } from '../wallet/profile-lock.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { isInvoiceState } from '../invoice/invoice-state.model.js';
import { loadCustomerInvoiceActivity } from '../invoice/customer-invoice-activity.js';
import { notifyRefundOutcome } from './refund-notifications.js';
import { assertRefundTransition, type RefundState } from './refund-state.model.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
interface InvoiceRow {
  id: string;
  profile_id: string;
  state: string;
  adjustment_kind: string | null;
  paid_amount: string;
  refunded_amount: string;
}
interface RefundRow {
  id: string;
  invoice_id: string;
  profile_id: string;
  amount: string;
  state: RefundState;
  destination: 'wallet' | 'external_bank';
  bank_reference: string | null;
  reconciliation_status: string | null;
  staff_id: string | null;
  idempotency_key: string;
}
export interface RefundRequest {
  invoiceId: string;
  amount: string;
  idempotencyKey: string;
  reason: string;
}
export interface RefundDto {
  id: string;
  invoiceId: string;
  profileId: string;
  amount: string;
  state: RefundState;
  destination: 'wallet' | 'external_bank';
  bankReference: string | null;
  reconciliationStatus: string | null;
  approvalRequestId: string | null;
}

/** Staff wallet refunds reuse the ledger and the existing financial review queue.
 * Profile -> policy -> actor -> invoice -> refund -> wallet is the lock order.
 * The migration owns the invoice counter; this service never increments it.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly wallet: WalletService,
    private readonly invoices: InvoiceStateMachineService
  ) {}

  async request(
    input: RefundRequest,
    actor: Actor,
    ip: string,
    destination: 'wallet' | 'external_bank' = 'wallet'
  ): Promise<RefundDto> {
    if (
      !/^\d{1,19}$/.test(input.amount) ||
      BigInt(input.amount) <= 0n ||
      BigInt(input.amount) > 9223372036854775807n
    )
      throw new BadRequestException('Refund amount must be positive int8 IRR');
    const amount = BigInt(input.amount).toString();
    const reason = this.reason(input.reason);
    const key = `${destination}-refund:${input.idempotencyKey}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([input.invoiceId, amount, actor.userId, reason]))
      .digest('hex');
    return this.transaction(input.invoiceId, actor, async (client, invoice, archived) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      const existing = (
        await client.query<RefundRow>('SELECT * FROM refunds WHERE idempotency_key=$1 FOR UPDATE', [
          key,
        ])
      ).rows[0];
      if (existing) {
        const saved = (
          await client.query<{ fingerprint: string }>(
            "SELECT metadata::jsonb->>'fingerprint' AS fingerprint FROM audit_log WHERE event='refund.requested' AND metadata::jsonb->>'refundId'=$1 ORDER BY created_at,id LIMIT 1",
            [existing.id]
          )
        ).rows[0];
        if (saved?.fingerprint !== fingerprint)
          throw new ConflictException('Refund idempotency key belongs to a different request');
        // A policy change can require a new review for an existing unpaid request.
        if (
          ['Requested', 'Approved', 'Processing'].includes(existing.state) &&
          (await this.requiresApproval(client, amount)) &&
          !(await this.latestApproval(client, existing))
        ) {
          assertWalletProfileWritable({ id: invoice.profile_id, archived });
          await this.createApproval(client, existing, actor, ip, reason);
        }
        return this.dto(client, existing);
      }
      assertWalletProfileWritable({ id: invoice.profile_id, archived });
      this.refundableInvoice(invoice);
      const reserved = (
        await client.query<{ amount: string }>(
          "SELECT COALESCE(SUM(amount),0)::text AS amount FROM refunds WHERE invoice_id=$1 AND state NOT IN ('Completed','Rejected','Cancelled')",
          [invoice.id]
        )
      ).rows[0]!.amount;
      if (
        BigInt(amount) >
        BigInt(invoice.paid_amount) - BigInt(invoice.refunded_amount) - BigInt(reserved)
      )
        throw new ConflictException('Refund exceeds the available paid balance');
      const row = (
        await client.query<RefundRow>(
          'INSERT INTO refunds(invoice_id,profile_id,amount,destination,staff_id,idempotency_key) VALUES ($1,$2,$3,$6,$4,$5) RETURNING *',
          [invoice.id, invoice.profile_id, amount, actor.userId, key, destination]
        )
      ).rows[0]!;
      const activity = await loadCustomerInvoiceActivity(client, invoice.id, invoice.profile_id);
      const paymentSources = activity.payments.filter((payment) =>
        ['Completed', 'Confirmed'].includes(payment.state)
      );
      await this.audit(client, row, actor, ip, 'refund.requested', {
        reason,
        fingerprint,
        paymentSources,
        legacyPaymentSourcesUnavailable: paymentSources.length === 0,
      });
      if (await this.requiresApproval(client, amount))
        await this.createApproval(client, row, actor, ip, reason);
      return this.dto(client, row);
    });
  }

  async decide(
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'process' | 'record-transfer' | 'reconcile',
    reason: string | undefined,
    actor: Actor,
    ip: string,
    destination: 'wallet' | 'external_bank' = 'wallet',
    bankReference?: string
  ): Promise<RefundDto> {
    const preliminary = (
      await getDbPool().query<{ invoice_id: string }>(
        'SELECT invoice_id FROM refunds WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!preliminary) throw new NotFoundException('Refund not found');
    return this.transaction(preliminary.invoice_id, actor, async (client, invoice, archived) => {
      const row = (
        await client.query<RefundRow>(
          'SELECT * FROM refunds WHERE id=$1 AND invoice_id=$2 FOR UPDATE',
          [id, invoice.id]
        )
      ).rows[0];
      if (!row || row.destination !== destination) throw new NotFoundException('Refund not found');
      if (
        (destination === 'external_bank' && action === 'process') ||
        (destination === 'wallet' && ['record-transfer', 'reconcile'].includes(action))
      )
        throw new BadRequestException('Action does not match refund destination');
      const reference = ['record-transfer', 'reconcile'].includes(action)
        ? this.reference(bankReference)
        : undefined;
      if (reference && row.bank_reference && row.bank_reference !== reference)
        throw new ConflictException('Bank reference does not match the recorded transfer');
      const target =
        action === 'approve'
          ? 'Approved'
          : action === 'reject'
            ? 'Rejected'
            : action === 'cancel'
              ? 'Cancelled'
              : action === 'record-transfer'
                ? 'Processing'
                : 'Completed';
      if (row.state === target) {
        if (
          action === 'record-transfer' &&
          (!row.bank_reference || row.reconciliation_status !== 'Pending')
        )
          throw new ConflictException('A pending recorded transfer is required');
        return this.dto(client, row);
      }
      if (action === 'reject' || action === 'cancel') {
        await this.move(client, row, target, actor, ip, this.reason(reason));
        if (target === 'Rejected') await notifyRefundOutcome(client, { ...row, state: 'Rejected' });
        return this.dto(client, row);
      }
      assertWalletProfileWritable({ id: invoice.profile_id, archived });
      this.refundableInvoice(invoice);
      await this.requireApproval(client, row);
      if (action === 'approve') {
        await this.move(client, row, 'Approved', actor, ip, 'Finance approved the refund');
        return this.dto(client, row);
      }
      if (action === 'record-transfer') {
        if (row.state !== 'Approved')
          throw new ConflictException('Only approved refunds can record a transfer');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `external-refund-reference:${reference}`,
        ]);
        const duplicate = await client.query(
          "SELECT id FROM refunds WHERE destination='external_bank' AND bank_reference=$1 AND id<>$2",
          [reference, row.id]
        );
        if (duplicate.rows.length)
          throw new ConflictException('Bank reference already belongs to another refund');
        await client.query(
          "UPDATE refunds SET bank_reference=$2,reconciliation_status='Pending' WHERE id=$1",
          [row.id, reference]
        );
        row.bank_reference = reference!;
        row.reconciliation_status = 'Pending';
        await this.move(client, row, 'Processing', actor, ip, 'External bank transfer recorded');
        await this.audit(client, row, actor, ip, 'refund.bank_transfer_recorded', {
          bankReference: reference,
        });
        return this.dto(client, row);
      }
      if (action === 'reconcile') {
        if (
          row.state !== 'Processing' ||
          !row.bank_reference ||
          row.reconciliation_status !== 'Pending'
        )
          throw new ConflictException('A pending recorded transfer is required');
        const transfer = (
          await client.query<{ user_id: string; bank_reference: string }>(
            "SELECT user_id,metadata::jsonb->>'bankReference' AS bank_reference FROM audit_log WHERE event='refund.bank_transfer_recorded' AND metadata::jsonb->>'refundId'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
            [row.id]
          )
        ).rows[0];
        if (!transfer || transfer.bank_reference !== reference)
          throw new ConflictException('Recorded transfer evidence is missing');
        if (transfer.user_id === actor.userId)
          throw new ForbiddenException('A second finance staff member must reconcile the transfer');
        await requireCurrentFinancePermission(client, transfer.user_id);
        await client.query("UPDATE refunds SET reconciliation_status='Confirmed' WHERE id=$1", [
          row.id,
        ]);
        row.reconciliation_status = 'Confirmed';
        await this.audit(client, row, actor, ip, 'refund.bank_reconciled', {
          bankReference: reference,
          recordedBy: transfer.user_id,
        });
        await this.complete(client, row, invoice, actor, ip);
        return this.dto(client, row);
      }
      if (row.state !== 'Processing')
        await this.move(client, row, 'Processing', actor, ip, 'Wallet refund processing');
      await this.wallet.createWallet(row.profile_id, client);
      const credit = await this.wallet.credit(
        row.profile_id,
        BigInt(row.amount),
        {
          type: 'refund',
          refId: row.id,
          description: 'Invoice wallet refund',
          metadata: { refundId: row.id, invoiceId: row.invoice_id },
        },
        `refund-wallet-credit:${row.id}`,
        client
      );
      if (
        credit.walletId !== row.profile_id ||
        credit.type !== 'refund' ||
        credit.refId !== row.id ||
        credit.amount !== BigInt(row.amount) ||
        credit.state !== 'Completed'
      )
        throw new ConflictException('Refund ledger identity does not match the request');
      await this.complete(client, row, invoice, actor, ip);
      return this.dto(client, row);
    });
  }

  private reference(value: string | undefined): string {
    const reference = value?.trim();
    if (
      !reference ||
      reference.length > 200 ||
      Array.from(reference).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    )
      throw new BadRequestException('A bank reference of 1 to 200 characters is required');
    return reference;
  }
  private async complete(
    client: PoolClient,
    row: RefundRow,
    invoice: InvoiceRow,
    actor: Actor,
    ip: string
  ): Promise<void> {
    await this.move(
      client,
      row,
      'Completed',
      actor,
      ip,
      row.destination === 'wallet' ? 'Wallet refund completed' : 'External bank refund reconciled'
    );
    const after = (
      await client.query<InvoiceRow>(
        'SELECT id,profile_id,state,adjustment_kind,paid_amount,refunded_amount FROM invoices WHERE id=$1',
        [invoice.id]
      )
    ).rows[0]!;
    if (!isInvoiceState(after.state)) throw new ConflictException('Unknown invoice state');
    await this.invoices.transition(
      invoice.id,
      after.state,
      BigInt(after.refunded_amount) === BigInt(after.paid_amount)
        ? 'Refunded'
        : 'PartiallyRefunded',
      {
        actorUserId: actor.userId,
        reason:
          row.destination === 'wallet'
            ? 'Wallet refund completed'
            : 'External bank refund reconciled',
        ip,
        client,
      }
    );
    await notifyRefundOutcome(client, { ...row, state: 'Completed' });
  }

  private async transaction<T>(
    invoiceId: string,
    actor: Actor,
    work: (client: PoolClient, invoice: InvoiceRow, archived: boolean) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const owner = (
        await client.query<{ profile_id: string }>('SELECT profile_id FROM invoices WHERE id=$1', [
          invoiceId,
        ])
      ).rows[0];
      if (!owner) throw new NotFoundException('Invoice not found');
      const profile = await lockWalletProfile(client, 'profile', owner.profile_id);
      await lockDualApprovalThreshold(client, 'read');
      await requireStaffMutationPermission(client, actor.userId, 'admin:financial:edit');
      await requireSessionStepUp(client, actor);
      const invoice = (
        await client.query<InvoiceRow>(
          'SELECT id,profile_id,state,adjustment_kind,paid_amount,refunded_amount FROM invoices WHERE id=$1 FOR UPDATE',
          [invoiceId]
        )
      ).rows[0];
      if (!invoice || invoice.profile_id !== profile.id)
        throw new ConflictException('Invoice ownership changed');
      const result = await work(client, invoice, profile.archived);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (['23514', '23505', '40001', '40P01'].includes((error as { code?: string }).code ?? ''))
        throw new ConflictException(
          'Refund conflicts with another financial change; review and retry'
        );
      throw error;
    } finally {
      client.release();
    }
  }

  private refundableInvoice(invoice: InvoiceRow): void {
    if (
      invoice.adjustment_kind === 'credit' ||
      !['Paid', 'PartiallyRefunded'].includes(invoice.state)
    )
      throw new ConflictException('Only a paid invoice can be refunded through this workflow');
  }
  private reason(value: string | undefined): string {
    const reason = value?.trim();
    if (!reason || reason.length > 1000)
      throw new BadRequestException('A reason of 1 to 1000 characters is required');
    return reason;
  }
  private async requiresApproval(client: PoolClient, amount: string): Promise<boolean> {
    const raw = (
      await client.query<{ value: unknown }>('SELECT value FROM app_config WHERE key=$1', [
        DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
      ])
    ).rows[0]?.value;
    const threshold = readInvoiceBankReceiptDualApprovalThreshold(raw);
    if (threshold.status === 'corrupt')
      throw new ConflictException('Dual approval configuration is invalid');
    return threshold.status === 'enabled' && BigInt(amount) >= BigInt(threshold.thresholdIrR);
  }
  private async latestApproval(client: PoolClient, row: RefundRow) {
    const binding = (
      await client.query<{ id: string }>(
        "SELECT metadata::jsonb->>'approvalRequestId' AS id FROM audit_log WHERE event='refund.approval_requested' AND metadata::jsonb->>'refundId'=$1 ORDER BY created_at DESC,audit_log.id DESC LIMIT 1",
        [row.id]
      )
    ).rows[0];
    if (!binding) return undefined;
    const approval = (
      await client.query<{
        id: string;
        action_type: string;
        amount_irr: string;
        initiator_id: string;
        reviewer_id: string | null;
        status: string;
        details: Record<string, string>;
      }>('SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE', [binding.id])
    ).rows[0];
    if (!approval) throw new ConflictException('The bound approval request is missing');
    return approval;
  }
  private async requireApproval(client: PoolClient, row: RefundRow): Promise<void> {
    const approval = await this.latestApproval(client, row);
    if (approval?.status === 'rejected')
      throw new ConflictException('The financial review rejected this refund');
    if (!(await this.requiresApproval(client, row.amount)) && !approval) return;
    if (
      !approval ||
      approval.action_type !== 'refund' ||
      approval.details.refundId !== row.id ||
      approval.status !== 'approved' ||
      !approval.reviewer_id ||
      approval.reviewer_id === approval.initiator_id ||
      approval.initiator_id !== row.staff_id ||
      approval.amount_irr !== row.amount ||
      approval.details.invoiceId !== row.invoice_id ||
      approval.details.profileId !== row.profile_id ||
      approval.details.destination !== row.destination
    )
      throw new ConflictException(
        'A matching approval by a second finance staff member is required'
      );
    await requireCurrentFinancePermission(client, approval.initiator_id);
    await requireCurrentFinancePermission(client, approval.reviewer_id);
  }
  private async createApproval(
    client: PoolClient,
    row: RefundRow,
    actor: Actor,
    ip: string,
    reason: string
  ): Promise<void> {
    const id = uuidv7();
    await client.query(
      "INSERT INTO approval_requests(id,action_type,amount_irr,initiator_id,reason,details,status) VALUES ($1,'refund',$2,$3,$4,$5::jsonb,'pending')",
      [
        id,
        row.amount,
        actor.userId,
        reason,
        JSON.stringify({
          entityType: 'refund',
          refundId: row.id,
          invoiceId: row.invoice_id,
          profileId: row.profile_id,
          destination: row.destination,
        }),
      ]
    );
    await this.audit(client, row, actor, ip, 'refund.approval_requested', {
      approvalRequestId: id,
    });
    await notifyApprovalRequested(client, {
      requestId: id,
      amountIrR: row.amount,
      initiatorUserId: actor.userId,
    });
  }
  private async move(
    client: PoolClient,
    row: RefundRow,
    to: RefundState,
    actor: Actor,
    ip: string,
    reason: string
  ): Promise<void> {
    try {
      assertRefundTransition(row.state, to);
    } catch (error) {
      throw new ConflictException((error as Error).message);
    }
    const from = row.state;
    await client.query('UPDATE refunds SET state=$2 WHERE id=$1', [row.id, to]);
    row.state = to;
    await this.audit(client, row, actor, ip, `refund.${to.toLowerCase()}`, {
      fromState: from,
      toState: to,
      reason,
    });
  }
  private async audit(
    client: PoolClient,
    row: RefundRow,
    actor: Actor,
    ip: string,
    event: string,
    extra: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES ($1,$2,$3,$4::jsonb,$5,$6)',
      [
        uuidv7(),
        actor.userId,
        event,
        JSON.stringify({
          refundId: row.id,
          invoiceId: row.invoice_id,
          profileId: row.profile_id,
          amount: row.amount,
          sessionId: actor.sessionId,
          ...extra,
        }),
        uuidv7(),
        ip,
      ]
    );
  }
  private async dto(client: PoolClient, row: RefundRow): Promise<RefundDto> {
    const approval = await this.latestApproval(client, row);
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      profileId: row.profile_id,
      amount: row.amount,
      state: row.state,
      destination: row.destination,
      bankReference: row.bank_reference,
      reconciliationStatus: row.reconciliation_status,
      approvalRequestId: approval?.id ?? null,
    };
  }
}
