import { z } from 'zod';
import { contractUuid, financialReviewHashSchema } from './contract-validation.js';
const command = { expectedVersionId: contractUuid, idempotencyKey: contractUuid };
export const signatureRequestSchema = z
  .object({
    ...command,
    originalDocumentId: contractUuid,
    expectedRequestId: contractUuid.nullable(),
  })
  .strict();
export const signatureRecordSchema = z
  .object({ ...command, requestId: contractUuid, signedDocumentId: contractUuid })
  .strict();
export type SignatureRequestInput = z.infer<typeof signatureRequestSchema>;
export type SignatureRecordInput = z.infer<typeof signatureRecordSchema>;
export const signatureRequestConfirmationSchema = signatureRequestSchema.extend({
  expectedReviewHash: financialReviewHashSchema,
});
export const signatureRecordConfirmationSchema = signatureRecordSchema.extend({
  expectedReviewHash: financialReviewHashSchema,
});
export const signatureFinancialReviewSchema = z.discriminatedUnion('action', [
  signatureRequestSchema.omit({ idempotencyKey: true }).extend({ action: z.literal('request') }),
  signatureRecordSchema.omit({ idempotencyKey: true }).extend({ action: z.literal('record') }),
]);
export type SignatureFinancialReviewInput = z.infer<typeof signatureFinancialReviewSchema>;
