import { expect, it } from 'vitest';
import { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';
import { parseInvoiceInput } from './invoice-input-fields.js';
const line = z
  .object({
    description: z.string().trim().min(1),
    quantity: z.number().int().min(1),
    unitPrice: z.string().regex(/^\d+$/),
    vatRate: z.number().int().min(0).max(10000),
    isTaxable: z.boolean(),
  })
  .strict();
const schema = z
  .object({
    profileId: z.string().uuid(),
    expectedReviewHash: z.string().length(64),
    lines: z.array(line).min(1).max(100),
  })
  .strict();
const goodLine = {
  description: 'Customer line',
  quantity: 2,
  unitPrice: '40',
  vatRate: 0,
  isTaxable: false,
};
const body = {
  profileId: '11111111-1111-4111-8111-111111111111',
  expectedReviewHash: 'a'.repeat(64),
  lines: [goodLine, goodLine],
};
it('preserves parsed, canonical invoice values', () => {
  expect(
    parseInvoiceInput(
      schema,
      { ...body, lines: [{ ...goodLine, description: '  Customer line  ' }] },
      true
    ).lines[0]?.description
  ).toBe('Customer line');
});
it.each([
  ['description', '', 'lineDescription1'],
  ['quantity', 0, 'lineQuantity1'],
  ['unitPrice', 'private-invalid', 'lineUnitPrice1'],
  ['vatRate', 10001, 'lineVatRate1'],
] as const)('maps only public indexed %s errors', (key, value, expected) => {
  try {
    parseInvoiceInput(schema, { ...body, lines: [goodLine, { ...goodLine, [key]: value }] }, true);
    throw Error('Expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(InputFieldException);
    expect((error as InputFieldException).fields).toEqual([expected]);
    expect(JSON.stringify(error)).not.toContain('private-invalid');
  }
});
it.each([
  { expectedReviewHash: 'bad' },
  { secret: 'private' },
  { lines: [{ ...goodLine, isTaxable: 'invalid' }] },
])('keeps protected or mixed failures generic: %j', (extra) => {
  try {
    parseInvoiceInput(schema, { ...body, profileId: 'bad', ...extra }, true);
    throw Error('Expected failure');
  } catch (error) {
    expect(error).not.toBeInstanceOf(InputFieldException);
    expect(error).toMatchObject({ status: 400 });
  }
});
it('maps line-count errors without inventing a row', () => {
  try {
    parseInvoiceInput(schema, { ...body, lines: [] }, true);
    throw Error('Expected failure');
  } catch (error) {
    expect((error as InputFieldException).fields).toEqual(['lines']);
  }
});
it('keeps fixed correction profiles protected', () => {
  try {
    parseInvoiceInput(schema, { ...body, profileId: 'bad' }, false);
    throw Error('Expected failure');
  } catch (error) {
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
});
it.each(['reason', 'amount'])('maps the public correction %s', (field) => {
  const correction = z
    .object({ reason: z.string().trim().min(1), amount: z.string().regex(/^-?\d+$/) })
    .strict();
  try {
    parseInvoiceInput(correction, { reason: 'Correct charge', amount: '-40', [field]: '' }, false);
    throw Error('Expected failure');
  } catch (error) {
    expect((error as InputFieldException).fields).toEqual([field]);
  }
});
