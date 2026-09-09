import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '@barghsa/shared/errors';
import { APPROVAL_REVIEW_REASON_MAX_LENGTH } from '@barghsa/shared/finance';
import type { WalletQueryClient } from '../wallet/wallet.service.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import { notifyEmergencyReceiptOverride } from './approval-notifications.js';

export const RECEIPT_EMERGENCY_OVERRIDE_PERMISSION = 'admin:financial:emergency-override';
export const RECEIPT_EMERGENCY_OVERRIDE_EVENT = 'financial.receipt.emergency_override';

export function readReceiptEmergencyOverrideReason(body: unknown): string | undefined {
  const value = (body as { emergencyOverrideReason?: unknown } | null)?.emergencyOverrideReason;
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > APPROVAL_REVIEW_REASON_MAX_LENGTH
  ) {
    throw new HttpException(
      {
        statusCode: 400,
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'A bounded, non-empty emergency override reason is required',
      },
      400
    );
  }
  return value.trim();
}

/** Receipt owner holds the request/evidence locks and current session until settlement commits. */
export async function applyReceiptEmergencyOverride(
  client: WalletQueryClient,
  input: {
    requestId: string;
    actorUserId: string;
    sessionId: string;
    reason: string;
    ip: string;
    correlationId?: string;
    now: Date;
  }
): Promise<void> {
  const reason = readReceiptEmergencyOverrideReason({ emergencyOverrideReason: input.reason });
  if (reason === undefined)
    throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
  await requireStaffMutationPermission(
    client as Parameters<typeof requireStaffMutationPermission>[0],
    input.actorUserId,
    RECEIPT_EMERGENCY_OVERRIDE_PERMISSION
  );
  const auditId = randomUUID();
  const result = await client.query(
    `UPDATE approval_requests SET status='approved',reviewer_id=$2,review_reason=$3,reviewed_at=$4,updated_at=$4,
       details=details||jsonb_build_object('emergencyOverride',jsonb_build_object('actorUserId',$2::text,'reason',$3::text,'auditId',$5::text))
     WHERE id=$1 AND status='pending' AND action_type='bank_payment_confirmation'
       AND details->>'entityType' IN ('wallet_bank_receipt','invoice_bank_receipt')
     RETURNING initiator_id,amount_irr,details`,
    [input.requestId, input.actorUserId, reason, input.now, auditId]
  );
  const row = result.rows[0] as
    { initiator_id: string; amount_irr: string; details: Record<string, unknown> } | undefined;
  if (!row)
    throw new HttpException(
      {
        statusCode: 409,
        error: ErrorCodes.CONFLICT_STATE.code,
        message: 'Emergency override requires a pending receipt approval',
      },
      409
    );
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [
      auditId,
      input.actorUserId,
      RECEIPT_EMERGENCY_OVERRIDE_EVENT,
      JSON.stringify({
        requestId: input.requestId,
        receiptId: row.details.receiptId,
        entityType: row.details.entityType,
        fingerprint: row.details.fingerprint,
        amountIrR: String(row.amount_irr),
        initiatorUserId: row.initiator_id,
        reason,
        sessionId: input.sessionId,
      }),
      input.correlationId ?? randomUUID(),
      input.ip,
      input.now,
    ]
  );
  await notifyEmergencyReceiptOverride(client, {
    requestId: input.requestId,
    amountIrR: String(row.amount_irr),
    initiatorUserId: input.actorUserId,
    reason,
  });
}
