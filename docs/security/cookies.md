# Browser cookie policy

E-06 owns this policy and `apps/api/src/session/cookie.helper.ts` implements it for every authentication controller. The supported topology is a Vite SPA and `/api` on the same origin, including the development proxy. No cross-origin credentialed frontend, embedded login or external OAuth provider is currently required. A topology change requires review of origin authorization, CSRF and cookie delivery together; do not switch to `SameSite=None` independently.

| Cookie                                                                 | Path                | SameSite | HttpOnly | Purpose                                                        |
| ---------------------------------------------------------------------- | ------------------- | -------- | -------- | -------------------------------------------------------------- |
| `barghsa_session`                                                      | `/api`              | Lax      | Yes      | Opaque API session credential                                  |
| `barghsa_refresh`                                                      | `/api/auth/refresh` | Lax      | Yes      | Rotating refresh credential                                    |
| `barghsa_csrf`                                                         | `/`                 | Strict   | No       | SPA-readable copy of the session-bound CSRF token              |
| `__Host-barghsa_device` in production, `barghsa_device` in development | `/`                 | Lax      | Yes      | Random device-possession proof, never authentication by itself |

All cookies omit Domain and use Secure in production. Non-production HTTP development/test fixtures explicitly select their environment. Session and refresh expiry follow server-issued deadlines; CSRF lasts at most 24 hours and device proof 30 days. Server revocation and expiry remain authoritative.

Session credentials do not accompany SPA documents or assets. CSRF stays at `/` because JavaScript on `/settings`, `/admin` and other SPA paths must read it. Device proof retains `/` because the production `__Host-` prefix requires it and prevents a sibling subdomain from planting that cookie. These are the security-owned exceptions to the infrastructure story's general narrow-path rule. No proxy may widen or rewrite these paths.

Lax permits ordinary external top-level navigation. It does not replace CSRF validation. Authenticated writes require the current session's CSRF header; the guard and exact-origin policy need their separate caller review. Public authentication and independently authenticated callbacks retain their documented defenses.

Issuing or rotating a session expires the historical root-scoped session cookie. Logout expires both `/api` and `/` session cookies plus refresh and CSRF cookies. Existing root cookies may remain until the next rotation/logout or their original expiry; stored sessions are not recreated or extended by this scope migration.

Browser semantics: [MDN Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). Cookie Path controls delivery, not authorization. This policy and local checks do not certify deployed TLS, proxy settings or cross-origin topology.
