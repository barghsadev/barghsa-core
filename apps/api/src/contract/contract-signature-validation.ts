import { z } from 'zod';
import { contractUuid } from './contract-validation.js';
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
