import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';

export function parseRefundInput<T>(
  schema: z.ZodType<T>,
  body: unknown,
  owned: readonly string[],
  required: readonly string[] = []
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.issues.map(({ path }) =>
      path.length === 1 && typeof path[0] === 'string' && owned.includes(path[0]) ? path[0] : null
    );
    if (fields.length && fields.every((field): field is string => field !== null))
      throw new InputFieldException(fields);
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  }
  const missing = required.filter((field) => !(parsed.data as Record<string, unknown>)[field]);
  if (missing.length) throw new InputFieldException(missing);
  return parsed.data;
}
