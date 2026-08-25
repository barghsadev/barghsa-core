import type { Response } from 'express'

/**
 * Session cookie name.
 * Centralized here so all auth endpoints use the same name.
 */
export const SESSION_COOKIE_NAME = 'barghsa_session'

/**
 * Refresh token cookie name.
 * Separate HttpOnly cookie so JS cannot access the long-lived credential.
 */
export const REFRESH_COOKIE_NAME = 'barghsa_refresh'

/**
 * Centralized SameSite policy (owned by E-06).
 *
 * Until E-06 (06-security-testing-observability.md#T-06.02.01.04) is
 * implemented, the default policy is `lax`. This provides CSRF protection
 * for all state-changing requests while allowing top-level navigation
 * (redirects from external auth providers) to carry the cookie.
 *
 * When E-06 is implemented, this value should be moved to a configuration
 * store so it can be changed per-route/topology without code changes.
 */
export const SESSION_COOKIE_SAMESITE = 'lax' as const

/**
 * Session cookie path.
 * Narrow path prevents the cookie from being sent to unexpected routes.
 */
export const SESSION_COOKIE_PATH = '/'

/**
 * CSRF token cookie name.
 * Non-HttpOnly so JavaScript can read it and send as X-CSRF-Token header.
 * SameSite=Strict provides browser-level CSRF defense as secondary layer.
 */
export const CSRF_COOKIE_NAME = 'barghsa_csrf'

/**
 * Set the CSRF token cookie on the response.
 *
 * Unlike the session and refresh cookies, this one is NOT HttpOnly so the
 * frontend can read it via document.cookie and include it in the
 * X-CSRF-Token header. SameSite=Strict provides browser-level protection.
 *
 * The CSRF token is the same value stored server-side in the session record.
 * Server-side validation compares the header value against the session's
 * csrfToken — the cookie is just a transport mechanism for the frontend.
 */
export function setCsrfCookie(res: Response, csrfToken: string): void {
  const isSecure = process.env.NODE_ENV === 'production'
  // Max age matches absolute session timeout (24h)
  const maxAge = 24 * 60 * 60

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge,
  })
}

/**
 * Clear the CSRF token cookie on logout.
 */
export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  })
}

/**
 * Set the session cookie on the response.
 *
 * Centralizes all cookie configuration so every auth endpoint uses
 * identical settings:
 * - HttpOnly: always true (prevents XSS access)
 * - Secure: true in production, false in dev (non-TLS dev exempted)
 * - SameSite: centralized policy (defaults to Lax until E-06 overrides)
 * - Path: '/' (narrow to API scope when path routing is defined)
 * - MaxAge: based on session expiry (cookie auto-deletes when session expires)
 */
export function setSessionCookie(
  res: Response,
  sessionId: string,
  expiresAt: Date,
): void {
  const isSecure = process.env.NODE_ENV === 'production'
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now())

  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: SESSION_COOKIE_SAMESITE,
    path: SESSION_COOKIE_PATH,
    maxAge,
  })
}

/**
 * Set the refresh token cookie on the response.
 *
 * Separate HttpOnly cookie to prevent XSS access while still allowing
 * automatic submission to the /api/auth/refresh endpoint.
 *
 * Has a longer maxAge than the session cookie (matches refresh token lifespan).
 */
export function setRefreshCookie(
  res: Response,
  refreshToken: string,
  expiresAt: Date,
): void {
  const isSecure = process.env.NODE_ENV === 'production'
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now())

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: SESSION_COOKIE_SAMESITE,
    path: '/api/auth/refresh',
    maxAge,
  })
}

/**
 * Clear the session cookie on the response (logout).
 *
 * Sets maxAge to 0, which tells the browser to immediately delete the cookie.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: SESSION_COOKIE_SAMESITE,
    path: SESSION_COOKIE_PATH,
  })
}

/**
 * Clear the refresh token cookie.
 */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: SESSION_COOKIE_SAMESITE,
    path: '/api/auth/refresh',
  })
}