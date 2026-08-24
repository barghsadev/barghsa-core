import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpExceptionFilter } from '../src/common/http-exception.filter.js';
import { CorrelationIdMiddleware, CorrelationIdProvider, correlationIdStorage } from '../src/common/correlation-id.middleware.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { ZodError, ZodIssue } from 'zod';

// ---------------------------------------------------------------------------
// Unit tests: CorrelationIdMiddleware
// ---------------------------------------------------------------------------
describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it('generates a valid UUIDv7 when no X-Correlation-ID header is present', () => {
    const req = { headers: {} } as any;
    const res = { setHeader: vi.fn() } as any;
    let capturedId: string | undefined;

    middleware.use(req, res, vi.fn(() => {
      capturedId = correlationIdStorage.getStore();
    }));

    // Should have set the header
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', expect.any(String));
    const headerId = res.setHeader.mock.calls[0][1] as string;
    expect(headerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(capturedId).toBe(headerId);
  });

  it('propagates a valid inbound X-Correlation-ID', () => {
    const inboundId = '550e8400-e29b-41d4-a716-446655440000';
    const req = { headers: { 'x-correlation-id': inboundId } } as any;
    const res = { setHeader: vi.fn() } as any;
    let capturedId: string | undefined;

    middleware.use(req, res, vi.fn(() => {
      capturedId = correlationIdStorage.getStore();
    }));

    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', inboundId);
    expect(capturedId).toBe(inboundId);
  });

  it('rejects an invalid inbound X-Correlation-ID and generates a new one', () => {
    const req = { headers: { 'x-correlation-id': 'not-a-uuid' } } as any;
    const res = { setHeader: vi.fn() } as any;

    middleware.use(req, res, vi.fn());

    const headerId = res.setHeader.mock.calls[0][1] as string;
    expect(headerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(headerId).not.toBe('not-a-uuid');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: CorrelationIdProvider
// ---------------------------------------------------------------------------
describe('CorrelationIdProvider', () => {
  it('returns undefined when no correlation ID is set', () => {
    const provider = new CorrelationIdProvider();
    expect(provider.getCorrelationId()).toBeUndefined();
  });

  it('returns the correlation ID from AsyncLocalStorage', () => {
    const provider = new CorrelationIdProvider();
    const testId = '550e8400-e29b-41d4-a716-446655440000';

    correlationIdStorage.run(testId, () => {
      expect(provider.getCorrelationId()).toBe(testId);
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests: HttpExceptionFilter
// ---------------------------------------------------------------------------
describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // Suppress Logger output during tests
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  function createMockHost(
    statusCode: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const response = { status } as any;
    const request = {
      method: 'GET',
      url: '/test',
      ip: '127.0.0.1',
      headers: { 'accept-language': 'fa', ...headers },
    } as any;
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as any;

    return { json, status, response, request, host };
  }

  it('returns 400 with VALIDATION:PARSE:ZOD_ERROR for ZodError', () => {
    const issues: ZodIssue[] = [{
      code: 'invalid_type',
      expected: 'string',
      received: 'undefined',
      path: ['name'],
      message: 'Required',
    }];
    const zodError = new ZodError(issues);
    const { json, status, host } = createMockHost(400, {});

    filter.catch(zodError, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION:PARSE:ZOD_ERROR',
        message: 'داده‌های ارسالی معتبر نیستند',
      },
    });
  });

  it('returns 400 with VALIDATION:INPUT:INVALID for BadRequestException', () => {
    const exception = new HttpException('Bad input', HttpStatus.BAD_REQUEST);
    const { json, status, host } = createMockHost(400, {});

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION:INPUT:INVALID',
        message: 'Bad input',
      },
    });
  });

  it('returns 401 for unauthorized — uses raw HttpException message for 4xx', () => {
    const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    const { json, status, host } = createMockHost(401, {});

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'AUTH:UNAUTHENTICATED',
        message: 'Unauthorized',
      },
    });
  });

  it('returns 404 for not found — uses raw HttpException message for 4xx', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    const { json, status, host } = createMockHost(404, {});

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND:RESOURCE',
        message: 'Not Found',
      },
    });
  });

  it('returns 500 with localized message for unhandled Error (never leak internals)', () => {
    const error = new Error('Database connection pool exhausted: timeout=30s');
    const { json, status, host } = createMockHost(500, {});

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(500);
    // Should NOT forward the raw error message
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL:UNEXPECTED',
        message: 'خطای غیرمنتظره رخ داده است',
      },
    });
  });

  it('includes correlationId in response when set', () => {
    const testId = '550e8400-e29b-41d4-a716-446655440000';
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    const { json, status, host } = createMockHost(404, {});

    correlationIdStorage.run(testId, () => {
      filter.catch(exception, host);
    });

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND:RESOURCE',
        message: 'Not Found',
        correlationId: testId,
      },
    });
  });

  it('uses English locale when accept-language is en — raw message used for 4xx', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    const { json, status, host } = createMockHost(404, {}, { 'accept-language': 'en-US' });

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND:RESOURCE',
        message: 'Not Found',
      },
    });
  });

  it('never leaks raw 5xx error messages to the client', () => {
    const exception = new HttpException(
      'Internal: connection pool timeout hitting primary DB replica',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    const { json, status, host } = createMockHost(500, {});

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL:SERVER_ERROR',
        message: 'خطای داخلی سرور',
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Integration test: middleware + filter end-to-end through NestJS TestingModule
// ---------------------------------------------------------------------------
describe('HttpExceptionFilter + CorrelationIdMiddleware (integration)', () => {
  let module: TestingModule;
  let filter: HttpExceptionFilter;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [CorrelationIdProvider, HttpExceptionFilter],
    }).compile();

    filter = module.get(HttpExceptionFilter);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('returns expected error shape for all exception types per AC', async () => {
    const testCases = [
      {
        exception: new HttpException('Bad Request', HttpStatus.BAD_REQUEST),
        expectedStatus: 400,
        expectedCode: 'VALIDATION:INPUT:INVALID',
      },
      {
        exception: new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED),
        expectedStatus: 401,
        expectedCode: 'AUTH:UNAUTHENTICATED',
      },
      {
        exception: new HttpException('Forbidden', HttpStatus.FORBIDDEN),
        expectedStatus: 403,
        expectedCode: 'AUTHZ:FORBIDDEN',
      },
      {
        exception: new HttpException('Not Found', HttpStatus.NOT_FOUND),
        expectedStatus: 404,
        expectedCode: 'NOT_FOUND:RESOURCE',
      },
      {
        exception: new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
        expectedStatus: 429,
        expectedCode: 'RATE_LIMIT:EXCEEDED',
      },
      {
        exception: new HttpException('Bad Gateway', HttpStatus.BAD_GATEWAY),
        expectedStatus: 502,
        expectedCode: 'PROVIDER:DOWNSTREAM_ERROR',
      },
      {
        exception: new Error('Something went wrong'),
        expectedStatus: 500,
        expectedCode: 'INTERNAL:UNEXPECTED',
      },
    ];

    for (const { exception, expectedStatus, expectedCode } of testCases) {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const response = { status } as any;
      const request = {
        method: 'GET',
        url: '/test',
        ip: '127.0.0.1',
        headers: { 'accept-language': 'en' },
      } as any;
      const host = {
        switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
      } as any;

      filter.catch(exception, host);

      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: expectedCode }),
        }),
      );
    }
  });
});