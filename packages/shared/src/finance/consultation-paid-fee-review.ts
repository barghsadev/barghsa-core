import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const signedMoney = z.string().regex(/^-?(0|[1-9]\d*)$/);
const dataSchema = z
  .object({
    serviceTitle: z.object({ fa: z.string().min(1), en: z.string().min(1) }).strict(),
    profileName: z.string().min(1),
    scope: z.string().min(1),
    deliverables: z.string().min(1),
    previousFee: money,
    revisedFee: money,
    difference: signedMoney,
    adjustmentAmount: money,
    reason: z.string().min(1),
    validUntil: z.iso.datetime({ offset: true }),
    paidInvoice: z
      .object({
        id: z.string().uuid(),
        state: z.string().min(1),
        totalAmount: money,
        paidAmount: money,
      })
      .strict(),
    refundPlan: z.array(
      z.object({ invoiceId: z.string().uuid(), amount: money, availableBefore: money }).strict()
    ),
    outcome: z.enum(['charge_invoice', 'credit_and_wallet_refund']),
  })
  .strict();

export type ConsultationPaidFeeReviewData = z.infer<typeof dataSchema>;
export type ConsultationPaidFeeReview = FinancialReviewSnapshot<ConsultationPaidFeeReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('consultation.paid-fee-adjustment'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((review) => {
    const data = review.data;
    const difference = BigInt(data.difference);
    if (
      difference === 0n ||
      BigInt(data.previousFee) + difference !== BigInt(data.revisedFee) ||
      (difference < 0n ? -difference : difference) !== BigInt(data.adjustmentAmount) ||
      BigInt(data.paidInvoice.paidAmount) <= 0n ||
      BigInt(data.paidInvoice.paidAmount) > BigInt(data.paidInvoice.totalAmount)
    )
      return false;
    if (difference > 0n) return data.outcome === 'charge_invoice' && data.refundPlan.length === 0;
    return (
      data.outcome === 'credit_and_wallet_refund' &&
      data.refundPlan.every(
        (item) => BigInt(item.amount) > 0n && BigInt(item.amount) <= BigInt(item.availableBefore)
      ) &&
      data.refundPlan.reduce((sum, item) => sum + BigInt(item.amount), 0n) === -difference
    );
  });

export function parseConsultationPaidFeeReview(value: unknown): ConsultationPaidFeeReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
