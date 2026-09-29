import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const positive = z.string().regex(/^[1-9]\d*$/);
const signed = z.string().regex(/^-?(0|[1-9]\d*)$/);
const unsigned = z.string().regex(/^(0|[1-9]\d*)$/);
const instant = z.string().datetime();

const dataSchema = z
  .object({
    currency: z.literal('IRR'),
    profileId: z.string().uuid(),
    contractId: z.string().uuid(),
    orderId: z.string().uuid(),
    versionId: z.string().uuid(),
    requestId: z.string().uuid(),
    amendmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    originalInvoiceId: z.string().uuid(),
    originalInvoiceIrR: positive,
    originalKwh: positive,
    requestedKwh: positive,
    incrementalKwh: positive,
    effectiveFrom: instant,
    eligibleFrom: instant,
    periodStart: instant,
    periodEnd: instant,
    remainingMs: unsigned,
    periodMs: positive,
    baseShareIrR: unsigned,
    priceAdjustments: z.array(
      z
        .object({
          invoiceId: z.string().uuid(),
          amountIrR: signed,
          effectiveFrom: instant,
          increaseShareIrR: signed,
        })
        .strict()
    ),
    adjustmentIrR: positive,
    activationRule: z.literal('after-signature-full-payment-and-effective-date'),
  })
  .strict()
  .refine((data) => {
    const start = Date.parse(data.periodStart);
    const end = Date.parse(data.periodEnd);
    const eligible = Date.parse(data.eligibleFrom);
    return (
      BigInt(data.requestedKwh) - BigInt(data.originalKwh) === BigInt(data.incrementalKwh) &&
      BigInt(data.baseShareIrR) +
        data.priceAdjustments.reduce(
          (sum, component) => sum + BigInt(component.increaseShareIrR),
          0n
        ) ===
        BigInt(data.adjustmentIrR) &&
      start < end &&
      eligible >= start &&
      eligible >= Date.parse(data.effectiveFrom) &&
      eligible < end &&
      BigInt(data.periodMs) === BigInt(end - start) &&
      BigInt(data.remainingMs) === BigInt(end - eligible)
    );
  });

export type ElectricityIncreaseSigningReviewData = z.infer<typeof dataSchema>;
export type ElectricityIncreaseSigningReview =
  FinancialReviewSnapshot<ElectricityIncreaseSigningReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('electricity.quantity-increase-sign'),
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
      review.scope.profileId === review.data.profileId &&
      review.scope.resourceId === review.data.contractId
  );

export function parseElectricityIncreaseSigningReview(
  value: unknown
): ElectricityIncreaseSigningReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
