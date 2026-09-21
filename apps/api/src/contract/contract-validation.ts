import { z } from 'zod';
export const contractUuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const content = z
  .record(z.string(), z.unknown())
  .refine(
    (value) =>
      Object.keys(value).length > 0 && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 65_536,
    'Contract content must be a nonempty JSON object up to 64 KiB'
  );
export const contractActivationContextSchema = z
  .object({
    initialInvoiceId: contractUuid.nullable(),
    serviceStartsAt: z.iso.datetime({ offset: true }).nullable(),
    serviceEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.serviceStartsAt ||
      !value.serviceEndsAt ||
      Date.parse(value.serviceEndsAt) > Date.parse(value.serviceStartsAt),
    'Service end must be after its start'
  );
const edit = {
  content,
  activationContext: contractActivationContextSchema.optional(),
  changeDescription: z.string().trim().min(1).max(1000),
  idempotencyKey: contractUuid,
};
export const createContractSchema = z
  .object({
    ...edit,
    profileId: contractUuid,
    orderId: contractUuid.optional(),
    serviceType: z.enum(['electricity', 'savings', 'solar']),
  })
  .strict();
export const updateContractSchema = z
  .object({
    ...edit,
    expectedVersionId: contractUuid,
  })
  .strict();
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

export const contractReviewSchema = z
  .object({
    expectedVersionId: contractUuid,
    idempotencyKey: contractUuid,
  })
  .strict();
export const financialReviewHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const contractAcceptanceSchema = contractReviewSchema.extend({
  expectedReviewHash: financialReviewHashSchema,
});
export const contractChangesSchema = contractReviewSchema.extend({
  reason: z.string().trim().min(1).max(1000),
});

export const contractListSchema = z
  .object({
    profileId: contractUuid.optional(),
    serviceType: z.enum(['electricity', 'savings', 'solar']).optional(),
    state: z
      .enum([
        'Draft',
        'AwaitingStaffReview',
        'ChangesRequested',
        'AwaitingCustomerAcceptance',
        'Accepted',
        'AwaitingSignature',
        'Signed',
        'Active',
        'Completed',
        'Cancelled',
      ])
      .optional(),
    before: contractUuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ContractListInput = z.infer<typeof contractListSchema>;
