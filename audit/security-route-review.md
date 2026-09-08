# CSRF and sensitive-action review

Product `455ed61`, 2026-09-08. Requirements: `02-auth-users-admin.md#T-02.02.03` and `T-02.02.04`. Both remain partial. [All registered routes](evidence/r01/route-security.csv) include controller source hashes. This is registration evidence, not a claim that every handler, transaction or screen has passed review.

The inventory reflects compiled Nest module/controller metadata without starting the application. It follows imports and forward references from AppModule, reads global/controller/method guards and route decorators, and expands registered paths. There are 33 modules, 63 controllers and 342 routes. Global guards are RateLimitGuard and CsrfGuard.

| State-changing route classification | Count | Current boundary |
| --- | ---: | --- |
| SessionAuthGuard and StepUpGuard | 116 | Global session-bound CSRF plus recent verification |
| Above plus StorageAdminGuard | 4 | Additional storage permission guard |
| SessionAuthGuard only | 66 | Global session-bound CSRF; service permissions and confirmation vary |
| RefreshCsrfGuard | 1 | CSRF bound to presented refresh credential |
| No route guard | 16 | Public or independently authenticated routes below |
| Total unsafe-method registrations | 203 | All 120 RequiresStepUp routes have StepUpGuard |

## Public routes and alternatives

| Routes | Current defense and remaining disposition |
| --- | --- |
| POST `/api/auth/activate-staff`, `/force-change-password`, `/forgot-password`, `/login`, `/login/resend`, `/login/verify`, `/register`, `/register/resend`, `/register/verify`, `/reset-password`, `/reset-password/verify` | All 11 require JSON through SkipCsrf metadata. The same-origin API does not authorize cross-origin JSON preflights. Reuse public-auth form/preflight evidence; reconcile this alternative with literal no-exemption wording. Keep same-origin deployment assumptions explicit. |
| POST `/api/auth/refresh` | SkipCsrf delegates to RefreshCsrfGuard. Final session HTTP suite verifies missing/wrong tokens, expiry and replay behavior. |
| POST `/api/wallet/top-ups/callback` and `/chargeback` | Entry methods authenticate signed raw bodies, event IDs and timestamps before processing; missing configuration/signature fails. Full payment/replay/ledger acceptance remains in finance review. |
| POST `/api/webhooks/email/resend` | No skip annotation. Service verifies Svix signature and replay window before processing. Normal provider requests have no session cookie. Full delivery and replay acceptance remains in R02. |
| POST `/api/auth/logout` | No skip annotation. Existing session requires CSRF. No-session logout has no authenticated account to mutate. Final session HTTP suite covers rejection and success. |
| POST `/api/csp-report` | Unauthenticated telemetry. Global CSRF currently rejects it if session context exists without a token. Check actual browser reporting and payload handling before deciding the required exception; no repair or runtime reproduction claimed here. |
| GET `/api/wallet/top-ups/callback` | Explicit provider return, outside the203 unsafe-method registrations. It reaches payment processing. Review paid/cancelled/failed transitions and provider verification with finance; GET does not by itself prove this route has no effects. |

Fourteen unsafe routes have SkipCsrf:11 public-auth, refresh and two payment callbacks. Public JSON and signed callbacks remain alternatives needing explicit task disposition. No requirement amendment or external origin approval is inferred.

## Sensitive-action review queue

| Required action family | Route evidence / next acceptance work |
| --- | --- |
| Existing staff and profile role changes | PUT staff roles; PUT/DELETE profile agents have step-up. Credential revocation checks are recorded in the session caller matrix. Verify current audit flag/timestamp and UI recovery for the whole operation. |
| New staff role grants | POST create-staff has SessionAuthGuard but no step-up metadata. Check role grants through this separate creation path next. |
| Storage and provider credentials | All four storage mutations/probes and email/SMS/AI-model mutations have step-up metadata. Verification-provider config does not; inspect its active behavior and credential contract next. Real identity provider remains unavailable by user decision. |
| Payment confirmation, prices and finance configuration | Invoice/wallet receipt decisions, catalogue prices, VAT and configured finance limits have step-up metadata. Domain authorization, audit, expiry during waits and UI retry remain in finance review. |
| Session and trusted-device revocation | Individual routes have guards. Bulk self-revocation uses explicit in-service confirmation and final checks. Reuse source-bound session/trust/CRM repairs; do not infer missing protection from the bulk route's absent decorator. |
| Profile archival and ownership | CRM DELETE profile and ownership transfer/accept/cancel/decline have step-up metadata. Reuse atomic ownership/session checks; reconcile complete domain audit and UI criteria. |
| Refunds and contract cancellation | Separate future consumers remain explicit dependencies. Order cancellation is not automatically a contract-cancellation implementation. |
| Other registered step-up actions | The CSV retains every route. Review required caller/audit/UI behavior with its domain once; avoid repeating shared guard tests per endpoint. |

## Completed guard repair

Invalid/future timestamps now fail step-up. CSRF and step-up guards no longer log session credentials; every CSRF rejection logs a reason, method and correlation ID without submitted tokens. The error filter emits `requiresStepUp: true` only for 403 `AUTHZ:STEP_UP_REQUIRED`.

The final combined run passes 83 distinct cases in 7 API files, including real session, staff-role, storage and safe-error HTTP checks. API types, focused lint/format and diff review pass. Two earlier failing runs prove the defects; overlapping passes are not added. Full logs and source hashes are in [step evidence](evidence/step-reviews.json). This repair does not certify other legacy session-service logs or renew browser, coverage, route-budget or production-image evidence.
