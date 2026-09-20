import { ConflictException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  readInvoiceBankReceiptDualApprovalThreshold,
} from '@barghsa/shared/finance';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { lockDualApprovalThreshold } from '../admin/dual-approval-threshold-lock.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { notifyApprovalRequested } from '../admin/approval-notifications.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import {
  CreateAdjustmentInvoiceService,
  ADJUSTABLE_INVOICE_STATES,
  type CreateAdjustmentInvoiceCommand,
} from './create-adjustment-invoice.service.js';
import { correctionFingerprint, findCorrectionReplay } from './invoice-correction-request.js';
import { lockInvoiceProfile } from './invoice-profile-lock.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type Submission = CreateAdjustmentInvoiceCommand & { actorSession: Actor; idempotencyKey: string };
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

  async submit(cmd: Submission) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await lockDualApprovalThreshold(client, 'read');
      await lockInvoiceProfile(client, 'invoice', cmd.originalInvoiceId);
      await requireStaffMutationPermission(client, cmd.actorUserId, 'invoices:write');
      if (cmd.actorUserId !== cmd.actorSession.userId)
        throw new ConflictException('Actor mismatch');
      await requireSessionStepUp(client, cmd.actorSession);
      const original = (
        await client.query(
          'SELECT state, paid_amount, metadata FROM invoices WHERE id=$1 FOR UPDATE',
          [cmd.originalInvoiceId]
        )
      ).rows[0];
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
        result = await this.adjustments.createAdjustmentInvoice(cmd, client);
      } else {
        if (
          !original ||
          BigInt(original.paid_amount) <= 0n ||
          !ADJUSTABLE_INVOICE_STATES.includes(original.state)
        )
          throw new ConflictException('Invoice has no adjustable confirmed payment');
        const prior = original.metadata?.adjustmentApprovals?.[cmd.idempotencyKey];
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new ConflictException('Request key payload conflict');
          const request = (
            await client.query('SELECT status FROM approval_requests WHERE id=$1', [
              prior.requestId,
            ])
          ).rows[0];
          if (request?.status !== 'pending')
            throw new ConflictException('Adjustment approval is rejected or inconsistent');
          result = this.pending(cmd, prior.requestId);
        } else {
          const config = (
            await client.query('SELECT value FROM app_config WHERE key=$1', [
              DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
            ])
          ).rows[0];
          const threshold = readInvoiceBankReceiptDualApprovalThreshold(config?.value);
          if (threshold.status === 'corrupt')
            throw new ConflictException('Invalid financial approval threshold');
          const absolute = cmd.amount < 0n ? -cmd.amount : cmd.amount;
          if (threshold.status !== 'enabled' || absolute < BigInt(threshold.thresholdIrR)) {
            result = await this.adjustments.createAdjustmentInvoice(cmd, client);
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
                    [cmd.idempotencyKey]: { requestId, fingerprint },
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
                  thresholdIrR: threshold.thresholdIrR,
                  invoiceAdjustment: binding,
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
      await client.query('SELECT metadata FROM invoices WHERE id=$1 FOR UPDATE', [
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
    await client.query('UPDATE approval_requests SET details=details || $2::jsonb WHERE id=$1', [
      row.id,
      JSON.stringify({ adjustmentInvoiceId: result.adjustmentInvoiceId }),
    ]);
  }
}
