import { z } from 'zod';
import { contractUuid } from './contract-validation.js';
const amount = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
export const prepareCancellationSchema = z
  .object({
    expectedVersionId: contractUuid,
    expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().trim().min(1).max(1000),
    refundDecision: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('full_wallet') }).strict(),
      z
        .object({
          mode: z.literal('custom'),
          refunds: z
            .array(
              z
                .object({
                  invoiceId: contractUuid,
                  amount,
                  destination: z.enum(['wallet', 'external_bank']),
                })
                .strict()
            )
            .max(500),
        })
        .strict(),
    ]),
    idempotencyKey: contractUuid,
  })
  .strict();
export const executeCancellationSchema = z
  .object({ intentId: contractUuid, idempotencyKey: contractUuid })
  .strict();
export type PrepareCancellationInput = z.infer<typeof prepareCancellationSchema>;
export type ExecuteCancellationInput = z.infer<typeof executeCancellationSchema>;
