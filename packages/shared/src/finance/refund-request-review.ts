import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';
import {
  financialReviewMoneySchema,
  invoiceFinancialDetailsSchema,
} from './wallet-payment-review.js';

const refundDataSchema = invoiceFinancialDetailsSchema.extend({
  refund: z
    .object({
      destination: z.enum(['wallet', 'external_bank']),
      amount: financialReviewMoneySchema,
      reason: z.string().min(1).max(1000),
      refundedBefore: financialReviewMoneySchema,
      reservedBefore: financialReviewMoneySchema,
      availableBefore: financialReviewMoneySchema,
      availableAfter: financialReviewMoneySchema,
      approvalRequired: z.boolean(),
    })
    .strict(),
});

export type RefundRequestReviewData = z.infer<typeof refundDataSchema>;
export type RefundRequestReview = FinancialReviewSnapshot<RefundRequestReviewData>;

const reviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.enum(['refund.wallet.request', 'refund.external_bank.request']),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: refundDataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine(
    (review) =>
      review.scope.profileId === review.data.profile.id &&
      review.scope.resourceId === review.data.invoice.id &&
      review.scope.action === `refund.${review.data.refund.destination}.request`
  );

export function parseRefundRequestReview(value: unknown): RefundRequestReview | null {
  const parsed = reviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
