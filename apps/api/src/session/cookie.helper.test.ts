import { describe, it, expect, vi, afterAll } from 'vitest';
import 'node:crypto';
import type { Request, Response } from 'express';
import {
  SESSION_COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  getOrCreateDeviceCookie,
} from './cookie.helper.js';

interface MockResponse extends Response {
  _cookies: Record<string, { value: string; options: Record<string, unknown> }>;
  _cleared: string[];
}

/**
 * Mock express Response for cookie testing.
 */
function mockRes(): MockResponse {
  const cookies: Record<string, { value: string; options: Record<string, unknown> }> = {};
  const cleared: string[] = [];

  return {
    cookie: (name: string, value: string, options?: Record<string, unknown>) => {
      cookies[name] = { value, options: options ?? {} };
    },
    clearCookie: (name: string) => {
      cleared.push(name);
    },
    _cookies: cookies,
    _cleared: cleared,
  } as MockResponse;
}

describe('setSessionCookie', () => {
  const originalEnv = process.env.NODE_ENV;

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('sets HttpOnly cookie with session ID', () => {
    const res = mockRes();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    setSessionCookie(res, 'test-session-id', expiresAt);

    expect(res._cookies[SESSION_COOKIE_NAME]).toBeDefined();
    expect(res._cookies[SESSION_COOKIE_NAME]?.value).toBe('test-session-id');
    expect(res._cookies[SESSION_COOKIE_NAME]?.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('sets Secure flag in production', () => {
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    setSessionCookie(res, 'test-session-id', expiresAt);

    expect(res._cookies[SESSION_COOKIE_NAME]?.options.secure).toBe(true);
  });

  it('does NOT set Secure flag in development', () => {
    process.env.NODE_ENV = 'development';
    const res = mockRes();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    setSessionCookie(res, 'test-session-id', expiresAt);

    expect(res._cookies[SESSION_COOKIE_NAME]?.options.secure).toBe(false);
  });

  it('sets maxAge based on session expiry', () => {
    const res = mockRes();
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

    setSessionCookie(res, 'test-session-id', expiresAt);

    // MaxAge should be roughly 3600000 milliseconds (1 hour)
    const maxAge = res._cookies[SESSION_COOKIE_NAME]?.options.maxAge as number;
    expect(maxAge).toBeGreaterThan(3500 * 1000);
    expect(maxAge).toBeLessThanOrEqual(3600 * 1000);
  });
});

describe('clearSessionCookie', () => {
  it('clears the session cookie', () => {
    const res = mockRes();

    clearSessionCookie(res);

    expect(res._cleared).toContain(SESSION_COOKIE_NAME);
  });
});

describe('SESSION_COOKIE_NAME', () => {
  it('is named barghsa_session', () => {
    expect(SESSION_COOKIE_NAME).toBe('barghsa_session');
  });
});
describe('device trust cookie', () => {
  it('uses a secure host-only HttpOnly cookie in production and ignores unprefixed fixation', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = mockRes();
      const planted = 'a'.repeat(64);
      const token = getOrCreateDeviceCookie(
        { cookies: { barghsa_device: planted } } as Request,
        response
      );
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(token).not.toBe(planted);
      expect(response._cookies['__Host-barghsa_device']?.options).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 2592000000,
      });
      const returning = mockRes();
      expect(
        getOrCreateDeviceCookie(
          { cookies: { '__Host-barghsa_device': token } } as Request,
          returning
        )
      ).toBe(token);
      expect(returning._cookies).toEqual({});
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
