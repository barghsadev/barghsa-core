import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const title = z.object({ fa: z.string(), en: z.string() }).strict();
const hardwareSnapshot = z.object({ title }).catchall(z.unknown());
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
    upgradeVersionId: z.string().uuid(),
    upgradeId: z.string().uuid(),
    previousHardware: hardwareSnapshot,
    replacementHardware: hardwareSnapshot,
    stockReserved: z.boolean(),
    adjustmentInvoiceId: z.string().uuid(),
    adjustmentInvoiceState: z.enum(['Unpaid', 'Overdue']),
    additionalChargeIrR: money,
    invoiceTotalIrR: money,
    invoicePaidIrR: z.literal('0'),
    outcome: z.enum(['cancel_unpaid_charge_and_release_reservation', 'cancel_unpaid_charge']),
  })
  .strict()
  .refine(
    (data) =>
      BigInt(data.additionalChargeIrR) > 0n &&
      data.outcome ===
        (data.stockReserved
          ? 'cancel_unpaid_charge_and_release_reservation'
          : 'cancel_unpaid_charge')
  );

export type SavingHardwareUpgradeCancellationReviewData = z.infer<typeof dataSchema>;
export type SavingHardwareUpgradeCancellationReview =
  FinancialReviewSnapshot<SavingHardwareUpgradeCancellationReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('saving.staff-hardware-upgrade-cancellation'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function parseSavingHardwareUpgradeCancellationReview(
  value: unknown
): SavingHardwareUpgradeCancellationReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
