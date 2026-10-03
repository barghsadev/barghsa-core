import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';

const lineFields: Record<string, string> = {
  description: 'Description',
  quantity: 'Quantity',
  unitPrice: 'UnitPrice',
  vatRate: 'VatRate',
};
export function parseInvoiceInput<T>(schema: z.ZodType<T>, body: unknown, manual: boolean): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map(({ path }) => {
    if (
      path.length === 1 &&
      (path[0] === 'lines' ||
        (manual ? path[0] === 'profileId' : ['reason', 'amount'].includes(String(path[0]))))
    )
      return String(path[0]);
    if (
      path.length === 3 &&
      path[0] === 'lines' &&
      typeof path[1] === 'number' &&
      Number.isInteger(path[1]) &&
      Number(path[1]) >= 0 &&
      Number(path[1]) < 100 &&
      typeof path[2] === 'string' &&
      Object.hasOwn(lineFields, path[2])
    )
      return `line${lineFields[path[2]]}${path[1]}`;
    return null;
  });
  if (fields.length && fields.every((field): field is string => field !== null))
    throw new InputFieldException(fields);
  throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
}
