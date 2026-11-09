import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';
import { InputFieldException } from './input-field.exception.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

afterEach(() => vi.restoreAllMocks());

function render(exception: unknown) {
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
    ip: '192.0.2.51',
    originalUrl: '/api/profiles/private-session-ref/addresses?token=private-token',
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
  const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
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
  expect(debug).toHaveBeenCalledWith(
    expect.stringContaining('POST /api/profiles/:profileId/addresses | correlationId=')
  );
  expect(JSON.stringify(debug.mock.calls)).not.toMatch(/private|192\.0\.2\.51/);
});

it('logs the matched route and correlation reference without an unexpected exception payload', () => {
  const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const body = render(new Error('private-provider-credential'));
  expect(body.error.code).toBe('INTERNAL:UNEXPECTED');
  expect(errorLog).toHaveBeenCalledWith(
    expect.stringContaining('POST /api/profiles/:profileId/addresses | correlationId=')
  );
  expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/private|192\.0\.2\.51/);
});
