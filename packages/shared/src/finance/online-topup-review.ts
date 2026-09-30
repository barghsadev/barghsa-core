import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const dataSchema = z
  .object({
    profileId: z.string().uuid(),
    amountIrR: z.string().regex(/^[1-9]\d*$/),
    onlineTopUpLimitIrR: z.string().regex(/^(0|[1-9]\d*)$/),
    configVersion: z.number().int().nonnegative(),
    paymentSource: z.literal('external_gateway'),
    stateAfterInitiation: z.literal('Pending'),
    creditRule: z.literal('after_verified_gateway_payment'),
  })
  .strict();

export type OnlineTopUpReviewData = z.infer<typeof dataSchema>;
export type OnlineTopUpReview = FinancialReviewSnapshot<OnlineTopUpReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('wallet.online-topup-initiation'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .refine(
    (review) =>
      review.scope.profileId === review.data.profileId &&
      review.scope.resourceId === review.data.profileId &&
      BigInt(review.data.amountIrR) <= BigInt(review.data.onlineTopUpLimitIrR)
  );

export function parseOnlineTopUpReview(value: unknown): OnlineTopUpReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
