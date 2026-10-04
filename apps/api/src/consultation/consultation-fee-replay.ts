import { ConflictException } from '@nestjs/common';
import { z } from 'zod';
import {
  parseConsultationFeeReview,
  parseConsultationPaidFeeReview,
} from '@barghsa/shared/finance';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function conflict(): never {
  throw new ConflictException('Consultation fee command key was already used');
}
const offerReceipt = z
  .object({
    requestId: z.string().uuid(),
    status: z.literal('offer_pending'),
    invoiceId: z.string().uuid(),
    financialReview: z.unknown(),
  })
  .strict();
const paidReceipt = z
  .object({
    requestId: z.string().uuid(),
    status: z.enum(['offer_pending', 'offer_accepted']),
    invoiceId: z.string().uuid(),
    adjustmentInvoiceId: z.string().uuid(),
    refundIds: z.array(z.string().uuid()),
    financialReview: z.unknown(),
  })
  .strict();

export function consultationFeeCommand(input: {
  fee: string;
  scope: string;
  deliverables: string;
  validUntil: string;
  reason?: string | undefined;
}) {
  return {
    fee: input.fee,
    scope: input.scope,
    deliverables: input.deliverables,
    validUntil: new Date(input.validUntil).toISOString(),
    reason: input.reason?.trim() ?? null,
  };
}

/** The old review and durable invoice key prove the original receipt, never current GET state. */
export function replayConsultationFee(
  metadata: unknown,
  invoiceId: string,
  profileId: string,
  requestId: string,
  input: Parameters<typeof consultationFeeCommand>[0] & { expectedReviewHash: string }
) {
  const saved = record(metadata);
  const scope = { action: 'consultation.fee-offer', profileId, resourceId: requestId };
  const review = parseConsultationFeeReview(
    new ReviewSnapshotService().assertStored(saved, input.expectedReviewHash, scope)
  );
  if (!saved || !review) return conflict();
  if (
    !z.string().uuid().safeParse(invoiceId).success ||
    review.data.previousInvoice?.id === invoiceId
  )
    return conflict();
  const command = consultationFeeCommand(input);
  if (
    review.data.fee !== command.fee ||
    review.data.scope !== command.scope ||
    review.data.deliverables !== command.deliverables ||
    review.data.validUntil !== command.validUntil
  )
    return conflict();
  if ('command' in saved) {
    const captured = record(saved.command);
    if (!captured || Object.entries(command).some(([key, value]) => captured[key] !== value))
      return conflict();
  } else if (review.data.reason !== command.reason) return conflict();
  const original = {
    requestId,
    status: 'offer_pending' as const,
    invoiceId,
    financialReview: review,
  };
  if (!('result' in saved)) return original;
  const result = offerReceipt.safeParse(saved.result);
  if (!result.success || result.data.requestId !== requestId || result.data.invoiceId !== invoiceId)
    return conflict();
  new ReviewSnapshotService().assertStored(
    { financialReview: result.data.financialReview },
    input.expectedReviewHash,
    scope
  );
  return original;
}

export function replayConsultationPaidFee(
  metadata: unknown,
  profileId: string,
  requestId: string,
  input: { fee: string; reason: string; validUntil: string; expectedReviewHash: string }
) {
  const saved = record(metadata);
  const scope = { action: 'consultation.paid-fee-adjustment', profileId, resourceId: requestId };
  const review = parseConsultationPaidFeeReview(
    new ReviewSnapshotService().assertStored(saved, input.expectedReviewHash, scope)
  );
  if (
    !saved ||
    !review ||
    saved.fee !== input.fee ||
    saved.reason !== input.reason ||
    saved.validUntil !== new Date(input.validUntil).toISOString() ||
    review.data.revisedFee !== input.fee ||
    review.data.reason !== input.reason ||
    review.data.validUntil !== saved.validUntil
  )
    return conflict();
  const result = paidReceipt.safeParse(saved.result);
  if (!result.success || result.data.requestId !== requestId) return conflict();
  const receipt = result.data;
  const charge = review.data.outcome === 'charge_invoice';
  if (
    receipt.adjustmentInvoiceId === review.data.paidInvoice.id ||
    receipt.status !== (charge ? 'offer_pending' : 'offer_accepted') ||
    receipt.invoiceId !== (charge ? receipt.adjustmentInvoiceId : review.data.paidInvoice.id) ||
    receipt.refundIds.length !== review.data.refundPlan.length ||
    new Set(receipt.refundIds).size !== receipt.refundIds.length
  )
    return conflict();
  new ReviewSnapshotService().assertStored(
    { financialReview: receipt.financialReview },
    input.expectedReviewHash,
    scope
  );
  return { ...receipt, financialReview: review };
}
