import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const stage = z.enum([
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
]);
const status = z.enum(['pending', 'in_progress', 'completed', 'skipped']);
const money = z.string().regex(/^(0|[1-9]\d*)$/);
const dataSchema = z
  .object({
    customerName: z.string().min(1),
    profileName: z.string().min(1),
    billIdentifier: z.string().min(1),
    addressSnapshot: z.record(z.string(), z.unknown()),
    hardwareTitle: z.object({ fa: z.string(), en: z.string() }).strict(),
    pricingSnapshot: z.record(z.string(), z.unknown()),
    agreementSnapshot: z.string(),
    contractId: z.string().uuid(),
    contractState: z.string(),
    versionId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    contractSnapshot: z.record(z.string(), z.unknown()),
    invoiceId: z.string().uuid(),
    invoiceState: z.string(),
    invoiceTotalIrR: money,
    paidAmountIrR: money,
    refundedAmountIrR: money,
    pendingRefundAmountIrR: money,
    orderStatus: z.enum(['approved', 'in_progress']),
    stages: z.array(z.object({ stage, status }).strict()),
    hasPendingUpgrade: z.boolean(),
    stage,
    action: z.enum(['complete', 'skip']),
    currentStatus: z.literal('in_progress'),
    nextStatus: z.enum(['completed', 'skipped']),
    nextStage: stage.nullable(),
    commercialStatus: z.enum(['in_progress', 'completed']),
    explanation: z.string().min(1),
    handoverDescription: z.string().nullable(),
  })
  .strict()
  .refine(
    (data) =>
      (data.action !== 'skip' || data.stage === 'equipment_handover') &&
      data.nextStatus === (data.action === 'skip' ? 'skipped' : 'completed') &&
      data.commercialStatus === (data.nextStage ? 'in_progress' : 'completed') &&
      (data.stage !== 'equipment_handover' ||
        data.action !== 'complete' ||
        !!data.handoverDescription)
  );

export type SavingFulfillmentStageReviewData = z.infer<typeof dataSchema>;
export type SavingFulfillmentStageReview =
  FinancialReviewSnapshot<SavingFulfillmentStageReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('saving.staff-fulfillment-stage-transition'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function parseSavingFulfillmentStageReview(
  value: unknown
): SavingFulfillmentStageReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
