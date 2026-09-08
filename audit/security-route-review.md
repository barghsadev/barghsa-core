# CSRF and sensitive-action review

Current through product `e48bf58`, 2026-09-08. Requirements: `02-auth-users-admin.md#T-02.02.03` and `T-02.02.04`. Both remain partial. [All registered routes](evidence/r01/route-security.csv) include controller source hashes. This is registration evidence, not a claim that every handler, transaction or screen has passed review.

The inventory reflects compiled Nest module/controller metadata without starting the application. It follows imports and forward references from AppModule, reads global/controller/method guards and route decorators, and expands registered paths. There are 33 modules, 63 controllers and 343 routes. Global guards are RateLimitGuard and CsrfGuard.

| State-changing route classification | Count | Current boundary |
| --- | ---: | --- |
| SessionAuthGuard and StepUpGuard | 117 | Global session-bound CSRF plus recent verification |
| Above plus StorageAdminGuard | 4 | Additional storage permission guard |
| SessionAuthGuard only | 65 | Global session-bound CSRF; service permissions and confirmation vary |
| RefreshCsrfGuard | 1 | CSRF bound to presented refresh credential |
| No route guard | 16 | Public or independently authenticated routes below |
| Total unsafe-method registrations | 203 | All 121 RequiresStepUp routes have StepUpGuard |

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
| Existing staff and profile role changes | Staff roles repaired ata4cd929: current authentication through writes, verified-session audit and intended self sign-out pass. PUT/DELETE profile agents repaired at417ab33: current session/CSRF/deadlines and owner/Manager grants, verified-time/correlated audit, rollback and self sign-out pass. Remaining role-matrix/domain acceptance stays open. |
| New staff role grants | Fixed at640108c: guarded creation checks the current session/CSRF/deadlines through commit and records verified time/correlation. The canonical creation permission remains admin:users:create. Whole local creation acceptance is now recorded atab10771, including creator-only role selection and password guarantees. |
| Storage and provider credentials | All four storage mutations/probes and email/SMS/AI-model mutations have step-up metadata. Verification-provider config has no step-up decorator but no production adapter is registered, so the controller cannot reach its writer. Five registration checks confirm production refuses the stub. Before a real provider is enabled, require current authorization/step-up, encrypted config, audit and atomic version persistence. This is a future integration prerequisite, consistent with the no-provider decision. |
| Payment confirmation, prices and finance configuration | Invoice/wallet receipt decisions, catalogue prices, VAT and configured finance limits have step-up metadata. Domain authorization, audit, expiry during waits and UI retry remain in finance review. |
| Session and trusted-device revocation | Individual routes have guards. Bulk self-revocation uses explicit in-service confirmation and final checks. Reuse source-bound session/trust/CRM repairs; do not infer missing protection from the bulk route's absent decorator. |
| Profile archival and ownership | CRM DELETE profile and ownership transfer/accept/cancel/decline have step-up metadata. Ownership credential effects retain prior evidence. Initiation/resolution still accept only actor userId and need current session/step-up through commit, verified-time/correlated audit and final expiry checks. |
| Refunds and contract cancellation | Separate future consumers remain explicit dependencies. Order cancellation is not automatically a contract-cancellation implementation. |
| Other registered step-up actions | The CSV retains every route. Review required caller/audit/UI behavior with its domain once; avoid repeating shared guard tests per endpoint. |

Invitation creation/withdrawal/decline are repaired at `e48bf58`: current account/session/CSRF and profile/role or invited-username checks hold through writes. They retain their non-step-up policy. Decision expiry and audit failures roll back atomically; acceptance/decline use consistent lock order. Registration counts remain unchanged.

## Completed guard repair

Invalid/future timestamps now fail step-up. CSRF and step-up guards no longer log session credentials; every CSRF rejection logs a reason, method and correlation ID without submitted tokens. The error filter emits `requiresStepUp: true` only for 403 `AUTHZ:STEP_UP_REQUIRED`.

The final combined run passes 83 distinct cases in 7 API files, including real session, staff-role, storage and safe-error HTTP checks. API types, focused lint/format and diff review pass. Two earlier failing runs prove the defects; overlapping passes are not added. Full logs and source hashes are in [step evidence](evidence/step-reviews.json). This repair does not certify other legacy session-service logs or renew browser, coverage, route-budget or production-image evidence.


## Staff creation follow-up

At `640108c`, 215 distinct API/unit cases pass across recorded runs, including five provider-registration cases. Four new fa/en desktop/mobile browser cases verify the existing creation dialog's confirmation, wrong-password recovery, retained draft, rotated CSRF and temporary-password dismissal. No frontend product change was needed.

The route inventory was refreshed from compiled AdminController metadata and current source hashes; other controller behavior is unchanged. Declaration-source bindings were also corrected for 9 controllers/78 routes where the initial runtime export-cache lookup had selected re-export files. The indexed class declarations now identify actual controller files before hashing;62 controllers owned the342 routes recorded at640108c, out of63 registered controller classes. Eight old authority fixtures were corrected to pause after request authentication at the actual service boundary. They now verify their exact blocker and query before changing authority. Actor-session revocation and CSRF-change cases also pass. See [step evidence](evidence/step-reviews.json#R01-staff-creation-step-up) for failure history and scope.

Staff role changes, disablement and activation resend are now repaired at`a4cd929`. All231 selected API/unit cases pass across recorded runs, including15 action-boundary cases and17 authority races. The source hash for AdminController is refreshed; its registered route metadata is unchanged. Whole local staff-task acceptance is now recorded atab10771; continue remaining domain and CSRF dispositions. See [step review](evidence/step-reviews.json#R01-staff-sensitive-actions).


## Staff task acceptance

At `ab10771`, staff creation, role assignment and staff listing are verified locally. The new GET `/api/admin/staff-role-options` inherits SessionAuthGuard and permits either staff creation or role editing; it returns only assignable role names/descriptions. Existing role-management permissions are unchanged. Runtime metadata and allow/deny HTTP checks pass. The inventory is now343 routes;203 unsafe methods and121 step-up registrations are unchanged.

Ten immediate-predecessor evidence bindings were reconciled. Twelve older verified-record drifts remain. Next review agent-role permissions T-05.04.04 and their current audit/UI criteria using prior credential evidence. Full shared-shell accessibility and remaining CSRF/domain dispositions retain their existing scope.
