import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Only visible string validation can acquire public field metadata. */
export async function parseTicketFormInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  owned: readonly string[],
  authorize: (body: Record<string, unknown>) => Promise<void>,
  message: string,
  reply = false
): Promise<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fields = isRecord(input)
    ? parsed.error.issues.map((issue) => {
        if (
          ['too_small', 'too_big'].includes(issue.code) &&
          issue.path.length === 1 &&
          typeof issue.path[0] === 'string' &&
          owned.includes(issue.path[0]) &&
          typeof input[issue.path[0]] === 'string'
        )
          return issue.path[0];
        if (
          reply &&
          issue.code === 'custom' &&
          issue.path.length === 0 &&
          typeof input.body === 'string' &&
          !input.body.trim() &&
          (input.attachments === undefined ||
            (Array.isArray(input.attachments) && input.attachments.length === 0))
        )
          return 'body';
        return null;
      })
    : [];
  if (
    fields.length &&
    fields.every((field): field is string => field !== null) &&
    isRecord(input)
  ) {
    await authorize(input);
    throw new InputFieldException(fields);
  }
  throw new HttpException(message, 400);
}

export function optionalTicketCommandKey(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  const parsed = z.uuid().safeParse(input);
  if (!parsed.success) throw new HttpException('Invalid ticket command', 400);
  return parsed.data;
}
