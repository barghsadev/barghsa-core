import { describe, it, expect, vi } from 'vitest';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { EtagInterceptor, ETAG_METADATA } from './etag.interceptor.js';

function createMockContext(options: {
  method?: string;
  url?: string;
  ifNoneMatch?: string | undefined;
}): { ctx: ExecutionContext; response: ReturnType<typeof createMockResponse> } {
  const { method = 'GET', url = '/api/products', ifNoneMatch = undefined } = options;

  const mockHeaders: Record<string, string | string[] | undefined> = { 'if-none-match': ifNoneMatch };
  const response = createMockResponse();

  return {
    ctx: {
      switchToHttp: () => ({
        getRequest: () => ({ method, url, headers: mockHeaders }),
        getResponse: () => response,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
      getArgByIndex: () => undefined,
      getArgs: () => [],
      getType: () => 'http',
      switchToRpc: () => ({} as ReturnType<ExecutionContext['switchToRpc']>),
      switchToWs: () => ({} as ReturnType<ExecutionContext['switchToWs']>),
    } as unknown as ExecutionContext,
    response,
  };
}

function createMockResponse() {
  const headers: Record<string, string> = {};
  let statusCode: number | undefined;
  return {
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
    status: vi.fn((code: number) => { statusCode = code; }),
    get statusCode() { return statusCode; },
    get headers() { return headers; },
  };
}

function createReflector(etagDecorated: boolean): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string, targets: Array<object>): boolean => {
      return key === ETAG_METADATA ? etagDecorated : false;
    }),
    getAllAndMerge: vi.fn(),
    get: vi.fn(),
    merge: vi.fn(),
  } as unknown as Reflector;
}

describe('EtagInterceptor', () => {
  describe('@Etag() decorator gating', () => {
    it('passes through untouched when route is not @Etag()-decorated', async () => {
      const { ctx } = createMockContext({ method: 'GET' });
      const interceptor = new EtagInterceptor(createReflector(false));
      const body = { message: 'hello' };
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toEqual(body);
    });

    it('passes through non-GET requests even when decorated', async () => {
      const { ctx } = createMockContext({ method: 'POST' });
      const interceptor = new EtagInterceptor(createReflector(true));
      const body = { message: 'created' };
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toEqual(body);
    });
  });

  describe('ETag header computation', () => {
    it('sets ETag header with SHA-256 base64 hash on decorated GET routes', async () => {
      const { ctx, response } = createMockContext({ method: 'GET' });
      const interceptor = new EtagInterceptor(createReflector(true));
      const body = { message: 'hello' };
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      await new Promise((resolve) => result$.subscribe(resolve));

      expect(response.setHeader).toHaveBeenCalledWith('ETag', expect.stringMatching(/^"[A-Za-z0-9+/=]+"$/));
    });
  });

  describe('304 Not Modified with If-None-Match', () => {
    it('returns 304 with null body when If-None-Match matches computed ETag', async () => {
      const body = { message: 'hello' };
      const { createHash } = await import('node:crypto');
      const expectedHash = createHash('sha256').update(JSON.stringify(body)).digest('base64');
      const expectedEtag = `"${expectedHash}"`;

      const { ctx } = createMockContext({
        method: 'GET',
        ifNoneMatch: expectedEtag,
      });
      const interceptor = new EtagInterceptor(createReflector(true));
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toBeNull();
    });

    it('returns body when If-None-Match does NOT match', async () => {
      const { ctx } = createMockContext({
        method: 'GET',
        ifNoneMatch: '"different-etag-value"',
      });
      const interceptor = new EtagInterceptor(createReflector(true));
      const body = { message: 'hello' };
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toEqual(body);
    });

    it('handles comma-separated If-None-Match values', async () => {
      const body = { message: 'hello' };
      const { createHash } = await import('node:crypto');
      const expectedHash = createHash('sha256').update(JSON.stringify(body)).digest('base64');
      const expectedEtag = `"${expectedHash}"`;

      const { ctx } = createMockContext({
        method: 'GET',
        ifNoneMatch: `"other-etag", ${expectedEtag}`,
      });
      const interceptor = new EtagInterceptor(createReflector(true));
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toBeNull();
    });

    it('handles wildcard * If-None-Match', async () => {
      const { ctx } = createMockContext({
        method: 'GET',
        ifNoneMatch: '*',
      });
      const interceptor = new EtagInterceptor(createReflector(true));
      const body = { message: 'hello' };
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toBeNull();
    });

    it('returns body when If-None-Match is undefined', async () => {
      const { ctx } = createMockContext({ method: 'GET' });
      const interceptor = new EtagInterceptor(createReflector(true));
      const body = { data: [1, 2, 3] };
      const next: CallHandler = { handle: () => of(body) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toEqual(body);
    });
  });

  describe('error resilience', () => {
    it('passes through body without ETag when JSON.stringify throws', async () => {
      const circular: Record<string, unknown> = { name: 'circular' };
      circular.self = circular;

      const { ctx } = createMockContext({ method: 'GET' });
      const interceptor = new EtagInterceptor(createReflector(true));
      const next: CallHandler = { handle: () => of(circular) };

      const result$ = interceptor.intercept(ctx, next);
      const result = await new Promise((resolve) => result$.subscribe(resolve));

      expect(result).toBe(circular);
    });
  });
});