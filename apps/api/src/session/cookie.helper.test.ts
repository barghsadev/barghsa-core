import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import type { Response } from 'express'
import { SESSION_COOKIE_NAME, setSessionCookie, clearSessionCookie } from './cookie.helper.js'

/**
 * Mock express Response for cookie testing.
 */
function mockRes(): Response {
  const cookies: Record<string, { value: string; options: Record<string, unknown> }> = {}
  const cleared: string[] = []

  return {
    cookie: (name: string, value: string, options?: Record<string, unknown>) => {
      cookies[name] = { value, options: options ?? {} }
    },
    clearCookie: (name: string) => {
      cleared.push(name)
    },
    _cookies: cookies,
    _cleared: cleared,
  } as unknown as Response
}

describe('setSessionCookie', () => {
  const originalEnv = process.env.NODE_ENV

  afterAll(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('sets HttpOnly cookie with session ID', () => {
    const res = mockRes() as unknown as Response & { _cookies: Record<string, unknown>; _cleared: string[] }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    setSessionCookie(res, 'test-session-id', expiresAt)

    expect(res._cookies[SESSION_COOKIE_NAME]).toBeDefined()
    expect(res._cookies[SESSION_COOKIE_NAME].value).toBe('test-session-id')
    expect(res._cookies[SESSION_COOKIE_NAME].options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  it('sets Secure flag in production', () => {
    process.env.NODE_ENV = 'production'
    const res = mockRes() as unknown as Response & { _cookies: Record<string, unknown> }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    setSessionCookie(res, 'test-session-id', expiresAt)

    expect(res._cookies[SESSION_COOKIE_NAME].options.secure).toBe(true)
  })

  it('does NOT set Secure flag in development', () => {
    process.env.NODE_ENV = 'development'
    const res = mockRes() as unknown as Response & { _cookies: Record<string, unknown> }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    setSessionCookie(res, 'test-session-id', expiresAt)

    expect(res._cookies[SESSION_COOKIE_NAME].options.secure).toBe(false)
  })

  it('sets maxAge based on session expiry', () => {
    const res = mockRes() as unknown as Response & { _cookies: Record<string, unknown> }
    const expiresAt = new Date(Date.now() + 3600 * 1000) // 1 hour

    setSessionCookie(res, 'test-session-id', expiresAt)

    // MaxAge should be roughly 3600000 milliseconds (1 hour)
    const maxAge = res._cookies[SESSION_COOKIE_NAME].options.maxAge as number
    expect(maxAge).toBeGreaterThan(3500 * 1000)
    expect(maxAge).toBeLessThanOrEqual(3600 * 1000)
  })
})

describe('clearSessionCookie', () => {
  it('clears the session cookie', () => {
    const res = mockRes() as unknown as Response & { _cleared: string[] }

    clearSessionCookie(res)

    expect(res._cleared).toContain(SESSION_COOKIE_NAME)
  })
})

describe('SESSION_COOKIE_NAME', () => {
  it('is named barghsa_session', () => {
    expect(SESSION_COOKIE_NAME).toBe('barghsa_session')
  })
})