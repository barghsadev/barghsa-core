import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from './input-field.exception.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

function render(exception: HttpException) {
  let body: unknown;
  const response = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: (value: unknown) => {
      body = value;
    },
  };
  const request = {
    headers: { 'accept-language': 'en' },
    method: 'POST',
    route: { path: '/api/profiles/:profileId/addresses' },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return body as { error: { fields?: string[]; code: string } };
}
it('exposes only bounded unique public identifiers from the dedicated exception', () => {
  const exception = new InputFieldException([
    'postalCode',
    'postalCode',
    '__proto__',
    'constructor',
    'prototype',
    'nested.secret',
    'private field',
    'x'.repeat(65),
  ]);
  expect(exception.fields).toEqual(['postalCode']);
  expect(render(exception).error).toMatchObject({
    code: 'VALIDATION:INPUT:INVALID',
    fields: ['postalCode'],
  });
  expect(Object.isFrozen(exception.fields)).toBe(true);
  expect(
    new InputFieldException(Array.from({ length: 100 }, (_, index) => `field${index}`)).fields
  ).toHaveLength(50);
});
it('never echoes arbitrary exception metadata or submitted values', () => {
  const body = render(
    new HttpException(
      {
        error: 'VALIDATION:INPUT:INVALID',
        fields: ['private-field'],
        message: 'private-secret-value',
      },
      400
    )
  );
  expect(body.error).not.toHaveProperty('fields');
  expect(JSON.stringify(body)).not.toContain('private');
});
