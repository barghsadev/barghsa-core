/**
 * CSRF token management for the frontend.
 *
 * Stores the token in a cookie (set by the server on auth events) and
 * provides a helper to attach it to state-changing requests.
 */

const CSRF_COOKIE_NAME = 'barghsa_csrf'
const CSRF_HEADER_NAME = 'X-CSRF-Token'

/**
 * Read the CSRF token from the cookie set by the server.
 */
function getCsrfFromCookie(): string | null {
  const cookies = document.cookie.split('; ')
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=')
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return null
}

/**
 * Store the CSRF token received from the server during auth.
 * The server also sets it as an HttpOnly cookie, but this in-memory
 * value serves as a fast path for the frontend.
 */
let csrfToken: string | null = null

export function setCsrfToken(token: string): void {
  csrfToken = token
}

export function getCsrfToken(): string | null {
  return csrfToken ?? getCsrfFromCookie()
}

/**
 * Attach the CSRF token as a header to a fetch request.
 * Returns a new Headers object with the token added.
 */
export function withCsrf(headers?: HeadersInit): Headers {
  const h = new Headers(headers)
  const token = getCsrfToken()
  if (token) {
    h.set(CSRF_HEADER_NAME, token)
  }
  return h
}