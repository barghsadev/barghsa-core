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

## F07.1 Preserve invitation consent during registration

Registration no longer creates agent memberships or writes invitation_accepted without a user decision. Pending invitations remain discoverable through the registered, verified username. The invitation list now uses actual schema fields, legal entity names and UUID text fallback; it includes non-expiring pending invitations and excludes archived profiles. The old query referred to nonexistent users.first_name/last_name and mixed text with UUID in COALESCE.

Review/evidence: a real migrated HTTP registration verifies that membership and acceptance audit remain absent, retrieves the pending invite, explicitly accepts it, and then verifies exactly the intended Finance membership and Accepted status. Existing agent tests and all auth tests pass; API typecheck and whitespace review pass. Delivery itself remains covered by the earlier mailbox tests. Invitation decision races, transfer completion, agent profile selection and UI remain separate F07 checkpoints.

## F07.2 Serialize invitation decisions

Acceptance now claims the still-pending, unexpired invitation before inserting membership. The claim rechecks the current enabled account username, role/profile binding and an available legal profile. Decline and withdrawal also require Pending at the write, so they cannot overwrite a committed acceptance. Ownership checks precede status disclosure. Expiry is evaluated at the write, including after a lock wait.

Review/evidence: five actual HTTP/database tests hold the invitation row lock to force competing requests past their preliminary reads. Accept/accept, accept/decline and accept/withdraw each commit exactly one terminal decision and audit; only Accepted creates membership. An expiry change during the wait rejects acceptance. An injected audit failure rolls back both acceptance and membership, allowing a later retry. The 50 focused registration/agent/race tests and API typecheck passed; whitespace review passed. Broader manager removal/creation permission races remain under the profile authorization checkpoint.

## F07.3 Complete ownership-transfer decisions

Initiation now requires recent step-up and rechecks current ownership and enabled target membership under transaction locks. Expired pending transfers are reconciled with audit before a replacement can be created. The new pending-transfer list exposes only requests involving the current user. Accept, decline and cancel require step-up and the exact transfer UUID; stale UI cannot silently approve a replacement request. The current owner remains unchanged until acceptance commits.

Acceptance locks the profile, transfer and target membership; rechecks expiry after lock waits; changes the single profiles.user_id owner; clears the transferred default selection; removes obsolete explicit Owner memberships; revokes both parties' sessions/refresh tokens; and records transfer state/audit in one transaction. Other existing agent roles remain intact. Both users choose context after signing in again. Decline/cancel/expiry preserve ownership. Historical rows remain retained.

Review/evidence: seven actual migrated HTTP tests cover missing step-up, unauthorized/stale IDs, recipient listing, session revocation, accept-versus-decline/cancel races, removed targets, expired requests and replacement, expiry during a target-membership lock wait, audit-failure rollback, and simultaneous initiation. Full API 181 files / 2452 tests and API typecheck passed; whitespace review passed. The customer transfer controls and the wider agent-access repair are the next checkpoints. No production ownership was changed.

## F08 Address deletion, manager access and main-address concurrency

Removed the query against nonexistent orders.address_snapshot_id. Orders store copied snapshot fields; saved-address deletion now removes only the non-main address and preserves those snapshots. Address creation, edits, deletion and main switching recheck owner/Manager authority while holding the same profile lock through their transaction. Removed manager membership no longer grants access; Finance/Legal cannot edit addresses. The first saved address becomes main automatically. Every successful address mutation writes an audit event in its transaction.

Review/evidence: actual migrated HTTP tests create addresses as a Manager, reject unrelated/Finance/Legal/removed managers, edit/delete an address while proving the entire historical order row is unchanged, reject main deletion, race two main switches and race switching with deletion while retaining exactly one main address. All 123 profile tests and API typecheck passed; whitespace review passed. This closes the reproduced deletion failure and the tested main-address invariants. Wider agent/profile selection and team controls remain F07 work.

## F07.4 / F11.1 Independent active-profile selection and capability checks

Migration 0090 adds per-user profile context without changing another owner's default flag. Profile lists include current legal-profile agents; switching rechecks profile and membership under locks and audits the persisted selection. Legacy owned defaults are used only until a selection exists. Removed or archived selections become unavailable rather than silently falling through to another profile. Verification, the notification center, customer invoices and dashboard counts use the selected authorized profile. No active profile can pass the commercial-order guard.

Enabling agent selection does not grant every operation: wallet reads, wallet funding and receipt submission require their specific role permissions; invoice receipt submission separately requires bank-receipts:submit. Manager cannot fund wallets or submit invoice receipts, Legal cannot access wallet funding or invoice lists, and Finance retains its financial capabilities. Dashboard counts are filtered by applicable operational/financial permissions. Owner authority comes from the current profiles.user_id, not a stale profile_agents Owner row. Agent-list display no longer queries nonexistent user name columns.

Review/evidence: four real migrated HTTP tests cover owned plus Finance/Legal profiles, unauthorized switching, owner-default preservation, selected verification and notification read state, removed/archived selection, stale Owner memberships and wallet/invoice capability distinctions. Full API 183 files / 2459 tests, clean/legacy migration replay and all eleven workspace typecheck tasks passed before the final receipt-capability refinement; its focused HTTP/receipt regression rerun is recorded below. Older receipt-boundary fixtures were expanded for the new resolver; migration correctness is independently verified with the production journal. Wider team controls, multi-role management and remaining notification migration/rendering remain open.

Final F07.4 rerun: all 32 selected HTTP/receipt unit and real PostgreSQL boundary tests passed after enforcing invoice receipt submission capability. The negative HTTP test uses a syntactically valid receipt request; invalid uploads are not mistaken for authorization evidence. All eleven workspace typecheck tasks passed.

## F07.5 Additive agent roles and guarded removal

Migration 0091 replaces the one-role-per-user uniqueness rule with one membership per profile/user/role. Step-up-protected role replacement and removal endpoints permit only the current owner or Manager of an available legal profile. They lock the profile, recheck authority, reject any change to the current owner, preserve unchanged membership IDs and audit before/after roles in the transaction. Only Manager/Finance/Legal can be assigned. Profile ownership remains a separate single value.

Review/evidence: real HTTP checks prove step-up enforcement, Finance+Legal membership, loss of wallet access when Finance is removed, rejection of assigned Owner roles/current-owner removal, completed agent removal and acceptance racing removal. The race commits one operation and preserves one owner. All 129 profile tests, clean/legacy migration replay and workspace typechecks passed; final owner/Manager archived-profile filtering was checked again with the focused suite. No existing production memberships were altered.

### F07.6 / F11.2 Profile selection refresh and dashboard route

Fixed the customer layout lazy import to select its actual named export; the previous route stayed suspended. A successful explicit profile switch now reloads the document so independently fetched dashboard, notification, and form state cannot remain from the previous profile. This clears unsaved page drafts as well. One remaining profile is selectable when the active context is unavailable; removed the root guard's silent automatic fallback. The required multi-profile dialog now submits its initially selected radio option through the agent-aware switch endpoint and verifies the returned identity before reload. Invitation decisions notify the sidebar to refresh its available profiles. The layout respects the document locale; broader page translation gaps remain under F20.

Review/validation: four Chromium browser checks pass (Persian/English switch labels, old dashboard data replaced after switch, rejected switch retaining selection, initial modal choice submitting). Web typecheck and diff whitespace check pass. Browser tests use mocked HTTP boundaries; server authorization and persistence were covered by F07.4 production-schema HTTP tests. No provider integration or full F07/F11 acceptance closure claimed.

### F07.7 Team and ownership screens

Added `/settings/team` with member roles, joined dates, pending invitations, invitation creation/withdrawal, additive role editing, removal, and ownership initiation/acceptance/decline/cancellation. Confirmation captures the exact target; a server-required password challenge retries that action with a fresh CSRF header and clears the password. Acceptance warns about session revocation and returns to login. Managers do not receive ownership initiation controls; the server returns canonical-owner permission metadata and incoming/outgoing transfer direction. A dashboard banner links recipients to pending ownership requests. All new strings have Persian and English dictionary entries.

Review/validation: ten Chromium team checks pass, including both languages, exact action payloads, password retry, cancellation without a mutation, manager controls, stale-transfer errors, and acceptance/sign-out. Four profile-switch regression checks also pass. Production-schema ownership HTTP and controller checks pass (12 tests); these caught and corrected reversed permission-query arguments. All 11 workspace typechecks pass. Production web build passes, with the existing bundle budget problem still open under F19 (entry 227.32 kB gzip in this build). Full profile capability coverage across contracts/orders/documents, delivery notifications, and comprehensive accessibility remain separate pending acceptance work; F07 is not declared wholly closed.

### F09.1 Truthful per-channel dispatch failures

Missing or mismatched transports now produce failed outcomes instead of silently disappearing. Each provider exception is caught per channel, sanitized, and recorded without discarding successful prior legs or preventing later channels from being attempted. Invalid successful results without provider references are rejected. Channel-specific failure details reach job/dead-letter/delivery-log persistence. Duplicate requested channel names are dispatched once per attempt.

Review/validation: all 27 worker test files / 288 tests pass, including new missing-adapter and mixed success/throw/success checks with secret-redaction assertions. Worker typecheck passes. Durable retry deduplication, independent scheduling, real external transports, and template test-send remain pending; this checkpoint does not enable external delivery or claim F09/F10 completion.

### F10.1 Durable delivery identity and inbox deduplication

Migration 0092 adds the missing `notification_job.provider_ref` column, versioned outbox identity, and a unique inbox delivery key. New channel keys include the durable occurrence ID; attempted legacy rows retain their old provider keys. The writer now requires an explicit stable business occurrence key instead of silently merging all events of one type/profile. Inbox retries return the original row without overwriting content or read state, including concurrent attempts. Proven legacy inbox inserts are linked through provider-reference evidence; ambiguous legacy attempts are held for reconciliation. See `audit/notification-delivery-migration.md` for rollout and read-only recovery queries. Historical inbox duplicates are retained rather than deleted without evidence.

Review/validation: full production-schema integration checks cover repeated/concurrent retries, two distinct top-ups, preserved read state, repeated enqueue keys, and proven/ambiguous/unattempted legacy migration cases. All 28 worker files / 292 tests and all 11 workspace typechecks pass. Clean-install and representative legacy-baseline migration checks pass. These checks also exposed the previously missing job provider-reference column, which is repaired here. Per-channel outcome reuse, lease safety and recipient quiet-hour scheduling remain the next checkpoint.

### F10.2 Reuse completed channel outcomes

The runner now consults durable channel jobs before retrying, skipping already delivered legs and previously recorded consent/destination skips. Exception bookkeeping preserves completed jobs and logs only jobs actually changed. The lease reader accepts the same injected pool as the runner so integration checks exercise the real claim/dispatch/persist path in an isolated database.

Review/validation: 18 focused worker checks pass, including a full production-schema run where in-app succeeds, email times out, and the next poll sends only email. Exactly one in-app delivery-log row remains. Worker typecheck passes. Lease fencing, independent attempt budgets and recipient-window scheduling are still open and are not claimed by this checkpoint.

### F10.3 Recipient windows and independent channel retry budgets

Deferred external jobs now keep their own `run_after` date and a captured delivery-window configuration (migration 0093). In-app remains runnable immediately. Schedules use the explicit recipient's timezone, falling back to the profile owner, and existing dates/windows survive later configuration changes. The aggregate outbox wake-up/status comes from all channel jobs; completed and exhausted jobs are not dispatched again, and successful/failed attempts use the channel's own retry budget. Window reconciliation locks each eligible outbox briefly and skips active claims. Fixed next-day scheduling across spring DST and ambiguous/nonexistent hourly boundaries; invalid timezones use the safe default.

Review/validation: all 28 worker files / 299 tests pass. Production-schema cases prove mixed in-app/email behavior for Tehran and New York, preservation of an existing schedule after config changes, independent exhausted/retryable channels, one dead-letter entry, and truthful aggregate failure after another channel later succeeds. Clean and representative legacy migration checks pass; all 11 workspace typechecks pass. Claim fencing/renewal and exception-path bookkeeping are the next checkpoint. Per-timezone administration and broader notification-template/destination delivery work remain open under F09/F11/F17.

### F10.4 Worker claim fencing and renewal

Migration 0094 adds a unique token per claimed outbox row. Claim deadlines and renewal checks use database time; each channel rechecks ownership before sending, and result/skip/failure persistence locks and verifies the current token before changing jobs or history. A lost claim aborts compatible transports and prevents later channels or stale state writes. Claimed rows run concurrently and the poll waits for all of them before returning, including failures, so shutdown can drain the full batch. Removed the separate bulk exception path; failures now retain per-channel budgets and the same fenced transaction rules. Expired sending rows re-enter window reconciliation safely.

Review/validation: all 28 worker files / 301 tests pass. Full-schema tests prove renewal during a slow send, a second poll finding no claimable row, forced takeover preventing further sends and stale persistence, recovery with the same provider key and one inbox item, and preserved successor state. Clean/legacy migration checks and all 11 workspace typechecks pass. SMTP/provider crash ambiguity remains an external transport limitation; this does not claim exactly-once external delivery. Stop old workers before migrations 0092–0094 and restart only the updated worker. No remote worker was operated.

### F09.2 Recipient selection, suppression and shared rendering

External delivery now resolves the outbox's explicit user before falling back to the profile owner. Verified legacy usernames remain eligible contacts, while disabled accounts and pending staff activation do not. Case-insensitive bounce/complaint suppression gates email independently of marketing consent. API and worker now share the pure template renderer; plain-text output can preserve literal characters, and property lookup never invokes getters or traverses prototypes.

Review/validation: all 28 worker files / 302 tests pass, including a production-schema recipient/suppression case. Three shared-renderer checks and all 11 workspace typechecks pass. Review found inherited random UUID defaults on nullable suppression foreign keys; the integration fixture supplies explicit values/null, and the defaults require an additive migration under F02 before that debt is closed. Real external adapters and truthful template test-send remain open; this checkpoint does not enable them.

### F09.3 Remove false template test-send success

Email/SMS template tests no longer create an unrelated inbox item and report delivery. Until their adapter is connected, they return an explicit unavailable response, record failure, and audit no delivered destination. In-app tests remain bound to the acting staff inbox and reject external destinations. Test-address allowlists now require explicit development/test environments, excluding unset, staging, preview and production.

Review/validation: nine focused API checks and API typecheck pass. These cover both unavailable external channels, truthful persisted/audited outcomes, valid in-app delivery and environment restrictions. This is a fail-closed checkpoint; real delivery is the next step.

### F09.4 Shared real email sender

Added a server-only shared SMTP/Resend sender for notification delivery and template tests. It requires exactly one active, successfully tested, non-degraded provider, rechecks case-insensitive suppression, validates the recipient/subject, and requires a provider receipt. Resend receives the durable occurrence key. SMTP pins the checked public address, requires TLS, disables file/URL loading, and retains a stable message ID; cancellation closes the connection and rejects the attempt. Added the existing pinned Nodemailer dependency to shared. Shared now skips third-party declaration checking, matching API/worker, because the installed Nodemailer declarations conflict with Node's optional error code type; application TypeScript checks remain strict.

Review/validation: seven tests pass, using a local HTTP server for Resend success/failure/missing-receipt cases and controlled SMTP connection boundaries for TLS, address rejection, receipts, stable IDs and cancellation. All 11 workspace typechecks pass. No external recipient was contacted. SMTP cannot guarantee exactly-once delivery across an acknowledgment crash; circuit-breaker recovery and worker/API wiring remain separate unfinished work.

### F09.5 Wire real email delivery and email template tests

The worker now registers the real email adapter. It resolves the durable recipient, selects exactly one active template for the recipient's locale, uses shared rendering, refuses missing/unknown variables, and records the provider receipt through the existing fenced per-channel runner. Email template tests use the same sender with an explicitly permitted destination and audit the actual channel/receipt. Subjects preserve plain text; email bodies escape inserted values. SMS remains unavailable pending its adapter.

Review/validation: all 28 worker files / 303 tests pass. A full production-schema test sends to a controlled local HTTP provider, receives an initial failure, retries with the same key, verifies the explicit recipient/English template/escaped content, records the receipt, and preserves one inbox item. Eleven API template-test checks and all 11 workspace typechecks pass. No real external endpoint was contacted. Review follow-ups remain: durable message/template/provider snapshots across retries and atomic circuit-breaker recovery, plus SMS delivery. These are not claimed complete.

### F10.5 Immutable email message snapshots

Migration 0095 adds a per-channel message snapshot. Before its first provider call, the email adapter stores the rendered subject/body, recipient user/profile/address, template identity/version, provider identity and delivery key. Concurrent attempts retain the first snapshot. Retries reuse it despite template/payload edits; changed recipients or provider identities fail for reconciliation. Previously attempted pending emails without snapshots are held without deleting jobs/history. Rollout guidance is in `audit/notification-delivery-migration.md`.

Review/validation: all 28 worker files / 305 tests pass, including template/payload changes between HTTP retries, recipient-change refusal and preservation of held legacy evidence. Eight shared sender checks cover provider replacement and existing delivery guarantees. Clean and representative legacy migrations and all 11 workspace typechecks pass. No provider receipt guarantees end-user receipt, and SMTP acknowledgment ambiguity remains. SMS snapshots will use the same job field when its adapter is added.

### F09.6 Shared SMS provider sender

Added server-only SMS preparation and delivery using the configured SMS.ir template mapping. Only allow-listed data becomes named provider parameters; missing values, duplicate parameter names, invalid destinations and unavailable mappings fail. Sending revalidates the exact active tested provider, applies a durable quota and propagates cancellation through the HTTP client. A valid SMS.ir receipt is required.

Review/validation: ten shared email/SMS checks pass, including local HTTP SMS requests, exact mapping/body fields, missing receipts, rejected variables, quota exhaustion, provider replacement and cancellation. All 11 workspace typechecks pass. SMS has no provider idempotency contract here, so acknowledgment crash ambiguity remains; durable job snapshots and queue/API registration follow next. Authentication SMS still uses its older separate quota key and needs consolidation when the business adapter is connected.

### F09.7 Wire durable SMS delivery and template tests

The worker registers SMS delivery with active locale-specific templates and approved provider mappings. It saves recipient/provider/template parameters before sending and reuses them on retries; changed recipients fail for reconciliation. Historical attempted SMS jobs without snapshots refuse replay rather than inventing parameters. SMS template tests use the shared sender and audit the real receipt/channel. Authentication and business SMS now share one durable provider quota key.

Review/validation: all 28 worker files / 306 tests pass. A production-schema/local-HTTP case proves SMS failure/retry, unchanged mapped amount despite payload edits, durable receipt, and authentication being blocked after the shared provider quota is consumed. Twelve API template tests and all 11 workspace typechecks pass. No real message was sent. SMS provider acknowledgment crashes remain ambiguous because this integration has no provider idempotency contract. Active configuration circuit-breaker concurrency and broader templates/inbox consolidation remain open.

### F09.8 Atomic email breaker and sender consolidation

API connection tests, queued email, template tests and authentication email now use one shared breaker. Failure counters update atomically. Recovery claims use a database-timed leased deadline; only the matching unexpired probe can clear or extend the open state. Missing providers fail closed, and an old boolean probe flag cannot reset a breaker. Removed the duplicate authentication SMTP/Resend implementation in favor of the tested shared sender. Recovery no longer remains permanently unavailable just because `degraded=true`.

Review/validation: production-schema checks cover concurrent failures, one of twelve concurrent recovery claims, expired/replaced claim refusal, window expiry, healthy reset and database clock behavior. The actual sender test trips after five controlled failures, rejects further requests, admits one pending recovery request among ten, and recovers on its receipt. The final provider suite has 29 passing checks; authentication/template/provider checks have 32 passes, all 306 worker checks and ten shared sender checks pass, and all 11 workspace typechecks pass. No external endpoint was contacted. Inbox/template consolidation and notification observability remain next under F10/F11; SMTP/SMS receipt ambiguity remains documented.

### F10.6 Safe manual recovery and truthful poll health

Dead-letter recovery now locks the parent outbox before the record/job, checks the current triage state before any requeue, and rejects active worker leases, cancelled/delivered parents and jobs that are no longer dead-lettered. Concurrent/repeated actions perform one audited transition; snapshots, provider receipts and completed jobs remain intact. Failed delivery batches record worker failure, and an empty poll no longer clears that failure as a success.

Review/validation: three production-schema integration cases pass, covering eight concurrent retries, completed-job replay refusal, active-claim preservation, cancellation, resolved records and already delivered jobs. API and worker typechecks pass. A fixture query needed an explicit JSON cast because audit metadata is stored as text; that correction is confined to the check. No remote job was retried.

### F11.3 Consolidate legacy and account inbox delivery

Migration 0096 copies legacy notifications into the canonical inbox with original text, recipient, timestamps, read state and occurrence identity; the source table remains as evidence. The canonical inbox supports private account notices without a profile and private profile notices alongside shared profile events. Both APIs now read/write the same inbox. List/count/read actions combine the selected authorized profile with the acting user's private notices; removed memberships expose no profile notices. Read timestamps remain stable. UI rows and accessible labels display saved content, normalize the former `/app` prefix and reject unsafe navigation links through one shared validator.

Review/validation: clean/legacy baseline migration and all 307 worker checks pass, including preservation of migrated legacy text/read/source history. HTTP checks prove private account visibility with no profile, both APIs sharing read state, owner/agent separation and profile selection. Two Chromium checks pass in fa/en for literal text, direction and correct profile navigation. All 11 typechecks pass. The full API run passed 2,472 tests and identified five outdated profile-only query-parameter assertions; after updating them, all 13 notification-center unit checks pass. Active localized in-app templates and newer-direction pagination remain follow-ups.

### F11.4 Saved bilingual inbox templates and explicit recipient privacy

In-app dispatch now renders active fa/en templates into saved plain text. Known current emitters have bilingual default content, including amounts/customer-visible reasons, when no active override exists. Replays return the original item before consulting changed templates, preserving content/read history. Explicit outbox recipients receive private inbox items; migration 0097 restores that privacy for old rows whose delivery key proves their source. Shared profile notices remain profile-scoped. Known invoice/profile/wallet notices receive valid default navigation.

Review/validation: all 308 worker checks pass, including active bilingual templates, replay after template/payload changes, malformed active-template failure, read-time preservation and recipient backfill. Shared defaults/navigation checks, clean/legacy baseline migration and all 11 typechecks pass. Review found the CRM verification mutation still reads status outside its transaction and writes notifications after commit; its concurrent/durable notification path is the next repair. Newer-direction pagination also remains open.

### F06.4 / F11.5 Transactional manual verification

Manual CRM verification accepts pending submissions and returns re-verification requests to PENDING_VERIFICATION. It locks the non-archived profile before checking status/owner, then commits the status, audit and bilingual private notice together. Concurrent approvals produce one transition; notice failure rolls back the transaction. Reasons are required for revocation/re-verification. User confirmed there is no identity provider, so automated verification remains unavailable.

Review/validation: 36 focused CRM/inbox checks pass, including production-schema concurrency, rollback, archived/invalid states and owner changes; API typecheck passes. Existing DRAFT manual approval compatibility is preserved. Provider integration and historical verification provenance remain unresolved external work.

### F11.6 Complete inbox pagination

Newer-page queries fetch the nearest arrivals before reversing each page for display, so intermediate pages are no longer skipped. Cursors retain PostgreSQL microseconds instead of rounding through JavaScript dates. Invalid cursor UUIDs and read IDs return 400 through both inbox APIs.

Review/validation: 18 notification-center checks pass, including full HTTP traversal in both directions, equal timestamps, sub-millisecond timestamps, default newest page and malformed inputs; API typecheck passes. No notification rows or read history are changed by this repair.

### F10.7 Align the second administration recovery path

The failed-notifications admin service now locks the parent before dead-letter rows, matching worker and canonical recovery ordering. It requeues only the exact linked dead-letter job, clears the expired claim token and preserves cumulative outbox attempts and saved content. Completed jobs and active claims cannot be revived.

Review/validation: 25 admin/recovery checks pass, including eight concurrent admin retries producing one success, active-lease refusal, completed-job refusal with rollback and preserved attempt/snapshot evidence. This repairs the additional existing entry point; no remote job was retried.

### F12.1 Overdue payments and cumulative refund states

Reconciled the canonical transition table with its explicit overdue-payability rule. Wallet settlement and both receipt paths now accept Overdue, retaining credit-note/cancelled restrictions, exact wallet debit, receipt allocation caps and audited transitions. Partial receipts become PartiallyFunded and remain eligible for overdue marking/reminders; full settlement reaches Paid. Shared eligibility exposes the existing receipt form for overdue invoices. Cumulative refunds below the paid amount remain strictly partial; exactly the paid amount may reach Refunded after previous partial refunds. The deferred refund module is not implemented.

Review/validation: all 58 invoice/wallet files (870 checks), 360 shared finance checks, nine invoice detail UI checks and all 11 workspace typechecks pass. Real database cases exercise overdue wallet debit and partial/full receipts through both existing services, preserving wallet balances. The backlog generator validates after specification reconciliation. Review discovered the wallet-payment service has no customer HTTP/UI caller; that missing built-task integration remains for F14, so customer end-to-end wallet payment is not yet claimed complete.

### F13.1 Step-up for generic financial approvals

The generic approval controller now requires recent step-up for initiation, approval and rejection, while queue reads retain ordinary authenticated permission checks. It continues to reject self-review and reads current finance capabilities.

Review/validation: 13 controller/production-HTTP checks pass, including absent/expired step-up, valid approval/rejection, repeated decisions, self-review, support-only access and a reviewer whose role was removed. API typecheck passes. Receipt-to-request binding and the missing wallet-receipt threshold gate are the next F13 steps.

### F13.2 Wallet receipt threshold and immutable approval binding

Wallet receipt confirmation now uses the shared at-or-above bank-payment threshold. The first finance confirmation saves an approval request and receipt-owned binding to the amount, evidence, wallet and intended invoice. It leaves funds untouched. A second currently eligible finance actor resolves and settles atomically; generic approval is accepted only when the bound request, both actors and receipt still match. Rejection, changed evidence/destination and revoked reviewer access block settlement. Lowering/disabling the threshold does not bypass a saved request. Pending details are returned to the staff caller.

Review/validation: 41 wallet/controller/production-HTTP checks and API typecheck pass, including five simultaneous second confirmations with one credit, same-actor retry, support denial, below/exact threshold, disabled/corrupt configuration and preserved pending funds. Existing isolated wallet tests gained the configuration table needed by this new gate. Invoice approval binding, exact audit amounts, rejection synchronization and the required approval UI remain next.

### F13.3 Consistent thresholds and exact approval amounts

Aligned generic dual approval with C-04.CC.02: positive thresholds require a second approver at or above the configured amount. Reconciled the administration epic wording. Approval DTOs and audit amounts now use decimal strings, preserving int8 IRR beyond JavaScript's safe integer range. A persisted JSON-null threshold is corrupt, rather than a missing disabled configuration.

Review/validation: the complete API suite passes 2,494 checks across 188 files; 30 shared approval checks and all 11 workspace typechecks pass. Production HTTP proves a 10000000000000001 IRR request remains exact in the response and audit. The backlog generator validates. This full run also confirms the preceding CRM, inbox, retry, overdue and wallet approval repairs together. Invoice receipt binding and remaining F13 UI/rejection synchronization are still open.

### F13.4 Invoice receipt approval evidence and current approvers

Invoice receipt initiation now saves a fingerprint of the receipt identity, profile, invoice, amount, bank reference, attachment and customer note in its own audit. Confirmation verifies that trusted initiation record and the exact request amount/action before accepting approval; arbitrary generic request details cannot authorize settlement. Both original approvers must remain eligible, and a distinct current finance actor performs the second confirmation. Shared actor validation is used by wallet and invoice gates.

Review/validation: 42 receipt/approval checks pass, including production HTTP for overdue receipt settlement, changed bank reference, forged generic request details and revoked reviewer permission; API typecheck passes. Legacy pending/approved invoice requests without the new evidence fingerprint are deliberately held for manual reconciliation, preserving their history instead of inferring approval from current data. Receipt rejection synchronization and pending-approval UI remain next.

### F13.5 Synchronize wallet receipt rejection

Rejecting a wallet receipt now resolves its bound pending approval in the same transaction and enforces a different finance reviewer. If the generic approval queue already rejected it, receipt rejection preserves that original reason in the customer notice and audit. Approved requests cannot be overwritten by rejection, and rejected receipts cannot later settle.

Review/validation: 45 wallet/production-HTTP checks and API typecheck pass. HTTP cases prove self-rejection refusal, synchronized statuses, original generic-rejection reasons and zero wallet credit. Pending approval UI remains the next step.

### F13.6 Truthful pending wallet receipt UI

The staff wallet receipt screen distinguishes pending dual approval from completed credit. It keeps the receipt selected/in the queue, shows a bilingual pending notice, restores the bound invoice and makes that destination read-only while review is pending.

Review/validation: all 13 receipt UI checks pass, including fa/en pending responses, absence of the former false credit-success message and preserved invoice binding; web typecheck passes. The i18n package was rebuilt before checking the new dictionary entries. The separate approval queue screen remains next.

### F13.7 Financial approval queue

Added the missing staff approval route and navigation, pending/approved/rejected queues with pagination, exact decimal IRR formatting, initiator/reviewer/reasons and receipt references. Decisions use the existing accessible confirmation and step-up dialog with finance-specific conflict/permission errors. Rejection reasons are captured before authentication; stale queue responses are discarded. Bilingual notices explicitly separate approval from payment execution.

Review/validation: five new Chromium scenarios and all ten team-dialog regression scenarios pass. They cover Persian/English exact amounts and password retries, mandatory rejection reasons, conflicts, history/pagination and stale responses. Production web build and typecheck pass. Approval notifications and remaining financial integration checks stay open.

### F13.8 Transactional generic approval notices

Generic request creation now enumerates current eligible staff inside its transaction, excludes disabled and unactivated accounts, and writes bilingual private notices before commit. Generic approval/rejection similarly commits the initiator notice with the decision and audit. Links now target the implemented queue directly.

Review/validation: 30 service/production-HTTP checks and API typecheck pass. A database trigger failure proves a failed notice leaves the request pending with no approval audit; retry succeeds after recovery. Browser evidence from F13.7 remains applicable. Receipt-created requests still need their own notification integration; this checkpoint does not claim that coverage.

### F15.1 CRM user pagination and lifecycle filters

CRM user pagination now compares cursors in the requested direction, keeps database microseconds and treats user IDs as text. Invalid cursors/date ranges return 400 instead of silently restarting or failing in SQL. Pending/disabled filter aliases map to the stored PENDING_VERIFICATION/SUSPENDED states; archived profiles are excluded from active summaries. Corrected the surname full-text search parameter.

Review/validation: 22 service/production-HTTP checks pass, including seven text IDs with equal/microsecond-separated timestamps in both directions, actual-state filters, surname search and invalid inputs. CRM list UI and the broader profile action matrix remain open.

### F15.2 CRM list and complete profile summaries

Replaced the CRM placeholder with bilingual user search, profile/verification/staff/date filters, sort direction, cursor navigation, filter clearing/removal and expandable links to profile details. Profile/name matching now uses existence checks so a matching subset cannot shrink the returned profile count or hide other active profiles. Added staff-only filtering and profile references to the authorized DTO.

Review/validation: 23 API checks, three Chromium scenarios and all 11 workspace typechecks pass. The browser review found and fixed an initial debounce timer that could reset a quick page change. Gregorian date inputs are explicitly labeled; replacing them with a true Jalali picker remains next. This slice does not close the remaining detail/edit/deletion acceptance work.

### F20.1 True Jalali date selection, used by CRM

The shared date picker now uses Jalali calendar arithmetic as well as localized labels, so its month grid, year boundaries and selected dates agree. Added an accessible trigger name/ID, RTL direction and single-selection dismissal. CRM date filters now use that picker in Persian and Gregorian mode in English, while sending Gregorian date bounds to the API.

Review/validation: all five CRM Chromium scenarios pass, including Farvardin 1, 1405 → 2026-03-21, leap-day Esfand 30, 1403 → 2025-03-20, inclusive end-of-day queries and keyboard Escape/focus return. UI/web typechecks and production web build pass. Broader F20 localization/accessibility and date-range consumer checks remain open.

### F15.3 CRM viewer permissions and session secrecy

CRM detail/edit responses expose the current viewer's edit/verification/user-management capabilities. The page gates controls on those capabilities instead of the customer's isAdmin flag, resets component state between profiles, cancels obsolete reads and uses the selected locale for dates/type labels. Back links return to the working CRM list.

Review found live bearer session IDs in the detail DTO. Replaced them with SHA-256 display references; live/expired status and counts now respect expiry and idle deadlines. No existing sessions were changed.

Review/validation: 29 service/production-HTTP checks, two browser permission scenarios and all 11 workspace typechecks pass. HTTP checks prove raw customer session IDs are absent and every returned reference fails authentication. Step-up and the remaining profile action UI still require completion.

### F15.4 Sensitive CRM step-up and strict editing

CRM edit, verification, password-reset, session-expiry and archive endpoints now require recent password confirmation. Existing edit/password/session controls use the shared accessible confirmation dialog and preserve the selected user, profile and reason across step-up. Reason entry now uses the shared focus-managed dialog. Profile edits reject unknown/identity fields and non-text payloads instead of silently reporting success. The UI reloads the detail after an edit because the mutation response is intentionally partial.

Review/validation: 30 API checks, three Chromium scenarios and all 11 workspace typechecks pass. HTTP verifies absent/expired step-up across all five mutation routes, a valid edit and forbidden identity-field rejection. Browser testing verifies the same customer/reason across session-expiry password retries. Verification/archive and identity-correction screens remain next.

### F15.5 Manual verification and archive controls

Added permission-gated verification/re-verification/removal controls with captured reasons and step-up, plus archive confirmation and explicit business-blocker feedback. All CRM action payloads now validate their action/reason shape. Archive checks use current invoice state and exact posted/reserved wallet amounts, and serialize on the profile row so concurrent archive attempts create one audit. The former optional, nonexistent legal representative table no longer permits bypassing canonical ownership; legal-profile archival stays blocked while that ownership remains active.

Review/validation: 31 API checks, 19 Chromium scenarios spanning CRM/team/finance dialogs, and all 11 workspace typechecks pass. Checks cover large wallet funds, preserved profiles on refusal, one archive among four concurrent attempts, required verification reasons, pending status after re-verification and visible archive errors. Contract archival rules and races with every business writer still need F22 review; identity-correction cases are next.

### F15.6 Identity-correction transaction safety

Correction creation/review now locks the target profile before its case, rejects duplicate unresolved cases and self-review, compares the live identity with the recorded original before approval, and rolls identity/case/audit changes back together. Original values come from the database, never the submitted currentValue. Archived targets, invalid identity fields/identifiers and malformed payloads are refused; mutations require step-up.

Review/validation: 11 checks pass, including seven retained list/detail unit checks and four production-HTTP scenarios replacing mutation mocks. HTTP exercises concurrent creation/review, forged original values, changed identity, archived targets, identifier validation, audit failure rollback and step-up. API typecheck passes. Evidence upload authorization, case queue UI and legacy case reconciliation still need review.

### F15.7 Fixed identity-correction evidence

Correction cases now require one to five verified evidence uploads owned by the corrector and bound to the target profile/purpose. The server reads capped bytes, checks content and size, writes a separate immutable copy outside the upload prefix, and stores its digest/provenance. Review refuses unsealed legacy evidence. Authorized detail reads supply five-minute download links to the fixed copy. Shared capped stream reading now handles both web and Node/S3 streams for invoice receipts and correction evidence.

Review/validation: 23 correction/invoice-upload checks and API typecheck pass against production migrations and a controlled local S3-compatible server. Replacing the original upload cannot change the downloaded evidence; another user's upload is refused; legacy unsealed cases cannot update identity. The HTTP fixture gained an optional local storage endpoint for this proof. No real storage account was used. Failed transactions can leave unreachable snapshot objects for later cleanup; legacy cases require resubmission.

Cross-step check before this evidence addition: the full API suite passed 2,496 checks in 190 files.

### F15.8 Identity-correction queue and request UI

Added the correction queue, profile-specific request link, evidence upload and independent review screen. Creation captures the profile, field, value, reason and uploaded keys before step-up; reviewing exposes original/new values and fixed evidence downloads. Self-review controls are hidden, rejection requires notes, and approval is disabled when sealed evidence is unavailable. Queue responses include the current viewer capabilities. Shared upload sequencing retains the invoice-receipt purpose and adds a distinct correction-evidence purpose.

Review/validation: three Chromium scenarios pass in fa/en, including one upload across a password retry and blocked legacy approval. Thirteen case API checks, four invoice-upload client regression checks and all 11 workspace typechecks pass; production web build passes. CRM still has cross-cutting acceptance work, including all identity-edit/deletion races and notification completion. F16 ticket workflows are next.

### F16.1 — Ticket assignment eligibility and concurrent status preservation

- Assignment now requires an existing, enabled, activated account with current ticket-write permission or administrator access. Invalid targets leave the ticket unchanged.
- The assignment update evaluates the current locked row's status. It advances Open to In Progress and preserves every other status, including a resolution committed while assignment waits.
- Assignment and its actor-bound audit commit together. Recording failure rolls back the assignment.
- Review: 52 ticket checks passed, including four real HTTP/PostgreSQL scenarios for rejected targets, authorization, transition preservation under an actual database lock, and audit rollback. API typecheck and diff whitespace check passed.
- Remaining F16 work includes the full transition/comment rules, attachments and related-record ownership, assigned-only/team access, and customer/staff screens. This checkpoint does not mark the ticket tasks acceptance-complete.

### F16.2 — Ticket transitions, public conversations and mutation rollback

- Staff status changes now lock the ticket and enforce the documented transition graph. Any state may reopen; resuming Waiting on Staff is supported. Entering In Progress requires an assignee. Repeating the same status is an idempotent read.
- Customer endpoints allow reopening and public comments only, including when the owner is also staff. Internal notes remain confined to staff endpoints.
- A customer reply resumes Waiting on Customer to In Progress. Replies on resolved/closed tickets require reopening first. Comments refresh the ticket's update time.
- Comments/status changes and their actor-bound audit records commit together. List/comment ordering now has an ID tie-breaker.
- Review: 36 ticket checks passed, including seven real HTTP/PostgreSQL scenarios. Added coverage exercises the full lifecycle, internal-note privacy, cross-owner refusal, malformed input, audit rollback and competing transitions. Earlier SQL-mock mutation tests were replaced by these database checks. API typecheck and diff whitespace check passed.
- Attachments, related records, team/assigned-only access, notices and screens remain in F16.

### F16.3 — Ticket creation, owned record links and persisted attachments

- Creation now validates runtime payloads, requires an active owned profile for profile-linked tickets and verifies order/invoice links belong to that exact profile. Unverifiable contract links return a conflict because the contract table is not implemented.
- Up to five verified PDF/image uploads are checked against uploader, profile and ticket purpose, inspected for content and size, copied to fixed private storage keys and persisted with the ticket. Detail reads sign five-minute downloads after owner/staff authorization. Replacing a source upload leaves its ticket copy unchanged.
- Creation and audit commit together. Migration 0098 adds an empty attachment list for existing tickets; the schema definition and production journal agree. Storage copies written before a failed database commit can remain unlinked and require the existing storage cleanup process; no external storage transaction is claimed.
- Review: 32 focused ticket checks, the populated baseline migration/rerun test, all workspace typechecks and the full API suite passed. Full API result: 191 files, 2479 tests. The lower count reflects replacing SQL-mock mutation tests with real HTTP/database coverage.
- Remaining ticket work: screens, assigned-only/team access, notices and full acceptance reconciliation. Contract integration remains dependent on the unbuilt contract module.

### F16.4 — Assigned-only ticket access

- Ticket endpoints recognize the explicit `tickets:assigned` and ticket-specific `tickets:*` capabilities without changing generic permission-prefix behavior elsewhere.
- Assigned-only staff receive a server-enforced own-assignment filter. Detail/comments/status/assignment writes include the assignment condition in the database query. They cannot claim unassigned work or reassign another user.
- An actual blocked comment transaction proves that reassignment removes access before the pending write can commit. The staff queue reports current action capabilities for its screen.
- Review: 36 ticket/permission checks passed, including 12 real HTTP/database scenarios; API typecheck and whitespace check passed. Tests also cover forged list filters, another ticket's internal comments, status/assignment refusal and access after reassignment.
- Team assignment/configuration consumption and ticket screens remain open.

### F16.5 — Customer and staff ticket screens

- Added customer `/tickets` and staff `/admin/tickets` routes and navigation. Both have searchable/filterable/sortable paginated lists, conversation details, localized dates, attachment downloads and direct ticket links.
- Customer creation offers only owned profiles, paginated owned order/invoice choices, priority and up to five uploads. A failed ticket save preserves the draft and reuses completed uploads on retry. Customers can reply and reopen.
- Staff controls follow current capabilities: eligible assignee selection, allowed status changes, public replies and visibly distinct internal notes. Assigned-only staff can resume reopened assigned tickets but cannot reassign them.
- Review found the global profile check blocked support and staff pages for accounts without customer profiles. Those pages now bypass onboarding/default-profile selection, and in-flight profile checks are cancelled on navigation. Profile-dependent customer behavior remains covered by regression tests. English/Persian admin layout direction now follows the locale.
- Review: nine Chromium ticket/profile-switch scenarios passed; 36 focused API checks passed; all workspace typechecks and the production web build passed. Rendered staff screen inspected. Build still reports the previously tracked entry bundle budget problem under F19.
- Remaining F16 work includes configured team assignment, staff response targets/notices and final task acceptance reconciliation. Contract linking is still unavailable until that module exists.

### F16.6 — Private transactional ticket notices

- New/unassigned customer work alerts eligible full-access support staff. Assignment, replies and status changes notify the other relevant participant. Customer notices always link to the customer ticket; staff notices link to the staff route.
- Internal notes never notify the customer. Notices contain the ticket subject/status, not conversation text, and include Persian/English content. Current staff access is checked before notifying an assignee.
- Notices, ticket mutations and audit records share a transaction. A notification failure rolls back the reply and audit. Assignment account locks now allow foreign-key reads while continuing to serialize account changes, avoiding an inverted lock dependency with ticket notices.
- Review: 38 ticket checks and API typecheck passed. New HTTP/database tests prove private recipients, localized content, no internal text, removed-access exclusion, and notification-failure rollback/retry.
- Team/configuration consumption, response target display and final acceptance review remain open.

### F16.7 — Configured teams and internal response targets

- Full ticket managers can select an active configured team and an eligible member. Saving rechecks the locked team and current membership, plus the account's current eligibility. Assigned-only staff cannot change team attribution.
- Migration 0099 persists optional team attribution, keeps the assignee/ticket when a team is removed, and indexes the team reference. Direct assignment clears previous team attribution; audits record the selected team.
- Staff queue target times use the configured hours and last ticket update, matching the worker's open-status/time rule. Targets are labelled as internal guidance and excluded from customer data.
- Review: 41 API ticket checks, five Chromium ticket checks, the populated production migration/rerun test and workspace typechecks passed. Concurrent membership removal prevents a stale assignment.
- The configured round-robin/expertise/load assignment engine is still absent. That configuration consumer and its admin screen remain under F17; manual team assignment does not claim to implement automatic routing.

### F17.1 — Staff team configuration safety

- Team creation/update/deletion and assignment-rule writes now require password confirmation as well as the current team-management capability.
- Team members must be enabled, activated staff accounts. Invalid team IDs, malformed updates, and rules naming missing/inactive teams fail validation. Account checks are locked against concurrent account changes.
- Assignment-rule writes take a transaction advisory lock before the first row exists, so concurrent initial saves preserve the actual previous version in their audits. Referenced active teams stay locked through the save.
- Review: 35 focused admin checks passed, including four new real HTTP/PostgreSQL scenarios for permissions/step-up, membership validation, five concurrent first writes, and audit-failure rollback/retry. API typecheck and whitespace check passed.
- The team/rule UI and automatic assignment engine remain next under F17.

### F17.2 — Automatic assignment for new tickets and correction cases

- New work consumes the saved rules in its creation transaction. Round-robin positions are durable; load routing counts open tickets/cases; expertise matches configured team skill tags and then selects the least-loaded eligible member. Missing/invalid rules, unavailable teams, and no eligible members leave work for manual assignment.
- Team/account locks serialize concurrent selections and eligibility changes. Correction creators cannot receive their own case. Assignment, cursor, audit and private notification changes roll back together. Existing work is not reassigned when configuration changes.
- Migration 0100 adds correction assignee/team fields, durable cursors and open-assignment indexes. Correction details show the reviewer; overdue scanners prefer that reviewer to the creator.
- Review: all 2,496 API tests passed (193 files), including concurrent round-robin balance, eligibility fallback, audit rollback/retry and correction self-review exclusion. Three correction browser checks, 24 worker target tests, populated migration/rerun and workspace typechecks passed.
- Follow-up: overdue scanners still omit staff without a default customer profile. Fix recipient handling next; team/rule administration screens and the rest of F17 remain open.

### F17.3 — Deliverable staff alerts and functioning escalation

- Staff alerts now use enabled, activated account recipients even without a customer profile. Archived profiles are not selected; disabled team members/admins are excluded. Queue, private inbox, external contact resolution and delivery-window handling support optional profile context.
- Migration 0101 removes the outbox profile requirement and generated foreign-key default, while requiring an account or profile recipient. Migration 0102 restores omitted alert-ledger uniqueness/domain constraints; existing invalid or duplicate rows fail migration for reconciliation rather than being discarded. Schema definitions retain these constraints for future generation.
- Real execution exposed and fixed an escalation timestamp parameter inferred as an interval. Breach failure counters now reflect rollback rather than reporting rolled-back alerts as delivered.
- Review: all 309 worker tests passed. The migrated PostgreSQL scenario proves breach/queue rollback, retry without duplicates, concurrent private inbox delivery, profileless escalation/admin fallback, disabled-recipient exclusion, escalation rollback and ordinary account delivery windows. Nine migration/schema checks and workspace typechecks passed; final worker typecheck and whitespace review passed after the final test changes.
- No external providers were called. Team administration and other F17 screens remain open.

### F17.4 — Staff team and routing administration screen

- Added a lazy admin screen for team create/edit/delete, named member selection, skill tags and per-work-type routing. Mutations use captured confirmation dialogs with password step-up; failures retain the draft/action and never report success. Rules disclose new-work-only semantics, expertise tags and manual fallback.
- The capability-guarded member search is bounded, excludes disabled/unactivated/non-staff accounts, and returns named existing members (including subsequently disabled members) for removal. Browser searches cancel stale responses and preserve selected members.
- Review: 36 focused API checks and workspace typechecks passed. Three Chromium checks cover both locales, password confirmation, failed-save retry, rule changes, deletion and denied access. Two additional Chromium checks use a disposable PostgreSQL database and the compiled real API to create/edit/delete teams, save routing and verify persistence after reload. Production web build passed; English screen visually reviewed.
- Original task 02-auth-users-admin.md#T-09.08.02 remains partial: its explicit priority-reordering requirement is not represented by the current single-team-per-type model. Consultations are a separate unbuilt domain and remain backlog work. These gaps must not be hidden by marking the parent task verified. Other F17 screens remain open.

### F17.5 — Response-target settings and configuration audit integrity

- Added the lazy response-target settings screen for implemented work types, with enable/disable, whole-hour bounds, localized guidance, captured confirmation and failure recovery. Targets explicitly describe internal alerts rather than a customer service promise.
- Target and escalation-rule changes now require password confirmation. Both writers serialize the first insert as well as later changes, preserving previous values/versions and the global configuration version atomically with audit records.
- Review: 31 API checks passed, including real HTTP permission/step-up/invalid/disable flows, concurrent first writes and audit-failure rollback/retry for both configurations. Replaced mocked transaction-success checks with those real database scenarios. Workspace typechecks and production web build passed. Four Chromium tests against the migrated API cover team/target persistence and disable in both locales; two additional target browser tests cover invalid input, confirmation, failed saves and denied access.
- Team/target live browser fixtures were consolidated under admin-settings-live.spec.ts and admin-ui-fixture.ts.
- Remaining escalation gap: level two currently broadcasts to teammates; the original requirement calls for a team lead. Correct that recipient model next. Consultation targets await the unbuilt consultation domain.

### F17.6 — Explicit team leads and escalation recipients

- Teams can designate a current member as their lead. Partial updates retain the lead; removing that membership requires clearing/changing the lead. The screen selects named members and clears a removed lead. Team create/update audits record the lead change.
- Level-two escalation now targets configured active team leads, not every teammate. A missing/disabled lead, or a lead already responsible for the item, falls back to active administrators. Unrelated teammates receive no escalation.
- Migration 0103 adds the optional lead reference and restores omitted unique team-name/membership and bounded-name constraints; schema definitions now retain them. Existing invalid/duplicate data is not silently deleted.
- Review: 41 focused API checks, all 310 worker tests, eight migration/schema checks and workspace typechecks passed. Real database checks cover lead membership, duplicate team rejection, concurrent escalation deduplication, teammate exclusion and disabled-lead fallback. Seven Chromium checks passed, including lead selection persisted through the real API in both locales.
- Priority reordering from the original team task is still open, as are separate unbuilt consultation flows. Further production-schema review follows because the legacy inline-constraint omission affects more than these tables.

### F02 follow-up — Restore skipped inline database constraints

- A catalog comparison of 80 named constraints from the retained legacy domain migration found 42 genuine omissions. Differently named equivalent foreign keys and the existing reminder-toggle unique index were counted as present, not duplicated. Full results are in legacy-inline-constraints.json and production-constraints.json; the audit command rebuilds an isolated migrated database.
- Migration 0104 restores 40 CHECKs and two GiST exclusions across notification delivery, approvals, reconciliation/jobs, templates, upload policies, invoice due/reminder settings and wallet callbacks. It validates existing data without deleting or silently repairing rows.
- The legacy upload-extension CHECK contained a PostgreSQL-disallowed subquery. Its repair uses an immutable SQL validator, rejecting empty/multidimensional arrays, null entries, malformed/uppercase extensions and more than 50 entries.
- A shared schema-check registry keeps the 40 repaired CHECKs in ORM schema generation. GiST exclusions and the upload validator remain explicit migration SQL.
- Review: all 2,497 API tests and 310 worker tests passed, plus populated baseline/rerun and four dedicated database scenarios. Those prove actual invalid-write rejection, adjacent-versus-overlapping policy windows, concurrent due-period exclusion, complete catalog/ORM coverage, and failed upgrade rollback followed by retry after correcting historical data. Final catalog: 80 checked, zero missing. Workspace and database typechecks passed.
- Broader database run: 556 checks passed and one old seed fixture failed because it omitted auth_version. The fixture now includes that existing column, uses an explicit test-only password, and all 13 seed tests pass. This was a fixture repair, not a production bootstrap execution.
- Scope: this inventory covers named inline constraints in 0081, not a blanket claim that all database/business invariants or operational restore requirements are verified. Optional foreign-key defaults and remaining F02 acceptance work continue next.

### F02 follow-up — Optional relationship defaults

- Catalog review found four remaining nullable foreign keys generating random IDs by default: invoices.order_id, email_webhook_events.outbox_id, and email_suppressions.profile_id/source_event_id. These generated nonexistent targets when a legitimate optional relationship was omitted.
- Migration 0105 removes those defaults, and the ORM fields now use ordinary UUID references. Before/after audit snapshots are saved in optional-foreign-key-defaults-before.json and optional-foreign-key-defaults-current.json.
- Review: six migrated database checks and workspace typechecks passed. An invoice without an order, an unmatched email webhook and a suppression without profile/event links now insert with NULL references; an explicitly nonexistent order still fails its foreign key. Fresh, populated-upgrade, failed-upgrade/retry and repeated-migration paths passed. Final catalog has no nullable foreign-key defaults.
- This does not claim operational backup/restore or the remaining acceptance matrix is complete.

### F04 follow-up — Seed-side administrator bootstrap

- The seed path now locks initial administrator creation, skips when any administrator exists (including a disabled administrator), and never promotes an existing customer. Account creation and its audit record commit together. Concurrent different identities can create only one administrator.
- Initial creation requires the explicit secret/key/identity/password configuration named by the task. Identity and password are validated; passwords are hashed and never generated into logs. The environment example documents the seed invocation and required values. No real bootstrap was run.
- Seed tests now use disposable databases with the complete production migrations instead of handcrafted subsets. Review: all 562 database tests passed (75 files), including 17 seed checks. New cases cover missing/invalid credentials, concurrent identities, stored hashes/forced password change, no secret output, existing-account protection and audit rollback/retry. Workspace typechecks passed.
- This repairs bootstrap creation only. The remaining first-login/MFA and authentication acceptance work stays under F05; no blanket verification of that broader flow is claimed.

### F18 / F21 — Production images and actual process shutdown

- API and worker now have separate runtime image targets with self-contained production dependencies and migration assets. Packaging uses the frozen workspace lockfile; the legacy deploy mode was rejected during review because it re-resolves dependencies. Shared DB runtime dependencies are declared correctly. All images use Node 24 and the non-root node user; build contexts exclude host dependencies, output and environment files.
- Fresh worker compilation produces dist/main.js. Its previous dist/src/main startup command was invalid and is repaired. Production web now runs the same server imported by tests; the duplicate implementation is removed, with security headers and idempotent graceful shutdown retained.
- Worker readiness probes the database and distinguishes liveness/unknown routes. API container health uses readiness, and unavailable configured Redis is reported as a warning while allowing database-backed fallback. Production compose includes the worker, external runtime configuration, required URLs/credentials, read-only application filesystems and a 40-second stop allowance above the 30-second application deadline.
- Review: clean API, worker and web image builds passed. scripts/test-production-images.py boots all three non-root/read-only, runs all 26 production migrations from the image, checks unavailable Redis, stops/restarts PostgreSQL to prove readiness failure/recovery, and exercises real concurrent outbox/invoice writes during SIGTERM. Graceful shutdown commits one inbox record and one audited invoice transition before exit 0. A 500ms forced deadline exits 1; interrupted work rolls back and a replacement worker commits each exactly once. Web/API SIGTERM exit 0. Workspace typechecks, ten web server tests and compose configuration validation passed.
- The forced-deadline test explicitly terminates disconnected sleeping test DB sessions and advances only the isolated outbox lease clock to avoid waiting for expiry; it does not claim to reproduce natural connection-loss/lease timing. No real provider request, host-port exposure or production deployment was performed. Disposable containers/networks are cleaned up.
- This verifies application images and process behavior. The inherited development backing-service compose, real credentials/provider setup, production migration/backup/restore procedure and deployment on the other machine remain operational work, not a production rollout claim. F19 quality gates and the remaining repair groups continue.

### F05 follow-up — Atomic authentication sessions

- Login OTP completion now commits challenge consumption, session/refresh-token creation, last-login time and optional device trust together. Registration commits the new account, exact TOS acceptance, consumed challenge and session together. A failed session write no longer burns a valid code or strands a newly created account behind a failed response.
- Session creation accepts the caller's transaction without independently committing, rolling back or releasing its connection. Ordinary password-login callers retain the existing owned transaction path. Failed OTP attempts still persist their decrement; stale/disabled account checks and one-use challenge locks remain intact.
- Review: all 2,499 API tests across 194 files passed, including controlled-provider authentication tests. New real HTTP/database failure injections prove a failed refresh-token insert rolls back the preceding session and OTP, and a failed registration session rolls back account/consent/OTP. Retrying concurrently yields one success and one consumed-code rejection, with exactly one new session/refresh token/consent. API typecheck and diff review passed.
- Old-and-new destination proof for username changes remains the next separate F05 repair; broader first-login/device/rate-limit acceptance is not blanket verified.

### F05 follow-up — Verify both username destinations

- Username changes now issue a linked pair of challenges to the current and proposed destinations. Both challenge/delivery rows commit together. Migration 0106 adds the self-reference and one-pair constraints without deleting history; unpaired historical username challenges cannot authorize a change.
- Completion requires both codes, bound to the signed-in account, current credentials and current username. Both are validated before either is consumed. A wrong code persists only its attempt decrement, and an account-write failure rolls back both consumptions. Reuse, cross-account/purpose and missing-old-proof attempts are rejected. New usernames are normalized consistently in the send/verify contract.
- The English/Persian settings form shows separately labeled masked destinations, requires both codes, submits the normalized destination, preserves input after rejection and clears codes on success/cancel. It truthfully says delivery is queued.
- Review: all 2,502 API tests and 562 database tests passed, along with all eleven workspace typecheck tasks and two Chromium locale checks. A controlled mailbox test receives both actual provider messages and completes the change without extracting OTPs from the database. Additional cases prove failed pair issuance leaves no orphan challenge/message, valid codes survive another code's rejection, legacy unpaired challenges cannot change the username, and account/OTP rollback plus reuse remain correct. Fresh/populated/repeated migration checks passed after the old-schema fixture was updated to remove the new column before simulating an upgrade.
- Broader F05/F23 device, contact-login and rate-limit requirements remain subject to the ongoing acceptance review. No production provider or real account was used.

### F19 — Enforce complete route JavaScript budgets

- Enabled TanStack Router code splitting and deferred the profile-selection dialog to routes that require it. Authentication routes now import a small auth/error/common/terms dictionary module; full application dictionaries still expose every original key/value. An exact comparison against the pre-change fa/en dictionaries passed. Activation is excluded from the profile guard alongside login/registration/recovery.
- Registration's terms dialog is loaded when opened, preserving the same accepted version/content and restoring focus to its trigger on close. The initial auth payload includes all static/shared JavaScript; the interaction-only terms dialog is explicitly excluded from the initial budget, not hidden as an uncounted initial dependency.
- Replaced permissive/per-chunk size checks with a manifest graph check using the specified route budgets: auth <150 KB gzip, dashboard <300, electricity ordering <250, every emitted admin component route <500. It includes bootstrap/layout/common files once and follows nested first-render lazy imports. Missing manifest entries, an empty configuration and over-budget output fail closed. A regression test proves an oversized common chunk fails rather than being omitted.
- Review: 26 route budgets pass; measurements are saved in frontend-budgets.json. Login 141.19 KB, registration 139.38 KB, registration verification 127.43 KB, recovery 132.34 KB, dashboard 229.53 KB and ordering 231.45 KB. Fresh Chromium contexts loading the real production server observe exactly the manifest totals for login/register/recovery.
- All 113 web tests, dictionary completeness checks and eleven workspace typecheck tasks passed. Fourteen production-browser flows passed across registration consent, recovery, staff activation, username pairs and profile switching; terms dismissal restores trigger focus. The production browser runner also passed its own real invocation. CI now uses Node 24, enforces route budgets, checks actual cold auth transfers and runs those production browser flows.
- This checkpoint does not close coverage thresholds, lint/format, API contract drift, every browser acceptance case, or the documented TanStack Start versus existing Vite SPA architecture discrepancy. Those remain explicit F19/F20/F22 work; no production or remote CI pass is claimed.

### F19 — API contract drift gate

- Added a committed, canonically ordered OpenAPI snapshot generated by the actual application build: 245 paths and 319 operations. The root contract check compares semantic JSON after key ordering and fails on missing/empty descriptions or drift. An explicit contract:update command rebuilds before refreshing the reviewed snapshot. CI checks it after the production build.
- Thirteen authentication handlers now describe request bodies from the exact Zod schemas they parse. The username-change contract therefore includes required previousOtp, alongside the new destination, challenge ID and new code. JSON Schema documents representable input shapes; arbitrary custom refinements still run on the server and are not claimed to be fully expressible in OpenAPI.
- The generator closes the application even if writing fails and sets a failing exit status on rejection. Review: a second clean API build matches the committed contract, the drift regression rejects removed endpoints and removed required fields, API typecheck passes, and all 24 focused HTTP/provider authentication tests pass.
- Coverage limit: the current generated description contains 54 documented request bodies and no named component schemas; many other requests/responses remain incompletely typed/documented. This gate makes existing/generated contract changes reviewable, not a claim that every endpoint or client schema is now complete. F19 coverage/lint/format and remaining task acceptance continue.

### F19 — Include actual HTTP processes in API coverage

- The HTTP integration fixture runs compiled Nest in child processes. Vitest previously counted only its own workers. Coverage runs now collect those child processes' native V8 records and remap the production SWC output to original TypeScript before combining them with unit coverage. CRM is no longer excluded.
- Raw subprocess records are cleared on each coverage run, including watch cleanup, so stale executions cannot inflate later results. Missing maps fail collection. The provider extends the pinned Vitest 4.1.11 converter; upgrading Vitest requires repeating the HTTP-only probe because this uses its provider API.
- Review: the HTTP-only OTP probe passed all nine tests and produced nine subprocess snapshots. Original-source counts confirmed execution of completeLogin, completeRegistration and completeChangeUsername. The full API run passed 2,502 tests in 194 files and merged 65 HTTP process snapshots covering 250 compiled modules. Final coverage: 86.50% lines, 68.80% branches, 83.54% statements and 73.83% functions, including eight CRM source files.
- The package-wide regression floors rise from 38/30 lines/branches to 80/65, with 80 statements and 70 functions. These measured baselines do not satisfy the separate 80/75 changed-code and 90/85 critical-domain requirements. No exception is approved; those gates and their remaining test gaps stay open. The shared config no longer falsely claims its zero defaults enforce the required policy.

### F23 — Account-specific login failures and usable retry responses

- Login now hashes the normalized account/IP tuple for its durable failure counter. Only invalid credentials increment it. The first five failures do not incur progressive delay; the sixth waits 500ms, increasing to a 5s cap. Atomic failure increments cover simultaneous attempts. Valid credentials also respect accumulated delay, and successful session creation clears only that account's failure counter.
- Removed the stacked five-attempt login decorator that overwrote the broad 50-per-IP guard. Broad spraying counts remain independent and are not reset by a successful account login. Email case/whitespace and Iranian mobile forms normalize before lookup/counter selection.
- The exception filter now preserves safe retry timing for 429 responses, sets Retry-After and renders the localized countdown with fa/en digits. OTP service limits carry their actual counter expiry through this path instead of returning an unhelpful timing-free error.
- Review: the 74-test auth suite passed, followed by all four focused real HTTP/PostgreSQL regression cases after adding the Persian retry check. They cover normalized identities, concurrent failures, sixth-attempt delay, expiry, account isolation, successful login reset without clearing IP counts, broad spraying rejection, and service-level OTP Retry-After/localization without Redis. API typecheck, contract drift check and diff review passed.
- This checkpoint does not close stacked metadata on other routes, destination-start quotas, device spraying or edge/client behavior. Those remain the next F23 work.

### F23 — Compose route limits and enforce domain quotas

- Repeated rate-limit decorators now retain every rule. The guard supports explicit authenticated-user scope using the middleware-resolved session, never a body/header user ID. Existing ordinary rules remain IP-scoped. Username/contact issuance now applies both user and IP limits.
- Registration enforces ten starts per normalized destination/hour and password recovery five, in the service before account lookup or delivery. Removed misleading destination-named decorators that actually counted IPs and the incorrect registration ten-per-IP/hour rule. Device spraying has its own fifty-per-device/15-minute counter; all critical counters remain PostgreSQL-authoritative.
- Review: all 77 auth checks pass, including actual stacked-rule enforcement, separate users at one IP, body-user spoof rejection, destination limits before challenge creation and independent device rejection. API typecheck passed. The wider suite passed 2,505 checks and exposed three obsolete constructor fixtures; supplying the newly exercised service dependency made all twelve checks in that fixture pass. No real counters or accounts were changed.
- A remaining device-identity defect emerged during review: the browser supplies its public user-agent string as a fingerprint and OTP completion trusts that string. That can share a device counter across unrelated browsers and is guessable trust proof. The next F05/F23 repair replaces this input with a server-issued opaque HttpOnly device cookie; edge/client retry handling remains open.

### F05 / F23 — Replace public browser fingerprints with opaque device proof

- HTTP login ignores client-submitted fingerprints for trust and device quotas. It issues a random 256-bit HttpOnly cookie and hashes that value for device trust. OTP completion trusts that same cookie only after successful verification. The login page no longer sends its public user-agent as a fingerprint.
- Production uses the Secure, host-only __Host-barghsa_device cookie with SameSite=Lax, path=/ and a 30-day maximum age. Development uses an unprefixed local cookie. Production ignores an unprefixed planted cookie; device values are absent from response JSON and inaccessible to browser JavaScript.
- Review: 85 focused auth/cookie checks passed. The controlled mailbox flow proves actual OTP establishes cookie trust, browser-version changes retain it, matching public user agents and submitted fingerprint imitation do not skip OTP, and expiry/revocation require OTP again. Staff still require OTP with a valid trusted cookie. Eleven workspace typechecks, all 113 web checks and the API contract gate passed.
- The broader API run passed 2,507 checks and exposed three old session fixtures relying on submitted fingerprint trust. Those fixtures now seed and send opaque cookies; all three real session tests and the Chromium cross-tab login/refresh/CSRF/logout test pass. The browser check also confirms the device cookie is not available through document.cookie. No production account/trust record was modified.
- Device-management acceptance and remaining client/edge retry behavior still need their separate review; this is not blanket F05/F23 closure.

### F23 / F20 — Localized retry feedback and live auth language

- Login, registration, OTP verification/resend, password recovery/change and activation now use a shared safe Retry-After formatter. It supports seconds/HTTP dates, rejects invalid/unbounded values and formats Persian or English digits. Resend cooldowns use the server duration; failed forms retain their inputs. Forced-password-change handling now reads the nested error code correctly.
- Real English browser checks exposed hardcoded Persian on login/registration/registration verification. Those screens now use the shared locale hook. The hook subscribes to language changes, normalizes regional locale tags and has a server-render fallback. Auth requests send the selected language; resend timers also use its digits.
- Review: all 116 web checks, eleven workspace typechecks and sixteen production-browser flows passed. Eight new browser cases cover fa/en login, registration and recovery rejection plus full resend cooldown expiry. Existing consent, recovery and staff activation flows still pass. A focused hook test proves mounted consumers update without an unrelated input event.
- All 26 route budgets still pass. Actual cold-browser transfers are login 142.02 KB, registration 140.19 KB and recovery 132.99 KB gzip, including shared scripts. CI now includes the new auth retry browser file. No remote CI run is claimed.
- Edge verification continues next. The supplied Caddy file fails to parse in the standard image; the existing NGINX configuration must also be exercised against its required response behavior before edge acceptance is recorded.

### F18 / F23 — Verify the actual pilot proxy and client identity

- Selected the NGINX option permitted by the infrastructure task. Removed the broken Caddy alternative: its empty TLS block fails standard-image parsing, and that image has no rate-limit module. The pilot README records this decision and the exact configuration/operational limits.
- NGINX now emits 429 instead of its default 503 for burst rejection, with consistent fa/en JSON and Retry-After. It preserves basic headers on redirects and rate-limit responses, supports WebSocket upgrades on API paths, and overwrites inbound forwarded-address headers. HSTS is left disabled until the required production TLS/subdomain verification.
- The API trusts only explicit immediate proxy IP addresses from API_TRUSTED_PROXY_IPS; an empty value ignores forwarded addresses. Wildcards, numeric hop counts, hostnames and CIDRs fail configuration validation. Production compose binds app ports to host loopback so the supported pilot entry point is the proxy.
- Review: the committed NGINX config passes syntax validation and actual isolated-container probes for TLS 1.2/1.3, HTTP redirect, web/API routing, 10 MiB rejection, cache/security headers, spoofed forwarded-address overwrite, unbuffered SSE, WebSocket upgrade and fa/en edge quotas. Auth/upload/AI bursts yield 429 and never a fabricated success. No host ports or production certificates were used; cleanup removed all containers and temporary keys. CI includes the repeatable probe.
- Three API checks pass for configuration validation and real HTTP/database behavior with and without trusted forwarding. Separate clients have separate IP counters only through an explicitly trusted proxy; destination-start limits survive changes of forwarded client IP. API typecheck passed.
- Production DNS/certificates/renewal, exact deployed bridge/proxy addresses, HSTS/CSP rollout and commercial HA remain explicit operational acceptance gaps. This checkpoint does not certify the development backing-service compose or deploy the proxy.

### F13 follow-up — Receipt-created approval notices

- Wallet and invoice receipt approval initiation now call the same recipient/notice helper as generic requests. Notices go to currently eligible finance reviewers, excluding the initiator, disabled/unactivated accounts and unrelated support staff. They are bilingual private account notices linked to the approval queue.
- Notices, approval requests, receipt bindings/state and initiation audits share the caller's transaction. Pending-request retries do not emit another notice. Amount formatting uses BigInt and preserves values above JavaScript's safe integer range.
- Review: 73 focused receipt/approval checks passed, followed by 37 checks including the new real HTTP/database case. That case injects notification failure on both receipt paths, proves no approval/binding/notice commits, retries concurrently to one approval/one notice, verifies recipient privacy and preserves 9,007,199,254,740,993 IRR exactly. API typecheck and diff review passed.
- Direct receipt decisions still need their initiator notices unified with generic queue decisions. That follow-up is next; this checkpoint closes initiation notification only.

### F13 / F14 — Transactional notices for direct receipt decisions

- Moved the initiator notice into the shared approval-resolution transaction used by generic queue and direct wallet/invoice receipt decisions. The generic endpoint no longer sends a duplicate. Both approval and rejection preserve bilingual private delivery and the original reason; wording directs staff to the related action for payment status rather than claiming approval itself executes payment.
- Review: 74 focused checks and fourteen real HTTP approval scenarios passed. New failure injections cover approval/rejection on both receipt paths, proving notice failure leaves approval pending, receipt unsettled, balances unchanged and resolution audit absent. Retry completes once; repeating the action does not duplicate the notice.
- The broad API run passed 2,510 checks and exposed five fixture failures: one assumed a fixed SQL call count, and four used a handcrafted invoice schema without the notification center. That financial integration fixture now creates a disposable database from the full production journal and uses real finance roles and notification writes, including generic rejection. All twelve affected resolution/integration checks pass, followed by the eight migrated financial cases with real generic notifications. API typecheck and diff review pass.
- This improves the actual-schema financial matrix but does not certify all 56 F14 service tasks. Remaining matrix cases, operational acceptance and CRM fixes continue.

### F15 — Separate editable profile contacts from verified account credentials

- CRM contact edits now update nullable profile-owned contact fields, never users.email/mobile or other account credentials. Migration 0107 copies the existing displayed contacts into those fields without changing authentication data. The account contact section stays read-only; Persian and English profile contact explanations and accessible input labels distinguish the editable fields.
- The edit transaction locks the current profile before reading old values, rejects archived profiles and writes the profile and scoped before/after audit together. Normalized contacts, clearing, no-op edits and sibling profiles remain independent of account authentication.
- Review: all 82 CRM checks passed, including five actual HTTP/full-production-schema cases replacing seven obsolete mocked account-edit tests. They prove account-row isolation, sibling isolation, validation/permissions, rollback on audit failure and intervening edit/archive races. Fresh, populated-upgrade and repeated migration checks passed with all 28 production migrations. Eleven workspace typechecks passed, followed by the final web typecheck.
- All 116 web checks, 26 route budgets and fourteen production-static-server browser cases passed. Two new fa/en browser cases verify read-only sign-in contacts, profile-contact normalization and preserved input through a failed save/retry. Browser API responses are mocked; the actual database behavior is independently covered by the HTTP tests above.
- Added a read-only operator query for historical CRM account-contact edits. It has not been run against production; old contacts are not automatically treated as verified or reverted, and current profile ownership may differ from historical ownership. No provider exists; automatic identity verification remains unavailable. Archiving/business races and remaining CRM acceptance continue separately.

### F15 — Preserve correction resolution through profile archival

- Archival checks for Open/Under Review identity corrections while holding the same profile lock used by case creation and review. A concurrent correction cannot be missed. The localized archive explanation includes this blocker.
- Existing cases on historically archived profiles can be rejected by an independent reviewer with a reason. Approval and continued review remain blocked; rejection cannot modify identity data and its audit commits atomically with closure. Invalid legacy field names cannot prevent rejection, while approval still requires an allowed identity field and valid sealed evidence.
- Review: all 86 CRM tests and API typecheck pass. New actual HTTP/database cases cover both nonterminal statuses, rejection then archival, archived-case approval denial, creator denial, injected audit failure/rollback, terminal retry, and both correction-versus-archive lock orderings.
- This closes the correction/archive interaction only. Pending wallet operations and other financial/archive concurrency paths remain under review; no production records were changed.

### F16 / F22 — Reject malformed ticket IDs and list inputs

- Every customer/staff ticket detail, comment, status and assignment route validates its UUID before querying PostgreSQL. A valid absent ID still returns 404.
- Shared list parsing rejects fractional/nonfinite/empty/repeated pagination, invalid filters and repeated search values. Page/limit are bounded positive integers; the service repeats numeric validation for non-HTTP callers, preventing fractional/unsafe offsets. Default pagination remains 1/20, with maximum page 100000 and limit 100.
- Review: all 43 ticket checks and API typecheck pass. Actual HTTP cases exercise all nine affected detail/action routes, customer/staff invalid list inputs, defaults and the largest allowed empty page. The generated OpenAPI contract remains unchanged and passes its drift gate. Existing ownership, assignment, private comments, attachments and notification regressions remain passing.
- Remaining ticket cleanup concerns, including abandoned object uploads and wider browser acceptance, are separate from this input-validation repair.

### F06 / F20 — Localized verification guidance without a provider

- The mounted verification banner now follows the shared language, including live fa/en changes and request language. Error text renders in the current language. When automatic verification is unavailable, it explains the next action and links to support without offering simulated approval.
- Review: nine production-browser checks pass, including fa/en unavailable-provider guidance, keyboard dismissal, support destination and live language switching, plus the CRM contact/action regressions after the latest dictionary changes. Web typecheck and all 26 route budgets pass. CI includes the new verification-banner browser file.
- The three existing actual HTTP verification-mode cases already prove canAutoVerify remains false, direct automatic attempts return 503 and no profile approval is manufactured. No provider adapter or real-provider acceptance is claimed. Commercial-order enforcement remains part of its separate consumer task.

### F07 — Switch profile context without a full-page reload

- A server-confirmed profile switch now advances a shared context revision. The root remounts the scoped application tree, clearing old page data, notification state, dialogs and drafts while preserving the document and current route. The required initial selection dialog uses the same path. The current SPA stores these views in component state; no separate query cache/loaders were found to invalidate.
- A same-origin BroadcastChannel refreshes other open tabs after the server-confirmed change. Messages contain no account/profile data; each tab re-reads its authorized server context. Listener/channel cleanup avoids accumulating subscriptions. Failed or mismatched switch responses do not publish a new context.
- Review: six focused production-browser cases pass, including fa/en switching with a document sentinel and zero navigation requests, failed-switch selection retention, required-dialog selection, cross-tab refresh, and late old-profile dashboard/notification responses arriving after new data. The old balance/count cannot overwrite the new view. Three verification-banner browser checks also pass, along with all 116 web tests, web typecheck and all 26 route budgets.
- Browser context responses are controlled fixtures; the previously recorded real HTTP ownership/agent-context tests provide server authorization evidence. This checkpoint does not complete unrelated agent consumer pages or the remaining F07 acceptance matrix.

### F13 / F14 / F15 — Serialize wallet top-up initiation with archival

- Zero balance is no longer sufficient for archival when the wallet has a Pending transaction. Online and bank-receipt initiation lock and check the profile inside their transaction, before locking the wallet. If archival commits first, initiation fails before gateway creation, receipt sealing or ledger insertion. If initiation holds the profile first, archive waits and then sees the pending payment.
- Both top-up integration suites now use the full production migration journal rather than handcrafted profile/wallet/storage/config tables. Existing idempotency, attachment immutability, gateway recovery and configuration-limit scenarios pass against that schema.
- Review: 31 migrated integration checks pass, including six new scenarios combining actual CRM HTTP archival with real top-up services and a controlled payment gateway. They prove both race orderings for both channels, pending-payment blocking, rejection then archival, and no new top-up on an archived target. API typecheck and diff review pass. The full API suite passes all 2,525 tests in 199 files.
- The archive explanation includes pending payments in fa/en. This checkpoint protects top-up initiation and outstanding pending wallet transactions; it does not certify every direct finance primitive, future contract/order consumer or historical archive reconciliation. No real payments or production records were touched.

### F03 — Serialize session creation at the account boundary

- Session creation always locks and rechecks the account, even for standalone callers that omit an expected authentication version. Locking existing session rows alone cannot protect an empty set or the count snapshot against new inserts. Disabled/missing accounts cannot receive a session.
- The cap counts currently usable sessions, excluding idle-expired entries. When historical excess already exists, creation revokes enough of the oldest sessions to return to the limit, using session ID as a deterministic tie-breaker. Eviction, session insertion and refresh credential creation remain one transaction.
- Review: all 155 session/auth checks and API typecheck pass. Four new full-schema scenarios prove 65 concurrent creations leave exactly 50 usable sessions, pre-existing excess repairs deterministically, an intervening account disable wins, and refresh-insert failure rolls back both the new session and cap eviction.
- Review also found a separate unwired rotation helper whose refresh-token insert has mismatched placeholders/values; current login/registration create sessions directly. That helper and its real-database behavior are the next bounded F03 repair, not included in this checkpoint.

### F03 — Prove rotation and enforce the idle cutoff

- Fixed the unused rotation helper's refresh-token INSERT, whose eight placeholders previously received seven values. A rotated credential now starts unconsumed, with a new session ID/CSRF token; prior credentials are consumed. Rotation locks the account before the session, rejects disabled/expired targets and remains serialized with session creation.
- Refresh now respects the required idle timeout instead of reviving an idle-expired session. Both its CSRF precheck and credential redemption reject expiry without consuming the token or extending the deadline. This corrects the earlier F03 "idle recovery" behavior/evidence recorded above: the canonical task specifies a 30-minute idle timeout, so a fresh login is required after that cutoff.
- Review: all 159 session/auth checks passed after the rotation repair. Adding idle enforcement passed 159 checks and exposed the older HTTP test intentionally expecting idle recovery; its corrected behavior plus the full-schema lifecycle suite now pass all twelve focused cases. API typecheck passes. New actual database cases cover usable rotated credentials, old-token family revocation, CSRF binding, disabled/expired rejection, rollback on credential failure, concurrent creation/rotation at the cap and unchanged credentials after idle rejection.
- The helper remains unwired into some authentication events, as documented in its source. This repair certifies its tested behavior, not complete wiring or all concurrent refresh/revocation scenarios.

### F19 — Make formatting an actual enforced check

- Installed pinned Prettier 3.9.6 and the canonical single-quote/es5-trailing-comma/100-column/2-space/semicolon/LF configuration. Root format:check and format:write now run the formatter across maintained repository files, and CI runs the check. Generated route/API/schema artifacts and canonical kanban/audit records retain their owning generator or evidence formatting.
- The first check correctly failed on 1,074 files. Applied the canonical format and repeated it to reach a stable passing check. Compared emitted JavaScript structure for 1,037 changed JS/TS files: after accounting for optional empty statements, equivalent property quoting and adjacent JSX text concatenation, only the separately explained test timeout differs. No application behavior change was identified in the formatting pass.
- The full workspace run exposed a five-second timeout in the migration rehearsal that creates a database, installs the prior journal, checks a failed upgrade, corrects historical data and retries/repeats. It now has a bounded 30-second timeout; all assertions and cleanup remain. This is the only deliberate test-behavior change in this formatting checkpoint.
- Review: the full build and eleven workspace typechecks pass. All eleven workspace test tasks pass (seven reused successful post-format cached results on the final run); actual results include 2,534 API, 562 database and 310 worker tests. Sixty-eight production-browser flows pass across auth/profile/verification, CRM, tickets, inbox, approval queue, teams and targets. Formatting, generated OpenAPI, all 26 bundle budgets, suppressed-error scan and backlog validation also pass (1,355 tasks, 116 traceability entries).
- Lint, strict typed lint policy, changed-code/critical coverage and the other F19 quality requirements remain separate unfinished work. This checkpoint closes the no-op formatter, not the whole quality-gate group. No remote CI execution is claimed.

### F19/F20 — Enforce lint and repair confirmed form accessibility defects

- Added pinned shared ESLint 9 configuration and a real repository-wide lint command, enforced in CI. It checks recommended JavaScript/TypeScript rules, React hooks placement, React and JSX accessibility. Tests permit intentionally malformed `any` fixtures; production code does not gain a blanket exception. Removed obsolete suppression directives and unused bindings while preserving setup/call side effects. Third-party query boundaries use `unknown` or the driver's row type; this is not a claim of full strict typed lint coverage.
- Lint exposed an unsafe wallet fallback: PostgreSQL bigint strings were subtracted as JavaScript numbers. Both operands now convert to bigint before arithmetic. A regression proves exact subtraction above Number.MAX_SAFE_INTEGER.
- Connected labels to native controls in branding, geography, storage, TOS and address forms. Repeated color pickers use unique React IDs and both color/text inputs have names. Verification modes use native radio change/label behavior. Address selection has explicit associations. Removed the input addon's extra pointer-only focus action; its actual input remains directly focusable. Corrected CRM tablist semantics.
- TOS detail and address forms now use the shared dialog for naming, focus containment, Escape and focus restoration. Existing receipt/reminder/security dialogs retain their tested keyboard handling with narrowly explained lint exceptions. Removed a redundant reminder form propagation handler. Custom-component autofocus remains allowed for intentional password/OTP entry.
- Review: lint, formatting, all eleven workspace typecheck tasks, build, OpenAPI drift, all 26 route budgets and suppressed-error scan pass. Deliberately invalid production `any`, conditional hooks and unnamed images fail the new gate. All eleven workspace test tasks pass, including API 2,535, database 562 and worker 310 tests. An initial parallel attempt failed during local worker container startup; sequential rerun completed. Sixteen production-browser checks pass, including four new dialog/label/keyboard checks and existing CRM/profile scenarios. New browser checks are included in CI.
- Strict type-aware/stylistic lint, additional framework-specific rules, changed-code/critical-domain coverage and remaining F19/F20 requirements are still open. No remote CI run or complete screen-reader/manual accessibility certification is claimed.

### F03/F07/F15 — Serialize refresh/revocation and keep CRM changes atomic

- Refresh now locks the account before its session and credential, re-reading account eligibility and token state after waiting. Single-session, whole-account and family revocation use the same account boundary as creation/rotation. Ownership transfer locks both affected accounts in sorted order before revoking credentials. This removes the token/session lock inversion and prevents refresh from racing past a disabled account.
- Signing out other sessions now preserves the excluded session's refresh credential as well as its session row. Previously its refresh token was consumed anyway, causing a subsequent refresh to revoke the supposedly retained family.
- Whole-account revocation can participate in a caller-owned transaction. CRM force-password-change and expire-session actions use it so credential changes and audit records commit or roll back together, without opening a second connection that waits on the caller's account lock. Success logging remains with the transaction owner.
- Rotation checks actual time after lock waits rather than relying on the transaction-start clock, and starts new credential deadlines after obtaining the locks.
- Review: eight full-schema controlled races pass for both orderings of refresh against single/all/family revocation and rotation. Additional database cases prove excluded-session refresh, disabled-account recheck, idle cutoff during a lock wait, and audit-failure rollback plus successful retry for both CRM actions. The full API suite passed 2,547 tests in 200 files before the final idle-wait assertion; the final two-file session run passes all 44 tests. API build/typecheck, lint, formatting and diff review pass. No production sessions were touched.
- This checkpoint covers these lifecycle operations and their current callers. Remaining authentication acceptance requirements and full task-level closure are still open.

### F08/F20 — Validate selected geography and protect dependent address fields

- Newly selected address geography must name an active city belonging to the selected active province. The shared check runs in the address/onboarding transaction and holds geography locks until commit. Address updates re-read the current pair under the profile/address lock before combining partial changes; text-only edits preserve retired historical geography.
- Address create/update endpoints now validate runtime body types, UUIDs, nonblank bounded text and postal codes. Address route IDs are validated before database access. Malformed objects and numeric/array field values return 400 rather than reaching string methods or PostgreSQL as server errors.
- Saved-address reads include Persian/English province and city names, so rendering does not depend on whichever city list happens to be open in the form. The form clears the selected city when province changes, cancels stale requests, blocks selection/save while loading, and offers localized failure/retry behavior. Unknown historical geography has a localized fallback instead of exposing raw IDs.
- Review: all 132 profile tests across eleven files pass, including actual HTTP checks for mismatched/inactive pairs, partial updates, concurrent deactivation, malformed bodies/route IDs, named reads, permissions, main-address races and unchanged order snapshots. All eleven workspace typecheck tasks and build pass. Six production-browser checks pass, including fa/en slow-response, retry and saved-name scenarios. Lint, formatting, OpenAPI drift, all 26 route budgets and diff review pass.
- Added `audit/address-geography-review.sql` for read-only review of historical mismatches. It has not been run against production and does not rewrite saved addresses or order snapshots. Broader onboarding identity/state races and complete F20 acceptance remain separate work.

### F07/F15 — Recheck profile write authority inside the transaction

- Individual/legal onboarding updates now atomically require the matching profile type, current ownership, DRAFT state and an unarchived profile. Two submissions that both read the same draft cannot both write or create a second main address.
- Profile settings lock and recheck ownership, archival and verification before writing. Verified identity changes require the documented exception for staff editing their own individual profile; the service reads the current account instead of trusting a pre-transaction controller decision. All profile/address changes and the self-edit audit commit together.
- Runtime profile payload validation rejects malformed field types, empty edits and partial address bundles instead of silently ignoring part of the request. A complete address edit preserves history by adding a new address.
- Review: six new real HTTP scenarios cover concurrent verification/archival, the own-staff exception, audit rollback, malformed/partial input and controlled duplicate individual/legal submissions. All 138 profile tests and the full API suite (2,557 tests in 201 files) pass. API build/typecheck, lint, formatting, OpenAPI drift and diff review pass.
- Correction to the preceding F08 checkpoint: its last API typecheck emitted optional-property and test JSON-typing errors after the progress log was read. Those three compile errors are corrected here; the completed API typecheck now passes. Earlier runtime/browser results were unaffected.
- Review identified a separate incomplete-onboarding bypass in the finalization endpoint and draft/suspended commercial eligibility when verification is disabled. Those are the next bounded repair; this checkpoint does not claim they are fixed or certify every remaining profile requirement.

### F06/F07 — Reject empty draft finalization

- Finalization rechecks and locks the current owned, unarchived profile. A draft needs its stored identity record and main address with valid postal/geography data before changing status. A concurrent verification/state change is preserved. A successful draft transition and its audit commit together; repeating completion does not duplicate the audit.
- Updated the canonical API/manual/disabled verification scenario to reject an empty draft and submit actual individual form data before completion. This supersedes its earlier test path that completed an empty profile. No mode manufactures provider approval.
- The commercial eligibility helper rejects draft and suspended profiles even when verification is disabled. Source review confirmed that the current general orders endpoint creates DRAFT orders and does not mount this guard; this change does not claim enforcement on a nonexistent commercial submission endpoint.
- Review: all 143 profile tests in twelve files, API build/typecheck, repository lint, edited-file formatting and diff checks pass. New actual HTTP cases prove empty individual/legal rejection, completed-draft transition/idempotency and preservation of a concurrent verification. Two unit cases cover disabled-verification eligibility for draft/suspended profiles.
- Added a read-only historical incomplete-profile review query. No production records were inspected or downgraded. Required legal-onboarding field completeness, remaining lifecycle/default-selection races and future commercial callers remain separate work.

### F07/F20 — Require complete legal details and restore onboarding child routes

- Legal saves require a listed company type and full official address. Runtime validation rejects malformed fields, invalid dates/email, invalid UUID geography and missing required values before writes. Geography and company lookups are locked through commit. Company types currently have no active/inactive state; this checks existence, not a nonexistent status flag.
- Legacy legal drafts cannot bypass company/official-address requirements through the separate completion endpoint. The historical review query now identifies missing legal details without changing production records.
- Browser review found that the onboarding parent always rendered the type picker and never rendered either child form. It now renders an outlet, with the picker in its index route. The picker and legal form use the live locale. New required-field messages are in both dictionaries; changing province clears the city and stale options.
- Validation: the profile suite passed 144 tests across twelve files before the final legacy-completion test; the rebuilt actual HTTP suite then passed all eleven cases, including that additional regression. Eight production-browser checks pass, including complete/incomplete legal submissions in Persian and English. Repository build, all eleven typecheck tasks, lint, OpenAPI contract, 26 route budgets and diff review pass. Initial browser failure exposed the parent-route defect, which was repaired; an import-extension typecheck failure was also corrected before completion.
- This is partial F07/F20 coverage. Full representative identity/address, durable draft autosave, real document attachment, and remaining lifecycle/default concurrency still require repair. No provider, deployment, remote state, or historical production data was changed.

### F07 — Serialize default-profile selection and audit draft creation

- Profile creation and draft completion lock the owning account before checking whether a default exists. Completion keeps the existing profile-before-account lock order used by selection and ownership changes. Concurrent requests cannot both claim the absent default and fail with a unique-index error.
- Draft creation and its `profile_draft_created` audit commit together. An audit failure rolls back the new draft.
- Review: forty service tests and fourteen actual HTTP cases pass. Controlled account-lock tests release two competing creations, and creation competing with completion; both requests succeed and exactly one default remains. Audit-failure rollback also passes. API build/typecheck, repository lint, formatting and diff review pass. No migration or historical default rewrite was required.

### F07/F20 — Validate individual onboarding and exercise the actual picker flow

- Start and individual-save endpoints validate runtime bodies before using string methods. Individual required text is trimmed/bounded, geography IDs are UUIDs, and all three profile-specific onboarding route IDs are validated. Malformed objects, numeric fields and invalid IDs produce 400 without modifying the draft.
- Individual onboarding uses the live locale. Its geography fetches reject unsuccessful responses and province changes clear stale city values/options. Both Persian and English browser tests start at the type picker, navigate to the individual child form, and submit the required fields.
- Review: eighteen focused HTTP tests, ten production-browser tests, both application builds, all eleven typecheck tasks, repository lint, formatting, OpenAPI drift and diff checks pass. The preceding default-selection checkpoint also passed the broader API suite: 2,567 tests across 201 files, before this bounded change. No production state was touched.

### F07 — Collect the legal representative's required identity and address

- New legal onboarding now requires representative first/last name, validated national ID, province/city, full address and postal code, with optional honorific. Both locale dictionaries supply the new labels. The company remains the main address; the representative address is saved separately, and its original values remain on the legal record.
- Migration 0108 adds nullable representative fields and geography foreign keys. Existing records remain intact with unknown values; no account details are guessed or copied into identity fields. The completion endpoint also requires these details for legacy drafts. One person may represent multiple companies without colliding with the individual-profile identity index.
- Legal save and its audit are atomic. The actual HTTP regression checks missing/invalid representative data, two saved addresses, detail readback, the same representative on two companies, and complete rollback on audit failure. The historical review query now lists missing representative details after migration 0108.
- Review: all profile tests, all 562 database tests, ten production-browser tests, repository build/typecheck/lint, edited-file formatting, OpenAPI drift, 26 route budgets and diff checks pass. The baseline test covers fresh migration, repeat migration, and the simulated old-schema upgrade; its old-schema setup was updated to remove the newly introduced columns before replay. Draft autosave and document attachment remain separate unfinished requirements.

### F07 — Persist legal onboarding drafts with version checks

- Migration 0109 adds a profile-owned draft record with bounded JSON data, positive version and timestamps. Draft requests accept only known bounded string fields; incomplete identity/date/geography values remain editable until full submission validation.
- Read/write endpoints require the current owner, a legal DRAFT profile, and no archival. Writes recheck these conditions under the profile lock, compare the expected version and commit the draft plus audit together. Competing writers cannot overwrite each other silently.
- Final legal submission can bind to a draft version and deletes the draft only when the legal save succeeds. Failed validation, stale versions and failed audits preserve resumable data.
- Review: thirty-two focused API tests and the fresh/legacy migration baseline pass. Real HTTP cases cover partial readback, unknown/oversized/malformed fields, competing saves, audit rollback, archival/completion/ownership changes during a lock wait, stale final submission and cleanup. API build, workspace typecheck, repository lint, formatting and diff checks pass. The generated API contract includes the draft body schema. Browser autosave wiring is the next step; these endpoints alone do not complete autosave acceptance.

### F07/F20 — Wire durable draft autosave into the legal form

- The form loads its saved draft before enabling edits, restores both geography selections, and saves after a pause or leaving a section. Saves are serialized, so an edit made during an earlier request is persisted afterward. The status distinguishes unsaved changes, saving, saved, failure and conflict in both languages.
- Submission and the Back action flush pending changes. Final submission includes the saved draft version; conflicts stop automatic writes and offer an explicit reload of the saved draft. Save failures retain local fields and offer retry. A page unload with unsaved edits invokes the browser's existing unsaved-change protection.
- Review: fourteen production-browser checks pass, including delayed request ordering, retry after 503, reload/readback, preserved province/city selections, stale-version blocking and failed initial load. The initial message assertions were tightened by separating status text from its action button. All 116 web tests, workspace build/typecheck, repository lint, formatting, 26 route budgets and diff review pass. Document uploads are still a placeholder and are the next bounded repair.

### F07/F16 — Upload and attach legal registration documents

- Replaced the filename-only picker with the existing presign/upload/verify/record flow, bound to the profile and `legal_profile_document` purpose. Files appear as uploaded only after recording succeeds; errors retain a retry path. Up to five PDF/image documents are supported. Uploaded keys/names survive draft reload, and removal updates the draft.
- Legal submission verifies uploader, profile, purpose, active verified record, trusted size and detected content, then saves immutable copies and their keys with the legal record. The existing ticket attachment implementation now shares this sealing service, preserving its ticket-specific purpose/prefix. Migration 0110 adds an empty document list to older legal records.
- Profile settings show owner-authorized document downloads and can refresh the five-minute links. Uploads block submission/Back while in flight, and final save still binds to the draft version. Oversized draft payloads are rejected before the database size constraint.
- Review: 75 existing profile/ticket tests, the dedicated legal-document HTTP scenario and 22 final focused HTTP tests pass; sixteen production-browser tests, all 116 web tests, the fresh/legacy migration baseline, build/typecheck/lint, formatting, OpenAPI drift and 26 route budgets pass. The local object-storage fixture proves rejection of another uploader/purpose/profile, changed bytes, audit rollback and an unchanged attached copy after replacing the original upload. These tests do not certify live S3 credentials or deployment.
- F16 orphan-object cleanup remains open: a storage copy made before a failed database transaction can remain unreferenced, as in the existing ticket flow. No unsafe immediate deletion was added after uncertain commits. Completion-page finalization errors and arbitrary fallback profile selection are the next repair.

### F07/F20 — Finalize the exact selected profile before showing success

- The completion page no longer ignores failed finalization or selects the first ACTIVE/DRAFT profile from a list. It requires the explicit profile ID, waits for a successful response with that same ID and an allowed completed status, then enables dashboard/add-another actions.
- Missing selection and failed/mismatched responses remain on an error state with a clear recovery action. Retry repeats the same profile request. The page uses the live locale and shows its success animation only after confirmation, with reduced-motion support.
- Review: nineteen production-browser tests pass, including failed completion/retry in both languages, no guessed profile when the ID is absent, mismatched-success rejection, and dashboard navigation without another completion request. Workspace build/typecheck, repository lint, formatting, 26 route budgets and diff review pass.

### F07/F08/F20 — Save the current profile address and expose permitted identity edits

- Settings now use named province/city selectors, clear the dependent city on province changes, preserve saved names when geography is unavailable, and offer retry after fetch failures. Saves send only changed fields.
- Changed addresses become main in the same transaction while retaining historical rows. Repeating unchanged values adds no duplicate. An audit failure rolls back both the new row and the old main flag. The official company address snapshot remains separate from subsequent contact-address changes.
- The detail response advertises the existing own-staff individual identity exception; write authorization is still checked by the server. Company profiles retain their editable title and show representative details without unrelated individual identity inputs. Pending verification has a localized status badge.
- Review: 157 profile tests and 21 production-browser tests pass, including real HTTP rollback/idempotency and both-language settings readback, changed-field payloads, dependent city reset and verified identity permissions. Workspace build/typecheck, repository lint, OpenAPI drift, 26 route budgets and diff checks pass. Legal identity editing before verification remains a separate unfinished requirement.

### F07/F08 — Complete drafts that already have a main address

- Individual and legal onboarding demote preliminary main addresses under the existing profile lock before inserting the submitted main address. Historical address contents remain intact, and the unique main-address rule remains enforced.
- Individual onboarding now records its successful save in the same transaction, matching legal onboarding. Failed audit writes restore the original draft, address contents and main flag.
- Review: all 159 profile tests pass. New actual HTTP cases exercise both profile types with an existing main address, forced audit failure, retry, exactly one final main address and one committed audit. API build, workspace typecheck, repository lint, formatting and diff review pass.

### F07 — Permit company identity edits before verification

- Profile settings allow legal name and national identifier changes before verification and show locked fields with explanations afterward. Requests send only changed values. The API validates legal identity separately from individual fields and documents the runtime request schema in OpenAPI.
- The current owner, profile type, archival and verification status are checked under the profile lock. Legal changes and their audit commit together; staff/admin accounts do not receive the individual-only exception for verified companies. Existing correction review also compares its recorded original value against the locked current identity, so a later review cannot silently overwrite these edits.
- Review: all 162 profile tests and 23 production-browser tests pass. New real HTTP cases cover malformed values, wrong profile type, audit rollback, verified staff denial, and verification/archival winning the lock before a write. Both-language browser checks cover edit/readback and verified locking. Workspace build/typecheck, repository lint, edited-file formatting, generated API contract, 26 route budgets and diff checks pass.

### F02/F07/F15 — Serialize order creation with profile archival

- Order creation holds the owned, unarchived profile through commit, so archival either waits and sees the new order or wins first and prevents creation. It also locks the selected active product while creating the order.
- Real schema review exposed a second defect: the product query used nonexistent `is_active` instead of the canonical `status`. It now queries `status='active'`.
- Review: 38 order and profile-finance tests pass. New actual HTTP cases use a fully migrated disposable database and cover ordinary order creation, archive-first rejection with no inserted order, and order-first archival blocking. The initial fixture incorrectly assumed migrations seed products; it now explicitly seeds an allowed system product, matching production's separate seed step. API build, workspace typecheck, repository lint, formatting and diff checks pass. This closes the draft-order creation race, not every invoice/contract creation path.

### F07/F08/F19 — Validate order requests and address geography

- Order creation validates runtime body types, UUIDs, supported order types, bounded address text, postal codes and optional gift codes before service calls. Detail/cancel route IDs also reject malformed UUIDs. The committed OpenAPI request schema comes from the same validator.
- Creation validates and locks an active city belonging to the active selected province inside the order transaction. Invalid geography cannot create an order or consume a gift-code redemption. Historical snapshots remain copied values.
- Review: 39 focused order/profile-finance tests pass, including actual HTTP malformed bodies, numeric values, invalid IDs, nonexistent/mismatched/inactive geography, no inserted records on rejection and successful retry. A controller unit assertion was updated to expect intentional gift-code trimming. API build, workspace typecheck, repository lint, formatting, OpenAPI drift and diff review pass.

### F07/F15 — Authorize orders through current profile ownership and agent roles

- Order list/detail/create/cancel now use the current canonical profile owner or a current Manager membership on a legal profile. The creator remains recorded on the order as history, but does not retain authority after ownership transfer. Finance/Legal-only roles and stale Owner membership rows do not grant order access; multiple roles remain additive.
- Mutations hold the profile and relevant membership before the order lock, preserving archival/role-change ordering. Cancellation checks the locked current state, retains idempotent cancellation, and still releases a gift-code slot in the same transaction. Creation/cancellation now include actor-bound audits in their transactions.
- Review: 44 focused order/profile-finance tests pass, including actual HTTP owner/Manager access, other-role denial, ownership transfer, role removal winning a lock wait, repeated cancellation and forced audit rollback. Existing gift-code release/rollback unit checks pass. API build, workspace typecheck, repository lint, formatting and diff review pass. The preceding checkpoint passed the full API suite, 2,585 tests across 202 files. Other profile-scoped consumers remain under review.

### F17 — Execute ordered staff-team fallback priorities

- Assignment rules retain the existing primary-team shape and optionally add up to nine ordered alternatives, each with its own strategy. Invalid/duplicate teams, missing primary teams and malformed alternatives are rejected. UUID casing is normalized, and corrupt stored rules fall back to manual assignment.
- Configuration verifies all referenced teams, preserves versioned writes and audits, and the engine tries alternatives in priority order. Missing/inactive teams, unmatched expertise and no eligible members fall through. Only the selected round-robin cursor advances, and the audit records its priority index.
- Selection locks all candidate teams and members in stable order before applying priority, preventing reversed fallback lists from reversing lock order.
- Review: 44 API and 21 shared-contract tests pass, including actual HTTP fallback/manual behavior, configuration readback, validation of every referenced team, cursor behavior and twelve concurrent choices with reversed priorities and shared members. Workspace build/typecheck, repository lint, formatting, OpenAPI drift and diff review pass. Admin priority controls are the next bounded step; consultations still have no implemented assignment caller.

### F17/F20 — Edit and reorder assignment priorities in the admin UI

- Added labeled fallback team/strategy controls with keyboard-operable move-up, move-down and removal actions. Duplicate teams are unavailable for selection. The confirmation describes the complete ordered sequence and its final manual fallback. Selecting manual assignment clears alternatives.
- Both dictionaries explain fallback behavior. Failed writes retain the proposed sequence for retry, successful writes reload persisted values, and further edits clear the saved indicator.
- Review: nine production-browser tests pass, including both-language priority reordering, confirmation, failed-save retry, reload persistence and manual reset, plus existing team/response-target flows through the migrated API and real local database. All 116 web tests, workspace build/typecheck, repository lint, formatting, 26 route budgets and diff review pass. Priority controls close the specific earlier priority-editor gap; consultation assignment still depends on its unbuilt domain, and other F17 screens remain open.

### F02/F05 — Reserve primary and verified secondary login identifiers together

- Migration 0111 introduces one unique destination namespace for primary usernames and explicitly proven secondary contacts. It imports existing primary usernames only. Historical email/mobile values do not become verified credentials. A read-only preflight query identifies normalized username conflicts and legacy secondary fields; it has not been run against production.
- Database triggers reserve primary usernames on all account creation/change paths, reject a destination owned by another account, bind secondary identifiers to current contact values, and remove stale aliases when those values change. Promoting the same account's secondary identifier to its primary username is supported.
- Review: all 564 database tests pass, including fresh/repeat/legacy migration, explicit proof requirements, contact binding, case-insensitive collision rejection, rollback after a conflicting rename, promotion, and a competing primary/secondary reservation. Nineteen existing authentication HTTP tests pass against the new schema. Database build, workspace typecheck, repository lint, formatting and diff review pass. This is the database foundation; OTP completion, login and UI wiring are the next step.

### F05 — Authenticate through proven secondary contacts

- Contact OTP completion now grants the login identifier in the same transaction as consumption, contact changes and audit. Legacy secondary text can be verified, but cannot authenticate or request account recovery until proof exists. Primary/secondary collisions return a conflict without consuming the code or retaining partial changes.
- Login and password recovery resolve the shared identifier registry. Aliases share the current account's failed-password counter, and successful login OTP clears it. Startup waits for the shared dummy password hash. Account reads expose proof flags; registration and username-change availability checks include aliases.
- Review: all 84 authentication tests pass, followed by five focused HTTP cases including a new secondary-mobile case. Cases cover legacy denial, both identifiers, recovery binding, collision rollback, audit rollback, removal after contact changes and shared counters. Initial tests hit the intentional one-minute OTP cooldown; fixtures now simulate the elapsed cooldown without changing production limits. API build, workspace typecheck, repository lint, formatting, OpenAPI drift and diff review pass. Settings proof labels and verification controls remain the next step.

### F05/F20 — Show contact proof and allow legacy-contact verification

- Username settings now show verified/unverified status and offer verification for saved but unproven email/mobile values. The form prefills the saved value, explains its login/recovery use, and prevents switching or cancelling a contact request while it is being sent or saved.
- Both language dictionaries include the new states and actions. Failed verification keeps the code for retry; success reloads authoritative proof flags and removes the action.
- Review: six production-browser tests pass, covering both-language email/mobile verification, failed-code retry, persisted reload and the existing two-code username-change flow. Workspace build/typecheck, repository lint, formatting, 26 route budgets and diff review pass.

### F04/F17 — Prepare current staff-management permissions and stable list reads

- Added an authenticated capability response for the staff screen, derived from current permissions on every request. It reports list, creation, role-edit and disable access independently.
- Staff pagination uses a unique secondary sort key for equal creation timestamps. Staff creation checks the shared login namespace before generating credentials, and OpenAPI now documents named role IDs rather than incorrectly requiring UUIDs.
- Review: 45 staff/service tests pass, including actual HTTP anonymous denial, administrator/no-role access, role addition/removal changing capabilities within the same session, secondary-contact collision and absence of temporary credentials from list readback. API build, workspace typecheck, repository lint, formatting and diff review pass; the generated contract is updated. The staff screen is the next step.

### F04/F17/F20 — Replace the staff-user dashboard placeholder

- `/admin/users` now lists staff names, identifiers, role badges, status and last login with pagination. Independent current capabilities control creation, role editing and disabling. Disabled accounts have no disable action; the current user cannot accidentally disable their own account from the list.
- Creation offers named roles and activation email or a one-time temporary password. Passwords remain only in component memory and disappear on dismissal/navigation. Email results truthfully say queued. Role changes include a reason and confirmation of the proposed roles; disabling explains session revocation. Sensitive-action retries use the existing password-confirmation dialog and preserve the captured request.
- New screen content and predefined role names/descriptions are localized. Both-language browser cases verify failed reads, password rejection, failed save retry and permission removal hiding controls. Six further browser cases use the actual migrated API, including staff creation/role updates/disabling and existing team/target flows. All eight pass; the final confirmation improvement passes the two focused browser cases again. All 116 web tests, workspace build/typecheck, repository lint, formatting, 26 route budgets and diff review pass.
- This repairs the list/create/role/disable UI for T-10.01.01, T-05.03.01 and T-05.03.02. Permission-audit filtering and pending activation resend controls remain separate follow-up steps; no parent acceptance certification is claimed here.

### F17/F20 — Add staff permission history and repair calendar keyboard focus

- Staff management now exposes all-user and per-user permission timelines showing added/removed roles, actor, timestamp and reason. Date filters cover complete browser-local days and explicitly label that timezone. Pagination, loading failures, retry and clearing filters preserve the selected user; obsolete responses are cancelled.
- Calendar filters use Gregorian or Jalali grids according to the live locale. A keyboard regression exposed a missing day-button ref: arrow navigation changed calendar state without moving DOM focus, so Enter could select the old day. The shared calendar now connects the focus ref.
- Review: six real-API browser cases pass, including persisted role changes rendered with their actor/reason in both languages. Four focused browser cases pass after the keyboard fix, covering permission removal, failures/retry, pagination, full-day query bounds, Nowruz-day selection, keyboard movement and rejection of a reversed range. Workspace build/typecheck, lint, formatting, 26 route budgets and diff review pass. The UI package has no unit test files; its empty test command is not counted as evidence. Saved-account timezone integration and broader calendar accessibility remain in F20.

### F05/F17/F23 — Expose pending activation without exposing credentials

- Staff list responses now include a pending-activation flag and link expiry, never the token/hash. Successful activation clears the displayed pending state. Resending during the one-minute cooldown now supplies a measured Retry-After value through the existing exception filter.
- Review: 61 staff and delivery tests pass. The real controlled-mailbox test reads the pending list state, checks cooldown headers, reissues and delivers the replacement link, rejects the old link, completes the new activation and verifies cleared status plus refusal to resend afterward. API build, workspace typecheck, lint, formatting and diff review pass. Resend UI is the next bounded step.

### F05/F17/F23 — Reissue pending staff activation from the admin screen

- Staff rows show pending activation and the link expiry. An authorized creator can confirm reissue for the displayed email; the result reports queued delivery. Activated/disabled accounts do not offer the action.
- The shared action dialog honors Retry-After on actions and password verification, shows a localized countdown, and prevents early resubmission while retaining the same target. No activation token reaches the screen.
- Review: all fourteen production-browser checks pass, including actual migrated-API reissue of expired accounts in both languages, plus cooldown/retry behavior with a controlled response. All 116 web tests, workspace build/typecheck, lint, formatting, 26 route budgets and diff review pass. Backend controlled-mailbox delivery and stale-link rejection passed in the preceding 61-test checkpoint. These results establish the local workflow; production delivery credentials and operations remain unverified.

### F04 — Recheck staff authority inside account mutations

- Staff creation, role replacement, disabling and activation reissue now acquire actor/target account locks in a consistent order and recheck current actor permissions inside the transaction. Disabled or unactivated actors cannot proceed. Role-derived grants are held through commit, including their membership/permission rows.
- Review: 70 focused tests pass. Eight actual HTTP races remove the actor's role or disable the actor after the request guard but before the transaction acquires its lock; every operation returns 403 without account, role, audit or delivery changes. A concurrent two-administrator role-removal case yields one successful change and one denial without deadlock. Existing isolated service tests mock only the new authority helper; real HTTP tests exercise it against the migrated schema.
- The full API regression suite passes: 2,609 tests across 205 files. API build, workspace typecheck, repository lint, formatting and diff review pass. This checkpoint closes these four staff-account mutation races; other privileged and financial transactions remain under their own review scopes.

### F04/F17 — Close unauthenticated storage administration

- Review of upload cleanup exposed missing guards on both storage administration controllers. Configuration reads/writes, connection probes and record actions now require a session and `admin:storage:edit`; mutations and connection probes additionally require recent step-up. The storage module imports session services for the guard dependency.
- Review: three actual HTTP tests cover all six routes. Anonymous calls return 401, finance-only calls return 403, mutations reject missing CSRF and missing step-up, and authorized configuration reads omit the secret key. API build, workspace typecheck, lint, formatting, OpenAPI drift and diff review pass. The first build exposed the missing module import; the first step-up assertion expected a field the existing error contract does not expose and now checks its canonical nested error code.
- Storage record service wiring, transactional immutability/deletion, persistent provider configuration and orphan cleanup remain open. This access-control checkpoint does not certify those unfinished behaviors.

### F16/F17 — Repair storage record signing and durable deletion

- Replaced the record controller's incorrect provider injection with a transactional service. Reads return actual file metadata; signing derives the actor from the session, checks current authority under locks, verifies the file exists and records its audit in the same transaction. Removed records cannot be signed.
- Deletion now commits a removal request before any object deletion. Signed files remain retained, including repeat requests. A tracked worker processes only explicit unsigned requests, serializes concurrent workers, retains history and retries transport/database failures. Raw uploads wait 65 minutes after removal to outlast the application's one-hour upload URLs. Worker runtime configuration comes from the same external environment file as the API.
- Actual HTTP tests exposed an incorrect storage stream type and missing-file mapping. The S3 adapter now converts the SDK stream to its promised web stream and maps HTTP 404 to the typed missing-object error.
- Review: 95 API tests, 44 shared tests and all 316 worker tests pass. Cases include forged signer rejection, idempotent signing, signed-file retention, audit rollback, missing files, simultaneous cleanup workers, failed transport, database completion failure after deletion, absent provider and upload-URL grace. Workspace build/typecheck, lint, generated-contract validation, formatting and diff review pass. The new worker registry entry fixed an initial compile failure; stream/error fixes resolved the initial HTTP failures.
- This does not clean historical orphans, recover untracked copies from failed attachment transactions, or establish durable provider configuration. The unused generic shared record helper still has older deletion semantics; the production administration route no longer calls it. S3 version retention and production cleanup operations remain unverified.
