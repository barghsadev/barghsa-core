import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

/**
 * Session cookie name.
 * Centralized here so all auth endpoints use the same name.
 */
export const SESSION_COOKIE_NAME = 'barghsa_session';

/**
 * Refresh token cookie name.
 * Separate HttpOnly cookie so JS cannot access the long-lived credential.
 */
export const REFRESH_COOKIE_NAME = 'barghsa_refresh';

/** Same-origin SPA/API policy owned by E-06; see docs/security/cookies.md.
 * SameSite is supplementary to session-bound CSRF validation, not a replacement.
 */
export const SESSION_COOKIE_SAMESITE = 'lax' as const;
export const SESSION_COOKIE_PATH = '/api';

/**
 * CSRF token cookie name.
 * Non-HttpOnly so JavaScript can read it and send as X-CSRF-Token header.
 * SameSite=Strict provides browser-level CSRF defense as secondary layer.
 */
export const CSRF_COOKIE_NAME = 'barghsa_csrf';

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
  const isSecure = process.env.NODE_ENV === 'production';
  // Max age matches absolute session timeout (24h)
  const maxAge = 24 * 60 * 60 * 1000;

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
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
  });
}

/**
 * Set the session cookie on the response.
 *
 * Centralizes all cookie configuration so every auth endpoint uses
 * identical settings:
 * - HttpOnly: always true (prevents JavaScript reads)
 * - Secure: true in production, false in dev (non-TLS dev exempted)
 * - SameSite: centralized same-origin policy
 * - Path: '/api' (the SPA and static assets do not authenticate with this cookie)
 * - MaxAge: based on session expiry (cookie auto-deletes when session expires)
 */
export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date): void {
  const isSecure = process.env.NODE_ENV === 'production';
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());

  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: SESSION_COOKIE_SAMESITE,
    path: SESSION_COOKIE_PATH,
    maxAge,
  });
  // Remove the old root-scoped credential when issuing or rotating a session.
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: SESSION_COOKIE_SAMESITE,
    path: '/',
  });
}

/**
 * Set the refresh token cookie on the response.
 *
 * Separate HttpOnly cookie to prevent XSS access while still allowing
 * automatic submission to the /api/auth/refresh endpoint.
 *
 * Has a longer maxAge than the session cookie (matches refresh token lifespan).
 */
export function setRefreshCookie(res: Response, refreshToken: string, expiresAt: Date): void {
  const isSecure = process.env.NODE_ENV === 'production';
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: SESSION_COOKIE_SAMESITE,
    path: '/api/auth/refresh',
    maxAge,
  });
}

/**
 * Clear the session cookie on the response (logout).
 *
 * Express expires both current and historical paths immediately.
 */
export function clearSessionCookie(res: Response): void {
  for (const path of [SESSION_COOKIE_PATH, '/']) {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: SESSION_COOKIE_SAMESITE,
      path,
    });
  }
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
  });
}

/** Read existing device proof without creating cookies on authenticated GET requests. */
export function readDeviceCookie(req: Request): string | null {
  const name = process.env.NODE_ENV === 'production' ? '__Host-barghsa_device' : 'barghsa_device';
  const token = req.cookies?.[name];
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

/** Random device possession proof. Public user-agent strings cannot confer trust. */
export function getOrCreateDeviceCookie(req: Request, res: Response): string {
  const secure = process.env.NODE_ENV === 'production';
  // __Host- prevents a sibling subdomain from planting a known trust cookie.
  const name = secure ? '__Host-barghsa_device' : 'barghsa_device';
  const existing = readDeviceCookie(req);
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  res.cookie(name, token, {
    httpOnly: true,
    secure,
    sameSite: SESSION_COOKIE_SAMESITE,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return token;
}
