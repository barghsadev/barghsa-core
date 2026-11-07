import { z } from 'zod/mini';
import type { $ZodType } from 'zod/v4/core';
export function createOnlineTopUpSchema(
  limit: number | null,
  messages: { invalid: string; limit: string }
): $ZodType<{ amount: string }, { amount: string }> {
  return z.custom<{ amount: string }>().check((ctx) => {
    const raw = ctx.value?.amount;
    const amount = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : 0;
    const invalid = !Number.isSafeInteger(amount) || amount <= 0;
    if (invalid || amount > (limit ?? 0))
      ctx.issues.push({
        code: 'custom',
        input: raw,
        path: ['amount'],
        message: invalid ? messages.invalid : messages.limit,
      });
  });
}
