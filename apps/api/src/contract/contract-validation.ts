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
const edit = {
  content,
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
export const contractChangesSchema = contractReviewSchema.extend({
  reason: z.string().trim().min(1).max(1000),
});
