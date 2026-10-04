import { parseElectricityIncreaseStaffDecisionReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
export { definitiveStaffDecisionRejection } from './electricity-staff-reason-form.js';

export function definitiveMissingIncrease(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const details = error as Record<string, unknown>;
  return (
    details.code === ErrorCodes.NOT_FOUND_RESOURCE.code &&
    typeof details.message === 'string' &&
    typeof details.correlationId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.correlationId)
  );
}

export type IncreaseDecision = 'approve' | 'reject';
export type IncreaseDecisionDraft = { effectiveDate: string; reason: string };
export interface IncreaseDecisionContext {
  requestId: string;
  profileId: string;
  contractId: string;
  versionId: string;
  orderId: string;
  originalKwh: string;
  requestedKwh: string;
  maxPercentage: number;
  effectiveFrom: string;
  periodEnd: string;
  contractState: string;
}

/** datetime-local keeps the existing browser-local timezone interpretation. */
export function increaseEffectiveFrom(raw: string): string | undefined | null {
  if (!raw) return undefined;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(raw);
  if (!parts) return null;
  const date = new Date(raw);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== Number(parts[1]) ||
    date.getMonth() + 1 !== Number(parts[2]) ||
    date.getDate() !== Number(parts[3]) ||
    date.getHours() !== Number(parts[4]) ||
    date.getMinutes() !== Number(parts[5]) ||
    date.getSeconds() !== Number(parts[6] ?? 0)
  )
    return null;
  return date.toISOString();
}

const sameTime = (left: unknown, right: string) =>
  typeof left === 'string' &&
  Number.isFinite(Date.parse(left)) &&
  Date.parse(left) === Date.parse(right);

export function boundIncreaseDecisionReview(
  value: unknown,
  request: IncreaseDecisionContext,
  decision: IncreaseDecision,
  input: { effectiveFrom?: string; reason?: string }
) {
  const review = parseElectricityIncreaseStaffDecisionReview(value);
  if (!review) return null;
  const data = review.data;
  return review.scope.profileId === request.profileId &&
    review.scope.resourceId === request.requestId &&
    data.action === decision &&
    data.requestId === request.requestId &&
    data.profileId === request.profileId &&
    data.contractId === request.contractId &&
    data.orderId === request.orderId &&
    data.versionId === request.versionId &&
    data.contractState === request.contractState &&
    data.originalKwh === request.originalKwh &&
    data.requestedKwh === request.requestedKwh &&
    data.maxPercentageAtRequest === request.maxPercentage &&
    sameTime(data.requestedEffectiveFrom, request.effectiveFrom) &&
    sameTime(data.periodEnd, request.periodEnd) &&
    data.reason === (decision === 'reject' ? input.reason : '') &&
    (!input.effectiveFrom || sameTime(data.effectiveFrom, input.effectiveFrom))
    ? review
    : null;
}

/** Validate the persisted request row, including the immutable approval document. */
export async function confirmedIncreaseDecision(
  value: unknown,
  review: NonNullable<ReturnType<typeof boundIncreaseDecisionReview>>
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const data = review.data;
  for (const name of [
    'requestId',
    'profileId',
    'contractId',
    'orderId',
    'versionId',
    'originalKwh',
    'requestedKwh',
  ] as const)
    if (row[name] !== data[name]) return false;
  if (
    row.maxPercentage !== data.maxPercentageAtRequest ||
    !sameTime(row.periodEnd, data.periodEnd) ||
    !sameTime(row.effectiveFrom, data.effectiveFrom ?? data.requestedEffectiveFrom) ||
    typeof row.reviewedBy !== 'string' ||
    !row.reviewedBy ||
    typeof row.requestedBy !== 'string' ||
    !row.requestedBy ||
    typeof row.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    typeof row.reviewedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.reviewedAt))
  )
    return false;
  const unsigned = [
    'signatureEvidence',
    'signedAt',
    'pricingSnapshot',
    'adjustmentAmount',
    'adjustmentInvoiceId',
    'effectiveAt',
  ].every((name) => row[name] === null);
  if (data.action === 'reject')
    return (
      row.status === 'rejected' &&
      row.reviewReason === data.reason &&
      unsigned &&
      row.expiredAt === null &&
      row.amendmentDocument === null &&
      row.amendmentSha256 === null
    );
  if (
    ![
      'awaiting_signature',
      'awaiting_payment',
      'awaiting_effective_date',
      'effective',
      'expired',
    ].includes(String(row.status)) ||
    row.reviewReason !== null ||
    typeof row.amendmentSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.amendmentSha256) ||
    !row.amendmentDocument ||
    typeof row.amendmentDocument !== 'object' ||
    Array.isArray(row.amendmentDocument)
  )
    return false;
  if (row.status === 'awaiting_signature' && !unsigned) return false;
  if (
    row.status === 'expired'
      ? typeof row.expiredAt !== 'string' || !Number.isFinite(Date.parse(row.expiredAt))
      : row.expiredAt !== null
  )
    return false;
  if (row.status !== 'awaiting_signature' && !(row.status === 'expired' && unsigned)) {
    if (
      !row.signatureEvidence ||
      typeof row.signatureEvidence !== 'object' ||
      Array.isArray(row.signatureEvidence) ||
      typeof row.signedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.signedAt)) ||
      !row.pricingSnapshot ||
      typeof row.pricingSnapshot !== 'object' ||
      Array.isArray(row.pricingSnapshot) ||
      typeof row.adjustmentAmount !== 'string' ||
      !/^[1-9]\d*$/.test(row.adjustmentAmount) ||
      typeof row.adjustmentInvoiceId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        row.adjustmentInvoiceId
      )
    )
      return false;
    const evidence = row.signatureEvidence as Record<string, unknown>;
    if (
      evidence.schemaVersion !== 1 ||
      evidence.amendmentSha256 !== row.amendmentSha256 ||
      typeof evidence.signedBy !== 'string' ||
      !evidence.signedBy ||
      typeof evidence.sessionId !== 'string' ||
      !evidence.sessionId ||
      !sameTime(evidence.signedAt, row.signedAt) ||
      evidence.adjustmentIrR !== row.adjustmentAmount ||
      (row.status === 'effective'
        ? typeof row.effectiveAt !== 'string' || !Number.isFinite(Date.parse(row.effectiveAt))
        : row.effectiveAt !== null)
    )
      return false;
  }
  const document = row.amendmentDocument as Record<string, unknown>;
  if (
    document.schemaVersion !== 1 ||
    document.kind !== 'electricity_quantity_increase' ||
    document.requestId !== data.requestId ||
    document.contractId !== data.contractId ||
    document.orderId !== data.orderId ||
    document.contractVersionId !== data.versionId ||
    document.originalKwh !== data.originalKwh ||
    document.requestedKwh !== data.requestedKwh ||
    document.incrementalKwh !== data.incrementalKwh ||
    document.increaseBasisPoints !==
      ((BigInt(data.incrementalKwh) * 10000n) / BigInt(data.originalKwh)).toString() ||
    document.maxPercentageAtRequest !== data.maxPercentageAtRequest ||
    document.maxPercentageAtApproval !== data.maxPercentageAtDecision ||
    document.requestedBy !== row.requestedBy ||
    document.approvedBy !== row.reviewedBy ||
    !sameTime(document.approvedAt, row.reviewedAt) ||
    !sameTime(document.earliestEffectiveFrom, data.effectiveFrom!) ||
    !sameTime(document.periodEnd, data.periodEnd) ||
    document.pricingRule !==
      'Paid original invoice and finalized price adjustments, prorated for the added quantity over each remaining eligible period at signature' ||
    document.activationRule !==
      'Quantity increases only after customer signature and full adjustment payment, no earlier than the effective date'
  )
    return false;
  const serialized = JSON.stringify(
    Object.fromEntries(
      Object.entries(document).sort(([left], [right]) => left.localeCompare(right))
    )
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return (
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') ===
    row.amendmentSha256
  );
}
