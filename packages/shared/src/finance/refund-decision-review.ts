import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';
import {
  financialReviewMoneySchema as money,
  invoiceFinancialDetailsSchema,
} from './wallet-payment-review.js';

const action = z.enum(['approve', 'reject', 'cancel', 'process', 'record-transfer', 'reconcile']);
const dataSchema = invoiceFinancialDetailsSchema.extend({
  refund: z
    .object({
      id: z.string().uuid(),
      destination: z.enum(['wallet', 'external_bank']),
      state: z.string(),
      amount: money,
      refundedBefore: money,
      reservedBefore: money,
      availableBefore: money,
      availableAfter: money,
      bankReference: z.string().nullable(),
      reconciliationStatus: z.string().nullable(),
      approvalRequired: z.boolean().nullable(),
      approvalRequestId: z.string().uuid().nullable(),
    })
    .strict(),
  decision: z
    .object({
      action,
      targetState: z.string(),
      reason: z.string().nullable(),
      bankReference: z.string().nullable(),
    })
    .strict(),
});

export type RefundDecisionReviewData = z.infer<typeof dataSchema>;
export type RefundDecisionReview = FinancialReviewSnapshot<RefundDecisionReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z
          .string()
          .regex(
            /^refund\.(wallet|external_bank)\.(approve|reject|cancel|process|record-transfer|reconcile)$/
          ),
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
      review.scope.profileId === review.data.profile.id &&
      review.scope.resourceId === review.data.refund.id &&
      review.scope.action ===
        `refund.${review.data.refund.destination}.${review.data.decision.action}`
  );

export function parseRefundDecisionReview(value: unknown): RefundDecisionReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
