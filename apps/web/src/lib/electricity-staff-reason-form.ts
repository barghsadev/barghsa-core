import { parseElectricityStaffDecisionReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';

export type ElectricityDecision = 'approve' | 'request-changes' | 'reject';
export type StaffReasonDraft = { reason: string };
export type StaffDecisionContext = {
  orderId: string;
  profileId: string;
  versionId: string;
  contractId: string | null;
  invoiceId: string;
};

export function boundStaffDecisionReview(
  value: unknown,
  order: StaffDecisionContext,
  decision: ElectricityDecision,
  reason: string
) {
  const review = parseElectricityStaffDecisionReview(value);
  return review &&
    review.scope.resourceId === order.orderId &&
    review.scope.profileId === order.profileId &&
    review.scope.action === `electricity.staff-review.${decision}` &&
    review.data.action === decision &&
    review.data.versionId === order.versionId &&
    review.data.contractId === order.contractId &&
    review.data.invoiceId === order.invoiceId &&
    review.data.reason === (decision === 'approve' ? '' : reason.trim())
    ? review
    : null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function confirmedStaffDecision(
  value: unknown,
  review: NonNullable<ReturnType<typeof boundStaffDecisionReview>>
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const status = {
    approve: 'approved',
    'request-changes': 'changes_requested',
    reject: 'rejected',
  };
  return (
    receipt.orderId === review.scope.resourceId &&
    receipt.contractId === review.data.contractId &&
    receipt.invoiceId === review.data.invoiceId &&
    receipt.status === status[review.data.action] &&
    (review.data.outcome === 'refund_obligation'
      ? typeof receipt.refundId === 'string' && uuid.test(receipt.refundId)
      : receipt.refundId === null)
  );
}

/** Only a complete public rejection can unlock an attempted command. */
export function definitiveStaffDecisionRejection(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const fields = error as Record<string, unknown>;
  return (
    typeof fields.message === 'string' &&
    typeof fields.correlationId === 'string' &&
    uuid.test(fields.correlationId) &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => fields.code === code)
  );
}
