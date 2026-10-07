import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const quantity = z.string().regex(/^[1-9]\d*$/);
const dataSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    reason: z.string().max(1000),
    requestId: z.string().uuid(),
    contractId: z.string().uuid(),
    orderId: z.string().uuid(),
    profileId: z.string().uuid(),
    versionId: z.string().uuid(),
    contractState: z.string(),
    electricityStatus: z.string(),
    originalKwh: quantity,
    requestedKwh: quantity,
    incrementalKwh: quantity,
    maxPercentageAtRequest: z.number().int().nonnegative(),
    maxPercentageAtDecision: z.number().int().nonnegative().nullable(),
    requestedEffectiveFrom: z.iso.datetime({ offset: true }),
    effectiveFrom: z.iso.datetime({ offset: true }).nullable(),
    periodStart: z.iso.datetime({ offset: true }),
    periodEnd: z.iso.datetime({ offset: true }),
    originalInvoiceId: z.string().uuid(),
    originalInvoiceState: z.string(),
    originalInvoiceTotalIrR: money,
    originalInvoicePaidIrR: money,
    originalInvoiceRefundedIrR: money,
    outcome: z.enum(['publish_amendment_for_customer_signature', 'reject_without_adjustment']),
    adjustmentRule: z.literal('prorated_at_customer_signature'),
  })
  .strict()
  .refine(
    (data) =>
      BigInt(data.requestedKwh) - BigInt(data.originalKwh) === BigInt(data.incrementalKwh) &&
      (data.action === 'approve'
        ? (data.reason === '' || data.reason.trim().length > 0) &&
          data.effectiveFrom !== null &&
          data.maxPercentageAtDecision !== null &&
          data.outcome === 'publish_amendment_for_customer_signature'
        : data.reason.trim().length > 0 &&
          data.effectiveFrom === null &&
          data.maxPercentageAtDecision === null &&
          data.outcome === 'reject_without_adjustment')
  );

export type ElectricityIncreaseStaffDecisionReviewData = z.infer<typeof dataSchema>;
export type ElectricityIncreaseStaffDecisionReview =
  FinancialReviewSnapshot<ElectricityIncreaseStaffDecisionReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('electricity.quantity-increase-staff-decision'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export function parseElectricityIncreaseStaffDecisionReview(
  value: unknown
): ElectricityIncreaseStaffDecisionReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
