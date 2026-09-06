/**
 * CSRF token management for the frontend.
 *
 * Stores the token in a cookie (set by the server on auth events) and
 * provides a helper to attach it to state-changing requests.
 */

const CSRF_COOKIE_NAME = 'barghsa_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Read the CSRF token from the cookie set by the server.
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      try {
        return decodeURIComponent(rest.join('=')) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Attach the CSRF token as a header to a fetch request.
 * Read the current cookie each time, including changes made by other tabs.
 * Returns a new Headers object with the token added.
 */
export function withCsrf(headers?: HeadersInit): Headers {
  const h = new Headers(headers);
  const token = getCsrfToken();
  if (token) {
    h.set(CSRF_HEADER_NAME, token);
  } else {
    h.delete(CSRF_HEADER_NAME);
  }
  return h;
}
