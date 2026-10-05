import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';

const allowedCodes = new Set([
  'invalid_type',
  'invalid_value',
  'invalid_format',
  'invalid_union',
  'too_small',
  'too_big',
  'custom',
]);
const simple = new Set(['title', 'text', 'changeDescription', 'invoiceLines']);
const nested: Record<string, Record<string, string>> = {
  commercialValue: {
    kind: 'commercialValueKind',
    amountIrr: 'commercialValueAmountIrr',
    description: 'commercialValueDescription',
  },
  source: {
    kind: 'sourceKind',
    templateVersionId: 'sourceTemplateVersionId',
    documentId: 'sourceDocumentId',
  },
};
const row: Record<string, string> = {
  description: 'Description',
  quantity: 'Quantity',
  unitPrice: 'UnitPrice',
  vatRate: 'VatRate',
  isTaxable: 'IsTaxable',
};
function ownedField(issue: z.core.$ZodIssue): string | null {
  if (!allowedCodes.has(issue.code)) return null;
  const path = issue.path;
  if (path.length === 1 && typeof path[0] === 'string') {
    if (simple.has(path[0])) return path[0];
    if (path[0] === 'commercialValue' || path[0] === 'source')
      return path[0] === 'source' ? 'sourceKind' : 'commercialValueKind';
  }
  if (path.length === 2 && typeof path[0] === 'string' && typeof path[1] === 'string')
    return Object.hasOwn(nested, path[0]) && Object.hasOwn(nested[path[0]]!, path[1])
      ? nested[path[0]]![path[1]]!
      : null;
  if (
    path.length === 3 &&
    path[0] === 'invoiceLines' &&
    typeof path[1] === 'number' &&
    Number.isInteger(path[1]) &&
    path[1] >= 0 &&
    path[1] < 100 &&
    typeof path[2] === 'string' &&
    Object.hasOwn(row, path[2])
  )
    return `invoiceLine${path[1]}${row[path[2]]}`;
  return null;
}
function ownedUnionShape(body: object): boolean {
  for (const [value, branches] of [
    [
      'commercialValue' in body ? body.commercialValue : undefined,
      [
        ['kind', 'amountIrr'],
        ['kind', 'description'],
      ],
    ],
    [
      'source' in body ? body.source : undefined,
      [
        ['kind', 'templateVersionId'],
        ['kind', 'documentId'],
      ],
    ],
  ] as const) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (!branches.some((allowed) => keys.every((key) => allowed.some((name) => name === key))))
        return false;
    }
  }
  return true;
}
export async function parseSolarContractInput<T>(
  schema: z.ZodType<T>,
  body: unknown,
  authorize: (profileId: string) => Promise<void>
): Promise<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields = result.error.issues.map(ownedField);
  if (
    fields.length &&
    fields.every((field) => field !== null) &&
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'profileId' in body &&
    typeof body.profileId === 'string' &&
    ownedUnionShape(body)
  ) {
    await authorize(body.profileId);
    throw new InputFieldException(fields.filter((field): field is string => field !== null));
  }
  throw new BadRequestException('Invalid solar contract');
}
