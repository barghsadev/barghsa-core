import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const action = z.enum(['cancel', 'reject', 'recover_refund']);
const dataSchema = z
  .object({
    action,
    serviceTitle: z.object({ fa: z.string().min(1), en: z.string().min(1) }).strict(),
    profileName: z.string().min(1),
    currentStatus: z.string().min(1),
    resultingStatus: z.string().min(1),
    reason: z.string().min(1),
    currentInvoice: z
      .object({
        id: z.string().uuid(),
        state: z.string().min(1),
        paidAmount: money,
        adjustmentKind: z.string().nullable(),
      })
      .strict()
      .nullable(),
    cancelInvoiceId: z.string().uuid().nullable(),
    uncoveredCreditBefore: money,
    refundAllocations: z.array(
      z
        .object({
          invoiceId: z.string().uuid(),
          state: z.string().min(1),
          amount: money,
          availableBefore: money,
        })
        .strict()
    ),
    totalCredit: money,
    totalRefund: money,
  })
  .strict();

export type ConsultationPaidResolutionReviewData = z.infer<typeof dataSchema>;
export type ConsultationPaidResolutionReview =
  FinancialReviewSnapshot<ConsultationPaidResolutionReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('consultation.paid-resolution'),
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
    const allocated = data.refundAllocations.reduce((sum, item) => sum + BigInt(item.amount), 0n);
    if (
      allocated !== BigInt(data.totalRefund) ||
      data.refundAllocations.some(
        (item) => BigInt(item.amount) <= 0n || BigInt(item.amount) > BigInt(item.availableBefore)
      )
    )
      return false;
    if (data.action === 'recover_refund')
      return (
        data.resultingStatus === data.currentStatus &&
        data.cancelInvoiceId === null &&
        data.totalCredit === '0' &&
        data.totalRefund === data.uncoveredCreditBefore &&
        BigInt(data.totalRefund) > 0n
      );
    return (
      data.resultingStatus === (data.action === 'cancel' ? 'cancelled' : 'rejected') &&
      data.uncoveredCreditBefore === '0' &&
      data.totalCredit === data.totalRefund
    );
  });

export function parseConsultationPaidResolutionReview(
  value: unknown
): ConsultationPaidResolutionReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
