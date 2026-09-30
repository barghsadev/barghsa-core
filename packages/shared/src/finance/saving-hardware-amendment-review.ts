import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const signedMoney = z.string().regex(/^-?(0|[1-9]\d*)$/);
const title = z.object({ fa: z.string(), en: z.string() }).strict();
const dataSchema = z
  .object({
    reason: z.string().min(1),
    customerName: z.string().min(1),
    profileName: z.string().min(1),
    billIdentifier: z.string().min(1),
    addressSnapshot: z.record(z.string(), z.unknown()),
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
    currentHardwareId: z.string().uuid(),
    currentHardwareTitle: title,
    currentHardwarePriceIrR: money,
    currentHardwareVatRateBps: z.number().int().min(0).max(10_000),
    currentOrderTotalIrR: money,
    targetHardwareId: z.string().uuid(),
    targetHardwareTitle: title,
    targetHardwarePriceIrR: money,
    targetHardwareVatRateBps: z.number().int().min(0).max(10_000),
    targetOrderTotalIrR: money,
    priceDeltaIrR: signedMoney,
    targetStockTracking: z.boolean(),
    targetAvailableCount: z.number().int().min(0),
    outcome: z.enum(['additional_charge', 'credit_note', 'swap_without_price_change']),
  })
  .strict();

export type SavingHardwareAmendmentReviewData = z.infer<typeof dataSchema>;
export type SavingHardwareAmendmentReview =
  FinancialReviewSnapshot<SavingHardwareAmendmentReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('saving.staff-hardware-amendment'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((review) => {
    const { currentOrderTotalIrR, targetOrderTotalIrR, priceDeltaIrR, outcome } = review.data;
    const delta = BigInt(targetOrderTotalIrR) - BigInt(currentOrderTotalIrR);
    return (
      delta === BigInt(priceDeltaIrR) &&
      outcome ===
        (delta > 0n
          ? 'additional_charge'
          : delta < 0n
            ? 'credit_note'
            : 'swap_without_price_change')
    );
  });

export function parseSavingHardwareAmendmentReview(
  value: unknown
): SavingHardwareAmendmentReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
