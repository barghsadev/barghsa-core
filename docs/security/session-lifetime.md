# Session lifetimes

The API sets a 30-minute idle window and a 24-hour absolute lifetime by default. Deployments can use shorter windows with these environment variables.

| Environment variable             | Default | Allowed integer range |
| -------------------------------- | ------: | --------------------: |
| `SESSION_IDLE_TIMEOUT_MINUTES`   |      30 |                  1–30 |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` |      24 |                  1–24 |

Set the same values across API replicas. A value outside the supported range prevents startup.

The server assigns and stores the absolute deadline when issuing a session. Session activity and credential rotation clamp the idle window to that deadline. The CSRF cookie uses the configured absolute window, and the server validates its token against the active session. [Cookie and CSRF policy](cookies.md).

## Session references and release cutover

Login, OTP verification and refresh send bearer credentials in HttpOnly cookies. Their JSON receipts and the session list use a stable `session-ref:` digest for each session. The revocation endpoint resolves that reference within the acting account and applies the existing CSRF, step-up and transaction checks. A reference changes when the underlying session rotates and cannot authorize requests. The CSRF proof remains available to the SPA through the existing transport.

Earlier builds returned session and refresh credentials in JSON and used the session credential as the revocation URL segment. The API now issues random UUIDv4 session credentials and rejects the former UUIDv7 credentials and their linked refresh tokens, even while their rows are still present. During the first rollout containing the fix, drain the old API replicas and confirm that the edge serves the new revision. Revoke the remaining old sessions and consume their unconsumed refresh tokens in one transaction while preserving audit and session history. Record the exact deployed revision, cutoff time and aggregate counts. Verify that a pre-cutover session and refresh fail and that a fresh sign-in, refresh and revocation succeed through the edge. Existing browsers must sign in again.

If a rollback would restore a build that returned bearer credentials, keep public authentication and session management behind the maintenance boundary. Resume public access with a build that preserves the corrected transport. Review restricted access logs under the existing incident procedure and avoid copying historical credential values into release evidence.

## Browser privacy boundaries

Authentication forms keep passwords, one-time codes and short-lived password-change grants in memory and submit them in request bodies. Registration can carry a challenge reference in its URL. Completing that challenge requires the one-time code. Staff invitations use the separate proof described in the [OTP and invitation policy](otp.md).

Browser storage holds presentation preferences, brief translated acknowledgements and non-authenticating invoice return identifiers. Structured identity edits send national identifiers in request bodies. CRM free-text search matches account names and personal or organization names.

Product analytics sends only approved event names and their permitted area or service. Route error reporting sends an approved error code and a random support reference. These payloads omit request bodies, form data and URL parameters.

Staging and pilot access logs keep the HTTP method, route and response status. They omit query strings and referrer values, and record individual session revocations as `/api/auth/sessions/:id`. Keep access to historical logs restricted through the credential cutover.
