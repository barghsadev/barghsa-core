import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { requireRefundFinancePermission } from '@barghsa/db/refund-processing';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  readInvoiceBankReceiptDualApprovalThreshold,
} from '@barghsa/shared/finance';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { lockDualApprovalThreshold } from '../admin/dual-approval-threshold-lock.js';
import { notifyApprovalRequested } from '../admin/approval-notifications.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import { auditContract, contractIdempotency, type ContractActor } from './contract-transactions.js';
import { readCancellationSnapshot } from './contract-cancellation-snapshot.js';
import type {
  ExecuteCancellationInput,
  PrepareCancellationInput,
} from './contract-cancellation-validation.js';
import { loadCustomerInvoiceActivity } from '../invoice/customer-invoice-activity.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { isInvoiceState } from '../invoice/invoice-state.model.js';

type Snapshot = Awaited<ReturnType<typeof readCancellationSnapshot>>;
type RefundDecision = {
  mode: 'full_wallet' | 'custom';
  refunds: Array<{ invoiceId: string; amount: string; destination: 'wallet' | 'external_bank' }>;
};
type Policy = { enabled: boolean; thresholdIrR?: string };
interface Intent {
  id: string;
  contract_id: string;
  version_id: string;
  actor_id: string;
  reason: string;
  refund_decision: RefundDecision;
  financial_snapshot: Snapshot;
  financial_fingerprint: string;
  financial_impact_amount: string;
  approval_policy: Policy;
  approval_request_id: string | null;
  created_at: Date;
}

@Injectable()
export class ContractCancellationService {
  constructor(private readonly invoices: InvoiceStateMachineService) {}

  async prepare(id: string, input: PrepareCancellationInput, actor: ContractActor, ip: string) {
    const intentId = await this.transaction(id, actor, async (client, archived) =>
      contractIdempotency(
        client,
        'contract_cancel_prepare',
        { ...input, contractId: id },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const snapshot = await readCancellationSnapshot(client, id);
          this.current(snapshot, input.expectedVersionId, input.expectedFingerprint);
          const decision = this.decision(snapshot, input.refundDecision);
          if (snapshot.serviceType !== 'electricity' && BigInt(snapshot.refundableAmount) > 0n)
            await requireStaffMutationPermission(client, actor.userId, 'admin:financial:edit');
          const policy = await this.policy(client);
          const approvalRequired =
            policy.enabled && BigInt(snapshot.refundableAmount) >= BigInt(policy.thresholdIrR!);
          const intentId = uuidv7(),
            approvalId = approvalRequired ? uuidv7() : null;
          if (approvalId) {
            await client.query(
              "INSERT INTO approval_requests(id,action_type,amount_irr,initiator_id,reason,details) VALUES($1,'contract_cancellation',$2,$3,$4,$5::jsonb)",
              [
                approvalId,
                snapshot.refundableAmount,
                actor.userId,
                input.reason,
                JSON.stringify({
                  entityType: 'contract_cancellation',
                  intentId,
                  contractId: id,
                  versionId: snapshot.versionId,
                  financialFingerprint: snapshot.fingerprint,
                  profileId: snapshot.profileId,
                  refundDecision: decision,
                }),
              ]
            );
          }
          await client.query(
            `INSERT INTO contract_cancellation_intents(id,contract_id,version_id,actor_id,reason,refund_decision,financial_snapshot,financial_fingerprint,financial_impact_amount,approval_policy,approval_request_id,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12)`,
            [
              intentId,
              id,
              snapshot.versionId,
              actor.userId,
              input.reason,
              JSON.stringify(decision),
              JSON.stringify(snapshot),
              snapshot.fingerprint,
              snapshot.refundableAmount,
              JSON.stringify(policy),
              approvalId,
              input.idempotencyKey,
            ]
          );
          await auditContract(
            client,
            id,
            snapshot.versionId,
            'contract.cancellation_prepared',
            actor,
            ip,
            {
              intentId,
              reason: input.reason,
              refundDecision: decision,
              financialFingerprint: snapshot.fingerprint,
              approvalRequestId: approvalId,
            }
          );
          if (approvalId) {
            await auditContract(
              client,
              id,
              snapshot.versionId,
              'approval_request_created',
              actor,
              ip,
              {
                requestId: approvalId,
                intentId,
                actionType: 'contract_cancellation',
                amountIrR: snapshot.refundableAmount,
                sessionId: actor.sessionId,
              }
            );
            await notifyApprovalRequested(client, {
              requestId: approvalId,
              amountIrR: snapshot.refundableAmount,
              initiatorUserId: actor.userId,
            });
          }
          return intentId;
        }
      )
    );
    return this.get(id, intentId);
  }

  async get(id: string, intentId: string) {
    const row = (
      await getDbPool().query<Intent & { approval_status: string | null; executed: boolean }>(
        `SELECT i.*,a.status AS approval_status,EXISTS(SELECT 1 FROM contract_cancellations c WHERE c.intent_id=i.id) AS executed
      FROM contract_cancellation_intents i LEFT JOIN approval_requests a ON a.id=i.approval_request_id WHERE i.contract_id=$1 AND i.id=$2`,
        [id, intentId]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return {
      id: row.id,
      contractId: row.contract_id,
      versionId: row.version_id,
      reason: row.reason,
      refundDecision: row.refund_decision,
      financialSnapshot: row.financial_snapshot,
      financialFingerprint: row.financial_fingerprint,
      approvalRequestId: row.approval_request_id,
      status: row.executed
        ? 'executed'
        : row.approval_status === 'rejected'
          ? 'rejected'
          : row.approval_request_id && row.approval_status !== 'approved'
            ? 'awaiting_approval'
            : 'ready',
      createdAt: row.created_at.toISOString(),
    };
  }

  async execute(id: string, input: ExecuteCancellationInput, actor: ContractActor, ip: string) {
    return this.transaction(id, actor, async (client, archived) =>
      contractIdempotency(
        client,
        'contract_cancel_execute',
        { ...input, contractId: id },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const intent = (
            await client.query<Intent>(
              'SELECT * FROM contract_cancellation_intents WHERE contract_id=$1 AND id=$2',
              [id, input.intentId]
            )
          ).rows[0];
          if (!intent) throw new NotFoundException();
          const snapshot = await readCancellationSnapshot(client, id);
          this.current(snapshot, intent.version_id, intent.financial_fingerprint);
          if (snapshot.serviceType !== 'electricity' && BigInt(snapshot.refundableAmount) > 0n)
            await requireStaffMutationPermission(client, actor.userId, 'admin:financial:edit');
          const policy = await this.policy(client);
          if (
            policy.enabled !== intent.approval_policy.enabled ||
            policy.thresholdIrR !== intent.approval_policy.thresholdIrR
          )
            throw new ConflictException(
              'Financial approval policy changed; prepare a new cancellation decision'
            );
          if (intent.approval_request_id) {
            const approval = (
              await client.query('SELECT * FROM approval_requests WHERE id=$1 FOR SHARE NOWAIT', [
                intent.approval_request_id,
              ])
            ).rows[0];
            if (
              !approval ||
              approval.status !== 'approved' ||
              !approval.reviewer_id ||
              approval.reviewer_id === intent.actor_id ||
              approval.initiator_id !== intent.actor_id ||
              approval.action_type !== 'contract_cancellation' ||
              approval.amount_irr !== intent.financial_impact_amount ||
              approval.details.intentId !== intent.id ||
              approval.details.contractId !== id ||
              approval.details.versionId !== intent.version_id ||
              approval.details.financialFingerprint !== intent.financial_fingerprint
            )
              throw new ConflictException('A matching second financial approval is required');
            try {
              await requireRefundFinancePermission(client, approval.reviewer_id);
            } catch {
              throw new ConflictException(
                'The financial reviewer no longer has permission; prepare a new decision'
              );
            }
          }
          await client.query(
            "UPDATE contracts SET state='Cancelled',cancelled_at=clock_timestamp() WHERE id=$1",
            [id]
          );
          await client.query(
            'INSERT INTO contract_cancellations(contract_id,intent_id,executed_by) VALUES($1,$2,$3)',
            [id, intent.id, actor.userId]
          );
          const refunds: Array<{
            id: string;
            invoiceId: string;
            amount: string;
            destination: string;
            state: string;
          }> = [];
          for (const line of intent.refund_decision.refunds) {
            const refundId = uuidv7();
            await client.query(
              'INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)',
              [
                refundId,
                line.invoiceId,
                snapshot.profileId,
                line.amount,
                line.destination,
                `contract-refund:${intent.id}:${line.invoiceId}`,
              ]
            );
            await client.query(
              'INSERT INTO contract_refund_obligations(refund_id,contract_id,invoice_id) VALUES($1,$2,$3)',
              [refundId, id, line.invoiceId]
            );
            const activity = await loadCustomerInvoiceActivity(
              client,
              line.invoiceId,
              snapshot.profileId
            );
            const paymentSources = activity.payments.filter((payment) =>
              ['Completed', 'Confirmed'].includes(payment.state)
            );
            await auditContract(client, id, intent.version_id, 'refund.requested', actor, ip, {
              refundId,
              invoiceId: line.invoiceId,
              profileId: snapshot.profileId,
              amount: line.amount,
              destination: line.destination,
              intentId: intent.id,
              actorType: 'system',
              authorizedBy: actor.userId,
              reason: intent.reason,
              paymentSources,
              legacyPaymentSourcesUnavailable: paymentSources.length === 0,
            });
            refunds.push({ id: refundId, ...line, state: 'Requested' });
          }
          for (const invoice of snapshot.invoices) {
            if (
              invoice.paidAmount === '0' &&
              ['Draft', 'Unpaid', 'Overdue'].includes(invoice.state) &&
              isInvoiceState(invoice.state)
            )
              await this.invoices.transition(invoice.id, invoice.state, 'Cancelled', {
                actorUserId: actor.userId,
                reason: intent.reason,
                ip,
                client,
                financials: {
                  paidAmount: 0n,
                  refundedAmount: 0n,
                  totalAmount: BigInt(invoice.totalAmount),
                },
              });
          }
          await auditContract(client, id, intent.version_id, 'contract.cancelled', actor, ip, {
            intentId: intent.id,
            reason: intent.reason,
            refundDecision: intent.refund_decision,
            refundIds: refunds.map((row) => row.id),
            approvalRequestId: intent.approval_request_id,
            financiallyClosed: refunds.length === 0,
          });
          return {
            contractId: id,
            versionId: intent.version_id,
            state: 'Cancelled' as const,
            intentId: intent.id,
            refunds,
            financiallyClosed: refunds.length === 0,
          };
        }
      )
    );
  }

  private current(snapshot: Snapshot, version: string, fingerprint: string) {
    if (snapshot.versionId !== version || snapshot.fingerprint !== fingerprint)
      throw new ConflictException(
        'Contract or financial facts changed; refresh the cancellation review'
      );
    if (snapshot.blockers.length)
      throw new ConflictException({
        message: 'Cancellation requires reconciliation',
        blockers: snapshot.blockers,
      });
    if (BigInt(snapshot.refundableAmount) > 9223372036854775807n)
      throw new ConflictException('Cancellation financial impact exceeds the supported amount');
  }
  private decision(
    snapshot: Snapshot,
    input: PrepareCancellationInput['refundDecision']
  ): RefundDecision {
    if (snapshot.serviceType === 'electricity' && input.mode !== 'full_wallet')
      throw new BadRequestException('Electricity cancellation requires the full wallet return');
    const refunds =
      input.mode === 'full_wallet'
        ? snapshot.invoices
            .filter((invoice) => BigInt(invoice.refundableAmount) > 0n)
            .map((invoice) => ({
              invoiceId: invoice.id,
              amount: invoice.refundableAmount,
              destination: 'wallet' as const,
            }))
        : input.refunds;
    const seen = new Set<string>();
    for (const line of refunds) {
      const invoice = snapshot.invoices.find((row) => row.id === line.invoiceId);
      if (
        !invoice ||
        seen.has(line.invoiceId) ||
        BigInt(line.amount) > BigInt(invoice.availableRefundAmount)
      )
        throw new BadRequestException('Refund decision exceeds the available invoice balance');
      seen.add(line.invoiceId);
    }
    return { mode: input.mode, refunds };
  }
  private async policy(client: PoolClient): Promise<Policy> {
    const raw = (
      await client.query('SELECT value FROM app_config WHERE key=$1', [
        DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
      ])
    ).rows[0]?.value;
    const policy = readInvoiceBankReceiptDualApprovalThreshold(raw);
    if (policy.status === 'corrupt')
      throw new ConflictException('Financial approval configuration is invalid');
    return policy.status === 'enabled'
      ? { enabled: true, thresholdIrR: String(policy.thresholdIrR) }
      : { enabled: false };
  }
  private async transaction<T>(
    id: string,
    actor: ContractActor,
    work: (client: PoolClient, archived: boolean) => Promise<T>
  ): Promise<T> {
    const owner = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM contracts WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!owner) throw new NotFoundException();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profile = (
        await client.query<{ archived: boolean }>(
          'SELECT archived FROM profiles WHERE id=$1 FOR UPDATE',
          [owner.profile_id]
        )
      ).rows[0];
      if (!profile) throw new NotFoundException();
      await lockDualApprovalThreshold(client, 'read');
      await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
      await requireSessionStepUp(client, actor);
      await client.query(
        `SELECT i.id FROM invoices i JOIN contracts c ON c.id=$1 WHERE i.profile_id=c.profile_id AND (i.contract_id=c.id::text OR (c.order_id IS NOT NULL AND i.order_id=c.order_id AND i.contract_id IS NULL)) ORDER BY i.id FOR UPDATE OF i NOWAIT`,
        [id]
      );
      await client.query('SELECT id FROM contracts WHERE id=$1 FOR UPDATE NOWAIT', [id]);
      const result = await work(client, profile.archived);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23505', '23514', '55P03', '40P01', '40001'].includes(String(error.code))
      )
        throw new ConflictException('Cancellation facts changed or are busy; refresh and retry');
      throw error;
    } finally {
      client.release();
    }
  }
}
