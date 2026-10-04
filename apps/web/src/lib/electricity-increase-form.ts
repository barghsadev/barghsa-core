import { ErrorCodes } from '@barghsa/shared/errors';
import {
  parseElectricityIncreaseSigningReview,
  type ElectricityIncreaseSigningReview,
} from '@barghsa/shared/finance';

export interface ElectricityIncreaseDraft {
  requestedKwh: string;
}
export interface ElectricityIncreaseRow {
  requestId: string;
  contractId: string;
  orderId: string;
  profileId: string;
  versionId: string;
  originalKwh: string;
  requestedKwh: string;
  maxPercentage: number;
  effectiveFrom: string;
  periodEnd: string;
  status: string;
  reviewReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  requestedBy: string;
  amendmentSha256: string | null;
  amendmentDocument: {
    schemaVersion: number;
    kind: string;
    requestId: string;
    contractId: string;
    orderId: string;
    contractVersionId: string;
    requestedBy: string;
    approvedBy: string;
    approvedAt: string;
    originalKwh: string;
    requestedKwh: string;
    incrementalKwh: string;
    increaseBasisPoints: string;
    maxPercentageAtRequest: number;
    maxPercentageAtApproval: number;
    earliestEffectiveFrom: string;
    periodEnd: string;
    pricingRule: string;
    activationRule: string;
  } | null;
  signatureEvidence: Record<string, unknown> | null;
  signedAt: string | null;
  pricingSnapshot: Record<string, unknown> | null;
  adjustmentInvoiceId: string | null;
  adjustmentAmount: string | null;
  effectiveAt: string | null;
  expiredAt: string | null;
  adjustmentInvoiceState: string | null;
  adjustmentPaidAmount: string | null;
  financialFollowUp: boolean;
  contractState: string;
}
export interface ElectricityIncreaseState {
  request: ElectricityIncreaseRow | null;
  maxPercentage: number;
  originalKwh: string;
  canRequest: boolean;
  quote: { adjustmentIrR: string; eligibleFrom: string } | null;
  review: unknown;
}
export const increaseRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positive = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value);
const money = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,40}$/.test(value);
const time = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableTime = (value: unknown) => value === null || time(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const cap = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000;
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function maximumIncreaseQuantity(original: string, percentage: number) {
  const maximum = BigInt(original) + (BigInt(original) * BigInt(percentage)) / 100n;
  return (maximum < 9_223_372_036_854_775_807n ? maximum : 9_223_372_036_854_775_807n).toString();
}
export function validIncreaseQuantity(raw: string, original: string, maximum: string) {
  const value = raw.trim();
  return positive(value) && BigInt(value) > BigInt(original) && BigInt(value) <= BigInt(maximum);
}
export function increaseRow(value: unknown): value is ElectricityIncreaseRow {
  if (
    !increaseRecord(value) ||
    !['requestId', 'contractId', 'orderId', 'profileId', 'versionId'].every((name) =>
      uuid(value[name])
    ) ||
    !positive(value.originalKwh) ||
    !positive(value.requestedKwh) ||
    BigInt(value.requestedKwh) <= BigInt(value.originalKwh) ||
    !cap(value.maxPercentage) ||
    value.maxPercentage === 0 ||
    !time(value.effectiveFrom) ||
    !time(value.periodEnd) ||
    Date.parse(value.periodEnd) <= Date.parse(value.effectiveFrom) ||
    ![
      'pending',
      'approved',
      'rejected',
      'awaiting_signature',
      'awaiting_payment',
      'awaiting_effective_date',
      'effective',
      'expired',
    ].includes(String(value.status)) ||
    !nullableText(value.reviewReason) ||
    !time(value.createdAt) ||
    !nullableTime(value.reviewedAt) ||
    !nullableText(value.reviewedBy) ||
    typeof value.requestedBy !== 'string' ||
    !value.requestedBy ||
    !(value.amendmentSha256 === null || hash(value.amendmentSha256)) ||
    !nullableTime(value.signedAt) ||
    !nullableTime(value.effectiveAt) ||
    !nullableTime(value.expiredAt) ||
    !(value.adjustmentInvoiceId === null || uuid(value.adjustmentInvoiceId)) ||
    !(value.adjustmentAmount === null || money(value.adjustmentAmount)) ||
    !nullableText(value.adjustmentInvoiceState) ||
    !(value.adjustmentPaidAmount === null || money(value.adjustmentPaidAmount)) ||
    typeof value.financialFollowUp !== 'boolean' ||
    typeof value.contractState !== 'string' ||
    !(value.signatureEvidence === null || increaseRecord(value.signatureEvidence)) ||
    !(value.pricingSnapshot === null || increaseRecord(value.pricingSnapshot))
  )
    return false;
  const unreviewed =
    value.status === 'pending' ||
    (value.status === 'expired' && value.reviewedAt === null && value.reviewedBy === null);
  if (
    unreviewed &&
    [
      value.reviewReason,
      value.reviewedAt,
      value.reviewedBy,
      value.amendmentSha256,
      value.amendmentDocument,
      value.signatureEvidence,
      value.signedAt,
      value.pricingSnapshot,
      value.adjustmentInvoiceId,
      value.adjustmentAmount,
    ].some((field) => field !== null)
  )
    return false;
  if (
    !unreviewed &&
    (!time(value.reviewedAt) || typeof value.reviewedBy !== 'string' || !value.reviewedBy)
  )
    return false;
  if (
    (value.status === 'expired' && !time(value.expiredAt)) ||
    (value.status === 'effective' && !time(value.effectiveAt))
  )
    return false;
  if (
    value.status === 'awaiting_signature' &&
    (!hash(value.amendmentSha256) ||
      !increaseRecord(value.amendmentDocument) ||
      value.signedAt !== null ||
      value.signatureEvidence !== null ||
      value.adjustmentInvoiceId !== null)
  )
    return false;
  if (
    ['awaiting_payment', 'awaiting_effective_date', 'effective'].includes(String(value.status)) &&
    (!hash(value.amendmentSha256) ||
      !increaseRecord(value.amendmentDocument) ||
      !increaseRecord(value.signatureEvidence) ||
      !time(value.signedAt) ||
      !increaseRecord(value.pricingSnapshot) ||
      !uuid(value.adjustmentInvoiceId) ||
      !money(value.adjustmentAmount))
  )
    return false;
  if (value.amendmentDocument === null) return true;
  const amendment = value.amendmentDocument;
  return (
    increaseRecord(amendment) &&
    amendment.schemaVersion === 1 &&
    amendment.kind === 'electricity_quantity_increase' &&
    amendment.requestId === value.requestId &&
    amendment.contractId === value.contractId &&
    amendment.orderId === value.orderId &&
    amendment.contractVersionId === value.versionId &&
    amendment.requestedBy === value.requestedBy &&
    typeof amendment.approvedBy === 'string' &&
    time(amendment.approvedAt) &&
    amendment.originalKwh === value.originalKwh &&
    amendment.requestedKwh === value.requestedKwh &&
    positive(amendment.incrementalKwh) &&
    BigInt(amendment.incrementalKwh) === BigInt(value.requestedKwh) - BigInt(value.originalKwh) &&
    money(amendment.increaseBasisPoints) &&
    cap(amendment.maxPercentageAtRequest) &&
    cap(amendment.maxPercentageAtApproval) &&
    amendment.earliestEffectiveFrom === value.effectiveFrom &&
    amendment.periodEnd === value.periodEnd &&
    typeof amendment.pricingRule === 'string' &&
    typeof amendment.activationRule === 'string'
  );
}
export function increaseState(value: unknown): value is ElectricityIncreaseState {
  return (
    increaseRecord(value) &&
    positive(value.originalKwh) &&
    cap(value.maxPercentage) &&
    typeof value.canRequest === 'boolean' &&
    (value.request === null || increaseRow(value.request)) &&
    !(value.request && value.canRequest) &&
    (value.quote === null ||
      (increaseRecord(value.quote) &&
        money(value.quote.adjustmentIrR) &&
        time(value.quote.eligibleFrom))) &&
    Object.hasOwn(value, 'review')
  );
}
export function definitiveIncreaseRejection(value: unknown, status = 400) {
  return (
    increaseRecord(value) &&
    increaseRecord(value.error) &&
    typeof value.error.message === 'string' &&
    value.error.message.length > 0 &&
    uuid(value.error.correlationId) &&
    ([
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => increaseRecord(value.error) && value.error.code === code) ||
      (status === 400 && value.error.code === 'VALIDATION:INPUT_INVALID'))
  );
}
export function boundIncreaseSigningReview(
  data: ElectricityIncreaseState,
  contractId: string,
  versionId: string,
  profileId?: string
) {
  const review = parseElectricityIncreaseSigningReview(data.review);
  const request = data.request;
  return review &&
    request?.amendmentDocument &&
    data.quote &&
    review.scope.resourceId === contractId &&
    review.scope.profileId === request.profileId &&
    (!profileId || review.scope.profileId === profileId) &&
    review.data.contractId === contractId &&
    review.data.orderId === request.orderId &&
    review.data.versionId === versionId &&
    review.data.requestId === request.requestId &&
    review.data.amendmentSha256 === request.amendmentSha256 &&
    review.data.originalKwh === data.originalKwh &&
    review.data.requestedKwh === request.requestedKwh &&
    review.data.incrementalKwh === request.amendmentDocument.incrementalKwh &&
    review.data.effectiveFrom === request.amendmentDocument.earliestEffectiveFrom &&
    review.data.periodEnd === request.amendmentDocument.periodEnd &&
    review.data.adjustmentIrR === data.quote.adjustmentIrR &&
    review.data.eligibleFrom === data.quote.eligibleFrom
    ? review
    : null;
}
export function confirmedIncreaseRequest(
  value: unknown,
  captured: {
    contractId: string;
    versionId: string;
    profileId?: string;
    actor: string | null;
    originalKwh: string;
    requestedKwh: string;
  }
) {
  return (
    increaseRow(value) &&
    value.contractId === captured.contractId &&
    value.versionId === captured.versionId &&
    (!captured.profileId || value.profileId === captured.profileId) &&
    (!captured.actor || value.requestedBy === captured.actor) &&
    value.originalKwh === captured.originalKwh &&
    value.requestedKwh === captured.requestedKwh
  );
}
export function confirmedIncreaseSignature(
  value: unknown,
  captured: ElectricityIncreaseRow,
  review: ElectricityIncreaseSigningReview,
  actor: string | null
) {
  if (
    !increaseRow(value) ||
    !['awaiting_payment', 'awaiting_effective_date', 'effective', 'expired'].includes(
      value.status
    ) ||
    ![
      'requestId',
      'contractId',
      'orderId',
      'profileId',
      'versionId',
      'originalKwh',
      'requestedKwh',
      'effectiveFrom',
      'periodEnd',
      'amendmentSha256',
      'requestedBy',
      'maxPercentage',
      'createdAt',
      'reviewedAt',
      'reviewedBy',
    ].every(
      (name) =>
        value[name as keyof ElectricityIncreaseRow] ===
        captured[name as keyof ElectricityIncreaseRow]
    ) ||
    !value.adjustmentInvoiceId ||
    value.adjustmentAmount !== review.data.adjustmentIrR ||
    !value.signedAt ||
    !value.signatureEvidence ||
    !value.pricingSnapshot
  )
    return false;
  const amendment: unknown = value.amendmentDocument;
  if (
    !captured.amendmentDocument ||
    !increaseRecord(amendment) ||
    !Object.entries(captured.amendmentDocument).every(
      ([name, expected]) => amendment[name] === expected
    )
  )
    return false;
  const evidence = value.signatureEvidence;
  const pricing = value.pricingSnapshot;
  const savedReview = parseElectricityIncreaseSigningReview(pricing.financialReview);
  const sameComponents = (actual: unknown) =>
    Array.isArray(actual) &&
    actual.length === review.data.priceAdjustments.length &&
    review.data.priceAdjustments.every((component, index) => {
      const saved = actual[index];
      return (
        increaseRecord(saved) &&
        Object.entries(component).every(([name, amount]) => saved[name] === amount)
      );
    });
  return (
    evidence.schemaVersion === 1 &&
    evidence.amendmentSha256 === review.data.amendmentSha256 &&
    typeof evidence.signedBy === 'string' &&
    !!evidence.signedBy &&
    (!actor || evidence.signedBy === actor) &&
    uuid(evidence.sessionId) &&
    evidence.signedAt === value.signedAt &&
    evidence.adjustmentIrR === review.data.adjustmentIrR &&
    pricing.schemaVersion === 1 &&
    pricing.amendmentSha256 === review.data.amendmentSha256 &&
    pricing.originalInvoiceId === review.data.originalInvoiceId &&
    pricing.originalInvoiceIrR === review.data.originalInvoiceIrR &&
    pricing.originalKwh === review.data.originalKwh &&
    pricing.requestedKwh === review.data.requestedKwh &&
    pricing.eligibleFrom === review.data.eligibleFrom &&
    pricing.periodStart === review.data.periodStart &&
    pricing.periodEnd === review.data.periodEnd &&
    pricing.remainingMs === review.data.remainingMs &&
    pricing.periodMs === review.data.periodMs &&
    pricing.adjustmentIrR === review.data.adjustmentIrR &&
    pricing.rounding === 'half-up-to-nearest-IRR' &&
    sameComponents(pricing.priceAdjustments) &&
    savedReview?.hash === review.hash &&
    savedReview.scope.profileId === captured.profileId &&
    savedReview.scope.resourceId === captured.contractId &&
    Object.entries(review.data).every(([name, expected]) =>
      name === 'priceAdjustments'
        ? sameComponents(savedReview.data.priceAdjustments)
        : savedReview.data[name as keyof typeof review.data] === expected
    )
  );
}
