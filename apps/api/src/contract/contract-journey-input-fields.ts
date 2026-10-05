import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Invalid editable input never reveals field metadata before current resource authority. */
export async function parseContractJourneyInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  owned: readonly string[],
  authorize: (body: Record<string, unknown>) => Promise<void>
): Promise<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = result.error.issues.map((issue) =>
    ['invalid_type', 'invalid_format', 'too_small', 'too_big'].includes(issue.code) &&
    issue.path.length === 1 &&
    typeof issue.path[0] === 'string' &&
    owned.includes(issue.path[0])
      ? issue.path[0]
      : null
  );
  if (
    fields.length &&
    fields.every((field): field is string => field !== null) &&
    isRecord(value)
  ) {
    await authorize(value);
    throw new InputFieldException(fields);
  }
  throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
}
