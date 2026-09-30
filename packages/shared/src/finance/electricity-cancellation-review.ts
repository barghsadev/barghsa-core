import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const dataSchema = z
  .object({
    reason: z.string().min(1),
    profileName: z.string().min(1),
    commercialStatus: z.string(),
    contractId: z.string().uuid(),
    contractState: z.string(),
    versionId: z.string().uuid(),
    contractSnapshot: z.record(z.string(), z.unknown()),
    invoiceId: z.string().uuid(),
    invoiceState: z.string(),
    invoiceTotal: money,
    paidAmount: money,
    refundedAmount: money,
    pendingRefundAmount: money,
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    totalKwh: z.string(),
    pricingSnapshot: z.record(z.string(), z.unknown()),
    outcome: z.enum(['refund_obligation', 'cancel_invoice', 'close_without_refund']),
    refundAmount: money,
    releasesGiftCode: z.boolean(),
  })
  .strict();

export type ElectricityCancellationReviewData = z.infer<typeof dataSchema>;
export type ElectricityCancellationReview =
  FinancialReviewSnapshot<ElectricityCancellationReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('electricity.customer-cancel'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((review) => {
    const { paidAmount, refundedAmount, refundAmount, outcome } = review.data;
    const expected = BigInt(paidAmount) - BigInt(refundedAmount);
    return (
      expected >= 0n &&
      BigInt(refundAmount) === expected &&
      (expected > 0n ? outcome === 'refund_obligation' : outcome !== 'refund_obligation')
    );
  });

export function parseElectricityCancellationReview(
  value: unknown
): ElectricityCancellationReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
