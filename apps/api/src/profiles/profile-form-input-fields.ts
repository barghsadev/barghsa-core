import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';

/** Only complete, public string-field failures acquire owning feedback. */
export async function parseProfileFormInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  owned: readonly string[],
  accepted: readonly string[],
  authorize: (body: Record<string, unknown>) => Promise<void>
): Promise<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const body = input as Record<string, unknown>;
    const fields = parsed.error.issues.map((issue) => {
      const field = issue.path[0];
      return issue.path.length === 1 &&
        typeof field === 'string' &&
        owned.includes(field) &&
        typeof body[field] === 'string'
        ? field
        : null;
    });
    if (
      Object.keys(body).every((field) => accepted.includes(field)) &&
      fields.length &&
      fields.every((field): field is string => field !== null)
    ) {
      await authorize(body);
      throw new InputFieldException(fields);
    }
  }
  throw new HttpException(
    { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
    400
  );
}
