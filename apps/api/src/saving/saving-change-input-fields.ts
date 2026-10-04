import { HttpException } from '@nestjs/common';
import type { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';

export async function parseSavingChangeInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  owned: readonly string[],
  authorize: () => Promise<void>
): Promise<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues;
  if (
    issues.length &&
    issues.every((issue) => issue.path.length === 1 && owned.includes(String(issue.path[0])))
  ) {
    await authorize();
    throw new InputFieldException(
      owned.filter((field) => issues.some((issue) => issue.path[0] === field))
    );
  }
  throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
}
