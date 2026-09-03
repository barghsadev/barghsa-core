import { HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { ErrorCodes } from '@barghsa/shared/errors'

/** Canonical audit event written when a pending dual-approval request is approved. */
export const APPROVAL_REQUEST_APPROVED_EVENT = 'approval_request_approved'

/** Canonical audit event written when a pending dual-approval request is rejected. */
export const APPROVAL_REQUEST_REJECTED_EVENT = 'approval_request_rejected'

/** Minimal query surface so callers can resolve inside an existing transaction. */
export interface DualApprovalQueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

export interface ApplyApprovalRequestResolutionInput {
  requestId: string
  reviewerUserId: string
  ip: string
  decision: 'approve' | 'reject'
  reviewReason: string | null
  now: Date
  initiatorId: string
  status: string
  actionType: unknown
  amountIrR: unknown
  correlationId?: string
}

/**
 * Apply a dual-approval resolution on a caller-owned transaction.
 *
 * Enforces the DualApprovalService invariants (pending-only, different-user
 * reviewer) and writes the canonical `approval_request_approved` /
 * `approval_request_rejected` audit row in the same transaction as the
 * status change. Does not BEGIN/COMMIT — the caller owns the transaction
 * so settlement (or queue review) stays atomic with the audit trail.
 */
export async function applyApprovalRequestResolutionOnClient(
  client: DualApprovalQueryClient,
  input: ApplyApprovalRequestResolutionInput,
): Promise<void> {
  if (input.status !== 'pending') {
    throw new HttpException(
      {
        statusCode: 409,
        error: ErrorCodes.CONFLICT_STATE.code,
        message: `Approval request is already ${input.status}`,
      },
      409,
    )
  }

  if (input.initiatorId === input.reviewerUserId) {
    throw new HttpException(
      {
        statusCode: 403,
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
        message: 'A user cannot approve or reject their own approval request',
      },
      403,
    )
  }

  const newStatus = input.decision === 'approve' ? 'approved' : 'rejected'
  await client.query(
    `UPDATE approval_requests
     SET status = $1, reviewer_id = $2, review_reason = $3, reviewed_at = $4, updated_at = $4
     WHERE id = $5`,
    [newStatus, input.reviewerUserId, input.reviewReason, input.now, input.requestId],
  )

  await client.query(
    `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      uuidv7(),
      input.reviewerUserId,
      input.decision === 'approve'
        ? APPROVAL_REQUEST_APPROVED_EVENT
        : APPROVAL_REQUEST_REJECTED_EVENT,
      JSON.stringify({
        requestId: input.requestId,
        actionType: input.actionType,
        // BIGINT arrives as a string from pg; normalize to a number so
        // both approval_request_created and the *_approved/_rejected
        // events emit type-consistent audit metadata.
        amountIrR: Number(input.amountIrR),
        initiatorUserId: input.initiatorId,
        reviewerUserId: input.reviewerUserId,
        ...(input.reviewReason !== null ? { reviewReason: input.reviewReason } : {}),
      }),
      input.correlationId ?? uuidv7(),
      input.ip,
      input.now,
    ],
  )
}
