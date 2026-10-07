import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  contractIdempotency,
  staffContractFinancialReview,
  staffContractMutation,
  type ContractActor,
} from '../contract/contract-transactions.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { GiftCodeService } from '../admin/gift-code.service.js';
import { readOrphanFinancialState } from './electricity-orphan-financial.js';
import { createElectricityRefundObligation } from './electricity-refund-obligation.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { requireRefundFinancePermission } from '@barghsa/db/refund-processing';
import { notifyApprovalRequested } from '../admin/approval-notifications.js';
import { loadCustomerInvoiceActivity } from '../invoice/customer-invoice-activity.js';

export type DraftTerminalAction = 'reject' | 'cancel';
const unlinked = `NOT EXISTS(SELECT 1 FROM contracts WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=e.id AND (profile_id<>e.profile_id OR contract_id IS NOT NULL OR (total_amount<=0 AND NOT (total_amount=0 AND paid_amount=0 AND refunded_amount=0 AND state IN ('Cancelled','Refunded'))) OR adjustment_kind='credit'))
 AND raw_electricity_draft_gift_consistent(e.id,e.profile_id,o.gift_code_id)
 AND NOT EXISTS(SELECT 1 FROM refund_obligations WHERE order_id=e.id AND status<>'completed')
 AND NOT EXISTS(SELECT 1 FROM electricity_order_submissions WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE type='payment' AND lower(ref_id)=e.id::text)
 AND e.submitted_at IS NULL AND e.submitted_by IS NULL`;
interface RawDraft {
  id: string;
  profile_id: string;
  order_profile_id: string;
  mode: string;
  status: string;
  order_status: string;
  order_type: string;
  gift_code_id: string | null;
  financial: Awaited<ReturnType<typeof readOrphanFinancialState>>;
  gift: {
    redemptionId: string;
    giftCodeId: string;
    status: string;
    restoreOnCancel: boolean;
    restoreAfterPayment?: boolean;
    outcome: 'release' | 'retain' | 'already_released';
  } | null;
  unlinked: boolean;
  fingerprint_source: string;
  updated_at: Date;
}
@Injectable()
export class ElectricityRawDraftService {
  constructor(
    private readonly reviews: ReviewSnapshotService,
    private readonly gifts: GiftCodeService,
    private readonly invoices: InvoiceStateMachineService
  ) {}
  private async staffContext(client: PoolClient, actor: ContractActor) {
    const row = (
      await client.query<{ operating_context: string }>(
        'SELECT operating_context FROM sessions WHERE session_id=$1 AND user_id=$2',
        [actor.sessionId, actor.userId]
      )
    ).rows[0];
    if (row?.operating_context !== 'staff') throw new ForbiddenException('Staff context required');
  }
  async queue(actor: ContractActor, after?: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      try {
        await requireStaffMutationPermission(client, actor.userId, 'contracts:read');
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 403) throw error;
        await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
      }
      await requireCurrentSession(client, actor);
      await this.staffContext(client, actor);
      const anchor = after
        ? (
            await client.query<{ created_at: Date }>(
              'SELECT created_at FROM electricity_orders WHERE id=$1',
              [after]
            )
          ).rows[0]
        : null;
      if (after && !anchor) throw new NotFoundException('Draft cursor not found');
      const rows = (
        await client.query<{
          id: string;
          profile_id: string;
          mode: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT e.id,e.profile_id,e.mode,e.created_at,e.updated_at FROM electricity_orders e JOIN orders o ON o.id=e.id JOIN profiles p ON p.id=e.profile_id WHERE e.status='draft' AND o.status IN ('DRAFT','PENDING') AND o.order_type='electricity' AND o.profile_id=e.profile_id AND NOT p.archived AND ${unlinked} AND ($1::timestamptz IS NULL OR (e.created_at,e.id)>($1::timestamptz,$2::uuid)) ORDER BY e.created_at,e.id LIMIT 51`,
          [anchor?.created_at ?? null, after ?? null]
        )
      ).rows;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        drafts: rows.slice(0, 50).map((r) => ({
          orderId: r.id,
          profileId: r.profile_id,
          mode: r.mode,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
        nextAfter: rows.length > 50 ? rows[49]!.id : null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async owner(id: string) {
    const row = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM electricity_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Draft order not found');
    return row.profile_id;
  }
  private async current(
    client: PoolClient,
    id: string,
    lock: 'SHARE' | 'UPDATE',
    expectedProfileId: string
  ) {
    await client.query(`SELECT id FROM invoices WHERE order_id=$1 ORDER BY id FOR ${lock} NOWAIT`, [
      id,
    ]);
    const row = (
      await client.query<RawDraft>(
        `SELECT e.id,e.profile_id,o.profile_id AS order_profile_id,e.mode,e.status,o.status AS order_status,o.order_type,o.gift_code_id,(${unlinked}) AS unlinked,(to_jsonb(e)||jsonb_build_object('order',to_jsonb(o),'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM electricity_order_lines l WHERE l.order_id=e.id),'[]'::jsonb)))::text AS fingerprint_source,e.updated_at FROM electricity_orders e JOIN orders o ON o.id=e.id WHERE e.id=$1 FOR ${lock} OF e,o`,
        [id]
      )
    ).rows[0];
    if (
      !row ||
      row.profile_id !== expectedProfileId ||
      row.profile_id !== row.order_profile_id ||
      row.order_type !== 'electricity'
    )
      throw new NotFoundException('Draft order not found');
    if (row.status !== 'draft' || !['DRAFT', 'PENDING'].includes(row.order_status) || !row.unlinked)
      throw new ConflictException(
        'Draft has business associations; use its reviewed contract workflow'
      );
    row.gift = null;
    row.financial = await readOrphanFinancialState(client, id, row.profile_id);
    row.fingerprint_source += row.financial.source;
    if (row.gift_code_id) {
      const gift = (
        await client.query<{
          id: string;
          gift_code_id: string;
          status: string;
          restore_on_cancel: boolean;
          restore_after_payment: boolean;
          source: string;
        }>(
          `SELECT r.id,r.gift_code_id,r.status,g.restore_on_cancel,g.restore_after_payment,(to_jsonb(r)||jsonb_build_object('policy',jsonb_build_object('id',g.id,'restoreOnCancel',g.restore_on_cancel,'restoreAfterPayment',g.restore_after_payment)))::text AS source FROM gift_code_redemptions r JOIN gift_codes g ON g.id=r.gift_code_id WHERE r.order_id=$1 AND r.profile_id=$2 AND r.gift_code_id=$3 FOR ${lock} OF r NOWAIT FOR SHARE OF g NOWAIT`,
          [id, row.profile_id, row.gift_code_id]
        )
      ).rows;
      if (gift.length !== 1) throw new ConflictException('Draft gift association changed');
      const saved = gift[0]!;
      row.fingerprint_source += saved.source;
      row.gift = {
        redemptionId: saved.id,
        giftCodeId: saved.gift_code_id,
        status: saved.status,
        restoreOnCancel: saved.restore_on_cancel,
        ...(row.financial.paid ? { restoreAfterPayment: saved.restore_after_payment } : {}),
        outcome:
          saved.status === 'released'
            ? 'already_released'
            : saved.restore_on_cancel && (!row.financial.paid || saved.restore_after_payment)
              ? 'release'
              : 'retain',
      };
    }
    return row;
  }
  private snapshot(row: RawDraft, action: DraftTerminalAction, reason: string) {
    return this.reviews.create(
      {
        action: 'electricity.draft-terminal.' + action,
        profileId: row.profile_id,
        resourceId: row.id,
      },
      {
        action,
        reason,
        fromState: 'draft',
        toState: action === 'reject' ? 'rejected' : 'cancelled',
        mode: row.mode,
        stateFingerprint: createHash('sha256').update(row.fingerprint_source).digest('hex'),
        createsContract: false,
        createsInvoice: false,
        collectsPayment: false,
        refundAmount: row.financial.refundAmount,
        invoices: row.financial.invoices,
        approvalPolicy: row.financial.policy,
        approvalRequired: row.financial.approvalRequired,
        paidOrder: row.financial.paid,
        changesSavedWizardProgress: false,
        gift: row.gift,
      }
    );
  }
  async review(id: string, action: DraftTerminalAction, reason: string, actor: ContractActor) {
    const profileId = await this.owner(id);
    return staffContractFinancialReview(
      profileId,
      actor,
      async (client, archived) => {
        if (archived) throw new ConflictException('Profile is archived');
        await this.staffContext(client, actor);
        const review = this.snapshot(
          await this.current(client, id, 'SHARE', profileId),
          action,
          reason
        );
        const approval = (
          await client.query<{ id: string; status: string }>(
            "SELECT id,status FROM approval_requests WHERE action_type='contract_cancellation' AND details->>'entityType'='electricity_order_termination' AND details->>'orderId'=$1 AND details->>'reviewHash'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
            [id, review.hash]
          )
        ).rows[0];
        return {
          ...review,
          approval: approval ? { id: approval.id, status: approval.status } : null,
        };
      },
      { financialPolicy: true }
    );
  }
  async prepareApproval(
    id: string,
    input: {
      action: DraftTerminalAction;
      reason: string;
      expectedReviewHash: string;
      idempotencyKey: string;
    },
    actor: ContractActor,
    ip: string
  ) {
    const profileId = await this.owner(id);
    return staffContractMutation(
      profileId,
      actor,
      async (client, archived) => {
        if (archived) throw new ConflictException('Profile is archived');
        await this.staffContext(client, actor);
        return contractIdempotency(
          client,
          'electricity_raw_draft_approval',
          { ...input, orderId: id },
          actor,
          async () => {
            const row = await this.current(client, id, 'UPDATE', profileId),
              review = this.snapshot(row, input.action, input.reason);
            this.reviews.assertConfirmed(review, input.expectedReviewHash);
            if (!row.financial.approvalRequired)
              throw new ConflictException('Second approval is not required');
            const approvalId = uuidv7(),
              details = {
                entityType: 'electricity_order_termination',
                orderId: id,
                profileId,
                terminalAction: input.action,
                reviewHash: review.hash,
                financialReview: review,
                refundDecision: {
                  mode: 'full_wallet',
                  refunds: row.financial.invoices
                    .filter((i) => BigInt(i.refundableAmount) > 0n)
                    .map((i) => ({
                      invoiceId: i.id,
                      amount: i.refundableAmount,
                      destination: 'wallet',
                    })),
                },
              };
            await client.query(
              "INSERT INTO approval_requests(id,action_type,amount_irr,initiator_id,reason,details) VALUES($1,'contract_cancellation',$2,$3,$4,$5::jsonb)",
              [
                approvalId,
                row.financial.refundAmount,
                actor.userId,
                input.reason,
                JSON.stringify(details),
              ]
            );
            await client.query(
              "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,'approval_request_created',$3::jsonb,$4,$5)",
              [
                uuidv7(),
                actor.userId,
                JSON.stringify({
                  entity: 'approval_request',
                  entityId: approvalId,
                  requestId: approvalId,
                  orderId: id,
                  profileId,
                  fromState: null,
                  toState: 'pending',
                  reason: input.reason,
                  actor: actor.userId,
                  actionType: 'contract_cancellation',
                  amountIrR: row.financial.refundAmount,
                  reviewHash: review.hash,
                }),
                correlationIdStorage.getStore() ?? uuidv7(),
                ip,
              ]
            );
            await notifyApprovalRequested(client, {
              requestId: approvalId,
              initiatorUserId: actor.userId,
              amountIrR: row.financial.refundAmount,
            });
            return { approvalRequestId: approvalId, status: 'pending', reviewHash: review.hash };
          }
        );
      },
      { financialReview: true, financialPolicy: true }
    );
  }
  async terminate(
    id: string,
    input: {
      action: DraftTerminalAction;
      reason: string;
      expectedReviewHash: string;
      idempotencyKey: string;
      approvalRequestId?: string | undefined;
    },
    actor: ContractActor,
    ip: string
  ) {
    const profileId = await this.owner(id);
    try {
      return await staffContractMutation(
        profileId,
        actor,
        async (client, archived) => {
          if (archived) throw new ConflictException('Profile is archived');
          await this.staffContext(client, actor);
          return contractIdempotency(
            client,
            'electricity_raw_draft_terminal',
            { ...input, orderId: id },
            actor,
            async () => {
              const row = await this.current(client, id, 'UPDATE', profileId),
                review = this.snapshot(row, input.action, input.reason);
              this.reviews.assertConfirmed(review, input.expectedReviewHash);
              if (row.financial.approvalRequired) {
                const approval = (
                  await client.query(
                    'SELECT * FROM approval_requests WHERE id=$1 FOR SHARE NOWAIT',
                    [input.approvalRequestId ?? null]
                  )
                ).rows[0];
                if (
                  !approval ||
                  approval.status !== 'approved' ||
                  !approval.reviewer_id ||
                  approval.reviewer_id === approval.initiator_id ||
                  approval.action_type !== 'contract_cancellation' ||
                  approval.amount_irr !== row.financial.refundAmount ||
                  approval.details.entityType !== 'electricity_order_termination' ||
                  approval.details.orderId !== id ||
                  approval.details.profileId !== profileId ||
                  approval.details.terminalAction !== input.action ||
                  approval.details.reviewHash !== review.hash
                )
                  throw new ConflictException('A matching second financial approval is required');
                this.reviews.assertStored(approval.details, review.hash, review.scope);
                try {
                  await requireRefundFinancePermission(client, approval.reviewer_id);
                } catch {
                  throw new ConflictException('Financial reviewer no longer has authority');
                }
              } else if (input.approvalRequestId)
                throw new ConflictException('Approval policy changed');
              if (row.financial.invoices.length)
                await client.query(
                  'INSERT INTO electricity_draft_terminations(order_id,profile_id,executed_by,action,reason,review_hash,financial_review,approval_request_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
                  [
                    id,
                    profileId,
                    actor.userId,
                    input.action,
                    input.reason,
                    review.hash,
                    JSON.stringify(review),
                    input.approvalRequestId ?? null,
                  ]
                );
              const refunds: Array<{ id: string; invoiceId: string; amount: string }> = [];
              for (const invoice of row.financial.invoices) {
                const refundId = await createElectricityRefundObligation(client, {
                  orderId: id,
                  contractId: null,
                  invoiceId: invoice.id,
                  profileId,
                  paidAmount: invoice.paidAmount,
                  refundedAmount: invoice.refundedAmount,
                  authorizedBy: actor.userId,
                  reason: input.reason,
                });
                if (refundId) {
                  refunds.push({
                    id: refundId,
                    invoiceId: invoice.id,
                    amount: invoice.refundableAmount,
                  });
                  const activity = await loadCustomerInvoiceActivity(client, invoice.id, profileId),
                    paymentSources = activity.payments.filter((p) =>
                      ['Completed', 'Confirmed'].includes(p.state)
                    );
                  for (const [event, fromState, toState] of [
                    ['refund.requested', null, 'Requested'],
                    ['refund.approved', 'Requested', 'Approved'],
                  ] as const)
                    await client.query(
                      'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
                      [
                        uuidv7(),
                        actor.userId,
                        event,
                        JSON.stringify({
                          entity: 'refund',
                          entityId: refundId,
                          refundId,
                          invoiceId: invoice.id,
                          orderId: id,
                          profileId,
                          fromState,
                          toState,
                          reason: input.reason,
                          amount: invoice.refundableAmount,
                          destination: 'wallet',
                          actorType: 'system',
                          authorizedBy: actor.userId,
                          reviewHash: review.hash,
                          paymentSources,
                          legacyPaymentSourcesUnavailable: paymentSources.length === 0,
                        }),
                        correlationIdStorage.getStore() ?? uuidv7(),
                        ip,
                      ]
                    );
                } else if (
                  invoice.paidAmount === '0' &&
                  ['Draft', 'Unpaid', 'Overdue'].includes(invoice.state)
                )
                  await this.invoices.transition(
                    invoice.id,
                    invoice.state as 'Draft' | 'Unpaid' | 'Overdue',
                    'Cancelled',
                    {
                      actorUserId: actor.userId,
                      reason: input.reason,
                      ip,
                      client,
                      financials: {
                        paidAmount: 0n,
                        refundedAmount: 0n,
                        totalAmount: BigInt(invoice.totalAmount),
                      },
                    }
                  );
              }
              const status = input.action === 'reject' ? 'rejected' : 'cancelled';
              const order = await client.query(
                "UPDATE orders SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=$1 AND status IN ('DRAFT','PENDING') RETURNING id",
                [id]
              );
              if (order.rowCount !== 1) throw new ConflictException('Draft order changed');
              if (row.gift) {
                const { released } = await this.gifts.releaseByOrder(
                  id,
                  client,
                  {
                    actorUserId: actor.userId,
                    ip,
                  },
                  row.financial.paid ? 'paid_cancellation' : 'unpaid_cancellation'
                );
                if (released !== (row.gift.outcome === 'release' ? 1 : 0))
                  throw new ConflictException('Draft gift outcome changed');
              }
              const draft = await client.query(
                "UPDATE electricity_orders SET status=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='draft' RETURNING id",
                [id, status]
              );
              if (draft.rowCount !== 1) throw new ConflictException('Draft order changed');
              await client.query(
                'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
                [
                  uuidv7(),
                  actor.userId,
                  'electricity.draft.terminated',
                  JSON.stringify({
                    entity: 'electricity_order',
                    entityId: id,
                    orderId: id,
                    profileId: row.profile_id,
                    fromState: 'draft',
                    toState: status,
                    reason: input.reason,
                    actor: actor.userId,
                    rawDraft: true,
                    reviewHash: review.hash,
                    financialReview: review,
                    refundIds: refunds.map((r) => r.id),
                    approvalRequestId: input.approvalRequestId ?? null,
                  }),
                  correlationIdStorage.getStore() ?? uuidv7(),
                  ip,
                ]
              );
              return {
                orderId: id,
                status,
                refundId: refunds[0]?.id ?? null,
                ...(row.financial.invoices.length
                  ? { refunds, financiallyClosed: refunds.length === 0 }
                  : {}),
              };
            }
          );
        },
        { financialReview: true, financialPolicy: true }
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['55P03', '40P01', '40001'].includes(String(error.code))
      )
        throw new ConflictException('Draft order is busy; retry the reviewed decision');
      throw error;
    }
  }
}
