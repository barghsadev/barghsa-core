import { ErrorCodes } from '@barghsa/shared/errors';
import {
  parseConsultationFeeReview,
  parseConsultationPaidFeeReview,
  type ConsultationFeeReview,
  type ConsultationPaidFeeReview,
} from '@barghsa/shared/finance';
import { consultationUuid } from './consultation-form.js';
import { offerInputFromInstant, offerInstantFromInput } from './consultation-offer-time.js';

export type ConsultationFeeDraft = {
  fee: string;
  scope: string;
  deliverables: string;
  validUntil: string;
  reason: string;
};
export interface ConsultationFeeSource {
  id: string;
  profile_id: string;
  profile_name: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  fee: string | null;
  scope: string | null;
  deliverables: string | null;
  invoice_id: string | null;
  invoice_state: string | null;
  has_paid_invoice: boolean;
  offer_valid_until: string | null;
}
export type ConsultationFeeReviewValue = ConsultationFeeReview | ConsultationPaidFeeReview;
export const emptyConsultationFee: ConsultationFeeDraft = {
  fee: '',
  scope: '',
  deliverables: '',
  validUntil: '',
  reason: '',
};
export function consultationFeeInstant(
  raw: string,
  source: ConsultationFeeSource,
  timezone: string
) {
  return source.offer_valid_until &&
    raw === offerInputFromInstant(source.offer_valid_until, timezone)
    ? new Date(source.offer_valid_until)
    : offerInstantFromInput(raw, timezone);
}
export function consultationFeeTerms(
  draft: ConsultationFeeDraft,
  source: ConsultationFeeSource,
  timezone: string
) {
  const validUntil = consultationFeeInstant(draft.validUntil, source, timezone)?.toISOString();
  if (!validUntil) return null;
  return source.status === 'offer_accepted'
    ? { fee: draft.fee, validUntil, reason: draft.reason.trim() }
    : {
        fee: draft.fee,
        scope: draft.scope.trim(),
        deliverables: draft.deliverables.trim(),
        validUntil,
        ...(source.invoice_id ? { reason: draft.reason.trim() } : {}),
      };
}
export function sameConsultationFeeSnapshot(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(actual) || Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => sameConsultationFeeSnapshot(value, expected[index]))
    );
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object')
    return false;
  const row = actual as Record<string, unknown>,
    source = expected as Record<string, unknown>;
  return (
    Object.keys(row).length === Object.keys(source).length &&
    Object.keys(source).every(
      (key) => Object.hasOwn(row, key) && sameConsultationFeeSnapshot(row[key], source[key])
    )
  );
}
export function matchedConsultationFeeReview(
  value: unknown,
  source: ConsultationFeeSource,
  terms: NonNullable<ReturnType<typeof consultationFeeTerms>>
): ConsultationFeeReviewValue | null {
  const paid = source.status === 'offer_accepted';
  const review = paid ? parseConsultationPaidFeeReview(value) : parseConsultationFeeReview(value);
  if (
    !review ||
    review.scope.resourceId !== source.id ||
    review.scope.profileId !== source.profile_id ||
    review.data.profileName !== source.profile_name ||
    !sameConsultationFeeSnapshot(review.data.serviceTitle, source.product_snapshot.title) ||
    review.data.validUntil !== terms.validUntil
  )
    return null;
  if ('revisedFee' in review.data) {
    if (
      review.data.previousFee !== source.fee ||
      review.data.revisedFee !== terms.fee ||
      review.data.reason !== terms.reason ||
      review.data.scope !== source.scope ||
      review.data.deliverables !== source.deliverables ||
      review.data.paidInvoice.id !== source.invoice_id ||
      review.data.paidInvoice.state !== source.invoice_state
    )
      return null;
  } else if (
    !('scope' in terms) ||
    review.data.fee !== terms.fee ||
    review.data.scope !== terms.scope ||
    review.data.deliverables !== terms.deliverables ||
    review.data.reason !== (terms.reason ?? null) ||
    (review.data.previousInvoice?.id ?? null) !== source.invoice_id ||
    (review.data.previousInvoice?.state ?? null) !== source.invoice_state
  )
    return null;
  return review;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && consultationUuid(value);
export function matchedConsultationFeeReceipt(
  value: unknown,
  expected: ConsultationFeeReviewValue
) {
  if (!record(value) || value.requestId !== expected.scope.resourceId || !uuid(value.invoiceId))
    return false;
  const actual =
    expected.scope.action === 'consultation.fee-offer'
      ? parseConsultationFeeReview(value.financialReview)
      : parseConsultationPaidFeeReview(value.financialReview);
  if (!actual || !sameConsultationFeeSnapshot(actual, expected)) return false;
  if ('revisedFee' in expected.data) {
    if (
      Object.keys(value).length !== 6 ||
      !uuid(value.adjustmentInvoiceId) ||
      value.adjustmentInvoiceId === expected.data.paidInvoice.id ||
      !Array.isArray(value.refundIds) ||
      !value.refundIds.every(uuid) ||
      new Set(value.refundIds).size !== value.refundIds.length ||
      value.refundIds.length !== expected.data.refundPlan.length
    )
      return false;
    return expected.data.outcome === 'charge_invoice'
      ? value.status === 'offer_pending' && value.invoiceId === value.adjustmentInvoiceId
      : value.status === 'offer_accepted' &&
          value.invoiceId === expected.data.paidInvoice.id &&
          value.adjustmentInvoiceId !== value.invoiceId;
  }
  return (
    Object.keys(value).length === 4 &&
    value.status === 'offer_pending' &&
    value.invoiceId !== expected.data.previousInvoice?.id
  );
}
export function publicConsultationFeeError(value: unknown) {
  if (!record(value) || !record(value.error)) return null;
  const error = value.error;
  return typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    uuid(error.correlationId)
    ? error
    : null;
}
export function definitiveConsultationFeeRejection(value: unknown) {
  const error = publicConsultationFeeError(value);
  return error &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      'VALIDATION:INPUT_INVALID',
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => code === error.code)
    ? error
    : null;
}
export function consultationFeeFields(fields: unknown[], source: ConsultationFeeSource) {
  const owned =
    source.status === 'offer_accepted'
      ? ['fee', 'validUntil', 'reason']
      : ['fee', 'scope', 'deliverables', 'validUntil', ...(source.invoice_id ? ['reason'] : [])];
  return fields.length &&
    fields.every((field) => typeof field === 'string' && owned.includes(field))
    ? (fields as (keyof ConsultationFeeDraft)[])
    : null;
}
