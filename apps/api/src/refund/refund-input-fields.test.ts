import { expect, it } from 'vitest';
import { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';
import { parseRefundInput } from './refund-input-fields.js';
import {
  refundReviewSchema,
  refundRequestSchema,
  refundDecisionConfirmSchema,
} from './refund-validation.js';
const invoiceId = '11111111-1111-4111-8111-111111111111';
const valid = { invoiceId, amount: '40', reason: '  Customer return  ' };
function error(fn: () => unknown) {
  try {
    fn();
    throw new Error('Expected failure');
  } catch (value) {
    return value;
  }
}
for (const [name, schema, body] of [
  ['review', refundReviewSchema, valid],
  [
    'request',
    refundRequestSchema,
    { ...valid, idempotencyKey: invoiceId, expectedReviewHash: 'a'.repeat(64) },
  ],
] as const) {
  it(`${name} preserves canonical reason and exact int8 amount`, () => {
    expect(parseRefundInput(schema, body, ['amount', 'reason'])).toMatchObject({
      amount: '40',
      reason: 'Customer return',
    });
  });
  it.each(['0', '-1', '1.5', '9223372036854775808'])(`${name} maps invalid amount %s`, (amount) => {
    const failure = error(() =>
      parseRefundInput(schema, { ...body, amount }, ['amount', 'reason'])
    );
    expect(failure).toBeInstanceOf(InputFieldException);
    expect((failure as InputFieldException).fields).toEqual(['amount']);
  });
  it(`${name} reports both owned fields without values`, () => {
    const failure = error(() =>
      parseRefundInput(schema, { ...body, amount: 'private-invalid', reason: ' ' }, [
        'amount',
        'reason',
      ])
    ) as InputFieldException;
    expect(failure.fields).toEqual(['amount', 'reason']);
    expect(JSON.stringify(failure.getResponse())).not.toContain('private-invalid');
  });
  it.each([{ invoiceId: 'bad' }, { protected: 'secret' }])(
    `${name} keeps mixed failures generic: %j`,
    (extra) => {
      const failure = error(() =>
        parseRefundInput(schema, { ...body, reason: ' ', ...extra }, ['amount', 'reason'])
      );
      expect(failure).not.toBeInstanceOf(InputFieldException);
    }
  );
}
it('keeps missing or invalid confirmation hashes generic', () => {
  for (const expectedReviewHash of [undefined, 'bad'])
    expect(
      error(() =>
        parseRefundInput(refundDecisionConfirmSchema, { reason: ' ', expectedReviewHash }, [
          'reason',
        ])
      )
    ).not.toBeInstanceOf(InputFieldException);
});
it('requires only the selected decision input after protected confirmation validation', () => {
  const body = { expectedReviewHash: 'a'.repeat(64) };
  expect(parseRefundInput(refundDecisionConfirmSchema, body, ['reason'])).toEqual(body);
  expect(
    (
      error(() =>
        parseRefundInput(refundDecisionConfirmSchema, body, ['reason'], ['reason'])
      ) as InputFieldException
    ).fields
  ).toEqual(['reason']);
});
it('maps only a complete public bank-reference path', () => {
  const schema = z
    .object({
      bankReference: z.string().trim().min(1).max(200),
      expectedReviewHash: z.string().length(64),
    })
    .strict();
  const failure = error(() =>
    parseRefundInput(schema, { bankReference: ' ', expectedReviewHash: 'a'.repeat(64) }, [
      'bankReference',
    ])
  ) as InputFieldException;
  expect(failure.fields).toEqual(['bankReference']);
  expect(
    error(() =>
      parseRefundInput(schema, { bankReference: ' ', expectedReviewHash: 'bad' }, ['bankReference'])
    )
  ).not.toBeInstanceOf(InputFieldException);
});
