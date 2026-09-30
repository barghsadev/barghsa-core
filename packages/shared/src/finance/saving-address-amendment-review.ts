import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const title = z.object({ fa: z.string(), en: z.string() }).strict();
const replacementAddress = z
  .object({
    id: z.string().uuid(),
    province_id: z.string().uuid(),
    city_id: z.string().uuid(),
    full_address: z.string().min(1),
    postal_code: z.string().min(1),
  })
  .strict();
const dataSchema = z
  .object({
    reason: z.string().min(1),
    customerName: z.string().min(1),
    profileName: z.string().min(1),
    billIdentifier: z.string().min(1),
    orderId: z.string().uuid(),
    hardwareTitle: title,
    pricingSnapshot: z.record(z.string(), z.unknown()),
    agreementSnapshot: z.string(),
    contractId: z.string().uuid(),
    contractState: z.string(),
    versionId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    contractSnapshot: z.record(z.string(), z.unknown()),
    invoiceId: z.string().uuid(),
    invoiceState: z.literal('Paid'),
    invoiceTotalIrR: money,
    paidAmountIrR: money,
    refundedAmountIrR: money,
    pendingRefundAmountIrR: z.literal('0'),
    previousAddressId: z.string().uuid(),
    previousAddress: z.record(z.string(), z.unknown()),
    replacementAddressId: z.string().uuid(),
    replacementAddress,
    outcome: z.literal('update_installation_address_without_repricing'),
  })
  .strict()
  .refine(
    (data) =>
      data.replacementAddress.id === data.replacementAddressId &&
      data.previousAddressId !== data.replacementAddressId &&
      data.invoiceTotalIrR === data.paidAmountIrR
  );

export type SavingAddressAmendmentReviewData = z.infer<typeof dataSchema>;
export type SavingAddressAmendmentReview =
  FinancialReviewSnapshot<SavingAddressAmendmentReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('saving.staff-address-amendment'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function parseSavingAddressAmendmentReview(
  value: unknown
): SavingAddressAmendmentReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
