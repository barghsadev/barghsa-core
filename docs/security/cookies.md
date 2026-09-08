# Browser cookie policy

E-06 owns this policy and `apps/api/src/session/cookie.helper.ts` implements it for every authentication controller. The supported topology is a Vite SPA and `/api` on the same origin, including the development proxy. No cross-origin credentialed frontend, embedded login or external OAuth provider is currently required. A topology change requires review of origin authorization, CSRF and cookie delivery together; do not switch to `SameSite=None` independently.

| Cookie                                                                   | Path                | SameSite | HttpOnly | Purpose                                                        |
| ------------------------------------------------------------------------ | ------------------- | -------- | -------- | -------------------------------------------------------------- |
| `barghsa_session`                                                        | `/api`              | Lax      | Yes      | Opaque API session credential                                  |
| `barghsa_refresh`                                                        | `/api/auth/refresh` | Lax      | Yes      | Rotating refresh credential                                    |
| `barghsa_csrf`                                                           | `/`                 | Strict   | No       | SPA-readable copy of the session-bound CSRF token              |
| `__Host-barghsa_device` in production, `barghsa_device` in development   | `/`                 | Lax      | Yes      | Random device-possession proof, never authentication by itself |
| `__Host-barghsa_preauth` in production, `barghsa_preauth` in development | `/`                 | Strict   | Yes      | Anonymous CSRF challenge, never an authenticated session       |

All cookies omit Domain and use Secure in production. Non-production HTTP development/test fixtures explicitly select their environment. Session and refresh expiry follow server-issued deadlines; CSRF lasts at most 24 hours and device proof 30 days. Server revocation and expiry remain authoritative.

Session credentials do not accompany SPA documents or assets. CSRF stays at `/` because JavaScript on `/settings`, `/admin` and other SPA paths must read it. Device proof retains `/` because the production `__Host-` prefix requires it and prevents a sibling subdomain from planting that cookie. These are the security-owned exceptions to the infrastructure story's general narrow-path rule. No proxy may widen or rewrite these paths.

Lax permits ordinary external top-level navigation. It does not replace CSRF validation. Authenticated writes require the current session's CSRF header; the guard and exact-origin policy need their separate caller review. Public authentication uses the pre-login token flow below. Independently authenticated callbacks retain their documented defenses.

Issuing or rotating a session expires the historical root-scoped session cookie. Logout expires both `/api` and `/` session cookies plus refresh and CSRF cookies. Existing root cookies may remain until the next rotation/logout or their original expiry; stored sessions are not recreated or extended by this scope migration.

Browser semantics: [MDN Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). Cookie Path controls delivery, not authorization. This policy and local checks do not certify deployed TLS, proxy settings or cross-origin topology.

## Pre-login CSRF

Before each public authentication POST, the browser fetches `GET /api/auth/csrf` on the same origin with cookies. The private, non-cacheable JSON response contains `csrfToken`. The POST sends it as `X-CSRF-Token` along with JSON and the browser cookie. This covers login, registration, OTP verification/resend, staff activation, forced password changes and password recovery. Requests without a valid token receive the existing localized, correlated CSRF 403 before auth code runs.

Anonymous state lives in `preauth_sessions` for at most 30 minutes. Only the hash of the random 256-bit HttpOnly cookie identifier is stored; the independent 256-bit CSRF token is returned in JSON. Production uses a Secure `__Host-` cookie at `/` to prevent sibling-domain cookie injection. No Domain is set. The anonymous session confers no user authority and is never promoted to a signed-in session.

Each valid anonymous POST atomically consumes its challenge before authentication code executes, including when credentials or input validation later fail. Its cookie is expired on that response. A subsequent attempt obtains a fresh challenge. Successful sign-in establishes the existing independent user session and rotated session-bound CSRF token. For an already authenticated browser, bootstrap returns the current session token and public auth POSTs require that token; anonymous tokens cannot override an authenticated session.

The browser retries only once after the exact CSRF-guard rejection, which proves the auth handler did not run. This handles cookie replacement by another tab. Credential errors, rate limits, server failures and network errors never trigger an automatic replay. Aborting a flow also cancels bootstrap. Tokens are never put in URLs, logs or persistent browser storage.

New anonymous sessions are limited to 60 per IP per minute by the authoritative PostgreSQL limiter. Existing live bootstrap sessions are reused. Issuance deletes at most 1,000 expired rows using the expiry index; expired rows cannot authorize requests even while awaiting cleanup. No additional secret, process-local session cache or provider is needed. Deploy migration `0123_preauth_sessions` before this API version. Rollback to earlier code would restore its previous JSON-only public-auth behavior and is not a security-equivalent rollback.

Design reference: [OWASP synchronizer tokens and login CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Refresh-token validation, signed payment callbacks and CSP telemetry retain their separately assigned reviews.
