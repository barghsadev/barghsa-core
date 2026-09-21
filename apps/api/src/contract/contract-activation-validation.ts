import { z } from 'zod';
import { contractUuid } from './contract-validation.js';
export const activationServiceType = z.enum(['electricity', 'savings', 'solar']);
export const activationRuleInput = z
  .object({
    expectedRevision: z.number().int().min(1).max(2147483646),
    signatureRequired: z.boolean(),
    paymentRequired: z.boolean(),
    serviceStartRequired: z.boolean(),
    idempotencyKey: contractUuid,
  })
  .strict();
export type ActivationServiceType = z.infer<typeof activationServiceType>;
export type ActivationRuleInput = z.infer<typeof activationRuleInput>;
