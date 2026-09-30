import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const dataSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    reason: z.string(),
    customerName: z.string().min(1),
    profileName: z.string().min(1),
    billIdentifier: z.string().min(1),
    hardwareTitle: z.object({ fa: z.string(), en: z.string() }),
    addressSnapshot: z.record(z.string(), z.unknown()),
    pricingSnapshot: z.record(z.string(), z.unknown()),
    agreementSnapshot: z.string(),
    contractId: z.string().uuid(),
    contractState: z.string(),
    versionId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    contractSnapshot: z.record(z.string(), z.unknown()),
    invoiceId: z.string().uuid(),
    invoiceState: z.string(),
    invoiceTotal: money,
    paidAmount: money,
    refundedAmount: money,
    pendingRefundAmount: money,
    outcome: z.enum([
      'publish_contract',
      'refund_obligation',
      'cancel_invoice',
      'reject_without_refund',
    ]),
    refundAmount: money,
    releasesGiftCode: z.boolean(),
  })
  .strict();

export type SavingStaffDecisionReviewData = z.infer<typeof dataSchema>;
export type SavingStaffDecisionReview = FinancialReviewSnapshot<SavingStaffDecisionReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.enum(['saving.staff-review.approve', 'saving.staff-review.reject']),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((review) => {
    const { action, paidAmount, refundedAmount, refundAmount, outcome, reason } = review.data;
    if (review.scope.action !== `saving.staff-review.${action}`) return false;
    if (action === 'approve')
      return reason === '' && outcome === 'publish_contract' && refundAmount === '0';
    if (!reason) return false;
    const expected = BigInt(paidAmount) - BigInt(refundedAmount);
    return (
      expected >= 0n &&
      BigInt(refundAmount) === expected &&
      (expected > 0n ? outcome === 'refund_obligation' : outcome !== 'refund_obligation')
    );
  });

export function parseSavingStaffDecisionReview(value: unknown): SavingStaffDecisionReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
