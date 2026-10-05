import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';
import { contractCommercialValueSchema } from './contract-validation.js';

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

function authoringFields(issue: z.ZodIssue, body: Record<string, unknown>): string[] | null {
  const directCodes = ['invalid_type', 'invalid_format', 'too_small', 'too_big'];
  if (
    issue.path.length === 1 &&
    issue.path[0] === 'changeDescription' &&
    directCodes.includes(issue.code)
  )
    return ['changeDescription'];
  if (
    issue.path.length === 2 &&
    issue.path[0] === 'activationContext' &&
    typeof issue.path[1] === 'string' &&
    ['initialInvoiceId', 'serviceStartsAt', 'serviceEndsAt'].includes(issue.path[1]) &&
    directCodes.includes(issue.code)
  )
    return [issue.path[1]];
  if (
    issue.code === 'custom' &&
    issue.path.length === 2 &&
    issue.path[0] === 'content' &&
    issue.path[1] === 'commercialValue' &&
    isRecord(body.content)
  ) {
    const nested = contractCommercialValueSchema.safeParse(body.content.commercialValue);
    if (nested.success) return null;
    const fields = nested.error.issues.map((child) => {
      if (child.path.length !== 1) return null;
      if (child.path[0] === 'amountIrr' && [...directCodes, 'custom'].includes(child.code))
        return 'commercialValueAmountIrr';
      if (child.path[0] === 'description' && directCodes.includes(child.code))
        return 'commercialValueDescription';
      return null;
    });
    if (
      fields.length &&
      fields.every((field): field is NonNullable<typeof field> => field !== null)
    )
      return fields;
  }
  return null;
}

/** Preserve arbitrary content; only exact existing editable validation paths are public. */
export async function parseContractAuthoringInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  authorize: (body: Record<string, unknown>) => Promise<void>
): Promise<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = isRecord(value)
    ? result.error.issues.map((issue) => authoringFields(issue, value))
    : [];
  if (
    fields.length &&
    fields.every((field): field is string[] => field !== null) &&
    isRecord(value)
  ) {
    await authorize(value);
    throw new InputFieldException(fields.flat());
  }
  throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
}
