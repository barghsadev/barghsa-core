import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const dataSchema = z
  .object({
    serviceTitle: z.object({ fa: z.string().min(1), en: z.string().min(1) }).strict(),
    profileName: z.string().min(1),
    scope: z.string().min(1),
    deliverables: z.string().min(1),
    fee: money,
    validUntil: z.iso.datetime({ offset: true }),
    reason: z.string().min(1).nullable(),
    previousInvoice: z
      .object({ id: z.string().uuid(), state: z.string().min(1), totalAmount: money })
      .strict()
      .nullable(),
    outcome: z.enum(['issue_invoice', 'replace_unpaid_invoice']),
  })
  .strict();

export type ConsultationFeeReviewData = z.infer<typeof dataSchema>;
export type ConsultationFeeReview = FinancialReviewSnapshot<ConsultationFeeReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('consultation.fee-offer'),
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
      (review.data.previousInvoice === null) === (review.data.outcome === 'issue_invoice') &&
      (review.data.previousInvoice === null) === (review.data.reason === null)
  );

export function parseConsultationFeeReview(value: unknown): ConsultationFeeReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
