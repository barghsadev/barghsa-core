import { z } from 'zod';
export const refundUuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
export const refundRequestSchema = z
  .object({
    invoiceId: refundUuid,
    amount: z
      .string()
      .regex(/^\d{1,19}$/)
      .pipe(
        z.string().refine((value) => BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n)
      ),
    idempotencyKey: refundUuid,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const refundDecisionSchema = z
  .object({ reason: z.string().trim().min(1).max(1000).optional() })
  .strict();
