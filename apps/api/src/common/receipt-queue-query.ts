import { z } from 'zod';
import { HISTORY_SORT_OPTIONS, parseHistoryQuery } from '@barghsa/shared/validation';

export const ReceiptQueueQuerySchema = z
  .object({
    q: z
      .string()
      .refine((value) => parseHistoryQuery(value, undefined) !== null)
      .transform((value) => value.trim())
      .default(''),
    sort: z.enum(HISTORY_SORT_OPTIONS).default('submitted_at:asc'),
    beforeAt: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => (value.beforeAt === undefined) === (value.beforeId === undefined));

export type ReceiptQueueQuery = z.infer<typeof ReceiptQueueQuerySchema>;
export interface ReceiptQueuePage<T> {
  items: T[];
  nextCursor: { beforeAt: string; beforeId: string } | null;
}
