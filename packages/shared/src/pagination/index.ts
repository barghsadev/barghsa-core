import { z } from 'zod';

const limit = (max: number) => z.number().int().min(1).max(max);
const offset = z.number().int().min(0);

export const cursorPaginationSchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: limit(100).default(20),
});

export const offsetPaginationSchema = z.strictObject({
  offset: offset.default(0),
  limit: limit(100).default(20),
});

/** Validate HTTP query strings before conversion and keep the caller's defaults. */
export function offsetPaginationQuerySchema(maxLimit = 100) {
  return offsetPaginationSchema.extend({
    limit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(limit(maxLimit))
      .optional(),
    offset: z.string().regex(/^\d+$/).transform(Number).pipe(offset.max(1_000_000)).optional(),
  });
}
