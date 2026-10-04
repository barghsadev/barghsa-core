import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';

export async function parseConsultationFeeInput<T>(
  schema: z.ZodType<T>,
  body: unknown,
  owned: readonly string[],
  authorize: () => Promise<void>
): Promise<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  if (
    result.error.issues.length &&
    result.error.issues.every(
      (issue) => issue.path.length === 1 && owned.includes(String(issue.path[0]))
    )
  ) {
    await authorize();
    throw new InputFieldException(
      owned.filter((field) => result.error.issues.some((issue) => issue.path[0] === field))
    );
  }
  throw new BadRequestException('Invalid consultation action');
}

/** Called only after the command's live authority/resource locks, and after saved replay. */
export function consultationOfferDeadline(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date <= new Date())
    throw new InputFieldException(['validUntil']);
  return date;
}
