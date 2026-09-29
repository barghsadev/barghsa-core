import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const decision = z.enum(['accept', 'decline']);
const dataSchema = z
  .object({
    decision,
    serviceTitle: z.object({ fa: z.string().min(1), en: z.string().min(1) }).strict(),
    scope: z.string().min(1),
    deliverables: z.string().min(1),
    fee: money,
    previousFee: money,
    validUntil: z.iso.datetime({ offset: true }),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
    invoice: z
      .object({
        id: z.string().uuid(),
        state: z.string().min(1),
        totalAmount: money,
        paidAmount: money,
        adjustmentKind: z.literal('charge').nullable(),
      })
      .strict(),
    outcome: z.enum(['payment_required', 'accepted_paid', 'cancel_unpaid_invoice']),
  })
  .strict();

export type ConsultationOfferReviewData = z.infer<typeof dataSchema>;
export type ConsultationOfferReview = FinancialReviewSnapshot<ConsultationOfferReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.enum(['consultation.offer-accept', 'consultation.offer-decline']),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine(
    (review) =>
      review.scope.action === `consultation.offer-${review.data.decision}` &&
      BigInt(review.data.previousFee) + BigInt(review.data.invoice.totalAmount) ===
        BigInt(review.data.fee) &&
      (review.data.invoice.adjustmentKind === 'charge'
        ? BigInt(review.data.previousFee) > 0n
        : review.data.previousFee === '0') &&
      BigInt(review.data.invoice.paidAmount) <= BigInt(review.data.invoice.totalAmount) &&
      (review.data.decision === 'decline'
        ? review.data.outcome === 'cancel_unpaid_invoice' &&
          review.data.invoice.paidAmount === '0' &&
          ['Draft', 'Unpaid', 'Overdue'].includes(review.data.invoice.state)
        : review.data.outcome ===
          (review.data.invoice.state === 'Paid' ? 'accepted_paid' : 'payment_required'))
  );

export function parseConsultationOfferReview(value: unknown): ConsultationOfferReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
