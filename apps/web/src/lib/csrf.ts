/**
 * Client-side CSRF token management (T-01.02.03 / T-02.02.03).
 *
 * Stores the CSRF token in memory (not localStorage) to prevent XSS-based
 * exfiltration. The token is bound to the server-side session and rotated
 * on auth events.
 *
 * All state-changing API calls should read this token and include it
 * in the X-CSRF-Token header.
 */

let currentCsrfToken: string | null = null

/**
 * Set the CSRF token after successful authentication.
 */
export function setCsrfToken(token: string): void {
  currentCsrfToken = token
}

/**
 * Clear the CSRF token (e.g. on logout, session expiry).
 */
export function clearCsrfToken(): void {
  currentCsrfToken = null
}

/**
 * Get the current CSRF token, if any.
 */
export function getCsrfToken(): string | null {
  return currentCsrfToken
}

/**
 * Fetch wrapper that automatically adds the CSRF token header
 * for state-changing methods.
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase()
  const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method)

  const headers = new Headers(options.headers)

  if (isStateChanging && currentCsrfToken) {
    headers.set('X-CSRF-Token', currentCsrfToken)
  }

  return fetch(url, { ...options, headers })
}