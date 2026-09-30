import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const amount = z.string().regex(/^-?(0|[1-9]\d*)$/);
const unsigned = z.string().regex(/^(0|[1-9]\d*)$/);
const componentSchema = z
  .object({
    source: z.enum(['original_invoice', 'quantity_increase', 'price_adjustment']),
    invoiceId: z.string().uuid(),
    basisIrR: amount,
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    eligibleFrom: z.string().datetime(),
    oldFutureIrR: amount,
    changeIrR: amount,
    newFutureIrR: amount,
    remainingMs: unsigned,
    periodMs: unsigned,
  })
  .strict();
const calculationSchema = z
  .object({
    schemaVersion: z.literal(1),
    contractId: z.string().uuid(),
    versionId: z.string().uuid(),
    originalInvoiceId: z.string().uuid(),
    reason: z.string().min(1),
    contractualBasis: z.string().min(1),
    quote: z
      .object({
        amountIrR: amount,
        oldFutureIrR: amount,
        newFutureIrR: amount,
        kind: z.enum(['charge', 'credit']),
        percentageBps: amount,
        effectiveFrom: z.string().datetime(),
        rounding: z.literal('half-up-to-nearest-IRR'),
        components: z.array(componentSchema).min(1),
      })
      .strict(),
  })
  .strict();
export type ElectricityPriceAdjustmentCalculation = z.infer<typeof calculationSchema>;

const dataSchema = z
  .object({
    currency: z.literal('IRR'),
    profileId: z.string().uuid(),
    orderId: z.string().uuid(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    calculation: calculationSchema,
  })
  .strict()
  .refine((data) => {
    const { quote } = data.calculation;
    const sum = (key: 'oldFutureIrR' | 'changeIrR' | 'newFutureIrR') =>
      quote.components.reduce((total, component) => total + BigInt(component[key]), 0n);
    return (
      BigInt(quote.oldFutureIrR) + BigInt(quote.amountIrR) === BigInt(quote.newFutureIrR) &&
      quote.components[0]?.source === 'original_invoice' &&
      quote.components[0].invoiceId === data.calculation.originalInvoiceId &&
      quote.components.every(
        (component) =>
          BigInt(component.oldFutureIrR) + BigInt(component.changeIrR) ===
          BigInt(component.newFutureIrR)
      ) &&
      sum('oldFutureIrR') === BigInt(quote.oldFutureIrR) &&
      sum('changeIrR') === BigInt(quote.amountIrR) &&
      sum('newFutureIrR') === BigInt(quote.newFutureIrR) &&
      (quote.kind === 'charge' ? BigInt(quote.amountIrR) > 0n : BigInt(quote.amountIrR) < 0n)
    );
  });

export type ElectricityPriceAdjustmentReviewData = z.infer<typeof dataSchema>;
export type ElectricityPriceAdjustmentReview =
  FinancialReviewSnapshot<ElectricityPriceAdjustmentReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('electricity.price-adjustment-proposal'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    data: dataSchema,
  })
  .strict()
  .refine(
    (review) =>
      review.scope.profileId === review.data.profileId &&
      review.scope.resourceId === review.data.calculation.contractId
  );

export function parseElectricityPriceAdjustmentReview(
  value: unknown
): ElectricityPriceAdjustmentReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
