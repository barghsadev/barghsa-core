# Repair progress

Baseline: `2f80d92df51556d47f778b5230e5eea577e2a8d4`. Work branch: `codex/audit-fixes`.
The original audit is preserved in this directory. Findings are checked against the implementation before repair. The feature scheduler remains paused.

## F01.1 Queue identity and requirement context

Implemented full payload and ordering validation, including type changes and unexpected fields. Existing notification and finance promotions are now explicit in `kanban/queue-priority.json`; the queue itself is unchanged. Both agents use the same extractor for all four task formats and receive the parent story requirements without sibling task bodies. The supervisor defaults to its own checkout rather than another machine's path.

Validation: all 31 Python tests passed; backlog check validated 1,355 tasks and 116 traceability entries. Tests cover payload mutation, reordering, duplicate/missing tasks, promotion rules, every current task's context, and existing review/merge gates.

Self-review caught the intentional priority order during the first regression run. It is preserved explicitly rather than being replaced with epic order. No live runtime state was changed.

## F01.2 Assignment ownership and state persistence

Implemented supervisor-owned assignments, separate strict builder handoffs, atomic external snapshots, append-only task events and a dedicated remote state branch with revision-checked push/readback. Added paginated PR reconciliation before builder dispatch. Stale idle identities, completed resumes, changed requirements and wrong handoff tasks cannot reach review. The documented three-fix limit now matches execution.

Generated `reconciled-loop-state.json` with 263 distinct merged identities and retained PR evidence. All 322 current audit claims and two retired identities have dispositions. The 57 historical skips without direct PR evidence remain deferred. No task is falsely certified acceptance verified.

Self-review found and fixed deeper infrastructure story headings and a task-ID boundary expression that could confuse an ID with a longer ID. Remote failure, stale writer, crash recovery and second-checkout recovery are exercised against disposable bare Git repositories. Live GitHub state publishing and the other machine's scheduler are untouched.

F01 still needs an explicit correction/recovery command and operational rollout after acceptance closure. The prepared state deliberately remains blocked. Later repair groups are tracked below.

## F02.1 Production migration runner

The runner now reads schema-qualified Drizzle metadata, reports journal tags, verifies SQL checksums for the requested version, and distinguishes absent metadata from connection/permission errors. Each invocation owns and closes a direct pool. A connection-held advisory lock serializes competing deploys.

Validation: four PostgreSQL integration tests passed, covering first run, repeat run, competing deploys, failure rollback/retry, version checksum mismatch and connection failure. Database package typecheck passed. Docker became available during this repair, enabling real database tests.

The production migration chain remains under repair. Historical migration 0014 drops products with CASCADE and must not be replayed against populated databases. Existing helper-created tables also need a complete production baseline and upgrade evidence before F02 can close.

## F02.2 Complete schema baseline

Added a separate production migration chain that retains the historical journal and creates the full declared schema plus missing domain/foundation constraints. Production migration commands now use it; the base image copies its assets. Fixed 14 text/UUID reference mismatches and two defaults that prevented schema generation. Generation now succeeds through the TypeScript loader and reports no schema drift against the retained snapshot.

Validation: 73 database test files and 551 tests passed. All 11 workspace typecheck tasks passed. The production-path integration test installs and seeds an empty database, rejects orphan addresses and invalid wallet balances, enforces catalogue/default-profile protections, upgrades a populated legacy-journal fixture, preserves a 9,007,199,254,740,993 IRR balance and leaves prior migration records unchanged. The first full-suite run exposed the test's five-second limit under parallel load; this full installation/upgrade test now has a 30-second limit.

F02 still needs API/worker startup against this schema, wider runtime-query coverage and final image verification. Incompatible legacy rows require a reviewed backfill; the migration blocks rather than discarding or inventing data. API startup and session runtime queries were subsequently verified in F03; worker/image verification remains pending.

## F03 Session loading and CSRF

Implemented cookie parsing and session context before the global CSRF guard. Rejected CSRF requests do not extend idle deadlines. Logout now requires CSRF for an active session. Refresh validates CSRF against its own credential so an idle-expired session can recover without bypassing token checks or refresh reuse detection. Optional authentication clears stale context before revalidation.

Fixed the CSRF cookie lifetime from 86.4 seconds to 24 hours and changed the browser helper to read the current cookie on every request. Updated 23 protected mutations across 13 web files. Session-establishing/token-authenticated auth routes and independently authenticated payment callbacks retain their exemptions. Forced password changes now revoke sessions and consume refresh tokens in the password transaction. Self-review found that password history omitted its version column; both password-change paths now select it.

Validation on 2026-09-06:

- `pnpm --filter @barghsa/api test`: 172 files, 2,403 tests passed. The HTTP tests compile the application before running, install the production schema in a fresh PostgreSQL database, and exercise the actual AppModule.
- `pnpm --filter @barghsa/web test`: 16 files, 109 tests passed.
- `pnpm typecheck`: all 11 workspace tasks passed.
- `pnpm --filter @barghsa/api test:e2e`: Chromium passed after installing its missing executable.
- `pnpm --filter @barghsa/api exec playwright test --repeat-each=5`: five consecutive Chromium runs passed.
- `git diff --check`: passed.

HTTP/browser evidence covers login cookies authenticating the next request; missing, wrong and previous-session tokens returning 403; valid step-up and logout; refresh without consuming credentials on CSRF failure; idle recovery; refresh reuse revoking its family; browser cookie flags/lifetime; another tab changing authentication; logout clearing the client token; and forced password changes invalidating old credentials. Browser tests use real API responses and PostgreSQL, with the actual client header helper. They do not certify every form's business behavior.

F03's reproduced ordering and token-lifecycle defects are repaired locally. API startup against the F02 baseline is now demonstrated. The complete repair plan is still in progress; staff authorization, OTP delivery and the remaining groups are not acceptance verified. No deployment or scheduler change was made.

## F04.1 Staff membership and credential invalidation

Staff creation now records `is_staff=true` and `is_admin=false`; named predefined roles pass the HTTP schema. The additive 0083 migration retains existing administrator flags and marks legacy administrators/role holders as staff. No-role staff remain visible and can be disabled. Login recognizes staff membership independently of platform authority, and session validation rejects a disabled user even if a session has not yet been explicitly revoked.

Role replacement now uses parameterized inserts with the correct column count, deduplicates role IDs, locks the account, and revokes sessions/refresh credentials in the same transaction. Repeating an unchanged role assignment is a no-op. Self-review found the previous insert named three columns but supplied two values, which mock-only tests had missed.

Validation on 2026-09-06: 173 API files / 2,405 tests passed; 73 database files / 551 tests passed; all 11 workspace typecheck tasks passed. New AppModule HTTP tests cover support, finance, legal and no-role creation, unknown-role rejection, narrow effective permission reports, role replacement/removal, idempotence and immediate disable enforcement. Upgrade coverage confirms existing administrator flags survive. An old seed fixture was updated for the new column. Fixture cleanup now waits for connections instead of force-terminating closing sockets; the full rerun passed without unhandled errors.

F04 remains in progress. Controllers still need capability-based enforcement, existing deployed administrator grants need account review, and activation delivery/consumption is not repaired yet. `staff-administrator-review.sql` is a read-only query for that deployment review, not an instruction to demote its results automatically.

## F04.2 Current staff capabilities

Replaced 86 administrator-only checks with explicit capability checks across staff tickets, CRM, finance, contracts, catalogue, geography, providers, AI and administration. The reviewed file/method/capability inventory is in `staff-permission-enforcement.json`. Session authentication reads current role permissions from PostgreSQL for every request; malformed role data grants nothing. The explicit Admin role wildcard works without setting the platform administrator flag. Disabled accounts have no effective permissions.

Migration 0084 gives unchanged predefined CRM, Finance and Legal roles the concrete capabilities required by their implemented endpoints. Customized deployment permission sets are preserved. Approval notifications now include current finance-capability holders and exclude unqualified/disabled users. The existing verified-owner identity exception in the customer profile route remains a domain rule to review with F06/F07, not a staff module permission gate.

Validation on 2026-09-06: 174 API files / 2,409 tests passed; 73 database files / 551 tests passed; all 11 workspace typecheck tasks passed. Real HTTP tests cover the six-account role matrix across tickets, CRM, receipt review, contract templates and role administration. They also reject attempted role escalation, verify permission removal and malformed-role denial on the next request, verify Admin-role wildcard reporting, and execute the read-only deployed-account review query. Migration follow-up confirms custom role permissions survive. Chromium session/CSRF checks passed after this change. The focused approval-service tests passed after expanding notification eligibility.

Self-review corrected capability spellings to match the canonical AI requirements and removed obsolete comments claiming role enforcement was deferred. Role permissions are exact strings; module-prefix wildcards do not grant access. Domain transaction, attachment, dual-approval and UI closure remain in their later repair groups. F04 activation-link delivery/consumption and operational account review are still pending.

## F05.1 Registration consent and usable controls

Registration now checks actual username availability and accepts only the immutable ID of an active, published terms version. The client fetches and displays that exact version, and the challenge retains its ID. Verification records the original publication even if a newer version becomes active; missing or unpublished terms roll back registration. The re-acceptance banner now sends the UUID instead of the human version label. Invalid IDs return a validation error instead of a PostgreSQL cast failure.

Review also found a race between draft edits/deletion and publication. Conditional draft writes and a publication row lock prevent changing published content or publishing the same draft twice. Real PostgreSQL/HTTP tests hold an edit behind a row lock, publish before releasing it, and verify the edit is rejected without changing content.

Browser testing exposed two previously unverified UI defects. The password-strength panel disappeared on blur, moving the terms button during its first click; it now remains visible while a password is entered. The web entry point never imported the shared stylesheet and had no Tailwind compilation plugin, leaving the custom checkbox with zero visible size. The entry point now loads the shared styles, Vite compiles them, and both workspace source directories are included. These are prerequisite F19/F20 fixes, not full UI acceptance closure.

Validation on 2026-09-06:

- Full API suite: 175 files, 2,412 tests passed.
- Full web unit suite: 16 files, 109 tests passed.
- Workspace typecheck: all 11 tasks passed.
- Chromium registration consent checks: 2 passed. They exercise the actual React page with controlled API responses, verify the displayed/submitted version ID, dialog keyboard dismissal, visible checkbox interaction, and blocked registration when terms cannot load.
- Real AppModule/PostgreSQL consent checks: publication between challenge and verification, later re-acceptance, placeholder/draft/unknown IDs, duplicate username, concurrent draft edit and duplicate publication passed. OTP hashes are fixture-controlled in these consent-only tests; they do not certify external OTP delivery.
- Production web build and diff whitespace check passed. Main JS remains 221.77 kB gzip, above the original auth budget; F19 remains open.

F05 delivery, purpose-bound challenges, resend/consumption races, reset/contact flows and F04 staff activation remain pending. Existing legacy placeholder challenges cannot establish valid consent and must restart registration. No production account, provider, scheduler or remote state was changed.

## F02 follow-up: reject silently skipped migrations

The inherited journal contains future timestamps. A newly generated migration can therefore sort behind the database head and be silently skipped by Drizzle. The runner now rejects unordered timestamps and duplicate tags before migration, checks applied SQL digests and missing entries behind the head, rejects a newer database history, and verifies the complete journal after migration. Existing migration SQL and metadata remain unchanged.

Validation on 2026-09-06: 73 database files / 553 tests and all 11 workspace typecheck tasks passed. Regression tests reproduce the stale timestamp, adjust only the new entry and apply it, reject altered applied SQL, reject a missing earlier entry and newer database history, then confirm recovery after restoring metadata. Fresh install, representative upgrade, repeat and competing migration checks remain passing. Operators still review generated SQL and assign a timestamp greater than the prior journal entry before committing.

## F05.2 OTP consumption and resend concurrency

Username/contact verification previously locked the challenge in its account transaction, then used another pool connection to consume that same row. The second connection waited on the first indefinitely. Verification now uses the caller's locked transaction. Successful account writes and OTP consumption commit together; failed account writes roll back consumption. Incorrect codes retain their attempt decrement before returning 401. The username audit now selects the old username it records.

Resend updates compare the original code hash and require an unconsumed, unexpired challenge with attempts remaining. A concurrent consume, expiry or replacement cannot be overwritten, and exhausted challenges cannot be resent. No delivery is claimed by this checkpoint.

Validation on 2026-09-06: 176 API files / 2,415 tests and all 11 workspace typecheck tasks passed. Real AppModule/PostgreSQL tests complete username changes without hanging, persist a wrong-code attempt, inject an account-write failure and retain the challenge for retry, reject reuse, race two contact verifications with one successful mutation/audit, and consume a challenge while resend waits on its row lock. The losing resend returns 409 without changing the hash or resend count. Diff review passed.

F05 remains partial. Next work is purpose/user binding for challenges and a durable, encrypted delivery event connected to real email/SMS adapters, followed by controlled-provider registration/reset tests. Staff activation shares that dependency. Test fixtures in this checkpoint supply codes directly and do not certify provider delivery. F02 operational rollout, F04 deployed account review and the rest of the plan remain open as previously recorded.

## F05.3 OTP purpose and account binding

Challenges now identify registration, login, password reset, username change, added email or added mobile. Registration/login/reset verification and their resend routes select only the intended purpose. Contact changes require both the signed-in user's ID and the correct contact purpose before checking the destination or consuming the code. Forgot-password issuance explicitly creates password-reset challenges.

Migration 0085 adds the purpose column and validates required account/registration bindings. Previously unscoped challenges remain in history but become consumed with no attempts remaining. The default for old writers is `legacy_invalid`, which no verification route accepts. The generated timestamp was advanced beyond the previous production journal entry; no earlier SQL was changed.

Validation on 2026-09-06: 176 API files / 2,417 tests, 73 database files / 553 tests, the final baseline constraint checks, and all 11 workspace typecheck tasks passed. Real HTTP tests reject reset-to-login, login-to-reset/registration, wrong resend purpose, another account's contact code, and mismatched contact type. Rejections preserve the original challenge and attempt budget; a correctly scoped login succeeds. Issuance tests verify actual contact/reset routes persist the expected account and purpose. Registration tests verify its unbound registration purpose. Upgrade testing preserves and invalidates legacy OTP history, rejects invalid database bindings, and confirms repeat migration remains a no-op.

Review complete for this checkpoint. F05 is still partial: durable encrypted provider delivery, working reset UI/contract, staff activation and credential-change invalidation of outstanding account challenges remain to be completed. The latter must respect transaction lock ordering; blindly consuming every other challenge while holding one challenge row risks deadlocks. These tests still use fixture codes and do not certify external delivery. No rollout or feature-loop restart occurred.

## F18.1 Worker job drain prerequisite

All eight worker pollers now use one timer/promise owner. Shutdown stops dispatch before awaiting every running job and its outcome recording, then closes the pool. Notification polls cannot overlap within one worker. The existing forced-exit deadline remains.

Review: checked all interval call sites and shutdown ordering. Focused tests prove two concurrent delivery/finance-shaped jobs both finish before pool closure, no overlapping dispatch, no post-drain work and retry after failure. Worker typecheck and all 27 worker test files / 288 tests passed. Actual image/SIGTERM acceptance remains for F18; these unit tests do not certify production deployment.

## F05.4 Durable authentication delivery

OTP creation and resend now enqueue an encrypted delivery row in the same SQL statement as the challenge mutation. Migration 0086 adds the outbox without replacing history. API and worker require the same separate AUTH_DELIVERY_ENCRYPTION_KEY. Worker claims use SKIP LOCKED and a 60-second token-bound lease, cancel consumed/expired/replaced challenges, retry with backoff up to five attempts, and wipe payloads on sent/cancelled/dead outcomes. Only provider acceptance with a receipt records sent. Missing providers and decryption failures remain failed delivery.

Active tested SMTP, Resend and SMS.ir configurations are consumed by the worker. SMTP pins the checked DNS address and requires TLS; Resend uses the delivery ID as an idempotency key; SMS enforces the configured account quota and exact purpose/code template mapping. Shared provider schemas preserve existing API imports. SMS activation tests now use the same real API envelope and field names as delivery and reject empty success-shaped responses.

Review evidence: six real HTTP/production-migration/compiled-worker tests use a local HTTP mailbox at the provider boundary. Registration completes with the received message, without reading or replacing the OTP in the database. They cover queue-insert rollback, failed delivery, retry exhaustion and secret removal, replacement, expiry, simultaneous workers and abandoned lease recovery. Shared crypto tests reject row substitution, tampering, wrong/missing keys. Full API 177 files / 2423 tests, DB 73 / 553, worker 27 / 288, shared 46 / 624 and all eleven workspace typecheck tasks passed before the final localized error addition; the final focused/typecheck rerun is recorded below.

Provider references: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [SMS.ir request contract](https://github.com/IPeCompany/SmsPanelV2.DotNet/blob/main/IPE.SmsIrClient/Models/Requests/VerifySendRequest.cs), [SMS.ir result envelope](https://github.com/IPeCompany/SmsPanelV2.DotNet/blob/main/IPE.SmsIrClient/Models/Results/SmsIrResult.cs).

Limits: external production credentials/delivery and an actual SMTP mailbox have not been exercised. Generic SMTP and SMS are at-least-once across a crash after provider acceptance but before recording the receipt. A resend racing an already-running send may still deliver the old message, but the old code cannot authenticate. F05 remains partial until password-reset UI, credential-change invalidation and staff activation are complete. F09 still owns general notification transport/circuit-breaker closure.

Final F05.4 rerun: all eleven workspace typecheck tasks and 15 focused API/provider test files / 144 tests passed. Diff whitespace review passed.

## F05.5 Password recovery caller and mailbox proof

The recovery API now returns a challenge ID. Unknown accounts receive a fresh opaque ID with the same response shape and destination quotas. Recovery normalizes email and Iranian mobile inputs. The client now collects the received code, new password and confirmation on the existing recovery page, submits the actual challenge, shows localized rejection or success, and clears secrets after completion. It no longer navigates to the nonexistent reset page or stores the code in sessionStorage/URLs.

Review: confirmed issued IDs flow into reset, resend replaces the in-memory ID, mismatched passwords cannot submit, failed reset retains the form, and errors are localized in fa/en. A real HTTP/compiled-worker/local mailbox test resets the password with the received code, verifies the new hash, rejects the old password and rejects code reuse. Three Chromium tests cover both locales, confirmation mismatch, exact request binding, secret clearing and server rejection. All 58 auth tests and all eleven workspace typecheck tasks passed; whitespace review passed. Broader rate-limit policy remains F23 and credential-change races are the next checkpoint.

## F05.6 Credential-change races and mandatory staff OTP

Migration 0087 adds an authentication version to accounts and their codes. Database triggers advance the version when password, username, email, mobile, disable state or forced-password-change state changes. Existing account codes without a version are invalidated without deletion. Issuance retains the version observed during password/account checks, verification locks and checks the current account, and session creation rechecks that version while holding the account lock through session insertion. Reset locks precede password-history reads. Obsolete forced-password-change tokens are cleared, and token issuance compares the version observed during password verification. Worker delivery cancels obsolete account codes.

Review found and fixed a trusted-device bypass of mandatory staff MFA. The corresponding real HTTP test confirms staff still receive an OTP challenge. Other tests hold a concurrent password update open while login-code verification or trusted-device session creation waits, then prove both reject the stale authentication without creating a session. Two valid reset codes racing for one account produce one success and one rejection, with one password-history entry. Contact code reuse retains its previous 409 response.

Validation: full API suite 177 files / 2428 tests; clean/legacy production migration replay; all eleven workspace typecheck tasks passed. Final issuance-binding refinements passed all 62 auth tests and API typecheck. Review checked issuance, consumption, account/session lock order, trigger behavior and the generated migration. Account codes do not acquire locks on other challenges, avoiding the cross-challenge deadlock that bulk invalidation would introduce. F05/F04 still require staff activation closure and production-provider evidence.

## F04/F05.7 Staff activation delivery and consumption

Staff creation with link activation now stores a random 256-bit token hash and queues the encrypted email in the account/profile/role/audit transaction. It returns queued status without the activation secret. Migration 0088 extends the existing auth outbox with explicit OTP/activation bindings. Delivery validates the pending account token and 24-hour expiry before sending. Credential changes invalidate old links. The public activation endpoint sets the password, consumes the token, clears forced-password-change state, revokes earlier sessions/refresh tokens and audits activation in one transaction. It does not log the user in or bypass mandatory staff MFA.

The activation page reads the token from the email URL fragment, removes it from browser history, keeps it in memory, validates password confirmation, and shows localized success/rejection. Browser review found and fixed same-document navigation to a replacement link. A permission/step-up-protected administrator endpoint replaces a pending link with a one-minute reissue limit; successful activation prevents reissue. APP_PUBLIC_URL and the shared delivery key are required to queue links.

Review and evidence: actual migrated API/worker/local mailbox tests verify token hashing/no response disclosure, delivered-link consumption, simultaneous one-time attempts, expired-message cancellation, atomic creation rollback on queue failure, reissue throttling and stale-link rejection. Three Chromium checks cover fa/en, fragment removal, secret clearing, missing/rejected links and replacement navigation. Full API 177 files / 2431 tests, all eleven typecheck tasks, production clean/legacy migration replay and web production build passed. The auth bundle remains above its F19 budget. Actual production provider credentials remain untested. The staff management UI is still an F17 repair; this checkpoint closes the delivery and activation caller gap only.

## F06.1 Block simulated verification and align verification mode

Majid confirmed on 2026-09-06 that no identity-verification provider exists yet. The public automatic-verification endpoint now returns a localized 503 and cannot write VERIFIED or send a false success notification. Production never registers the success stub; test/development require explicit ENABLE_VERIFICATION_STUB=true. Automatic approval is not offered by the verification context API.

Onboarding, verification context and the order eligibility check now use the canonical administrator profile_verification_mode setting, retaining legacy flag fallback only when it is absent. Invalid explicit values preserve enforcement. Both individual and legal submissions persist PENDING_VERIFICATION for MANUAL/API and ACTIVE for DISABLED; their HTTP responses reflect the stored status. Migration 0089 adds the previously rejected pending lifecycle value and reserves pending national IDs. Completion preserves the existing default profile. Review also found migration reporting sorted text IDs (1,10,2); it now orders numeric migration timestamps/IDs.

Review/evidence: full API suite 179 files / 2439 tests passed. Fresh/legacy production migration replay and all eleven workspace typecheck tasks passed. Real HTTP checks exercise conflicting legacy/canonical settings in all three modes, repeated unavailable verification, no approval/notification mutation, and preserved default profile. Environment-matrix tests prevent stub registration in production/staging/unset environments. Test setup now rebuilds shared errors/dictionaries before compiled API checks so stale package exports cannot mask changes.

Provider-dependent F06 acceptance remains blocked: adapter selection/contract, credential storage, durable external request/result evidence, stale-result protection and actual provider delivery. No fictitious provider integration or successful queue-processing claim has been added. Existing VERIFIED rows cannot be automatically classified as manual versus former simulated approval from available evidence; review them against authoritative records before production rollout. No production account or profile was changed.
