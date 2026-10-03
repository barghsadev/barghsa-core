import { expect, it } from 'vitest';
import { inputErrorFields } from './input-error-fields.js';
it('carries only structured input metadata and never carries server copy', () => {
  expect(
    inputErrorFields(
      {
        error: {
          code: 'VALIDATION:INPUT:INVALID',
          fields: ['amount'],
          message: 'private server text',
        },
      },
      400
    )
  ).toEqual({ fields: ['amount'] });
});
it.each([
  [409, { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['amount'] } }],
  [400, { error: { code: 'VALIDATION:PARSE:ZOD_ERROR', fields: ['amount'] } }],
  [400, { code: 'VALIDATION:INPUT:INVALID', fields: ['amount'] }],
  [400, { error: { code: 'VALIDATION:INPUT:INVALID', fields: 'amount' } }],
  [400, null],
  [400, { error: null }],
  [500, {}],
])('ignores untrusted error shapes for status %s', (status, body) => {
  expect(inputErrorFields(body, status as number)).toEqual({});
});
