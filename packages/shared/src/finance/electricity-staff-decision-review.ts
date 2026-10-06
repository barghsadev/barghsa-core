import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const action = z.enum(['approve', 'request-changes', 'reject']);
const dataSchema = z
  .object({
    action,
    reason: z.string(),
    customerName: z.string().min(1),
    contractId: z.string().uuid(),
    contractState: z.string(),
    commercialStatus: z.enum([
      'draft',
      'submitted',
      'awaiting_staff_review',
      'changes_requested',
      'approved',
    ]),
    versionId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
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
    outcome: z.enum([
      'publish_contract',
      'request_revision',
      'refund_obligation',
      'cancel_invoice',
      'reject_without_refund',
    ]),
    refundAmount: money,
    releasesGiftCode: z.boolean(),
  })
  .strict();

export type ElectricityStaffDecisionReviewData = z.infer<typeof dataSchema>;
export type ElectricityStaffDecisionReview =
  FinancialReviewSnapshot<ElectricityStaffDecisionReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.enum([
          'electricity.staff-review.approve',
          'electricity.staff-review.request-changes',
          'electricity.staff-review.reject',
        ]),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((review) => review.scope.action === `electricity.staff-review.${review.data.action}`)
  .refine((review) => {
    const { action, outcome, refundAmount, paidAmount, refundedAmount } = review.data;
    if (action === 'approve') return outcome === 'publish_contract' && refundAmount === '0';
    if (action === 'request-changes') return outcome === 'request_revision' && refundAmount === '0';
    return (
      (outcome === 'refund_obligation' &&
        BigInt(refundAmount) === BigInt(paidAmount) - BigInt(refundedAmount) &&
        BigInt(refundAmount) > 0n) ||
      (outcome !== 'refund_obligation' && refundAmount === '0')
    );
  });

export function parseElectricityStaffDecisionReview(
  value: unknown
): ElectricityStaffDecisionReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
