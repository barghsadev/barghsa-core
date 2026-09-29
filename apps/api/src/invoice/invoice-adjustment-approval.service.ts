import { ConflictException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  parseInvoiceAdjustmentReview,
  readInvoiceBankReceiptDualApprovalThreshold,
  type InvoiceAdjustmentReview,
  type InvoiceAdjustmentReviewData,
} from '@barghsa/shared/finance';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { lockDualApprovalThreshold } from '../admin/dual-approval-threshold-lock.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { notifyApprovalRequested } from '../admin/approval-notifications.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { readInvoiceFinancialDetails } from '../finance/invoice-review.js';
import type { ValidatedSession } from '../session/session.service.js';
import {
  CreateAdjustmentInvoiceService,
  ADJUSTABLE_INVOICE_STATES,
  type CreateAdjustmentInvoiceCommand,
} from './create-adjustment-invoice.service.js';
import { correctionFingerprint, findCorrectionReplay } from './invoice-correction-request.js';
import { lockInvoiceProfile } from './invoice-profile-lock.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type Submission = CreateAdjustmentInvoiceCommand & {
  actorSession: Actor;
  idempotencyKey: string;
  expectedReviewHash?: string;
};
interface OriginalRow {
  id: string;
  profile_id: string;
  state: string;
  total_amount: string;
  paid_amount: string;
  refunded_amount: string;
  metadata: {
    adjustmentApprovals?: Record<
      string,
      { requestId: string; fingerprint: string; financialReview?: InvoiceAdjustmentReview }
    >;
    [key: string]: unknown;
  } | null;
}
interface ApprovalPolicy {
  approvalRequired: boolean;
  thresholdIrR: string | null;
}
const bindingSchema = z
  .object({
    originalInvoiceId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    amount: z
      .string()
      .regex(/^-?\d{1,19}$/)
      .pipe(
        z
          .string()
          .refine(
            (v) =>
              BigInt(v) !== 0n &&
              (BigInt(v) < 0n ? -BigInt(v) : BigInt(v)) <= 9_223_372_036_854_775_807n
          )
      ),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** The invoice metadata binds a server-created request. Generic queue details alone confer no authority. */
@Injectable()
export class InvoiceAdjustmentApprovalService {
  constructor(private readonly adjustments: CreateAdjustmentInvoiceService) {}

  private scope(original: OriginalRow) {
    return {
      action: 'invoice.adjustment.submit',
      profileId: original.profile_id,
      resourceId: original.id,
    };
  }

  private async policy(client: PoolClient, amount: bigint): Promise<ApprovalPolicy> {
    const config = (
      await client.query('SELECT value FROM app_config WHERE key=$1', [
        DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
      ])
    ).rows[0];
    const threshold = readInvoiceBankReceiptDualApprovalThreshold(config?.value);
    if (threshold.status === 'corrupt')
      throw new ConflictException('Invalid financial approval threshold');
    const absolute = amount < 0n ? -amount : amount;
    return {
      approvalRequired:
        threshold.status === 'enabled' && absolute >= BigInt(threshold.thresholdIrR),
      thresholdIrR: threshold.status === 'enabled' ? String(threshold.thresholdIrR) : null,
    };
  }

  private async snapshot(
    client: PoolClient,
    original: OriginalRow,
    amount: bigint,
    reason: string,
    initiatorId: string,
    policy: ApprovalPolicy
  ): Promise<InvoiceAdjustmentReview> {
    const absolute = amount < 0n ? -amount : amount;
    if (absolute === 0n || absolute > 9_223_372_036_854_775_807n || !reason.trim())
      throw new ConflictException('Invalid adjustment review input');
    if (
      BigInt(original.paid_amount) <= 0n ||
      !ADJUSTABLE_INVOICE_STATES.some((state) => state === original.state)
    )
      throw new ConflictException('Invoice has no adjustable confirmed payment');
    const total = BigInt(original.total_amount),
      paid = BigInt(original.paid_amount);
    const invoiceDetails = await readInvoiceFinancialDetails(
      client,
      original.id,
      original.profile_id,
      total > paid ? total - paid : 0n
    );
    const data: InvoiceAdjustmentReviewData = {
      ...invoiceDetails,
      adjustment: {
        direction: amount > 0n ? 'charge' : 'credit',
        amount: amount.toString(),
        absoluteAmount: absolute.toString(),
        reason: reason.trim(),
        initiatorId,
        approvalRequired: policy.approvalRequired,
        approvalThreshold: policy.thresholdIrR,
      },
    };
    return new ReviewSnapshotService().create(this.scope(original), data);
  }

  async review(input: { originalInvoiceId: string; amount: bigint; reason: string; actor: Actor }) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await lockDualApprovalThreshold(client, 'read');
      const profileId = await lockInvoiceProfile(client, 'invoice', input.originalInvoiceId);
      await requireStaffMutationPermission(client, input.actor.userId, 'invoices:write');
      await requireCurrentSession(client, input.actor);
      const original = (
        await client.query<OriginalRow>(
          'SELECT id,profile_id,state,total_amount,paid_amount,refunded_amount,metadata FROM invoices WHERE id=$1 FOR UPDATE',
          [input.originalInvoiceId]
        )
      ).rows[0];
      if (!original || original.profile_id !== profileId)
        throw new ConflictException('Invoice profile changed; retry');
      const policy = await this.policy(client, input.amount);
      const review = await this.snapshot(
        client,
        original,
        input.amount,
        input.reason,
        input.actor.userId,
        policy
      );
      await requireCurrentSession(client, input.actor);
      await client.query('COMMIT');
      return review;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async submit(cmd: Submission) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await lockDualApprovalThreshold(client, 'read');
      const profileId = await lockInvoiceProfile(client, 'invoice', cmd.originalInvoiceId);
      await requireStaffMutationPermission(client, cmd.actorUserId, 'invoices:write');
      if (cmd.actorUserId !== cmd.actorSession.userId)
        throw new ConflictException('Actor mismatch');
      await requireSessionStepUp(client, cmd.actorSession);
      const original = (
        await client.query<OriginalRow>(
          'SELECT id,profile_id,state,total_amount,paid_amount,refunded_amount,metadata FROM invoices WHERE id=$1 FOR UPDATE',
          [cmd.originalInvoiceId]
        )
      ).rows[0];
      if (!original || original.profile_id !== profileId)
        throw new ConflictException('Invoice profile changed; retry');
      const fingerprint = correctionFingerprint({
        reason: cmd.reason.trim(),
        amount: cmd.amount.toString(),
        dueAt: null,
      });
      const replay = await findCorrectionReplay(
        client,
        cmd.originalInvoiceId,
        'adjustment',
        cmd.idempotencyKey,
        fingerprint
      );
      let result;
      if (replay) {
        if (cmd.expectedReviewHash) {
          const stored = (
            await client.query<{ metadata: { financialReview?: InvoiceAdjustmentReview } }>(
              "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='invoice.adjustment_review_confirmed' AND metadata::jsonb->>'adjustmentInvoiceId'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
              [replay.id]
            )
          ).rows[0];
          // Adjustments issued before review snapshots have no review audit;
          // a fingerprint-matched replay cannot issue a second invoice.
          if (stored)
            new ReviewSnapshotService().assertStored(
              stored.metadata,
              cmd.expectedReviewHash,
              this.scope(original)
            );
        }
        result = await this.adjustments.createAdjustmentInvoice(cmd, client);
      } else {
        if (
          BigInt(original.paid_amount) <= 0n ||
          !ADJUSTABLE_INVOICE_STATES.some((state) => state === original.state)
        )
          throw new ConflictException('Invoice has no adjustable confirmed payment');
        const prior = original.metadata?.adjustmentApprovals?.[cmd.idempotencyKey];
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new ConflictException('Request key payload conflict');
          if (cmd.expectedReviewHash && prior.financialReview)
            new ReviewSnapshotService().assertStored(
              { financialReview: prior.financialReview },
              cmd.expectedReviewHash,
              this.scope(original)
            );
          const request = (
            await client.query('SELECT status FROM approval_requests WHERE id=$1', [
              prior.requestId,
            ])
          ).rows[0];
          if (request?.status !== 'pending')
            throw new ConflictException('Adjustment approval is rejected or inconsistent');
          result = this.pending(cmd, prior.requestId);
        } else {
          const policy = await this.policy(client, cmd.amount);
          const financialReview = cmd.expectedReviewHash
            ? await this.snapshot(client, original, cmd.amount, cmd.reason, cmd.actorUserId, policy)
            : null;
          if (financialReview)
            new ReviewSnapshotService().assertConfirmed(financialReview, cmd.expectedReviewHash!);
          const absolute = cmd.amount < 0n ? -cmd.amount : cmd.amount;
          if (!policy.approvalRequired) {
            result = await this.adjustments.createAdjustmentInvoice(cmd, client);
            if (financialReview)
              await client.query(
                `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
                 VALUES ($1,$2,'invoice.adjustment_review_confirmed',$3::jsonb,$4,$5)`,
                [
                  uuidv7(),
                  cmd.actorUserId,
                  JSON.stringify({
                    originalInvoiceId: cmd.originalInvoiceId,
                    adjustmentInvoiceId: result.adjustmentInvoiceId,
                    financialReview,
                  }),
                  cmd.correlationId ?? uuidv7(),
                  cmd.ip ?? 'unknown',
                ]
              );
          } else {
            const requestId = uuidv7();
            const binding = bindingSchema.parse({
              originalInvoiceId: cmd.originalInvoiceId,
              idempotencyKey: cmd.idempotencyKey,
              amount: cmd.amount.toString(),
              fingerprint,
            });
            await client.query(
              `INSERT INTO approval_requests(id,action_type,amount_irr,initiator_id,reason,details,status)
               VALUES ($1,'manual_adjustment',$2,$3,$4,$5::jsonb,'pending')`,
              [
                requestId,
                absolute.toString(),
                cmd.actorUserId,
                cmd.reason.trim(),
                JSON.stringify({
                  invoiceAdjustment: binding,
                  invoiceId: cmd.originalInvoiceId,
                  adjustmentAmount: cmd.amount.toString(),
                  ...(financialReview ? { financialReview } : {}),
                }),
              ]
            );
            await client.query(
              'UPDATE invoices SET metadata=$2::jsonb, updated_at=NOW() WHERE id=$1',
              [
                cmd.originalInvoiceId,
                JSON.stringify({
                  ...original.metadata,
                  adjustmentApprovals: {
                    ...original.metadata?.adjustmentApprovals,
                    [cmd.idempotencyKey]: {
                      requestId,
                      fingerprint,
                      ...(financialReview ? { financialReview } : {}),
                    },
                  },
                }),
              ]
            );
            await client.query(
              `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES ($1,$2,'approval_request_created',$3::jsonb,$4,$5)`,
              [
                uuidv7(),
                cmd.actorUserId,
                JSON.stringify({
                  requestId,
                  sessionId: cmd.actorSession.sessionId,
                  actionType: 'manual_adjustment',
                  amountIrR: absolute.toString(),
                  thresholdIrR: policy.thresholdIrR,
                  invoiceAdjustment: binding,
                  ...(financialReview ? { financialReview } : {}),
                }),
                cmd.correlationId ?? uuidv7(),
                cmd.ip ?? 'unknown',
              ]
            );
            await notifyApprovalRequested(client, {
              requestId,
              amountIrR: absolute.toString(),
              initiatorUserId: cmd.actorUserId,
            });
            result = this.pending(cmd, requestId);
          }
        }
      }
      await requireSessionStepUp(client, cmd.actorSession);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private pending(cmd: Submission, approvalRequestId: string) {
    return {
      status: 'pending_approval' as const,
      approvalRequestId,
      originalInvoiceId: cmd.originalInvoiceId,
      idempotencyKey: cmd.idempotencyKey,
      kind: 'adjustment' as const,
      amount: cmd.amount.toString(),
      reason: cmd.reason.trim(),
    };
  }

  /** Acquire the same profile lock before the resolver locks users/approval rows. */
  async lockRequestProfile(client: PoolClient, details: Record<string, unknown> | null) {
    if (!details || !('invoiceAdjustment' in details)) return;
    const binding = bindingSchema.safeParse(details.invoiceAdjustment);
    if (!binding.success) throw new ConflictException('Invalid invoice adjustment approval');
    await lockInvoiceProfile(client, 'invoice', binding.data.originalInvoiceId);
  }

  async executeApproved(
    client: PoolClient,
    row: Record<string, unknown>,
    actor: Actor,
    ip: string,
    correlationId: string
  ) {
    const details = row.details as Record<string, unknown> | null;
    if (!details || !('invoiceAdjustment' in details)) return;
    const binding = bindingSchema.parse(details.invoiceAdjustment);
    const { originalInvoiceId, idempotencyKey, amount, fingerprint } = binding;
    await requireStaffMutationPermission(client, String(row.initiator_id), 'invoices:write');
    const original = (
      await client.query('SELECT profile_id,metadata FROM invoices WHERE id=$1 FOR UPDATE', [
        originalInvoiceId,
      ])
    ).rows[0];
    const saved = original?.metadata?.adjustmentApprovals?.[idempotencyKey];
    const absolute = BigInt(amount) < 0n ? -BigInt(amount) : BigInt(amount);
    if (
      row.action_type !== 'manual_adjustment' ||
      String(row.amount_irr) !== absolute.toString() ||
      saved?.requestId !== row.id ||
      saved?.fingerprint !== fingerprint ||
      fingerprint !== correctionFingerprint({ reason: String(row.reason), amount, dueAt: null })
    )
      throw new ConflictException('Approval is not bound to this adjustment');
    const result = await this.adjustments.createAdjustmentInvoice(
      {
        originalInvoiceId,
        idempotencyKey,
        amount: BigInt(amount),
        reason: String(row.reason),
        actorUserId: actor.userId,
        actorSession: actor,
        ip,
        correlationId,
      },
      client
    );
    const financialReview = parseInvoiceAdjustmentReview(saved?.financialReview);
    if (saved?.financialReview && !financialReview)
      throw new ConflictException('Invalid stored adjustment review');
    if (financialReview) {
      new ReviewSnapshotService().assertStored({ financialReview }, financialReview.hash, {
        action: 'invoice.adjustment.submit',
        profileId: String(original.profile_id),
        resourceId: originalInvoiceId,
      });
      const recorded = (
        await client.query(
          "SELECT id FROM audit_log WHERE event='invoice.adjustment_review_confirmed' AND metadata::jsonb->>'adjustmentInvoiceId'=$1 LIMIT 1",
          [result.adjustmentInvoiceId]
        )
      ).rows[0];
      if (!recorded)
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
           VALUES ($1,$2,'invoice.adjustment_review_confirmed',$3::jsonb,$4,$5)`,
          [
            uuidv7(),
            actor.userId,
            JSON.stringify({
              originalInvoiceId,
              adjustmentInvoiceId: result.adjustmentInvoiceId,
              approvalRequestId: row.id,
              financialReview,
            }),
            correlationId,
            ip,
          ]
        );
    }
    await client.query('UPDATE approval_requests SET details=details || $2::jsonb WHERE id=$1', [
      row.id,
      JSON.stringify({ adjustmentInvoiceId: result.adjustmentInvoiceId }),
    ]);
  }
}
