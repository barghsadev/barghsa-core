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

### F07/F16 — Track copied attachments before object writes

- Ticket, verification-case and legal-profile attachment sealing now independently commits a provisional cleanup record before writing the copy. The business transaction locks that record during the object write and converts it to immutable only on success. A failed reservation prevents the write; rollback leaves an explicit request for the cleanup worker. Successfully referenced copies lose the provisional/deletion markers and remain retained.
- The reservation uses a short-lived owned connection, closed in all cases, so transactions cannot exhaust the application pool while waiting to journal their copies. A one-connection HTTP test uncovered existing legal-onboarding pool exhaustion in its settings lookup and final readback. The settings lookup now precedes the transaction; readback uses its held connection before commit.
- Review: 230 profile/ticket/verification/storage tests pass across the focused regression run and corrected unit-fixture rerun. The migrated HTTP test uses the compiled worker and a local object endpoint. It rejects a failed reservation without writing a copy, skips cleanup while a due copy is being written, rolls back the business audit, removes the abandoned copy on a later worker pass, and preserves the successful copy plus original. The API has only one application connection in that test. Two older unit fixtures required updating their query sequence for transaction-bound readback and the previously omitted address-demotion statement.
- API build, workspace typecheck, lint, contract validation, formatting and diff review pass. Existing historical untracked copies and never-recorded browser uploads remain outside this cleanup scope. No production files were inspected or deleted. Other profile methods with nested pool acquisitions remain a follow-up.

### F07 — Prevent profile writes from exhausting the connection pool

- Individual onboarding and final completion now resolve their cached verification settings before acquiring a transaction connection. Individual saves, completion and profile edits read their result using that same connection before commit, avoiding a second pool acquisition while holding the first.
- Review: three actual HTTP cases run against fully migrated databases with DB_POOL_MAX=1 and a 2.5-second request deadline. All return the saved state with exactly one business audit. Another 67 service/profile-write tests pass, including verification modes, ownership/archive races, idempotency and failed-audit rollback. Existing completion unit fixtures were corrected to include their audit and transaction-bound readback.
- API build, workspace typecheck, lint, formatting, generated-contract check and diff review pass. The verification setting keeps the existing cache semantics; this change does not claim immediate cross-process configuration consistency.

### F20 — Localize calendar accessibility labels without loading calendars on login

- Date pickers now combine Jalali date formatting with the installed DayPicker Persian translations for day state, navigation and other calendar accessibility labels. The existing Gregorian labels remain English.
- Review: all six staff-screen production-browser tests pass, including both-language month navigation labels, the Nowruz date announcement, selected-day announcements and keyboard filtering. Workspace build/typecheck, lint, formatting and diff review pass.
- The first size check caught calendar libraries entering unrelated route bundles through module-level locale initialization. Moving initialization inside the date picker removed that dependency from login; all 26 route budgets pass again. These checks do not certify account-timezone preferences or every remaining calendar/range boundary.

### F04/F17 — Make failed-job actions safe for the administration screen

- Failed-job retry/resolve now recheck current staff authority under the transaction lock and require step-up at the HTTP boundary. Bulk retry locks a deduplicated, sorted set and commits all eligible transitions plus their audits together. Missing or non-retryable selections are skipped; unexpected failures now abort the entire batch instead of being silently swallowed after partial commits.
- Added current view/retry capabilities for the screen. Single job IDs, bulk IDs and pagination reject malformed values before SQL. Result readback happens within the mutation transaction, and every rejection releases it with rollback.
- Review: 22 controller/list-mapping and actual HTTP tests pass. Real migrated cases replace the older mocked transition sequences and cover failed/dead-letter retries, attribution on resolve, terminal/missing jobs, bulk deduplication/skips, failure of the second audit rolling back the first update, permission revocation after the request guard, no leaked transaction, CSRF/step-up and input validation. API build, workspace typecheck, lint, formatting, contract and diff checks pass. The screen remains the next step for 02-auth-users-admin.md#T-09.09.02.

### F17 — Build the failed-jobs administration screen

- Added `/admin/failed-jobs` and sidebar navigation for 02-auth-users-admin.md#T-09.09.02. The localized screen provides status filters including dead letter, job-type filtering, pagination, error/attempt/last-run details, single or selected retry and resolution confirmation. Details include job identity, first failure, next attempt and resolution attribution. Browser timezone is explicit.
- Current view/retry capabilities are checked on each load. View-only users have no mutation controls. Confirmation names the selected jobs and explains that recurring jobs continue after a failure is marked resolved. Retry feedback reports how many were requested and skipped, without claiming the worker has already succeeded. Requests are cancelled when filters change; selections reset, failed loads can be retried, and shared step-up/error handling retains the captured action.
- Review: ten production-browser flows against the migrated API pass, including both-language bulk retry, single dead-letter retry, resolution attribution and persisted reload, plus prior team/target/staff flows. Two additional both-language cases pass for pagination/filtering, view-only access, failed reads, incorrect password, failed save, retry with the same selection and permission removal. The initial controlled step-up response used the wrong literal; it now imports the canonical shared error code. All 116 web tests, workspace build/typecheck, lint, formatting, 27 route budgets and diff review pass. No worker was started against production and no production jobs were retried.


### Failed-notification API consolidation (F04/F11/F17/F21)

Replaced the duplicate dead-letter controller/service with aliases to the canonical failed-notification implementation. Both existing URL prefixes remain available, now with masked recipient/payload/cause data, strict pagination and UUID validation, current view/retry capabilities, password step-up, and transactional actor-permission checks. Retry keeps the original delivery snapshot and idempotency key. Resolve/dismiss accept open failures only; a queued retry cannot be represented as cancelled or final.

Reviewed the removed implementation and callers, retained parent-outbox-before-job lock ordering, and verified rollback precedes permission errors. Real HTTP tests exercise both aliases against fully migrated disposable PostgreSQL, concurrent requests, active worker leases, cancelled/delivered jobs, masked data, invalid input, CSRF/step-up, audit-write rollback, and authority revoked while waiting for the actor lock. Eight competing retries produce one success and one audit. Validation: 34 focused API tests, API build, root typecheck/lint, and OpenAPI contract checks pass. Updated the committed API contract. UI password confirmation and current-capability handling are the next step; no external delivery or production state was changed.

### Failed-notification administration screen (F11/F17/F20)

Reused DeadLetterPanel on the notification-settings page and added `/admin/failed-notifications` for operators with jobs permissions. The panel reads current view/retry capabilities, hides stale rows during refresh/failure, aborts obsolete requests, and supports status/channel/severity filters plus 25-row pages. Open-row retry/resolve/dismiss use a captured confirmation action with password step-up and actionable conflicts. Details use the masked API DTO. Notices distinguish a requested retry from confirmed delivery. Added Persian/English copy, explicit unique filter-label associations, logical header alignment, and localized attempt counts.

Review found ambiguous wrapping filter labels, fixed with explicit label/control IDs; browser review also corrected Persian details inheriting a monospace font. A pagination assertion initially observed the loading state before the request; it now waits for the actual query. Validation: 12 real-API administration browser cases pass, including all three notification actions and actor persistence in both locales; two controlled browser cases pass for failed loads, paging, filters, read-only/revoked access, wrong password and failed-save retries retaining the same notification. 116 web tests, root build/typecheck/lint and all 28 bundle budgets pass. Reviewed the RTL screenshot. No screen-reader certification or live-provider delivery is claimed.

### Localized, usable application navigation (F20)

Translated the remaining hard-coded administration links and navigation labels. Admin terms review now receives the active locale rather than the banner's Persian default. Admin navigation scrolls independently so its lower links remain reachable on short desktop viewports. Both admin/customer shells use a keyboard-operable collapsed menu on mobile, full-width content, and a skip-to-main-content link; desktop navigation stays visible. Customer route navigation closes the mobile menu.

Review checked both direction modes at 390px and 1280px, menu Enter-key operation, skip-link focus transfer, document overflow, and keyboard access to the bottom administration link. Six production browser cases pass, including real rendered terms-dialog titles/content and locale-specific requests in both languages. Root build/typecheck/lint and all bundle budgets pass. This fixes shell layout/localization, not every child page's mobile layout or the broader screen-reader acceptance gap.

### Authenticate upload URL issuance and verification (F03/F16/F17)

Moved SessionAuthGuard to the upload controller so URL issuance, object verification and recording all require an authenticated session. Previously only recording was guarded; anonymous callers could obtain storage PUT URLs. The existing global CSRF check now protects each authenticated upload operation before storage access.

Reviewed the direct-upload requirement in `01-platform-infrastructure.md#T-04.03.02` and callers. Eight migrated-API storage tests pass, including anonymous 401, missing-CSRF 403 on all three upload steps, and authenticated presign/verify/record with a local object fixture and actual SDK adapter. API build, root typecheck/lint and contract checks pass. Immediately before this change, the complete API suite passed 2,618 tests across 209 files. Binding issued keys to their owner and persisting abandoned-upload cleanup intent remain the next separate repair; authentication alone does not establish object ownership.

### Bind upload keys and persist abandoned-upload cleanup (F16/F17)

URL issuance now commits a storage reservation containing the issuing user, authorized name/category/MIME/byte count, expiry, and cleanup intent before signing the URL. The existing removed-record cleanup protocol holds provisional uploads out of active use until recording atomically promotes them. Verification/recording require the recorded owner; unissued or expired keys fail closed. Recording checks actual bytes against the authorized size/MIME and deployment policy, retains the issued filename/category, validates its body, and refuses reassociation of an already recorded upload to another purpose/profile. Failed reservation persistence cannot return a URL. Existing unrecorded URLs issued before this change need a new upload; ownership cannot be reconstructed safely.

Review caught an interaction with administration removal: provisional reservations already carry removed status, so the earlier idempotent removal branch did not cancel them. Removal now clears their promotion eligibility and keeps cleanup intent, with the existing transactional audit. An HTTP race pauses object verification, cancels the reservation, then verifies completion returns 409 and cannot reactivate it. No database connection is held across object inspection; the conditional promotion rechecks state/owner/expiry after inspection.

Validation: 98 focused upload/storage/legal-document/ticket/invoice-receipt tests passed; final upload/storage rerun passed 41 tests after rejecting changed repeat associations. Fully migrated HTTP fixtures and the actual compiled cleanup worker/local S3 adapter verify owner isolation, exact-byte limits, body errors, persistence failure, expiry, cancellation during inspection, and physical cleanup only after the 65-minute raw-upload grace. API build, root typecheck/lint and contract checks pass. Old untracked objects and recorded-but-unreferenced uploads remain outside automatic deletion; downstream business attachment permissions/sealing remain required. No production storage was accessed.

### Upload-policy API preparation and database correction (F04/F17)

Added current `admin:uploads:edit` capability discovery and a guarded deployment-limits endpoint for the missing editor. Mutation bodies now reject unknown fields. Policy writes recheck the actor under a transaction lock, and existing policy rows are locked before closing/replacing them. The real PostgreSQL test exposed a type mismatch: bigint size limits arrived as strings, defeating the unchanged-policy check and returning a string DTO. Size limits now compare/serialize as bounded numbers, preserving the same version on repeat saves.

Validation: 45 focused tests pass. The migrated HTTP fixture covers permissions, CSRF/step-up, deployment ceilings, unchanged saves, version history, end idempotency, audit rollback, revoked authority while waiting on the actor, and actual presigned-URL acceptance changing with the policy then returning to deployment defaults after end. Root typecheck/lint, API build and OpenAPI contract checks pass. This API checkpoint does not complete the required edit-modal/table UI; that follows next.

### Upload-policy editor and version history (F17/F20)

Completed the missing administration screen for `02-auth-users-admin.md#T-09.12.05` at `/admin/upload-policies`. The category table shows effective formats and size limits intersected with deployment boundaries, distinguishes configured limits from deployment defaults, and exposes retained version history. The edit modal restricts choices to deployment-permitted extensions, validates byte-exact size limits, and explains effects on pending uploads. Changes apply through a captured confirmation/password-step-up action. Ending a current open policy explicitly warns that deployment defaults may permit more files. Current permission/error/loading states and both locales are supported.

Review checked source permissions, effective-limit calculations, bounded numeric input, retained history, and failed-action handling. Fourteen real-API administration browser cases pass, including two new localized edit/version/end workflows with database readback. Two controlled browser cases pass for failed loads, empty format selection, wrong password, server failure, same-body retry and revoked capability. Root build/typecheck/lint and all 29 bundle budgets pass. Future-scheduled versions remain visible in history; the screen edits immediate policies and does not invent cancellation or backdating behavior beyond the existing API.

### Wallet-payment regressions on the production schema (F02/F14/F21)

Replaced the two wallet-to-invoice integration suites' handcrafted foundation tables and selected historical SQL with the complete production migration fixture. Preserved their locking, competing debit/reserve/credit, same-key replay/collision, insufficient-balance and expired-claim checks. Added exact debit/cache replay above Number.MAX_SAFE_INTEGER and an injected final invoice-audit failure proving wallet balance, invoice, ledger, earlier audit and idempotency claim all roll back before a clean same-key retry.

Review: all 28 cases pass on the fully migrated database; typecheck and lint pass. This provides current-schema evidence for `04-invoices-wallet-contracts.md#T-04.2.03.01` through `.04` without deleting protections from their follow-up PRs. Scope correction to the earlier F12 note: these four task definitions require the service and integration tests; a customer HTTP/UI payment flow remains separate product integration and is not claimed here. No payment endpoint or real financial operation was added. The remaining F14 finance matrix still needs review.

### Latest production image verification (F18/F21)

Rebuilt API, web and worker runtime images with product code through ab96c26, then passed the complete disposable-container probe. All three run non-root with read-only filesystems and packaged migrations. Database loss changes readiness while preserving liveness; recovery restores readiness. SIGTERM waits for concurrent inbox and invoice commits. Forced shutdown leaves rolled-back/retryable work, and a replacement worker completes each exactly once; web/API exit cleanly. The probe removed its containers/network, verified by an empty matching container inventory.

The first builds stalled in Docker's stored-credential helper. Stopped those build processes and used a temporary credential-free configuration for public base images; all builds then passed. Removed the temporary configuration. Image identities, product-source revision, checks and operational limitations are recorded in `audit/production-image-verification.json`. No registry push or deployment was performed. The prior forced-lease-clock limitation remains explicit.

### Wallet ledger primitives on the production schema (F02/F14)

Moved credit, debit, reserve/release and optimistic-balance integration suites to the full migration chain, preserving concurrency, idempotency, amount/ref binding, insufficient available balance and UUID normalization checks. The old negative-balance setup deliberately wrote data that production constraints now reject. That case now verifies the production constraint rejects the write without changing balance/history; service-level invalid-state checks remain in unit coverage.

Review/validation: 54 real-database cases, typecheck and lint pass. No production wallet implementation changed. Evidence covers the existing `T-04.2.01.03` through `.06` primitive tasks, not new customer payment or contract flows. Reversal/provider-callback suites are the next matrix group.

### Wallet reversals and chargeback handling on the production schema (F02/F14)

Converted the reversal, chargeback detection, and finance alert integration suites to disposable databases running all production migrations. Removed partial schema definitions and seeded actual user-owned profiles and existing finance roles. The initial detection run exposed ownerless test profiles; these fixtures now satisfy the production ownership constraint. No production constraint was relaxed.

Review: retained reversal sign, balance, duplicate/replay, transaction rollback, unmatched alert, and concurrent handler assertions. The shared fixture accepts an explicit pool maximum so the four-handler deadlock regression still runs with exactly four service connections. Finance alert checks now exercise production foreign keys and seeded staff roles. These are service integration tests, not evidence of a live payment provider or externally delivered alerts.

Validation: all 27 tests across the three suites passed; root type checking and lint passed; whitespace review passed. Production application behavior is unchanged in this step. Remaining callback and receipt confirmation suites are still under review.

### Repair callback processing constraint omitted from production migrations (F02/F14)

Moving the payment callback suite to full production migrations reproduced a product failure: seven of eight tests failed because `chk_wallet_topup_callback_events_status` rejected `processing`. The historical test fixture applied migration 0071, but the consolidated production chain retained the earlier terminal-only constraint. Every new callback claim failed before wallet credit.

Added additive migration 0112 to permit the existing service's processing state while retaining the three terminal states. No rows are deleted or rewritten. The migration is journaled after 0111; the baseline test explicitly recreates the old constraint before its populated upgrade check and verifies that processing is restored. The converted callback suite retains signed callbacks, replay binding, crash recovery, provider-return verification, and delayed paid returns after expiry or an earlier unpaid return.

Review and validation: all eight callback tests pass with the full migration chain; fresh install, repeat migration, and populated baseline upgrade test pass; root type checking and lint pass. Provider verification is a local fake in this suite, so this does not certify a real payment-provider deployment. Apply 0112 before expecting deployed callback handling to work. No production migration was run.

### Bank receipt wallet settlement on production migrations (F02/F14)

Converted the wallet bank-receipt confirmation suite to the full production database and real required user fields. Review retained all 15 cases for confirmation/rejection, replay, wallet excess, partial/exact/overdue invoice settlement, concurrent allocations, customer notice amounts, and audit-failure rollback. All 15 pass, along with root type checking and lint. This verifies trusted service transactions; HTTP staff authority remains a separate review item.

### Invoice receipt confirmation and rejection on production migrations (F02/F14)

Converted both invoice receipt settlement suites to fully migrated databases with separate customer and audit-actor users. Review preserved allocation/excess arithmetic, replay, concurrent receipt settlement, notification rollback, and confirmation-versus-rejection conflicts. All 15 tests passed across the two suites; root type checking and lint passed. No service behavior changed in this step. HTTP staff permissions and other invoice fixtures remain separate work.

### Hold current finance authority through invoice receipt decisions (F04/F14)

Invoice receipt confirmation and rejection previously relied on the controller's permission snapshot. Both now acquire the actor account and current role grants inside the decision transaction before locking or changing the receipt. Revoked, disabled, or activation-pending actors cannot proceed, including idempotent repeats. Existing rollback and advisory-lock cleanup remain in place.

Review caught a regression in test meaning: the old audit-failure fixture used a nonexistent actor, which the new authority check rejects before auditing. Replaced that shortcut with a trigger that fails the specific confirmation/rejection audit insert for a valid finance actor. The tests assert the exact injected error and unchanged receipt, invoice, wallet credit, and rejection outbox.

Validation: 62 focused unit, migrated service, dual-approval, and real HTTP tests passed. The final audit-injection rerun passed all 15 receipt tests. The HTTP race pauses after the session guard at the actor lock, revokes the role, resumes both decision types, and verifies 403 with no settlement. API build, root types, lint, contract, and whitespace checks pass. Wallet receipt authority and other finance actions remain separate follow-up work.

### Hold current finance authority through wallet receipt decisions (F04/F14)

Wallet receipt confirmation/rejection now use the same transaction-held actor and current-grant checks as invoice receipts. Converted all three rollback tests from nonexistent actors to failures of the actual final audit insert, including invoice allocation plus excess wallet credit. This preserves evidence that later failures undo earlier financial changes.

Review and validation: 50 focused unit, migrated transaction, and real HTTP tests pass. Both wallet decision routes reject permission revocation after the session guard with 403 and preserve Pending state and zero balance. API build, root types, lint, and whitespace checks pass. The full database suite also passed 564 tests across 76 files with migration 0112. No deployment or external financial action occurred.

### VAT and invoice due-period calculations on production migrations (F02/F14)

Replaced hand-created VAT/product and due-period tables with the production migration fixture. Product fixtures now include required titles/prices and configuration authors are real users. Review retained override precedence, effective-window boundaries, zero-rate/default-day fallbacks, and caller-owned transaction checks. All 12 cases pass; root types and lint pass. This covers calculation reads, not the separate staff configuration editors.

### Recheck due-date override authority and preserve audit rollback (F04/F14)

Staff due-date changes now hold the actor account and current override permission through the invoice transaction. The service test database uses all production migrations. Its rollback check now injects a real audit-write failure for an authorized actor, proving that due_at changes are undone. A real HTTP test revokes authority while the request waits, verifies an unchanged date after 403, then restores the grant and verifies one successful audit.

All 33 focused service/controller/HTTP tests pass, as do API build, root types and lint. The full API run before this due-date step passed 2,632 tests across 210 files, covering callback migration and both receipt permission fixes. These counts are evidence for those revisions, not blanket acceptance of the remaining plan.

### Restore generated invoice accounting amounts (F02/F12/F14)

Full migration tests exposed another baseline defect: 0080 created accounting_amount as ordinary nullable BIGINT. The retained 0067 logic then saw the column and skipped its GENERATED ALWAYS definition. Charge adjustment creation failed converting NULL to BigInt; ordinary invoices and credits could also lack their signed liability amount. The Drizzle declaration had omitted the generated expression.

Migration 0113 renames the ordinary column to accounting_amount_legacy, preserving stored values, then adds the generated signed amount. Existing generated installations retain their expression and gain an empty legacy column. No invoice rows or source amounts are deleted. A conflicting legacy backup name blocks the migration rather than overwriting evidence. The Drizzle declaration now declares the generated expression and retained legacy field. Deployment reconciliation and eventual removal of legacy values remain operational follow-up.

Converted manual creation, automatic creation, calculation replay, cancel/replace, and adjustment suites to production migrations. Removed incomplete tables and created actual owned profiles and complete orders. Review retained original-document immutability, distinct replacement/adjustment indexes, signed credit liability, payability exclusions, replay, exact large amounts, and rollback checks.

Validation: all 39 tests across five suites pass. All 564 database tests across 76 files pass, including fresh/repeated migrations and a populated upgrade that preserves legacy value 123 while restoring exact accounting amount 9007199254740993. An explicit write to the generated amount fails with 428C9. Root type checking, lint and whitespace checks pass. No production database was changed; deployment must apply 0113 before adjustment creation is considered repaired there.

### Finish invoice state and receipt evidence fixtures on production migrations (F02/F14)

Moved invoice state transitions, invoice receipt uploads, and shared wallet/invoice receipt claims to production-migrated databases. Removed the remaining partial invoice schema setup in these suites. Review retained allowed/forbidden transitions, guarded amounts, competing state changes, audit rollback, cross-profile denial, byte inspection, oversized forged uploads, same-attachment races, and immutable sealed-copy assertions. Cross-flow submission still permits exactly one wallet or invoice claim for the same evidence.

Validation: invoice state transitions passed 30 tests; cross-flow receipt claims passed three; receipt uploads passed ten tests. Root type checking, lint and whitespace checks pass. Object storage is an in-memory test provider in these service suites; real object transport is covered separately by existing HTTP storage fixtures.

### Persist and apply storage configuration across processes (F04/F17)

Replaced process-local environment edits with versioned app_config storage settings. Secrets use AES-256-GCM with a dedicated external encryption key and are never returned by the API. Save probes both configured endpoints before the transaction, then rechecks current staff authority, version and existing storage records. Location changes are refused when recorded objects would be stranded. The audit insert and settings write commit together. API and worker operations read the durable configuration, including after restart; invalid encrypted configuration fails closed. Normal object operations retain existing retry and timeout behavior, while connection probes use bounded attempts.

The storage screen now supports Persian and English, masked write-only credentials, explicit secret removal, optimistic conflict handling, connection tests, step-up recovery, and denied/error/retry states. Operational documentation explains the shared encryption key, backups, endpoint behavior and remaining bucket configuration checks. No external storage settings or credentials were changed.

Review and validation: the clean full API run passed 2,638 tests across 211 files. Shared storage checks passed 47 tests across four files; worker checks passed 316 across 29. Sixteen live admin browser checks and two controlled storage browser checks passed, including save/reload and failure recovery in both languages. Reviewed both language screenshots. Root build, types, lint, contract and bundle checks passed. The OpenAPI change records the connection-test response as HTTP 200. An earlier full API run had one child startup failure while another test command rebuilt the same compiled modules; the isolated full rerun passed. Future API suites must not overlap build-producing test commands.

This verifies application configuration persistence and local test object transport. It does not certify production bucket versioning, CORS, lifecycle policy, legal holds, every object-operation permission, or deployment of the required encryption key.

### Hold reconciliation authority through exception changes (F04/F17)

All three reconciliation actions now lock and recheck the actor's current permission inside the state-change transaction. Rollback now runs for every pre-commit exception, including denied authority, before the connection is released. Removed duplicated rollback calls from individual error branches.

Review and validation: five real HTTP checks on production migrations verify the lifecycle, competing resolutions, exact audit-failure rollback, and revocation during investigate/resolve/close. Denied requests preserve the open record and leave no idle transaction or audit entry. Closing preserves the original resolver and explanation while auditing the separate closure note. The first broad run passed 2,639 checks and exposed four unit mocks that returned a synchronous undefined value for rollback; updated those mocks to the actual asynchronous query contract. The focused rerun passed all 23 service and HTTP checks. Root types and lint pass. The reconciliation screen and date-range filtering remain the next bounded step.

### Add the reconciliation queue and date filtering (F17/F20)

Added /admin/reconciliation with Persian/English navigation, severity/status/date filters, pagination, mismatch details, assigned staff and the stored resolution. Current read-only grants hide mutation actions. Investigate, resolve and close use the reviewed API; explanations are mandatory for resolution and closure, and the confirmation dialog retains its captured action on failure. Loading, retry, empty, denied and conflict states are visible. Reload after a decision verifies persisted results.

The API now exposes independent view/resolve capabilities and validates UUID action identifiers, bounded paging and strict explanation bodies. Date filtering accepts explicit timezone-bearing timestamps and uses an inclusive start/exclusive end. The screen converts device-local input to those timestamps and labels that convention.

Review and validation: 38 focused controller/service/real HTTP checks passed, including timezone-offset equivalence and exact date-boundary paging. All 18 live admin browser checks passed. Two controlled browser checks passed for paging, read-only access, failed loads, stale mutations and permission loss. Reviewed the Persian screenshot. Root build, type checking, lint, contract and all 29 bundle budgets passed. OpenAPI includes the date filters and access route.

Remaining acceptance limits: mismatch details are displayed without changing their recorded values. The wallet scanner records wallet/profile identity, but there is no existing staff transaction-detail destination or general payment-mismatch identifier contract to support truthful related-transaction links. Those links remain open rather than inventing routes or treating the task as fully accepted. The native date-time input uses device-local Gregorian input; a Persian calendar picker remains part of F20. No production reconciliation record was changed.

### Recheck green-rule activation inside its save transaction (F04/F17)

Green-rule saves now recheck current catalogue-edit authority and read the product under a transaction-held share lock before writing. The existing early validation remains for useful activation errors. A separate advisory lock serializes first-time configuration creation so concurrent saves record the actual preceding value/version. Denied or unsafe activation errors retain their 403/400 response after rollback.

Review and validation: all 29 existing green-rule service/controller checks pass. Four new production-migrated HTTP checks pass for competing first saves, authority revocation after preflight, product deactivation after preflight, and final audit failure. Rejected changes leave no settings, audit entry or idle transaction; audit failure also preserves the global configuration version. Root types and lint pass. This closes save-time races only. Product-limit compatibility, the editor, post-save alerts and future ordering consumers remain separate acceptance work.

### Protect catalogue mutation authority and product reads (F04/F17)

Catalogue create, edit, archive and price changes now hold current catalogue-edit authority inside their transaction. Edit/archive/price operations lock the selected product before deriving changes, preserving no-op behavior under competing staff requests. Read-only requests do not acquire mutation locks.

Review and validation: all 56 focused service/controller/production-migrated HTTP checks pass. HTTP tests revoke permission after the guard on each of the four write paths and verify no mutation, audit or idle transaction. Additional checks preserve exact 9007199254740993/9007199254740995 prices, version history and archived products, roll back price/history on audit failure, and verify that two staff submitting the same status change generate one audit. Review added the product lock to the price path as well as edit/archive. The first HTTP run corrected a test expectation: the existing price endpoint returns 200, not 201. Root types, lint and whitespace checks pass.

The catalogue screen, full pricing-effective-date behavior, and active-rule deactivation alerts remain open. Reviewing price scheduling found that future versions are recorded without immediately updating products.price; the due-time reader/scheduler path needs the next review.

### Apply scheduled product prices at read time (F02/F14/F17)

Confirmed that future price versions remained in history while catalogue, public product, ordering and green-activation readers kept using products.price indefinitely. Migration 0114 adds effective_product_price without rewriting rows. Readers now select the version effective at their calculation time. Automatic invoice creation passes its calculation timestamp, then retains its ordinary immutable snapshots. Legacy prices remain usable before the first history entry; gaps after history starts return no price rather than silently reusing an old value.

Review and validation: exact-boundary database tests cover large values, inclusive starts/exclusive ends, legacy fallback and invalid history gaps. Public and staff HTTP reads apply a due price without changing the legacy column. Automatic invoice integration selects the historical effective price at its supplied timestamp and persists the correct line amount. Updated the order/archive lock probe to match the changed price query. Reviewed all affected query sites and retained non-pricing product reads.

All 73 focused API checks passed, followed by all 2,657 API tests across 214 files and all 565 database tests across 77 files. Fresh/repeated/populated migration checks pass with 0114. Root build, lint, contract and final types pass. Type review replaced unsafe JSON property reads in the HTTP test with assertions on unknown response bodies; its final eight checks pass. Deployment guidance is in docs/operations/product-price-schedules.md. No production migration was run. Historical prices changed without retained versions cannot be reconstructed by this repair.

### Fail closed on damaged stored ordering settings (F17)

Green-rule and contract-limit reads now return CONFIG:STORED_VALUE_INVALID with HTTP 503 for malformed persisted settings. They preserve the damaged row for investigation. Previously both silently substituted defaults, potentially disabling a mandatory advanced-order rule or widening a saved contract limit. Missing rows still use the documented initial defaults. The green safety-status endpoint also refuses damaged rule data.

Review and validation: 33 focused unit and real HTTP checks passed. HTTP confirms both configuration reads and green safety status refuse damaged data without replacing it. Root type checking and lint passed. This does not add unbuilt ordering/contract consumers; they must preserve this fail-closed behavior when integrated.

### Protect contract-limit saves and first-write audit history (F04/F17)

Contract-limit changes now hold current catalogue-edit authority through the transaction and serialize initial configuration creation with an advisory lock. Permission errors preserve their 403 status after rollback.

Review and validation: all 20 focused controller/service/HTTP checks pass. A deterministic HTTP test holds the global configuration-version row, starts saves from two different staff accounts, waits until both transactions are blocked, then releases them and verifies the audit chain 0→1→2. This checks configuration serialization independently of the actor-account lock. Other HTTP cases verify revocation after the guard and rollback of settings/global version on final audit failure. Updated the green first-write test to use two distinct staff accounts as well. Root types and lint pass. The required contract-limit editor remains open.

### Add the green-electricity rule editor and password verification (F04/F17)

Added /admin/electricity-rules with separate simple/advanced mode settings, enable toggles, power thresholds and keyboard-operable share sliders. Both languages explain the new-order scope and display the current saved rule's product-state warnings. The editor can disable unsupported rules, reports rejected activation clearly, and handles loading, damaged settings, denied access and retries. Saves now require password step-up; the confirmation flow retries the captured proposal after verification. Corrected the documented GET response fields to match the existing camelCase response.

Review and validation: 14 API/controller checks passed, including missing step-up. All 20 live admin browser checks passed, with both languages saving independent values, reloading persisted settings, observing product deactivation, rejecting an enabled save and recovering by disabling both rules. Two controlled browser checks passed for damaged/unavailable reads, incorrect/correct password verification, unchanged retry payload and permission loss after save. Reviewed the Persian screenshot. Root build, types, lint, contract and all 29 bundle budgets pass.

This adds the editor and current product-state warnings. Product-limit compatibility remains awaiting the requested specification clarification. Order-time composition and integration with future ordering flows, and durable administrator notifications for later product changes, are not certified by this step.

### Add the contract electricity limit editor (F17)

Added /admin/contract-limits with Persian/English navigation, bounded integer inputs for quantity increases, Jalali-month duration and lead days, and explanations for zero values. The page describes the new-draft scope, preserves a captured proposal through password verification, reloads committed settings, and hides the form on denied or damaged/unavailable configuration reads.

Review and validation: all 22 live admin browser checks passed. Both languages save zero increase allowance, independent duration values and seven-day lead time, then verify the exact persisted API response after reload. Two controlled browser checks passed for unavailable configuration, native invalid-value rejection, wrong/correct password recovery, unchanged retry payload and permission loss. Reviewed the Persian screenshot. Root build, type checking, lint and all 29 bundle budgets pass. This completes the existing configuration editor; enforcement by the unbuilt advanced-order/contract modules remains their separate backlog dependency.

### Make AI model changes atomic and recheck authority (F04/F17)

Model create, edit and delete now hold current AI-model administration permission through one transaction with their audit entry. Edits lock the model before deriving changes. Changes to connection fields invalidate prior test status; title-only changes preserve it. Stored tokens remain encrypted and masked, with explicit clearing supported.

Review and validation: all 20 focused service and production-migrated HTTP checks pass. HTTP checks cover final audit failure for each mutation, permission revocation after guards, encrypted storage and masked responses/audits, connection-change invalidation, and rejection of deleting an agent-referenced model. Root types and lint pass. The connection-test path, worker requirement and model editor remain open for subsequent steps.

### Bound AI connection responses and redact before truncation (F17)

Connection testing now limits streamed provider bodies to 64 KiB and cancels oversized responses. It removes secrets before shortening previews and provider errors, fixing partial token exposure at the 300-character boundary. Base URLs containing credentials, query strings or fragments are rejected before credentials are sent.

Review and validation: all 27 tester checks pass, including cutoff-crossing tokens in success/error responses, cancellation of an oversized stream and early URL rejection. Root types, lint and whitespace checks pass. Tests use injected clients or a mocked fetch, with no provider calls. DNS pinning, concurrent-test result binding, worker execution and the editor remain open.

### Bind AI test results to the tested row version (F04/F17)

Connection testing now checks current staff authority before reading credentials and again when saving a result. The network request holds no database connection or lock. Result persistence locks the model and compares its PostgreSQL tuple version, rejecting intervening edits or competing completed tests even when timestamps are identical. Deletion returns 404; permission loss returns 403. Results and audit entries commit together. Undecryptable tokens still fail without an unauthenticated provider request.

Review and validation: 26 focused service and production-migrated HTTP checks pass. A local fake provider pauses replies while tests edit/delete the model, revoke authority, fail the final audit, or complete a competing request. Stale results never overwrite the current state, audit failures roll back, and slow replies leave no idle transaction. Root types, lint and whitespace checks pass. The shared HTTP fixture allows an explicit test-only provider host and clears inherited allow-list values by default. This repairs the existing synchronous path; worker execution remains open.

### Validate AI provider addresses at socket connection (F17)

The native HTTP transport now validates the DNS answers it passes directly to the socket, preserving the requested host and normal TLS verification. Redirects are never followed, oversized bodies close the connection, and DNS preflight shares the request timeout budget. Explicit deployment allow-list hosts remain supported. The shared network guard now recognizes hexadecimal and expanded IPv4-mapped IPv6 spellings before applying private-address restrictions.

Review and validation: 63 focused API/network/production-migrated HTTP checks passed, including public-to-private DNS changes, allowed local hosts, request shape, redirects, oversized streaming replies, silent providers, stalled DNS and mapped private/public addresses. All 644 shared tests passed. Root lint and final types pass. Type review narrowed the overloaded DNS mock to the all-addresses signature; the final six transport tests pass. No external provider was contacted. Worker execution and the model editor remain open.

### Validate model inputs and prevent silent credential forwarding (F17)

Model routes now reject malformed UUIDs before database access. Create/edit reject unknown fields, whitespace-only names and URLs containing credentials, query strings or fragments. Names and URLs are trimmed. Changing a stored-token model's base URL or provider requires explicit token re-entry or clearing; omitted or masked tokens cannot silently move to a new destination.

Review and validation: 22 controller/service checks and all 26 production-migrated HTTP checks pass. HTTP covers all ID routes, invalid create/edit fields, and omitted/masked/cleared tokens for address and provider changes. The initial two test failures corrected assertions to the application's actual error envelope; the final HTTP run passes. Root types and lint pass. Updated the API description and contract snapshot. The model editor and worker-based test execution remain open.

### Add the AI model administration table and editor (F17)

Added /admin/ai-models in Persian and English. The table shows provider/model, masked token, reachability and test details. Create/edit forms offer explicit token keep/replace/clear choices. Save, delete and connection testing use the existing password-verification dialog, preserve the captured proposal through retries, and show current-authority, referenced-model, changed-model and encryption errors. New test results display the safe response preview or diagnostic. Loading failures and permission loss hide the editor.

Review and validation: all four focused production-browser checks pass. Both languages create, reject a silent token destination change, clear the token, reload, test a blocked local address and delete through the migrated API. Controlled checks verify failed reads, wrong/correct password retries, identical submitted payloads and permission loss. Reviewed Persian desktop/mobile screenshots. Review corrected the navigation item spacing, aligned the list with the required table layout, and corrected a test's Persian Cancel label. The scrollable table region retains keyboard focus with a documented accessibility-lint exception. Root build, types, final lint, contract and all bundle budgets pass. The refreshed contract captures the preceding token-destination API description. Worker-based test execution remains open; these checks do not certify a real provider connection.

### Share the tested AI transport and credential implementation (F17)

Moved provider request handling and token encryption into the server-only shared AI module. The API retains small Nest injection adapters and its encryption-configuration warning. Moved the corresponding transport, token and tester regressions with the implementation, avoiding separate worker copies.

Review and validation: all 48 focused API service/controller/production-migrated HTTP checks pass after the move. Shared tests, root types, lint and whitespace checks pass. This is preparation for worker execution; the API still runs its existing synchronous test path until the queue integration lands.

### Add the durable AI test queue and worker claim handler (F02/F17)

Migration 0115 adds short-lived model-test jobs bound to model version and requesting staff member. It stores no copied credential. The worker handler claims exclusively, rechecks current grants and model version, reads the existing encrypted token, and writes safe results only while its lease and deadline remain valid. Expired leases can be retried once; terminal previews expire after one day. Cancellation and replacement leases fence late results. The existing permission parser is shared with the API without broadening accepted grants.

Review and validation: ten production-migrated worker tests pass for competing claims, invalid authority/model/token/deadline, stale worker results, cancellation, retry limits, constraints and retention. Fresh/repeated/populated migration checks pass with 0115; review made table/index creation replay-safe for the populated adoption scenario. API permission/model HTTP checks pass, as do the full worker suite, root build, types, lint and whitespace checks. The API and production poller are not wired to this queue yet; that is the next integration step. No production migration was run.

### Execute model connection tests through the production worker (F17)

The API now enqueues the model/version/actor in its authority-held transaction, releases the connection, and waits for the worker's safe result. The worker polls through the existing draining lifecycle, uses the remaining job/lease budget for the provider timeout, and records queue failures in the failed-jobs screen. The API rechecks current authority and model version before persisting reachability and its audit entry. Missing-worker timeouts cancel outstanding work and leave model status unchanged. Removed the unused API transport adapter.

Review and validation: 49 focused API checks pass, including a real separate worker process and an absent-worker timeout. Competing worker slots preserve the stale-result guard. Review fixed fractional database milliseconds before passing them to the HTTP timeout and added a regression; local transport tests verify both OpenAI-compatible and Anthropic request/header shapes. All four Persian/English browser checks pass through the worker-backed API. Full suites pass: API 2,659/215 files, worker 326/30, shared 692/55, database 565/77. Root build, final types/lint, contract and bundle budgets pass. Deployment and timeout guidance is in docs/operations/ai-model-tests.md. Migration 0115 and matching API/worker encryption configuration are required; no production migration, provider call or proxy deployment was performed.

An unrelated development-proxy edit appeared in apps/web/vite.config.ts during this step. It is preserved and excluded from this commit. Legacy plaintext model tokens remain a documented migration/rotation limitation; newly entered tokens are encrypted.

### Make knowledge-base and group metadata changes atomic (F04/F17)

Knowledge-base/group create, edit and delete now hold current admin:ai:kb authority through one transaction with their audit entry. Edits/deletes lock the selected record; aggregate reads and no-op responses use the same transaction connection. Audit failure also rolls back cascaded membership deletion.

Review and validation: 33 existing service/controller checks and 14 new production-migrated HTTP checks pass. HTTP covers audit rollback and authority revocation for all six mutations, plus successful create/edit/delete, accurate membership counts and preservation of the counterpart record. Root types, lint and whitespace checks pass; type review corrected an incomplete test query result. Document linking, membership mutations, validation and the KB editor remain open. Unrelated changes to the development proxy and database package scripts are preserved and excluded.

### Protect knowledge-base documents and group membership (F04/F17)

Document attach/detach and membership add/remove now commit with current staff authority and their audit entries. Attachment locks the storage record and accepts only completed uploads owned by the editor, unless the editor also has admin:storage:edit. Removed, provisional and deletion-pending records cannot be attached. Detachment preserves the underlying file. Repeated attachments and memberships create no duplicate audit.

Review and validation: 33 existing service/controller checks and all 32 production-migrated HTTP checks pass. Added coverage for four mutation audit rollbacks, four permission-revocation races, successful links, foreign uploads, concurrent storage removal, pending upload/deletion flags and duplicate requests. Root types, lint and whitespace checks pass. Review removed the obsolete unique-violation recovery query inside an aborted transaction and corrected a stale reference-race comment. Input validation and the KB editor remain open.

### Validate knowledge-base and group API inputs (F17)

All KB/group route IDs now require UUIDs, including nested document/member IDs. Metadata schemas trim titles, reject blank titles and unknown fields, and retain length limits. Membership payloads require a UUID; document keys reject whitespace-only input without rewriting valid storage keys.

Review and validation: 46 production-migrated HTTP checks and 18 service checks pass. The controller recheck passes all 15 tests after replacing a legacy fake ID with a UUID. Invalid requests leave metadata, links and audits unchanged. Root types, lint and whitespace checks pass. The management editor and document-processing dependency remain open.

### Add knowledge-base and group administration (F17)

Added the lazy /admin/knowledge-bases page and navigation entry, using the established admin layout. Persian/English controls support KB/group creation, editing and deletion, group membership changes, document names and truthful processing status. Mutations capture the proposal in the existing password-verification dialog. Failed reads expose refresh; permission loss removes editor controls.

Review and validation: four controlled production-browser checks pass for failed reads, wrong/correct password retries, identical proposals, permission loss, group links and document status. Two additional browser checks pass against the production-migrated API for create/edit/reload, group membership, unlink and deletion in both languages. Reviewed the Persian 390px screenshot and checked no horizontal page overflow. Root build, final types/lint, contract and bundle checks pass. Document selection/attachment controls are next; this step does not implement the deferred chunk/embedding processor.

### Select and attach completed knowledge-base documents (F17)

Added a file-name picker backed by an authenticated endpoint for the editor's own completed uploads. Search returns at most 100 newest matches and excludes removed, provisional and deletion-pending records. The picker excludes already attached files. Attachment and detachment use the captured step-up transaction; detachment retains the file for reuse. Processing state remains truthful.

Review and validation: all 47 production-migrated knowledge-base HTTP checks pass, including owner isolation and search validation. All six focused browser checks pass in Persian/English; the migrated-API flows attach a seeded completed upload, verify pending state, detach it and confirm the underlying upload remains selectable. The earlier storage-removal race test verifies attachment rechecks availability. Root build, types, lint, contract and bundle checks pass. Fixed a test fixture property mismatch before the final run. This supports selection of existing uploads; an integrated new-upload control and the deferred chunk/embedding worker remain open.

### Make AI policy mutations atomic and serialize rule validation (F04/F17)

Policy/group create, update, delete and membership changes now hold current admin:ai:policies authority and commit their audit in the same transaction. Existing rows are locked before validation or mutation. A rules-only update therefore validates against the latest stored policy type after a concurrent edit completes. Aggregate/no-op reads stay on the transaction connection; duplicate membership remains audit-free.

Review and validation: 36 existing service/controller tests and 20 production-migrated HTTP checks pass. HTTP covers all eight mutation audit rollbacks and authority-revocation races, successful metadata/group cycles, duplicate membership and a concurrent policy-type change. Review corrected a copied test's irrelevant document-count assertion and removed unrelated storage cleanup from its fixture. Final review caught a strict-type error in an existing query-parameter assertion after the mock was typed; the assertion is narrowed to its parameter array. The final root type check passes, as do lint and whitespace checks. Policy input validation and the policy editor remain open.

### Validate AI policy and group inputs (F17)

Policy/group route IDs and membership payloads now require UUIDs. Create/edit trim titles, reject blank titles and unknown fields, and preserve structured rule validation and existing length limits.

Review and validation: 46 controller/production-migrated HTTP tests pass, including malformed routes and nested member IDs, invalid policy/group create/edit payloads, valid trimmed titles and unchanged records/audits after rejection. Updated legacy controller fixture IDs to valid UUIDs. Root types, lint and whitespace checks pass. The policy administration editor remains open.

### Add structured policy and group administration (F17)

Added /admin/policies with Persian/English policy lists, type badges, enabled status, structured per-type fields and group management. List rules use one entry per line; response style exposes tone, optional language and maximum length. Changing type clears the prior rule fields. Save/delete/membership actions use the existing captured password-verification flow.

Review and validation: four production-browser checks pass. Controlled password retry/permission-loss checks cover data scopes and prohibited actions. Migrated-API checks create allowed topics, change to response style, disable/reload, verify exact stored rules and manage groups in both languages. Reviewed the Persian mobile screenshot; no horizontal page overflow. Root build, types, lint, contract and bundle checks pass. The complete API suite passed 2,738 tests across 217 files after the preceding knowledge-base/policy API changes. Rule-document whitespace and unknown-field validation is the next review finding; agent policy enforcement remains a separate consumer review.

### Normalize and validate AI policy rule documents (F17)

All four rule schemas now reject unknown fields and whitespace-only entries. Creation and updates persist the validated, trimmed document. Rule comparison uses semantic object equality so key order does not cause a change audit. Optional response language must be nonblank when supplied.

Review and validation: all 72 policy service/controller/production-migrated HTTP checks pass. Added real HTTP coverage for every rule type, trimmed storage, invalid create/rules-only updates, unknown fields, unchanged records after rejection and repeated equivalent rules without duplicate audits. Root types, lint and whitespace checks pass. This validates configuration storage; agent-side enforcement and integration still require separate review.

### Hold current authority during agent-slot assignments (F04/F17)

Slot assignment/clearing now rechecks and holds current admin:ai:agents authority inside its existing transaction. The existing slot lock, audit rollback, foreign-key conflict handling and duplicate-assignment behavior remain in force.

Review and validation: 17 existing unit/controller checks and six production-migrated HTTP checks pass. HTTP covers assigning/clearing after grant revocation, both audit-failure rollbacks, shared-agent usage, duplicate suppression and concurrent agent deletion returning 409 without changing the slot or audit. Corrected the fixture's missing model creator before rerunning. Root types, lint and whitespace checks pass. The slot administration screen remains open.

### Add agent-slot administration (F17)

Added /admin/agent-slots in Persian and English for the five predefined chatbot slots. Staff can choose an agent or clear an assignment, see disabled-agent status and cross-slot use, and confirm through the existing password-verification dialog. Identical assignments disable Save; failed reads and lost authority remove stale controls.

Review and validation: four production-browser checks pass. Controlled checks verify failed loads, wrong/correct password retries, identical captured assignments, disabled/shared-agent notices and permission loss. Migrated-API checks assign/reload, reuse one agent across two slots and clear an assignment in both languages. Reviewed the Persian mobile screenshot and verified no horizontal page overflow. Root build, types, lint, contract and bundle checks pass. This manages configuration; actual chatbot consumers and the AI agent editor remain separate review items.

### Recheck agent mutation authority and lock current state (F04/F17)

Agent create/update/delete now recheck and hold current admin:ai:agents authority inside their existing transaction. Updates and deletion lock the selected agent row before reading the state used for validation and audit.

Review and validation: 38 existing service/controller checks and eight production-migrated HTTP checks pass. HTTP covers all three mutation audit rollbacks and authority-revocation races, successful CRUD, and an overlapping enabled-state edit whose audit records the actual before/after state. Review corrected the test's audit metadata read to parse the existing text column. Final root types, lint and whitespace checks pass. Individual agent KB/policy link operations remain the next atomicity repair.

### Commit individual agent links with authority and audits (F04/F17)

Individual KB/policy link and unlink operations now use the same transaction helper and agent-row lock as bulk agent edits. Current authority remains held until commit, and audit failures roll back the link. Duplicate adds retain their no-op behavior; unlinking retains the referenced KB or policy.

Review and validation: 23 service checks and all 18 production-migrated agent HTTP checks pass. Added all four link audit rollbacks and permission-revocation races, plus successful add/duplicate/remove cases for each relationship. Reviewed transaction connection usage and updated unit fixtures to account for BEGIN. Root types, lint and whitespace checks pass. Agent input strictness, group references, the editor and real test-chat execution remain open.

### Validate agent and slot mutation payloads (F17)

Agent metadata now trims titles and rejects blank titles and unknown fields. Individual KB/policy links and slot assignments reject unknown payload fields while retaining existing UUID validation.

Review and validation: all 83 agent/slot service/controller/production-migrated HTTP checks pass. New HTTP cases verify invalid create/edit/link/assignment requests leave records and audits unchanged, and valid titles are trimmed. Root types, lint and whitespace checks pass. Before this final validation change, the full API suite passed 2,766 tests across 219 files after all preceding repairs. Group references, the agent editor and test-chat integration remain open.

### Add durable agent group references (F02/F17)

Migration 0116 adds separate agent-to-KB-group and agent-to-policy-group links without changing existing direct references. Composite primary keys prevent duplicates; reverse indexes support group deletion; both foreign keys cascade only the join rows. Added matching exported schema definitions and corrected the old schema comment claiming disabled agents could not be assigned to slots.

Review and validation: fresh/repeated/populated baseline migration checks and two real database schema-insert/constraint/cascade tests pass. Review aligned composite constraint names with the schema declaration before the final run. Root types, lint and whitespace checks pass. This is an additive storage step; API/editor integration follows. No production migration was applied.

### Wire agent group references into the API (F17)

Agent create/update accept bounded UUID lists for KB groups and policy groups. Omitted lists preserve existing links; supplied lists replace them; empty lists clear them. Group references are validated in the authority-held transaction and are included in change audits and agent detail responses. Added an agent-permission editor-options endpoint exposing only IDs/titles of selectable records, without model credentials or policy contents.

Review and validation: the existing 83 agent/slot checks pass, followed by all 26 agent HTTP checks with the new cases. HTTP covers group creation, deduplication, preservation, clearing, unknown/malformed references, rollback with scalar edits, equivalent-set audit suppression and restricted options output. API build, root types/lint, contract and whitespace checks pass. Migration 0116 is required. The editor and test-chat integration remain open.

### Add the AI agent configuration editor (F17)

Added /admin/agents in Persian and English with model selection, direct KB/policy selections, group selections, enabled status and create/edit/delete actions. Mutations use the existing confirmation and password-verification dialog. Failed reads and lost authority remove stale editing controls.

Review and validation: four production-browser checks pass. Controlled checks cover failed loads, incorrect/correct password retries with identical captured group selections, and permission loss. Migrated-API checks create all four relationship types, reload the editor, clear selected relationships while retaining others, disable and delete the agent in both languages. Reviewed the Persian mobile screenshot and verified no horizontal overflow. Root build, types, lint, contract, bundle and whitespace checks pass. T-09.11.04 remains partial: the required actual-agent test-chat backend and panel are not implemented by this configuration step.

### Hold contract-template authority and lock metadata before reading (F04/F17)

Template create/edit/delete and version finalization now hold current admin:documents:edit authority through commit. Metadata edits, deletion and version allocation read the selected template under a row lock. This prevents an overlapping rename from overwriting a newer description and prevents version finalization after grant revocation. Storage writes remain outside the database transaction.

Review and validation: 29 existing service/controller checks and ten production-migrated HTTP checks pass. HTTP covers all four audit rollbacks and permission races, preservation of concurrent metadata, version upload and protected deletion. The local storage fixture initially compared operation-specific URL query strings; corrected it to compare object paths, then verified failed uploads remove their object. Root types, lint and whitespace checks pass. Durable recovery after failed storage cleanup remains separate work; version history responses and the admin screen remain open.

### Return complete contract-template version history and validate metadata (F17)

The detail endpoint now returns ordered version metadata with a count and latest version from the same version query. File sizes are normalized to numbers on reads, matching upload responses. Metadata schemas reject blank names after trimming and unknown fields; version upload payloads reject unknown fields.

Review and validation: all 45 template service/controller/production-migrated HTTP checks pass. New HTTP coverage verifies both archived files remain after a second upload and that invalid payloads leave metadata, storage and audits unchanged. The history comparison exposed the old PostgreSQL bigint string response; fixed and reran successfully. Root build, types, lint, contract and whitespace checks pass. Binary template support, the UI and the upload request-size boundary remain separate work.

### Align template upload limits across API and pilot proxy (F17/F18)

The version-upload JSON parser now allows escaping overhead for a 10 MiB text file; other JSON endpoints retain the default request limit. Compressed large-upload bodies are disabled. The pilot proxy has a matching route-specific ceiling. Oversized parser requests now return a stable localized 413 rather than a 500.

Review and validation: 34 migrated-template HTTP and exception-filter checks pass, including an actual 10 MiB upload, a larger decoded file rejected before storage and the ordinary endpoint limit. The local container proxy probe passes TLS/routing/header/size/SSE/WebSocket/quota checks plus the template exception and its upper bound. Its first run caught a missing nested-location proxy handler; added the explicit upstream and reran successfully. Root build, types, lint, contract, bundle and whitespace checks pass. Only disposable local containers were used; no deployment occurred.

### Add contract-template administration and fix editor switching (F17)

Added /admin/contract-templates with Persian/English metadata editing, activation/archive, ordered version history, extracted placeholders, text-file selection/drop and append-only uploads. Versioned templates cannot be deleted in the UI; server-side reference checks remain authoritative. The confirmation dialog now accepts PATCH. Selecting another editor clears stale controls immediately, also repairing the same form-switching race in the agent editor.

Review and validation: eight agent/template production-browser checks pass, followed by four template checks after localizing the file-choice button. The template migrated-API flow creates metadata, rejects a PDF before upload, uploads two distinct files, verifies retained history and placeholders, renames/archives/reloads, protects versioned deletion and deletes an empty template in both languages. Controlled checks exercise failed loads, password retries with captured metadata and lost permission. The first live run exposed text entered into the previous form being cleared after Add; repaired and reran. Reviewed the Persian mobile screenshot and verified no horizontal overflow. Root build, types, lint, contract, bundle and whitespace checks pass. Word/PDF template parsing and durable failed-upload cleanup remain open; the screen explicitly supports UTF-8 text files only.

### Serialize VAT configuration writes with current authority (F04/F17)

All four VAT mutations now hold current admin:finance:edit authority and a transaction-scoped VAT configuration lock. The lock covers category rates and dependent overrides, including empty histories, so overlapping writes read the previous committed result before deciding whether to change or audit it.

Review and validation: all 45 VAT service/controller/production-migrated HTTP checks pass. New HTTP cases cover all four audit rollbacks and permission revocations, duplicate end-date requests and an end-date request waiting behind a newer committed state. Root types, lint and whitespace checks pass. Immediately before this repair, checkpoint 967a4d5 passed the full API suite with 2,793 tests across 220 files and the shared suite with 692 tests across 55 files. VAT input strictness and its administration screen remain open.

### Validate VAT inputs and expose restricted product choices (F17/F20)

VAT mutation payloads reject unknown fields. Supplied effective timestamps must include an explicit offset, avoiding server-timezone interpretation; omitted timestamps retain immediate behavior. Added a finance-permission product-choice endpoint returning only IDs, localized titles and types.

Review and validation: 27 VAT controller/production-migrated HTTP checks pass. New cases cover malformed IDs, excessive rates, unknown fields, ambiguous create/end timestamps, explicit +03:30 conversion to the correct UTC instant and the restricted choice response. API build, root types/lint and whitespace checks pass; reviewed the added OpenAPI route. Existing API clients sending offset-free timestamps must include Z or a numeric offset. The new editor will send explicit UTC timestamps.

### Add VAT administration with localized scheduling (F17/F20)

Added /admin/vat with category-rate history, product overrides, rate/end-date actions and percentage inputs converted to basis points. Optional scheduling uses the existing Persian/Gregorian date picker and shows the device timezone explicitly; requests send a UTC instant. Nonexistent local times are rejected. VAT-specific translations load with this page so they do not increase unrelated route bundles.

Review and validation: four production-browser checks pass after the final translation split. Controlled cases verify failed reads, password retries preserving 7.25% as 725 basis points and permission loss. Both migrated-API flows create a rate, assign an override, verify it wins, end it and verify zero fallback, close the rate, then schedule a future rate with the localized calendar. Corrected the fixture's numeric catalogue price to the required string before the live checks. Final review fixed a TypeScript narrowing issue and the shared translation growth that exceeded the electricity-ordering route budget. Root build, types, lint, contract, bundle and whitespace checks pass. Reviewed the Persian mobile screenshot and verified no horizontal overflow. Account-timezone integration remains part of F20; this screen labels its device-timezone behavior explicitly.

### Hold gift-code administration authority and lock edits (F04/F17)

Gift-code create/edit/activation mutations now hold current admin:promotions:edit authority through commit. Edit and activation operations lock the selected gift-code row, matching the redemption lock, before reading state. Redemption and cancellation retain their separate caller-owned transaction contract.

Review and validation: 53 service/controller checks and eight production-migrated HTTP checks pass. HTTP covers all three audit rollbacks and grant-revocation races, concurrent activation preservation during an edit, successful writes and repeated activation without duplicate audits. Root types pass after correcting the transaction callback type to the actual PoolClient; lint and whitespace checks pass. Input bounds and the gift-code editor remain open.

### Bound gift-code amounts, usage limits and mutation inputs (F17/F20)

Gift-code amounts now fit the signed bigint storage range, and usage limits fit the integer columns. The shared payload validator enforces the same bounds for service callers. Admin payloads reject unknown fields and unsupported categories, trim codes before rejecting blank values, and require explicit timezone offsets for supplied dates.

Review and validation: all 83 gift-code service/controller/production-migrated HTTP checks and 27 shared promotion checks pass. Real HTTP coverage rejects each excessive amount/limit and malformed input on create and edit, verifies unchanged state/audits, accepts exact database maxima, normalizes the code and preserves a +03:30 timestamp as its UTC instant. API build, root types, lint, contract and whitespace checks pass. Existing clients sending offset-free dates must include Z or a numeric offset. The profile-eligibility transition and editor remain open.

### Validate gift-code profile eligibility transitions (F17)

Switching a public gift code to profile-restricted now requires explicit profile selections. Edits to an already-restricted code validate and preserve its stored selections when omitted. Public codes clear profile scopes, including when clients submit leftover IDs. Activation rejects a legacy restricted code with no selected profiles.

Review and validation: all 86 gift-code service/controller/production-migrated HTTP checks pass. Added real HTTP cases for missing selections, deduplication, preservation during amount edits, switching back to public, public creation with leftover IDs and blocked activation of an empty legacy scope. Root types, lint and whitespace checks pass. This does not rewrite production legacy records; existing empty scopes need profile selection before activation. The gift-code editor remains open.

### Add restricted profile choices for gift-code eligibility (F17)

Added a promotions-permission profile search returning only ID, display name, profile type and archive status. Search excludes archived profiles and returns at most 50 choices; selected-ID lookup resolves up to 200 records per request, including archived selections. Search and ID inputs are bounded and validated.

Review and validation: all 34 gift-code production-migrated HTTP checks pass. The new case verifies current-name search, archived-selection resolution, exact response fields and invalid-query rejection. API build, root types/lint and whitespace checks pass. OpenAPI review caught optional parameters being advertised as required; corrected their declarations and regenerated the contract. No national IDs, phone numbers or credentials are returned. The selection component and editor follow.

### Add gift-code administration with profile scopes and scheduling (F17/F20)

Added /admin/gift-codes in Persian and English with filters, fixed/percentage discounts, mandatory percentage caps, usage limits and statistics, product categories, profile selection and activation. Localized date controls preserve existing instants exactly unless edited and show the device timezone. Mutations use the existing password confirmation flow. Page translations load separately to preserve unrelated route budgets.

Review and validation: both migrated-API browser flows pass, covering creation, percentage conversion, selected-profile persistence, expiry dates, public-scope clearing, unchanged start instants, activation and filtering. Both controlled browser checks pass after correcting a test that omitted the required amount; password retries retain identical captured payloads and lost permission removes the editor. Reviewed the Persian mobile screenshot and checked horizontal overflow. Root build, types, lint, contract, bundle and whitespace checks pass. Actual order-redemption consumers remain separate unstarted work; account-timezone integration remains F20.

### Validate catalogue category edits and scheduled-price inputs (F17/F20)

Catalogue edits now validate selected categories against the product type, matching creation. Both paths deduplicate categories before storing or comparing them, so repeated selections do not produce database errors or false change audits. Mutation schemas reject unknown fields, trim localized titles before blank validation and require explicit timezone offsets for scheduled prices.

Review and validation: all 59 catalogue service/controller/production-migrated HTTP checks pass. Added HTTP coverage verifies invalid cross-type edits leave stored categories intact, repeated selections produce one category and no duplicate audit, changed selections appear once in the audit, malformed payloads do not mutate state, and a +03:30 future price preserves its UTC instant without changing today's price. Root types, lint and whitespace checks pass. The catalogue screen and its rule-reference warning remain open.

### Expose catalogue rule references for deactivation warnings (F17)

Added a catalogue-permission lookup returning enabled green ordering modes and whether a product has a VAT override whose effective window intersects its linked rate now or in the future. It returns configuration flags only. Invalid persisted green configuration reports an error instead of hiding the dependency.

Review and validation: all 11 production-migrated catalogue HTTP checks pass. The new case covers the default enabled green mode, future VAT overlap, non-overlapping windows, missing products, malformed IDs, denied access and malformed saved configuration. The initial test assumed system products were seeded by migrations; added the explicit local fixture before rerunning. API build, root types/lint and whitespace checks pass; reviewed the added OpenAPI route. This is a warning lookup, not a new prohibition on deactivation.

### Add catalogue administration with versioned prices and rule warnings (F17/F20)

Added /admin/catalogue with four product tabs, bilingual metadata and descriptions, type-specific categories, electricity limits, activation, archive/restore and price history. New products start inactive. Prices remain exact IRR strings; scheduled changes use localized calendars and explicit UTC instants. System products cannot be added or archived. The editor and deactivation confirmation show enabled/scheduled configuration references.

Review and validation: four production-browser checks pass, plus two keyboard-navigation checks. Both migrated-API flows create all three supported product types, preserve large prices exactly, edit metadata, schedule a second price without changing today's price, retain history through archive/restore, edit system electricity limits and confirm a green-rule warning before deactivation. Controlled cases cover failed reads, captured payloads across password retries and permission loss. Fixed the live test's premature field check and screenshot capture. Reviewed the Persian mobile screenshot. The first tab implementation increased shared route code above the existing budget; replaced it with the existing buttons and tested arrow/Home/End keyboard behavior in both directions. Final root types/lint, build, contract, bundle and whitespace checks pass without raising budgets. Dates explicitly use device timezone; account-timezone integration remains F20.

### Refresh production image evidence through the catalogue repair (F18)

Rebuilt API, worker and web production images from clean checkpoint c60c148, including migrations 0112 through 0116, durable AI-model testing, storage configuration and the repaired administration screens. The disposable-container probe passes non-root/read-only startup, packaged migrations, optional Redis fallback, database loss/recovery, graceful draining and forced-deadline recovery with one eventual delivery/finance commit. All probe containers and their network were removed.

Reviewed the image IDs and source revision in production-image-verification.json. No production environment, registry push or external provider was used. The forced-deadline fixture still terminates disconnected sleeping database sessions and advances only its isolated retry lease. These images cover c60c148; the subsequent reminder-authority repair is outside this image checkpoint.

### Hold reminder-setting authority through commit (F04/F14)

Reminder-offset changes now lock the actor and recheck the current reminder-settings grant inside the write transaction before taking the existing per-offset lock. Converted the concurrent audit-chain test from partial tables to production migrations. Existing scheduling semantics and per-write audits remain unchanged.

Review and validation: all 15 service/controller/migrated-database/HTTP checks pass. New HTTP cases verify permission revocation while waiting, denied access, the 24-entry default matrix and rollback when the actual audit insert fails. The first run caught an extra audit parameter introduced during the edit; removed it and reran all checks. Root types, lint and whitespace checks pass. Production-image evidence remains explicitly bound to the earlier c60c148 checkpoint.

### Require current invoice authority for cancel-and-replace (F04/F14)

The staff cancel-and-replace service now holds current invoices:write authority before locking or changing the original invoice. Its production-migrated fixture uses the actual Finance role. Review confirms the actor lock precedes invoice locks and remains held through both state changes and commit.

All 17 unit and migrated-service checks pass. Added a grant-revocation race proving no cancellation, replacement or audit survives denial. Replaced the old missing-actor rollback shortcut with a failure of the replacement issue audit after the original cancellation; the whole correction chain rolls back. Root types, lint and whitespace checks pass. This service has no staff HTTP caller yet, so these checks certify its existing service contract rather than a new API/UI workflow.

### Require current invoice authority for charge and credit adjustments (F04/F14)

Adjustment creation now holds the actor's current invoices:write grant before locking the original invoice. Both positive charges and negative credit notes use the same boundary. Existing signed accounting, payability exclusions and original-document preservation remain covered.

All 20 unit and production-migrated service checks pass. Added grant-revocation races and actual issue-audit failures for both signs; each preserves the original invoice and leaves no adjustment. The fixture uses the real Finance role. Root types, lint and whitespace checks pass. This repairs the existing service contract; no new staff API, refund workflow or production financial operation was added.

### Require current invoice authority for manual creation and replay (F04/F14)

Manual invoice creation now holds invoices:write authority before inspecting the profile or replaying an idempotency key. Removed grants cannot create a new invoice or retrieve an old result through the mutation service. The calculation-replay fixture now grants its staff actor the actual Finance role.

All 24 unit, production-migrated manual-invoice and calculation-replay checks pass. New coverage pauses a replay at the actor lock, revokes the grant, checks denial for replay and new creation, then restores the grant and verifies the original invoice is returned. The audit rollback test now fails the actual issue audit for an authorized actor and verifies invoice/line/audit counts are unchanged. Root types, lint and whitespace checks pass. Cross-actor concurrent idempotency remains the next review item; this step does not add an HTTP caller.

### Prevent duplicate manual invoices across concurrent staff requests (F14)

A migrated-database race reproduced two invoices from the same profile/request key when different staff submitted concurrently. Manual creation now takes a transaction-scoped lock for that profile/key before replay lookup. Matching requests return the same invoice and audit. Replay refuses duplicate legacy matches, missing fingerprints, missing issue audits and missing issue timestamps; it no longer chooses an arbitrary record, returns an empty audit ID or substitutes current dates. Existing records are preserved for reconciliation.

Review and validation: all 29 manual-invoice and calculation-replay checks pass. The race delays the actual insert so both staff requests previously passed the lookup; with the fix it leaves one invoice and one audit. Legacy cases verify conflicts without changing existing records. Corrected a missing test exception import during the first legacy run. Root types, lint and whitespace checks pass. This is an invoice idempotency defect, separate from the original kanban task-selection duplication. No production invoices were inspected or rewritten.

### Full regression checkpoint after catalogue and invoice repairs

Checkpoint 4b128a6 passes the full API suite with 2,863 tests across 223 files and the full shared suite with 697 tests across 55 files. This run includes the catalogue/gift/VAT changes, reminder authority, manual/correction authority and manual-request idempotency repair. It is regression evidence for this revision, not acceptance certification for unfinished parent tasks or production operations.

### Add date-picker bounds, locale and validation controls (F20)

The shared picker now accepts inclusive minDate/maxDate limits in both modes, explicit fa/en locale, a disabled state and an accessible error message. Persian is the default when neither locale nor the legacy jalali flag is supplied. Explicit legacy flags keep existing callers stable. The trigger and calendar dialog have accessible names; errors describe the trigger. Locale changes preserve the controlled Date value.

Review and validation: four new browser component checks pass for inclusive boundaries, arrows/Enter/Escape, focus restoration, language changes, disabled state and error association. The fixture compiles the actual shared component into a temporary output directory and adds no product route. Corrected its initial import path, explicit test timezone and ambiguous status locator. All five production CRM browser checks pass, including Nowruz and Esfand leap day. Root build, types, lint, contract and bundle checks pass. Timezone integration, half-open ranges, full date labels and responsive month selection remain open; this is not full T-06.03.04 acceptance.

### Use one explicit timezone for date display and selection (F20)

DatePicker accepts an IANA timezone for its selected-date text, calendar math, limits and returned selection. The Jalali date constructor converts calendar fields into midnight in that zone instead of creating a browser-local midnight. Omitted timezone preserves existing browser-local callers pending the separate account-preference integration.

Review and validation: eight component browser checks pass, including Persian and English Tehran dates from UTC and Los Angeles browsers, exact resulting instants, upper bounds and locale switching without value changes. The first tests compared timezone-aware ISO serialization with Z serialization and used an ambiguous Persian day label; normalized the fixture's output to UTC and made the locator exact. All five production CRM browser checks, root build/types/lint and bundle checks pass. Account timezone defaults and migration of current consumers remain open; this step does not claim global timezone compliance.

### Correct date-picker range boundaries (F20)

Range values now use the required half-open interval. The calendar highlights included days, while the returned to value is midnight at the beginning of the next excluded day. Calendar-day arithmetic respects the configured timezone and daylight-saving transitions. The displayed interval states that its end is excluded. No current product page uses range mode, so no existing inclusive consumer was silently reinterpreted.

Review and validation: all ten browser component checks pass. Added a fresh one-day interval and a three-day New York interval spanning spring DST, verifying exact UTC endpoints, excluded-day highlighting and reopening. The latter is correctly 71 hours, not an assumed 72. Root build, types, lint and bundle checks pass. Full date formatting, responsive month controls and account timezone integration remain open.

### Complete localized picker labels and month controls (F20)

The selected value now shows the full date. Persian mode uses Persian digits by default and includes the Gregorian year; callers can explicitly select Latin digits. Both calendar years appear beside the month dropdown. The native month selector works at mobile width, and long labels wrap. Persian date parts are assembled in day/month/year order because the browser's default formatter used an unexpected order.

Review and validation: eleven styled browser component checks pass, including a 390px Persian month-selection check with Latin digits and unchanged stored selection. Reviewed the completed-animation mobile screenshot. All five production CRM checks pass with full Persian labels, including Nowruz and Esfand leap day. Root build, types, lint and bundle checks pass. Global account timezone and administrator numeral preference wiring remain separate open work. The component offers those controls; it does not claim every page consumes the preferences.

### Use the saved timezone in staff permission history (F20)

Permission history now loads the account timezone and uses it for calendar selection, timestamp labels and inclusive day filters. Date controls remain disabled until the preference is known; failed or invalid responses show the existing retry state. The reusable preference hook aborts obsolete requests and re-reads after the timezone settings page reports a successful save. Updated Persian and English guidance to say account timezone.

Review and validation: all six staff browser checks pass from a Los Angeles browser. History tests verify exact Tehran day bounds, retry after an unavailable or invalid timezone response and unchanged pagination/permissions behavior. The original clock setup replaced Date.prototype before the timezone library initialized, causing local setters in the mocked environment; initializing the fake clock after page load resolves the test interference while retaining exact cross-zone assertions. Root build, types, lint and bundle checks pass. Other date consumers and the settings page's silent load-error handling remain open. Existing inclusive API timestamp precision is preserved.

### Make timezone settings failures visible and selection keyboard-accessible (F20)

Timezone settings now uses the validated account-preference loader. Unavailable settings show retry and cannot be overwritten through a guessed default. A searchable native list replaces the incomplete custom combobox, with keyboard navigation, grouping and accessible labels. Save responses must confirm the selected zone; errors and success appear in the form. Non-string server error messages cannot break rendering. Time/date previews follow the selected language, and controls stay disabled during saving.

Review and validation: both Persian and English production-browser checks pass for initial failure/retry, keyboard selection, failed-save recovery, exact submitted values and persistence after reload. The Persian case includes a malformed server error message. Testing exposed an invisible toast on this page and a shared bundle-budget failure; replaced toast-only feedback and moved page-specific translations into the timezone dictionary, keeping the navigation title shared. Root build/types/lint and bundle checks pass. No remote settings were changed.

### Apply account timezone to VAT scheduling (F20)

VAT uses the saved account timezone for its date picker, timestamps and scheduled rate/override changes. The editor waits for a valid preference and refresh retries that read. Wall-clock conversion rejects invalid fields and nonexistent local times during spring DST. Existing immediate changes and captured step-up submissions retain their behavior.

Review and validation: three date-helper checks, four controlled VAT browser checks and both production-migrated API/browser VAT checks pass. Coverage includes exact Tehran conversion, skipped New York time, a 25-hour fall day, failed preference loading, permission revocation and percentage retry. Root build, types, lint and bundle checks pass. Gift windows, catalogue scheduling and CRM filters remain separate timezone consumers to repair.

### Apply account timezone to catalogue prices (F20)

Catalogue timestamps and scheduled prices now use the saved account timezone. The editor waits for a valid preference and refresh can recover a failed preference read. Scheduling uses the same validated wall-clock conversion as VAT, including rejection of skipped local times.

Review and validation: four controlled catalogue checks and both production-migrated API/browser catalogue checks pass. The live checks now assert that a midnight Tehran schedule persists as 20:30 UTC on the previous day, while the current price remains unchanged. Product creation, editing, archival/restoration, exact large prices, system limits, rule warnings and keyboard tabs remain covered. Root build/types/lint and bundle checks pass.

### Apply account timezone to gift-code windows (F20)

Gift-code date/time inputs now display and edit the saved account timezone. Editor initialization waits for the preference, failed reads remain retryable through search, and changed fields use the validated wall-clock conversion. Unchanged start/end fields retain their original timestamp strings, including fractional seconds.

Review and validation: all three controlled gift-code browser checks and both production-migrated API/browser gift-code checks pass. New coverage verifies 12:34 UTC displays as 16:04 in Tehran, changing another field preserves both original timestamps exactly, and changing the start time to 10:15 stores 06:45 UTC without changing expiry. Existing discount scope, profile selection, status changes and captured step-up retry remain covered. Root build/types/lint and bundle checks pass.

### Apply account calendar days to CRM filters and labels (F20)

CRM registration filters now resolve calendar days in the saved account timezone. The final day retains PostgreSQL microsecond precision, and displayed registration/last-login dates plus active date-filter labels use the same zone and locale. Pickers constrain reversed date ranges. A failed preference read disables date selection, prevents a CRM request in an unknown zone and remains recoverable through refresh. Pagination resets when the timezone changes.

Review and validation: all six CRM browser checks and four date-helper checks pass. Coverage verifies Tehran Nowruz and Esfand leap-day UTC boundaries, full Persian labels, account-zone registration display across midnight, failed preference retry, cursor navigation and extreme +14-hour date construction. Root build, types, lint and bundle checks pass. All five current production DatePicker consumers now pass the account timezone; unrelated date displays elsewhere and administrator numeral preferences remain open F20 work.

### Set the picker default after migrating all current consumers (F20)

With CRM, staff history, VAT, catalogue and gift-code consumers explicitly using the account timezone, DatePicker now defaults to Persian and Asia/Tehran when no preference is provided. It no longer silently uses the browser timezone. Explicit alternate locales, numeral systems and timezones remain supported.

Review and validation: all twelve styled component browser checks pass, including default Persian/Tehran selection and exact returned instant. The new default-value fixture initially made a stored-value locator ambiguous; made those names exact and reran. The combined production-browser regression passes all 25 CRM/staff/VAT/catalogue/gift/settings checks. Together these are 37 browser checks, plus the four date-helper tests and the separately verified six migrated API/browser VAT/catalogue/gift checks. Root build, types, lint, contract and bundle checks pass. This closes the bounded picker/consumer work, not all F20 accessibility/global formatting or all F01-F23 work.

### Remove render-time mutations and impure OTP countdown updates (F19/F20)

React Doctor 0.9.13 reported five errors at checkpoint 38b6679. Onboarding draft references now update after React commits the render. Reminder confirmation takes and releases its pending-request guard in the event handler, including cancellation protection. Login and registration resend availability now derives from the timer; countdown updates have no nested state changes or timer side effects.

Review and validation: the changed-file scan reports zero errors. All 17 reminder unit tests and 33 production-browser checks pass, covering both locales, login and registration resend cooldowns, delayed draft writes, conflicts, failed draft reads and submission sequencing. Root build, types, lint, contract and bundle checks pass. Saved the full baseline and changed-file scan in this directory. The baseline contains 316 diagnostics, including five errors, with the remaining warnings requiring source review. Its version and scope differ from the original audit, so counts are not directly comparable. Scoring, supply-chain scanning and caching were disabled. This does not close remaining accessibility or dependency-review work.

### Label notification templates and delivery-window settings (F20)

Connected the template editor and delivery-window labels to their controls, named template filters and error-dismiss buttons, and announced validation/errors and saved status. Read-only template identity fields retain labels when editing. Error-dismiss placement follows text direction. The body-template hint is exposed as its accessible description.

Review and validation: two production-browser checks pass in Persian and English, including label-click focus, editing, client-side validation without a write, failed-save announcement and keyboard dismissal. Root build, types, lint and bundle checks pass. The changed-file scan has zero errors and zero accessibility diagnostics for the two components; its seven remaining warnings cover complexity, state grouping and mutation guards, which remain separate review work. Saved the scan as react-doctor-notification-labels.json.

### Repair session-revocation dialogs (F05/F20)

Replaced the two custom session-revocation overlays with the shared modal component. Both contain keyboard focus, restore their trigger on cancellation and follow the selected locale. Pending revocations take a synchronous request guard. Password entry, cancellation, backdrop dismissal and Escape cannot change a pending all-session confirmation. Single-session confirmation now stays open while pending and reports failures inline, allowing retry.

Review and validation: both Persian/English production-browser checks pass, covering forward/reverse tab navigation, focus restoration, pending single/all requests, failed responses and password preservation. Build, types, lint and bundle checks pass. One bundle-check attempt could not find the generated manifest; rebuilt the web output and verified the check again. The changed-file scan has no errors or accessibility diagnostics. Remaining warnings concern file/component size and an intentional error-body read followed by response.ok handling. Stored the scan in react-doctor-session-dialogs.json.

### Preserve notification preferences and marketing consent on failures (F09/F20)

Source review of an unnamed switch found that failed reads silently exposed defaults and enabled saving. Both preference sections now require a valid response before editing or saving, show a localized retry action after failure, and validate the returned channel/consent shape. Saving disables toggles, rejects duplicate in-flight requests and checks that the response confirms the requested choices. Failed or mismatched saves preserve the draft and show an inline error. Success is announced inline. Notification switches now have localized names.

Review and validation: four production-browser checks pass across both preference types and Persian/English. They cover HTTP and malformed read failures, disabled writes, keyboard toggles, pending requests, malformed error messages, mismatched successful responses, retained choices and successful retry without refetching over the draft. Initial test locators used Save instead of the existing Save Changes label; corrected them and reran all four. Root build, types, lint and bundle checks pass. The changed-file scan has zero errors/accessibility findings; three remaining warnings concern component complexity/size and a three-item array lookup. New retry text uses a page dictionary to keep shared bundle growth bounded.

### Associate email-provider field labels (F09/F20)

Provider label and transport controls now have explicit label associations. The shared field wrapper encloses its input, so all SMTP and Resend configuration fields have accessible names. Named the connection-test recipient input and localized the error-dismiss button.

Review and validation: both Persian/English production-browser checks pass for all ten SMTP controls and all seven Resend controls, label-click focus, transport switching and password-type API-key entry. Corrected the test's nested locator and API key capitalization before rerunning. No provider request was sent. Root build, types, lint and bundle checks pass. The changed-file scan reports zero errors/accessibility findings; remaining warnings concern component size, state grouping and formatter placement. Stored react-doctor-provider-labels.json.

### Associate ordering address labels (F20)

Connected province, city, full-address and postal-code labels to the existing ordering form controls.

Review and validation: both Persian/English production-browser checks pass for accessible names, label-click focus, text entry and the disabled city selector before province selection. Root build, types, lint and bundle checks pass. This is a bounded accessibility correction; missing ordering backends and verification/address-loading failure behavior remain unverified or open and are not certified by these controlled UI checks.

### Repair shared table sorting, visibility and selection (F19/F20)

Sortable headers now contain native keyboard buttons and expose aria-sort. Columns with enableHiding=false stay visible. Controlled selection follows its parent's selectedRows value. Sorting and selection callbacks run in event handlers rather than state updater functions, preventing duplicate callbacks under Strict Mode. Equal missing sort values compare equally.

Review and validation: four browser component checks pass for keyboard ascending/descending/reset sorting, retained fixed columns, controlled/uncontrolled selection, select-all clearing, external selection updates and exactly one callback per action under Strict Mode. The fixture compiles the actual shared component in a temporary directory and introduces no production route. Root build, types, lint and bundle checks pass. No current product consumer uses this table; this verifies the built shared component, not a future CRM migration.

### Close the remaining baseline control-label findings (F20)

Added localized names to geography filters and the TOS error-dismiss action. Current breadcrumb text now uses aria-current without a disabled link role. Full page translation remains separate work.

Review and validation: both geography/TOS browser checks and the combined 63 auth/form/calendar/table checks pass. Root build, types, lint and bundle checks pass. The same-version full scan now reports 268 warnings, zero errors and one accessibility diagnostic, down from 316 diagnostics, five errors and 43 accessibility diagnostics. Reviewed the remaining toast warning as a wrapper-analysis false positive because ToastPrimitive.Close provides its accessible name. Saved the report and explicit limitations in accessibility-triage.md. Broader task acceptance and localization remain open.

### Make verification configuration truthful and retryable (F06/F20)

Verification settings now require a valid read before editing. Failed reads offer retry, pending writes disable the form, duplicate writes are guarded, and failed/mismatched responses preserve the selection without claiming success. Automatic verification is unavailable because the user confirmed that no identity provider exists. Existing API configuration can be read and changed to manual review. Added Persian/English page text and accessible status/error messages.

Review and validation: both production-browser checks pass, including unavailable and malformed reads, legacy API configuration, disabled automatic mode with its explanation, pending-save protection, failed and mismatched responses, preserved selection and confirmed manual mode after reload. Root build, types, lint and bundle checks pass. This UI change does not configure a provider or certify the backend's configuration-write authority race; that is the next repair.

### Hold configuration-write authority through commit (F04/F06/F09)

Verification-mode writes now hold admin:config:write authority inside the transaction. Delivery-window writes hold admin:notification-providers:edit, matching their controller. Both acquire actor/grant locks before configuration changes and preserve permission-denied responses instead of converting them to generic server errors.

Review and validation: all 59 focused service/controller/production-migrated HTTP checks pass. The eight new HTTP checks verify read-only denial, successful writes and audits, configuration-version increments, full rollback on actual audit-trigger failure, and permission revocation while a request waits on its actor lock. Reran the eight HTTP checks after adding an explicit version-increment assertion. Root types, lint and contract checks pass. The API fixture compiled the real application and ran production migrations in disposable databases. No operational state or provider was changed.

### Preserve delivery-window settings across request failures (F09/F20)

The delivery-window form now requires a valid loaded configuration before editing or saving. Failed reads offer retry; obsolete reads are aborted. Saved timezones outside the short suggestion list remain selectable. Pending saves lock the form and guard duplicate submission. Success requires the returned timezone/hours to match the submitted values. Failed saves retain the draft, malformed error messages fall back to localized text, and editing clears the previous success message.

Review and validation: all four notification/delivery-window browser checks pass in Persian and English. Coverage includes failed and malformed reads, disabled writes, Tokyo outside the original list, exact snake-case request values, pending-save protection, mismatched successful responses and successful retry. Root build, types, lint and bundle checks pass. The request uses the existing shared delivery-window validator; no delivery scheduler or external provider was run.

### Include the complete browser and loop protocol suites in CI (F01/F19)

CI now validates the generated canonical queue and runs all 46 loop protocol tests. The browser gate discovers the full Chromium suite, including migrated-API admin flows and shared components, instead of maintaining an eight-file list. Fixed four files that failed the existing formatting gate.

Review found a test-state dependency when running the whole browser suite: the green-rule safety test leaves the singleton product inactive, and the catalogue test assumed it was active. The catalogue test now establishes the active product and explicit rule configuration through the disposable API before testing its UI. It still verifies both the warning and confirmed deactivate/reactivate operations. No product behavior was changed to accommodate the test.

Validation: API regression passed 2,871 tests across 224 files; shared regression passed 697 tests across 55 files; all 46 loop tests and the canonical queue check passed. Lint and formatting passed. The initial full browser run passed 229 checks and failed the catalogue precondition. Final browser rerun result is recorded below. Remote CI execution, branch protection, cross-browser coverage and the remaining security/coverage gates are not certified by this change.

Final browser rerun: all 230 Chromium checks passed in 3.2 minutes, including both catalogue languages after preceding green-rule mutations. No retries were enabled for this local run.

### Repair vulnerable dependencies and add the CI dependency gate (F19)

Removed unused size-limit tooling and obsolete UUID type stubs. Upgraded Drizzle ORM/Kit and SWC CLI, selected patched qs within Express's supported range, and removed Drizzle Kit's unused deprecated loader through an exact-version override. Supplied SWC's optional watch dependency through a scoped package extension without changing Nest's Chokidar peer. CI now blocks high/critical dependency advisories and retains the JSON scan report even on failure.

Review and validation: the scan went from five high/seven moderate occurrences to zero advisories. Production build, root types, contract comparison, route budgets, lint, formatting and migration-tool config/journal checks passed. All 2,871 API tests and 567 database tests passed. Drizzle's error wrapping required preserving constraint assertions under cause; native pool assertions remain unchanged. A temporary watch fixture verified initial and changed-file compilation. No schemas, migration history or product routes changed. See dependency-repair.md and both saved JSON scans for detail. Remaining security and license gates are still open.

### Add a tested, redacted Git-history secret gate (F19)

Added a full-history CI secret scan using checksum-pinned Gitleaks 8.30.1. Shallow checkouts fail. Each run first creates a disposable Git fixture and verifies that a generated nonfunctional credential fails detection while the report remains redacted. Reports live outside the checkout and upload even on failure.

Review and validation: scanned 1,029 local commits. Reviewed all 24 generic-key findings as specific test/alphabet/nonce/digest false positives and recorded exact historical fingerprints, without excluding whole files or rules. The self-test detected its new synthetic credential despite the ignore list; the reviewed project scan then found zero remaining findings. See secret-scan-review.md and secret-scan-triage.json. No provider credentials were tested or rotated, and no remote CI run was triggered.

Four wrapper tests pass for checksum rejection before extraction, ignoring archive traversal paths, retaining scanner failure codes with redaction/all-history arguments, and rejecting shallow checkouts before downloading the tool.

### Record the unresolved dependency-license policy (F19)

Collected the full installed-package license inventory and compared metadata against T-05.03.04's literal allowlist. Twenty-three package entries fall outside it, including Nodemailer, axe-core, Lightning CSS and tslib. Saved the package/version/license list in license-policy-review.md and the normalized inventory in license-inventory.json. No dependency was silently exempted and no broader license list was approved. Asked the user which approved policy to use; independent repair work continues while that decision is pending.

Post-commit secret verification also passed at f9de86b: the synthetic credential was detected, and all 1,030 project commits had zero untriaged findings.

License policy update: the user instructed "ignore it. install any dependencies you need." The original allowlist is waived for this repair work, so the 23 metadata differences no longer block the plan. The inventory is retained as reference, without claiming legal review.

### Add tested static security rules and a fail-closed report gate (F19)

Added five local Semgrep rules with positive/negative fixtures for SQL text, outbound destinations, redirects, HTML output and literal credentials. The pinned tool runs without registry rules or telemetry. Reports preserve locations and severities but omit source, metavariables and parser snippets. Findings, parser errors, empty scans, missing reports and unexpected scanner versions fail.

Review and validation: all five rule fixtures and four report/failure-handling tests pass. Corrected draft-rule false positives caused by treating database query methods as request sources and Map.get as an HTTP client. Escaped one chart-heading ampersand to remove a JSX parser warning without changing display text. The final scan covered 654 source/runtime files with zero findings or parser errors; production build, lint and formatting passed. See static-security-review.md for the scope limits and static-security-scan.json for the normalized report. This does not replace cross-service review or close all F19 coverage/ownership requirements.

### Recheck financial configuration authority inside the write transaction (F04/F12/F14)

Dual-approval threshold and wallet top-up limit writes now lock and recheck the actor's financial-edit permission inside their transaction. Revoking the grant while a request waits prevents the write and audit. Permission failures retain HTTP 403 rather than becoming a generic server failure.

Review and validation: 49 focused configuration checks passed, including 16 migrated HTTP checks for denial, successful versioned writes, audit-failure rollback and concurrent role revocation across four configuration types. All 13 online top-up integration checks passed after giving their administrative fixture its explicit financial-edit grant; the existing limit-change race remains covered. Root types, lint and contract checks passed. Financial step-up enforcement remains a separate follow-up. No external settings were changed.

### Recheck service configuration authority during writes (F04/F15/F16)

Response targets, escalation policies and staff assignment rules now recheck their distinct current staff capability inside the write transaction, before configuration/team locks. Revoked grants return 403 and leave configuration, versions and audit history unchanged.

Review and validation: all 86 focused checks across seven files passed, including 28 migrated HTTP checks covering seven configuration endpoints. Corrected two new fixture mistakes before the final run: the assignment route name and mandatory in-app escalation channel. Root types, lint and contract checks passed. Team CRUD authority and its account-lock ordering remain the next bounded review.

### Protect team CRUD authority and account lock ordering (F04/F16)

Team create/update/delete now recheck the operator's current team-edit permission inside the transaction. Creates and updates lock the operator and member accounts together in sorted order, matching role-change locking. Updates discover membership before locking accounts and recheck it under the team lock; a changed membership returns 409 without overwriting it, and a fresh retry succeeds.

Review and validation: 71 focused checks passed, including real HTTP grant-revocation tests for all three team writes, overlapping operator/member creation and a membership-change race. The full API regression passed 2,896 tests across 224 files. Root types, lint and contract checks passed. The shared permission helper retains single-target support for existing callers. No schema or remote state changed.

### Require password confirmation for financial configuration (F04/F12/F14/F20)

Dual-approval threshold and online top-up limit routes now require a recent step-up confirmation. The wallet-limit form uses the shared confirmation/password dialog with a captured amount and expected version. Failed or malformed reads disable writes; saves must return the exact amount and next version before success appears. A version conflict retains the proposed change until the operator cancels and explicitly reloads. Reload/conflict text and version numerals support Persian and English.

Review and validation: 40 focused API checks passed, including missing and expired confirmation denial without configuration/audit changes and a successful fresh-confirmation retry. The draft initially omitted the guard metadata; the HTTP negative test caught this and the final routes include both guard and requirement metadata. Corrected the assertion to the actual nested HTTP error envelope. All 17 related UI unit checks and four browser checks passed. The browser checks cover both languages, password challenge, cancellation, failed/mismatched successful responses, version conflicts, reload and exact retry payloads. The two former DOM-only save/conflict cases were replaced with browser coverage. Root build, types, lint, contract, bundle and formatting checks passed. Emergency override remains outside this bounded change.

### Keep ordering closed when eligibility cannot be checked (F06/F20)

The electricity ordering screen no longer treats failed, unauthorized or malformed verification responses as permission to proceed. It clears stale profile context, ignores obsolete responses, disables the ordering/address actions until a valid check and offers localized retry. A valid response with no active profile also blocks the form. Existing unverified-profile blocking remains intact.

Review and validation: eight affected browser checks passed across Persian/English ordering and wallet-limit flows, including failed/401/malformed/no-profile responses, retry and zero write attempts while blocked. Root build, types, lint and route budgets passed. The initial size check caught 250.21 KB against the existing 250 KB ordering budget; extracted wallet-admin strings to a dedicated bilingual dictionary and verified both consumers. Ordering now measures 249.62 KB. A first browser run used an outdated heading assertion; the corrected exact existing heading passes.

Scope correction: the current repository has a general orders API that creates drafts. It deliberately does not represent the future commercial submission handler, as documented in ProfilesService.canPlaceCommercialOrder. The earlier broad note about missing ordering backends must not be read as saying no orders API exists. Full commercial submission, address-loading behavior and task-level acceptance remain separate follow-ups.

### Preserve the selected province's city options (F07/F20)

Saved-address city-name lookups now update only the name cache. Form lookups use a generation counter, clear the prior city immediately and ignore obsolete responses after a province change or unmount. Background name resolution cannot overwrite the form's selected city or options.

Review and validation: six ordering browser checks passed, including delayed saved-address and obsolete-province responses in both languages. Root build, types, lint, formatting and bundle checks passed; ordering measures 249.66 KB against 250 KB. This closes the city-selection race; failed address reads remain the next bounded fix.

### Distinguish failed address loads from empty results (F07/F20)

Ordering now clears stale address selection while loading, validates the returned address list and displays a retryable error for failed or malformed reads. The form and mutation handlers cannot proceed with an unavailable address list. Obsolete responses after profile changes or unmount are ignored. A valid retry restores the main-address selection.

Review and validation: all eight ordering browser checks passed in Persian and English, including 503, malformed address entries, retry and main-address recovery. Root build, types, lint, formatting and bundle checks passed; ordering is 249.90 KB against 250 KB. Product/province/city failure feedback and complete commercial submission remain separate work.

### Retain package coverage reports in CI (F19)

Corrected the coverage upload paths from a root-only directory to apps/*/coverage and packages/*/coverage. The shared Vitest configuration uses package-local default report directories; the old artifact step missed those reports.

Review and validation: confirmed the configured output behavior and matched five existing local coverage-final.json reports under the corrected paths. Workflow formatting and whitespace checks pass. Existing reports are path evidence only, not new coverage measurements. This correction does not implement the still-open changed-code/critical-domain threshold policy or claim a remote CI run.

Full browser checkpoint after 64b2260: all 240 Chromium checks passed in 2.6 minutes, including the migrated-API administration flows. All 114 web unit tests also passed. These are regression results, not complete per-task acceptance or operational certification.

### Align ordering with the public product contract (F17/F20)

Ordering now consumes the API's type/status/localized title fields, offers only active electricity products and uses the same localized product name in selection and review. Prices format exact integer strings through BigInt, avoiding precision loss above Number.MAX_SAFE_INTEGER. Failed/malformed product reads clear selection and offer retry; mutation handling requires a currently loaded eligible product.

Review and validation: 20 affected browser checks passed across ordering, wallet settings and navigation, including real response-shaped product fixtures, wrong-domain/inactive filtering, localized selection/review names and exact 9007199254740993 IRR display. All 17 receipt/wallet unit checks passed. Root build, types, lint and bundle checks passed. Type checking caught a remaining legacy titleFa read in the review summary, which now uses the same title helper. Extracted receipt-review translations from the shared dictionary while retaining its shared navigation label; ordering is 248.76 KB against 250 KB. No commercial-order lifecycle was added.

### Recover from ordering geography failures (F07/F20)

Province and form-city loads now distinguish failure from empty data, validate response fields and provide localized retry. Form-city responses must belong to the selected province. Dependent controls and saving stay disabled while required location data is loading or unavailable; the save handler also validates the current province/city selection. Obsolete responses cannot change the current loading/error state.

Review and validation: all twelve ordering browser checks passed, including failed/malformed province lists, failed/wrong-province city lists and successful retries in Persian and English. Root build, types, lint, formatting and route budgets pass; ordering measures 249.05 KB against 250 KB. Background saved-address name lookup may still fall back to IDs if unavailable; this bounded change covers editable location lists.

### Validate and report flaky-test quarantines (F19)

Replaced the always-zero placeholder with a registry validator and JSON/CI summary report. Missing or malformed registries fail closed; owners, issue links, normalized test identity, severity and 1–30 day expiry are validated. Expired critical entries fail CI; active and expired counts remain distinct. CI runs reporting after earlier failures and uploads the generated report. Runtime flakes are explicitly unmeasured, not reported as zero.

Review and validation: eight tests passed with invalid-field subcases, duplicate/missing fields, inclusive UTC expiry, critical/non-critical expiry, missing/malformed input, report replacement and workflow output checks. The actual empty registry passes with zero active quarantines and null runtime measurement. Workflow/docs formatting and whitespace checks pass. Automatic promotion and observed runner retry reporting remain separate work.

### Enforce changed-source coverage instead of relying on package floors (F19)

Added a CI gate that reads committed changes and package-local Istanbul reports. General changes require 80% executable lines and 75% branches; modified critical files require whole-file 90% lines and 85% branches. Package and critical/general groups cannot hide each other's failures. Missing reports/files and malformed counters fail, and the artifact records immutable base/HEAD hashes. Existing Vitest package floors remain active. The documented scope excludes unchanged critical files and does not equate uninstrumented browser tests with coverage.

Review and validation: eight checker tests pass, including exact threshold boundaries, deliberately failing critical line/branch coverage, missing/malformed reports, counter mismatch, multi-line branches, duplicate statement-line aggregation, critical classification and a real temporary Git repository with changed/deleted lines and ignored uncommitted edits. Review caught macOS symlink path normalization and misleading per-group pass flags on missing reports; both corrected. Workflow/docs formatting and whitespace checks pass. Application coverage is being measured separately; passing these fixtures does not certify application thresholds.

### Fail CI on observed browser flakes (F19)

Playwright now fails CI when a test passes only after retry. It emits JSON results; CI always publishes a separate outcome summary with actual flaky, skipped and failed counts. Missing or malformed results, no successful tests, runner errors and flaky/unexpected outcomes fail the summary check. Known quarantine records remain separate.

Review and validation: the actual application Playwright configuration passes a clean synthetic test and rejects a failed-first/passing-retry test. Both use the real installed runner without a browser or external providers. Two summary tests pass with failure, empty-run, malformed-count and runner-error subcases; CLI summaries correctly return success and failure against the real fixture reports. Root lint, targeted formatting and whitespace checks pass. This does not invent runner results for Vitest or certify production promotion.

Coverage checkpoint at 87c8550: the full coverage command passes existing package floors with 4,607 tests across 407 files, including 2,898 API tests and 567 DB tests. The new changed-coverage gate fails against the audit baseline. See changed-coverage-checkpoint.json for exact counts, source groups and 53 missing/malformed entries. Most missing entries come from index-file exclusions; an API AI-agent branch has a negative reported count. Frontend browser evidence is not currently included in unit coverage. These failures remain open, and this checkpoint is not acceptance certification.

Browser checkpoint after e927df7: the full production Chromium run reports 243 expected outcomes, one unexpected outcome, zero observed flakes and zero skips. The failure is ECONNRESET while forwarding GET /api/admin/roles in the Persian expired-staff-activation flow. This run failed; it is not a green regression checkpoint. The new outcome checker preserves that failure. Investigation continues.

### Include index implementations and shared configuration in coverage (F19)

Removed blanket index-file coverage exclusions from the shared, API and DB configurations. The exclusions also omitted implemented index routes and the primary translation dictionary. Declared the shared TypeScript/Vitest package as a development dependency of all seven coverage consumers and added it to global cache inputs. Global cache inputs alone did not make the existing affected-package selector follow that dependency; explicit workspace edges do.

Review and validation: a temporary Git repository using the real project manifests, lockfile and Turbo executable confirms that changing only shared Vitest configuration selects API, web, worker, DB, shared, UI and i18n coverage. Frozen installation passes. Full coverage passes existing package floors with 4,607 tests; rechecking baseline changes reduces missing/malformed source entries from 53 to one, the negative AI-agent branch counter. Threshold shortfalls remain; no coverage exceptions were introduced. Formatting and whitespace checks pass. The concurrently prepared address-form change is outside this coverage checkpoint.

### Keep ordering address saves consistent while pending (F07/F20)

Address creation now has a synchronous in-flight guard, captures the submitted fields, disables editing/cancellation while pending and prevents order creation while the address form is open or saving. A successful response must contain a nonempty ID, the exact profile/submitted address fields and a boolean main-address flag before the page adds/selects it or announces success. Obsolete address-generation responses are ignored. Failed or malformed saves retain the draft and show the localized error.

Review and validation: 14 focused browser checks pass across ordering and the previously failed activation flow in both languages. New checks cover synchronous double clicks, pending field/cancel controls, 503, mismatched profile, empty returned ID, preserved draft, exact repeated payload and successful selected-address recovery. Build, types, lint, formatting and bundle gates pass. The focused activation rerun passes, but the earlier full-run connection reset has no established root cause and is not marked fixed. Address creation after an ambiguous network failure still lacks server-side idempotency; this change prevents concurrent clicks and false success, not all possible retry duplication.

### Consolidate agent reference validation into one branch (F17/F19)

Agent updates now perform model selection and related-reference validation in one explicit if/else branch, retaining the existing query order and scalar-only behavior. The previous repeated condition around awaited calls produced a negative implicit-else counter in V8-to-Istanbul output, reproduced with unit tests alone. The checker continues to reject negative counters; none are clamped or silently accepted.

Review and validation: all 88 agent/service/controller/real-HTTP checks pass across six files. Focused coverage contains no negative branch counters after the refactor. Diagnostic focused coverage disabled only command-line whole-package floors because unrelated source is intentionally unexercised; committed thresholds and the changed-code gate are unchanged. Root types, lint, formatting and whitespace checks pass. Full coverage remains a separate required checkpoint.

### Preserve API diagnostics for failed browser fixtures (F19)

The administration browser fixture now captures bounded wrapper/API output and attaches it to a failed test after cleanup. This closes the diagnostic gap that left the earlier ECONNRESET without API logs. It adds no automatic request retry or passing override.

Review and validation: ten activation checks passed across five repeats, followed by ten additional serial checks to avoid concurrent shared-build effects. Targeted formatting, root lint and whitespace checks pass. The connection reset did not reproduce; its root cause remains unknown and is not marked fixed. These diagnostic changes do not change production application behavior.

### Collect browser coverage from a separate production-equivalent build (F19)

Added an opt-in dist-coverage build with hidden source maps and a shared Chromium coverage fixture. Normal dist output retains no maps. Browser records bind the tested revision and dirty-checkout state. Collection verifies executed asset bytes, rejects missing maps/records and maps V8 ranges to workspace source. A separate CI job merges same-revision clean browser coverage into package unit reports before applying unchanged thresholds. PR coverage includes all four browser-consumed packages so their unit baselines are present.

Review and validation so far: two address-save browser checks pass with collection, mapping 100 workspace source files. All 219 JavaScript assets are byte-identical between normal and coverage builds. Three collector/merge tests pass, including real range remapping, preservation of uncovered unit source, missing maps/records, source mismatch, negative raw ranges, stale revision, dirty checkout and missing unit report rejection. Tests caught non-plain Istanbul return objects; serialization now matches the actual report contract. Types, lint, targeted formatting and whitespace checks pass. Generated coverage output is ignored by Git/lint/format. Full instrumented browser regression and combined threshold measurement remain the next checkpoint; no threshold pass is claimed here.

Instrumented browser checkpoint at ff8d33a: all 246 checks passed. Collection correctly failed when a standalone component-test server supplied an asset absent from the production-app build; no combined coverage pass was reported. Browser records now explicitly bind the application origin. Scripts from separate component servers are counted as unmeasured, while absent or mismatched application assets still fail. Four collector/merge tests pass, including both origin separation and missing-application-asset failure. Root lint, formatting and whitespace checks pass. A clean full rerun is required for the revised record format.

Browser coverage completeness follow-up: all 246 checks passed again at aad28ff. Chromium omitted optional source text for several scripts; unverifiable ranges now contribute no hits and their count is explicit. Supplied source mismatches still fail. Diagnostic mapping reached 166 source files, then exposed three authentication checks extending an older fixture. That fixture now extends the collector, and collection requires at least one record per completed browser check. Six collector/merge tests pass, including zero credit for discarded source, missing completed-test records and missing result-file failure. Root lint, formatting and whitespace checks pass. Diagnostic dirty-run reports remain rejected by the merge gate; a clean run follows.

Combined coverage checkpoint at 0ea737a: all 246 browser checks passed and all 246 emitted records. Clean-revision collection/merge succeeded for web and UI. General changed web line coverage rose from 10.88% to 61.16%; critical web lines reached 71.63%. Requirements remain unmet. Review found an inverted minifier source span in the timezone page and unmapped intermediate shared/i18n JavaScript. The checker now conservatively includes the interval between mapped endpoints without changing counts, and collection chains the workspace TypeScript maps. Seven collector/merge tests and nine changed-gate tests pass, including missing intermediate maps and inverted-span uncovered counts. Diagnostic mapping now reaches 192 source files. Root lint, formatting and whitespace checks pass. A clean combined checkpoint follows; no threshold exception is granted.

Clean combined checkpoint at e5af3b7: all 246 browser checks pass, with zero observed flakes/skips and all 246 coverage records present. Mapping succeeds for 192 source files across web, UI, shared and i18n; revision and clean-checkout checks pass. Refreshed web/UI unit baselines before merging, so browser evidence is included once. The changed-source report now has zero malformed/missing source entries. Required thresholds still fail in 11 of 13 package/criticality groups; see combined-coverage-checkpoint.json. General web lines measure 61.05%, critical web lines 71.63%, general i18n lines 100%. These are coverage measurements, not fix-plan completion percentages. The feature loop remains paused and task acceptance remains open.

### Hold notification-template authority and audit every mutation (F04/F09)

Template create, update, publish, unpublish and delete now require current staff grants inside one transaction. Family locks serialize competing drafts and publication; row locks recheck state after waits. Every successful state change records its audit in the same transaction, and an audit failure rolls back the change. Removed a fabricated IP value from publication audit metadata.

Review and validation: 22 real HTTP checks cover all five mutation permissions, successful audits, audit-failure rollback, revocation during a wait, competing editors and a draft becoming active while an edit waits. Before repair, 15 failed; after repair all 22 pass. Related notification/admin regression: 109 checks across seven files pass. Root types and lint, targeted formatting and whitespace checks pass. Review identified a separate existing immutable-version violation in unpublish/create; that follows as the next bounded repair.

### Preserve published notification-template content (F09/F20)

Unpublish now archives the published row. Update, delete and publish reject previously published rows, including legacy rows left in draft status. A replacement draft can coexist with an active version; family locking prevents competing editable drafts. New families first publish version 1; subsequent drafts advance beyond retained history. Existing historical version numbers are not rewritten. The administration list shows version numbers, opens published/archived content read-only, and copies content into a separate new draft. Persian and English labels cover the new actions.

Review and validation: four new real HTTP lifecycle cases failed before repair and pass afterward; notification regression totals 113 checks across seven files. Four production-browser checks pass in Persian/English, including immutable content fields, disabled variable insertion/save, archived and legacy history, and copying without overwriting history. Root build, types, lint, contract, bundle budgets, targeted formatting and whitespace checks pass. Type checking caught untyped test JSON and was rerun after correction. Existing historical duplicates and the missing database-level version/supersession constraint remain distinct migration work; no production history has been altered or declared clean.

### Report draft-order creation truthfully and validate saved output (F20/F22)

The electricity page now says Save Draft / Draft Saved in Persian and English, explaining that processing has not been requested. Its existing endpoint creates DRAFT orders. A synchronous in-flight guard prevents duplicate-click requests, product/address choices are locked while saving, and success requires a nonempty saved ID plus exact profile/product/type/status/address-snapshot agreement with captured input. An obsolete profile-generation response cannot report success.

Review and validation: all 14 ordering browser checks pass, including two new language variants exercising a delayed failed request, duplicate clicks, locked controls, nine mismatched successful responses, retained selections and a valid draft result. Root build, types, lint and bundle budgets pass; whitespace checks pass. This closes the false submission/success claim and concurrent-click defect. Server idempotency for an ambiguous network retry is not implemented or claimed by this UI repair.

### Bind template-test UI confirmation to the actual saved channel (F09/F20)

Test-send now validates ok, channel and delivered status before showing a channel-specific Persian/English confirmation. Unsaved content cannot be tested as if it were persisted. A synchronous guard prevents duplicate clicks; content and destination are locked during a test. Switching editors invalidates the pending result, and changing content/destination clears or hides prior confirmation. Corrected stale API documentation that still described email/SMS tests as inbox-only.

Review and validation: eight notification browser checks pass, including both languages and all three channels, malformed/wrong-channel/failed outcomes, unsaved edits, duplicate clicks, pending field locks and switching templates before completion. Root build, types, lint, bundle budgets, targeted formatting and whitespace checks pass. Separately, the full API coverage run at the preceding implementation checkpoint passes 2,924 tests across 225 files. Test-send backend audit failure and transaction semantics remain the next repair; this UI change does not certify those paths.

### Commit template-test outcomes with current authority and audits (F04/F09)

Test-send now holds current staff grants and the selected template row while rendering and sending. Contact checks, provider database access, inbox creation and outcome persistence reuse the held connection. In-app delivery, latest-test metadata and audit commit together. Audit failures are no longer swallowed. Delivery exceptions are separated from persistence failures, so a delivered external message is not falsely relabeled failed after its audit errors. Audits include the tested version and prior updated timestamp.

Review and validation: 32 real HTTP cases pass; two newly added cases reproduced the former audit-rollback and revoked-permission defects before repair. Tests also cover missing CSRF, missing step-up and committed failed-channel outcomes. Notification regression totals 120 checks across seven files, including a provider-boundary test proving that an audit failure after email delivery returns an error, rolls back metadata and does not write a false failed outcome. Root types, lint, formatting and whitespace checks pass. External delivery cannot be rolled back after a provider accepts it; durable attempt/recovery semantics for a process crash or ambiguous retry remain a separate delivery concern. No provider delivery was performed outside test fixtures.

### Include verified component-browser execution in coverage (F19)

Calendar and data-table browser fixtures now retain their separate production builds and hidden maps during coverage runs. Each raw record explicitly registers the local component origin and build directory. The collector checks exact executed asset bytes, validates ranges and maps workspace source, while reporting component assets separately. Unknown origins still receive no credit; invalid registries, foreign origins, missing maps and escaped/symlinked component directories fail.

Review and validation: all 16 component browser checks pass, mapping two retained assets to seven real UI source files. This diagnostic checkout was dirty and its report is not accepted as merge evidence. All nine collector/merge tests pass, including positive component mapping and negative source/path/registry cases. Root types, lint, formatting and whitespace checks pass. A clean full browser and refreshed unit-coverage checkpoint follows; coverage thresholds remain unchanged.


Clean checkpoint at 28a0934: all 4,640 package tests across 408 files pass; all 252 browser checks pass with no observed flakes/skips. The 46 loop protocol tests, canonical queue validation and repository formatting also pass. Same-revision clean browser collection and merge succeed, now including the two component builds. Changed-source coverage still fails in 11 of 13 groups, with zero malformed/missing entries. UI changed lines rise from 32.67% to 49.26% and branches from 32.12% to 60.18%; no required threshold is waived. Reports are saved in combined-coverage-checkpoint.json and browser-outcomes-checkpoint.json. Provider review found client-attested test passes and preserved pass status after credential edits; these are active repair work, not accepted completion.

### Reject provider test self-attestation and stale eligibility (F09/F17)

Email/SMS legacy test-result endpoints now reject client-supplied outcomes and direct callers to the server connection-test endpoint. Editing provider configuration clears prior test status/time/error. Rollback requires a previously activated version with a passing test; a disabled untested draft cannot bypass activation through cloning. Updated the generated API contract for the deprecated endpoints.

Review and validation: eight real HTTP cases reproduced the bypasses before repair and pass afterward. Related provider regression totals 135 checks across 14 files, preserving genuine lifecycle/connection-test cases. Root types, lint, regenerated contract verification, targeted formatting and whitespace checks pass. Current grant/transaction locking, concurrent test-result binding and fail-closed provider-secret storage remain separate next repairs; no production provider was tested or changed.

### Fail closed on new provider secrets without an encryption key (F09/F17)

Provider secret writes now require the configured encryption key rather than storing plaintext when it is absent. Non-secret edits and masked placeholders retain their existing behavior; legacy values remain readable for compatibility. Updated environment guidance and startup messages. Added provider-secret-review.sql, a read-only inventory returning provider/field identities without secret values, for controlled legacy migration.

Review and validation: five new/changed checks reproduced plaintext fallback before repair. All 139 provider checks across 14 files pass after repair, including SMTP/Resend/SMS.ir secret rejection, real HTTP email/SMS updates with unchanged database rows and no secret in the response, keyed encryption/decryption and preserved masking. SMS lifecycle fixtures now use a real test encryption key. Root types, lint, formatting and whitespace checks pass. No production key, credential rotation or existing provider row was changed; legacy credential migration remains an operational requirement.

### Hold provider create/edit authority and commit audits atomically (F04/F09)

Email/SMS draft creation and editing now run on one held connection with current staff grants, a provider-family lock and a transactional audit. Draft edits lock and recheck their row before validation and persistence. Controllers pass the authenticated actor into edits; missing actor context fails the production permission check. Audit metadata contains provider identity/status only, and existing secret encryption/masking remains intact.

Review and validation: 12 of the first 16 real HTTP checks failed before repair; all pass afterward. Two additional row-transition checks pass, for 18 HTTP checks covering both channels. Related provider regression passes 155 checks before those two additions. Lint, targeted formatting and whitespace checks pass. The late typecheck result exposed incompatible pool query interfaces after the implementation commit; the following correction narrows the permission helper to the query operation it actually uses. Unit service fixtures isolate permission lookup only; actual grant/revocation and audit rollback evidence comes from the migrated HTTP tests. Activation, disable, rollback and live connection testing remain the next bounded lifecycle repair.

### Provider mutation query interface correction

The staff permission helper now accepts the SQL query operation shared by both database pool interfaces, without an unsafe cast or a requirement for unused PostgreSQL overloads. Runtime permission checks are unchanged. Root typecheck passes all 11 tasks; root lint exits successfully. Reviewed the diff for changes to authorization behavior and found none.

### Provider lifecycle transactions and rollback recovery

Email/SMS activation, disable and rollback now use the same held staff capability, provider-family lock, row recheck and transactional audit as draft writes. Activation cannot rely on a passing result invalidated while it waits. Rollback validates its source and SMS mappings before inserting, then clones, supersedes, activates and audits on one connection. Failure leaves neither a clone nor a partial provider switch. Disable controllers pass the authenticated actor. Active-provider unique conflicts remain HTTP 409; unrelated database failures are not relabeled.

Review and validation: initial expanded HTTP run exposed missing audits and stale authority. Its 14 failures included six incorrect test expectations for HTTP 201; lifecycle routes correctly return 200 and those expectations were corrected. Final provider regression passes 186 tests across 15 files, including 47 real HTTP checks for current/revoked permission, transactional audit failures, stale row/test state, invalid rollback mappings and active constraints. Root typecheck and lint pass; targeted formatting and whitespace checks pass. The sole-provider disable guard and live-test outcome binding remain separate pending repairs.

### Preserve active OTP provider channels

Disabling the single active provider is blocked for both email and SMS. Superseded or disabled history cannot deliver an OTP and no longer counts as a recovery path. Operators can activate a tested replacement or roll back atomically. Draft disable remains available. This follows the email sole-channel requirement and the shared SMS lifecycle in the canonical notification epic.

Review and validation: five new HTTP cases reproduced unsafe disables before repair; a sixth already-blocked case had an incorrect error-envelope assertion, now corrected to the public error code. All six pass after repair. Provider regression passes 192 tests across 15 files; SMS rollback tests now switch through an active replacement and still pass. Lint, targeted formatting and whitespace checks pass. A late typecheck caught direct property access on an unknown JSON response in the new test; the follow-up correction uses a structural assertion.

Correction validated: root typecheck now passes all 11 tasks. The test asserts the same error code through the typed test matcher without accessing unvalidated JSON properties.

### Bind provider connection tests to held settings and authority

Server connection tests now lock the draft and provider family while holding the actor's current capability through the result/audit commit. Test reads, result writes and email breaker changes use the same connection. A concurrent edit runs afterward and clears test eligibility; a role revocation waits for the authorized operation and blocks the next write. Provider audits include the resulting test status without credentials or raw diagnostics. The email breaker can bind to a transaction while retaining its configured thresholds and clock.

Review and validation: six added HTTP checks failed before this repair. Final provider regression passes 206 tests across 15 files, including 61 HTTP cases and six additional migrated-database delayed-transport cases. Only the external tester is simulated in those six cases; locks, role revocation, config persistence, breaker counters and audit rollback use PostgreSQL. Successful email tests reset prior failure counters; an audit failure restores them. Shared delivery regression passes 10 tests across three files. Root types, lint, targeted formatting and whitespace checks pass. Reviewed all connection-test reads/writes for accidental fallback to the outer pool. External sends already accepted by a provider cannot be undone if audit persistence later fails; durable attempt/crash reconciliation remains an explicit limitation.

### Bound SMTP failure diagnostics

Fixed a conditional-precedence error that returned the original unbounded SMTP diagnostic instead of the truncated string, and returned an empty message for an empty Error. Diagnostics now remain within 1,000 characters after credential redaction, with a usable fallback. Two new cases failed before repair; all six SMTP tester tests pass afterward, including password redaction and private-destination rejection. Targeted lint, formatting and whitespace review pass.

### Exercise the compiled worker and align process coverage

Added six tests that start the shipped worker against fresh PostgreSQL databases created by the production migration command. They exercise health, metrics, recurring job success, database outage/recovery, invalid interval defaults, missing system-actor recovery, SIGINT/SIGTERM drain and forced shutdown deadlines. The worker now reports its actual bound health port, including an OS-assigned ephemeral port. Tests rebuild workspace dependencies and the worker before launch, retain bounded diagnostics and clean up only fixture processes/databases.

API and worker share one process-coverage collector, with separate output directories and compiled-source roots. Coverage review reproduced duplicate branch entries caused by different compiler-mapped end positions. The collector now aligns only unique branch identities with the same type, source start and ordered arm starts. Ambiguous or incomplete mappings stay separate; no unexecuted arm receives credit. Ten regression tests cover merging, unchanged missing-arm counts, distinct/ambiguous mappings and implicit else locations. CI runs those tests and shared collector changes invalidate Turbo caches. The audit index now labels its historical findings and initial verification as baseline evidence.

Review and validation: full worker coverage passes 332 tests across 31 files, merging six process records over 31 compiled modules. Full API coverage passes 3,012 tests across 227 files, merging 170 HTTP process records over 264 compiled modules. Root typecheck passes all 11 tasks without cache; root lint, targeted formatting and whitespace checks pass. Worker whole-package coverage measures 95% lines and 76.51% branches; API measures 90.43% lines and 76.32% branches. These are regression measurements, not task completion or changed-critical-code gate certification. No production deployment was performed.

### Verify authentication delivery at the worker boundary

Added 35 worker-owned tests against the production-migrated database. They cover consumed/expired/replaced/exhausted codes, disabled accounts and credential changes, corrupt or mismatched encrypted payloads, retry backoff and terminal erasure, concurrent claims, expired-lease recovery, stale completion fencing, staff activation, SMS mappings and destination normalization, shared provider quotas, and email idempotency keys. Existing API mailbox flows remain in place; these tests directly measure the worker-owned paths. Provider I/O is controlled in-process; no external message is sent.

Review and validation: all 35 new checks pass. Full worker coverage passes 367 tests across 32 files; worker/dependency compilation, targeted lint, formatting and whitespace review pass. The delivery runner reaches all measured branch arms; its provider dispatcher reaches 97.29% branch coverage, with the remaining guard protecting an unsupported transport that the migrated SMS schema already disallows. Whole-worker coverage is 96.36% lines and 79.40% branches. Tests required no production behavior change. A stale completed send still reports retry after losing its lease, while the tested fence prevents it from overwriting the newer attempt; provider-level exactly-once delivery is not claimed.

### Preserve notification template version identity and lineage

Migration 0117 enforces unique positive versions per event/channel/locale and an optional foreign key to an older version in the same family. Publishing records the active version it replaces and returns that link through the API. Existing history retains its identifiers and content with null predecessor links. Duplicate legacy versions block migration for explicit reconciliation; no history is renumbered or deleted. A read-only inventory query and migration review are saved alongside this progress log.

Review and validation: all 120 notification tests pass. The final 32 HTTP checks also assert returned publication lineage. Five database checks cover the full baseline upgrade, valid history, archived/draft duplicate rejection, concurrent insertion, foreign-key restrictions and migration replay. Root types and lint pass; targeted formatting and whitespace checks pass. Reviewed generated SQL and kept only this task's changes. The generator exposed unrelated snapshot drift after 0097; its reconciliation remains the next database step. No production migration or inventory was run.

### Reconcile migration generator metadata with implemented schema

Added generated snapshot checkpoint 0118 with a no-op SQL statement for structures already installed by earlier migrations. Catalog review caught and corrected the ORM wallet callback CHECK that omitted the durable `processing` state supported since migration 0112. No earlier migration or snapshot was rewritten. The detailed scope and limitations are in `schema-snapshot-review.md`.

Review and validation: 32 changed-table catalog checks pass, comparing PostgreSQL-parsed definitions against a fresh production-migrated database. The combined baseline, lineage and domain-constraint run passes 42 tests. A new CI guard verifies generation in an isolated copy and tests both matching and deliberately stale snapshots. The negative test caught an exit-zero generator error during implementation; the guard now rejects diagnostics and requires explicit no-change output. Root types and lint pass. No product data or deployed database changed.

### Repair translation lookup and dictionary gaps

The full dictionaries lacked 23 English entries and one explicit English-label alias in the Persian dictionary. Added the missing CRM, verification-notification and onboarding messages while retaining the existing bilingual onboarding keys. Translation resolution now reads only own dictionary entries, so unknown keys such as `toString`, `constructor` and `__proto__` return the key rather than inherited objects/functions. Unsupported runtime locales use English; Persian remains the default. The authentication bundle imports only the small shared lookup helper.

Review and validation: 15 of 16 new checks reproduced the original gaps or inherited-property behavior. All 17 i18n tests now pass, covering dictionary-key parity, interpolation names, declared messages, default locale, runtime fallback and prototype-name handling in all seven generic resolvers. The localized chargeback status placeholder intentionally differs by language and is explicitly normalized in the parity assertion. Root build, types, lint, contract and bundle checks pass; formatting and whitespace review pass. Browser coverage must be refreshed before reporting a new combined coverage gate result.

### Full regression checkpoint at 39498a0

The serial workspace coverage run passes 4,814 tests across 416 files. It retains valid Turbo cache hits for unchanged inputs; API, worker, database and web suites ran with current changes. All 252 Chromium browser checks pass with zero retries or skips. Browser coverage maps 252 records to 194 source files and merges into web, UI, shared and i18n unit baselines from this clean revision. All 46 loop tests pass; queue validation reports 1,355 tasks and 116 traceability entries. Root build, types, lint, format, contract and bundle checks pass.

The refreshed changed-code report is saved in `combined-coverage-checkpoint.json`. 8 of 13 groups still fail their required coverage gates; checker errors are empty. Passing test counts do not close those gates or certify every historical task. The next bounded repair concerns contract-template storage cleanup and uncertain transaction outcomes.

### Make contract-template object cleanup durable

Template uploads now check current staff permission and lock the template before touching storage. They commit a separate cleanup reservation, lock it through the object write, and mark it immutable in the same transaction as version history and audit. Rollback or process loss leaves worker-owned deletion intent. A lost COMMIT acknowledgement cannot trigger immediate deletion of a successfully committed template. Unknown templates and failed reservations never write an object. Existing archived files remain untouched.

Review and validation: three new HTTP cases reproduced missing reservations and protection before repair. The final related run passes 63 tests across five files, including 20 template HTTP checks and four migrated-database failure/concurrency checks. Those checks execute a real PostgreSQL COMMIT and then simulate acknowledgement loss, retry a failed cleanup transport, preserve a locked eligible reservation during upload, and clean bytes accepted before a lost PUT response. Existing storage HTTP regressions pass. Root types, lint, contract and targeted formatting checks pass; reviewed reservation and business-transaction connection ownership. No production object inventory or cleanup was run. PDF/DOCX parsing remains outside this bounded storage repair.

### Verify SMTP destination guard boundaries

Added direct guard coverage for IPv4 reserved-range edges, IPv6 local/multicast/documentation addresses, mapped IPv4 spellings, malformed input, mixed DNS answers, resolver failures, IP-literal bypass of DNS and explicit host allowlist behavior. All 60 guard checks plus four existing SMTP delivery tests pass. Shared typecheck and targeted lint pass. No destination policy changed in this step; this verifies the currently documented blocked ranges rather than certifying every special-purpose Internet allocation.

### Repair frozen production packaging with dependency overrides

The current image rebuild failed in `pnpm deploy` with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`, although frozen installation succeeded. The pinned pnpm 10.8.1 deployment path discarded overrides. Updated the package-manager and CI pins together to 10.11.1, which includes the upstream correction documented in [pnpm's release notes](https://github.com/pnpm/pnpm/releases/tag/v10.11.1) and [fix #9546](https://github.com/pnpm/pnpm/pull/9546).

Review and validation: frozen workspace installation passes with no dependency lockfile changes. The API image rebuild, including both API and worker production packaging stages, now succeeds. Snapshot generation guard and its negative test pass with the new tool version. Runtime image boot and shutdown checks follow this packaging checkpoint. No legacy deployment mode or dependency re-resolution was enabled.

### Refresh production image boot and shutdown evidence

Rebuilt API, worker and web images from clean commit 2aeaf54 after the pnpm packaging correction. All isolated runtime checks pass: non-root/read-only startup using packaged migrations, optional Redis failure, database readiness loss/recovery with continued liveness, simultaneous notification and finance drain, forced deadline rollback, restart with one committed result, and clean web/API SIGTERM. Image identities and exact source revision are saved in `production-image-checkpoint.json`. The test's lease shortening and disconnected-session termination remain explicit fixture controls. No deployed service or existing database was touched.

### Validate notification subjects and persisted publication content

Template validation now rejects empty, unclosed, reversed and nested delimiters, malformed dotted paths and prototype-related names even when allowlisted. Rendering does not serialize symbol values. Creation and editing validate subjects as well as bodies; publication revalidates stored content before replacing the active version. Removing a variable referenced by a retained subject leaves the draft unchanged.

Review and validation: ten new shared checks and six HTTP checks reproduced gaps before repair. Final runs pass 20 shared renderer tests, 130 API notification tests across seven files, and 138 worker notification tests across twelve files. Review added two cases for stray braces inside placeholders; shared and worker checks and the final API rerun include that change. Root types and lint pass. Reviewed the changed blocked-placeholder diagnostic contract, transaction ordering, formatting and whitespace. These changes are not yet included in the saved production image checkpoint.

### Bound optional Redis failures and preserve TLS settings

The factory now catches construction failures, retains configured TLS options, disables offline command queuing and applies a configurable one-second command deadline. The retry default is one; the previous null default meant commands could wait indefinitely despite its fail-fast comment. Explicit retry settings remain supported within the command deadline.

Review and validation: three new checks reproduced discarded TLS settings, escaped constructor errors and unbounded defaults. All 38 Redis/configuration-cache tests pass, including a real TCP fixture using ioredis that stops replying after connection. Ping reports the deadline, a configuration read returns its database fallback, and commands after disconnect reject. Shared types, targeted lint, formatting and whitespace checks pass. No live Redis instance was changed. Review found a separate configuration-cache version race and unsafe missing-version fallback; that is the next repair.

### Make configuration-cache freshness authoritative

The cache now validates a positive, equal PostgreSQL version instead of trusting Redis's invalidation counter or treating missing metadata as zero. Cache population reads the version before and after the database value and skips caching if a concurrent commit changed it. Malformed entries are rejected. A new entry namespace excludes values labelled fresh by the previous race; those old keys expire naturally. The Redis ADR now describes the metadata round-trip, current command deadlines and PostgreSQL-backed sessions.

Review and validation: seven new shared checks reproduced stale/malformed cache acceptance and the population race. Final shared Redis/cache regression passes 51 tests. The API cache, profile and wallet regression passes 636 tests across 41 files, including five new production-migrated database cases for missed invalidation, a concurrent commit, missing/failed version metadata and old cache keys. The cache I/O is controlled in those five tests; database values and committed versions are real. Root types, targeted lint, formatting and whitespace checks pass. Reads concurrent with a commit can return their earlier database snapshot, but cannot cache that row under the later version. Every configuration writer must still bump the durable version in its transaction.

### Restore explicit workspace installation and development behavior

Added the required strict-peer and non-hoisted settings to .npmrc. README now uses the package-manager version declared by the project and runs the production migration command during setup. The database development task watches compilation instead of invoking schema push as a side effect of root development startup. Explicit schema tooling remains available separately.

Review and validation: an initial noninteractive pnpm run exited zero at a reinstall prompt and was not counted as a successful install. Repeated with CI=true, which completed the fresh frozen installation of all ten workspace projects with the strict settings and unchanged lockfile. Root build passes after installation. The Turbo dry run resolves the database dev command to persistent compilation; formatting and whitespace checks pass. No database command was run against the developer's database.

### Begin explicit per-task acceptance sign-off

Added acceptance-closure.json with eight task-level sign-offs, exact reviewed source revision, requirement text/hash, source hashes, checks and limitations. The remaining 314 recorded task keys are explicitly pending; baseline PR and completion evidence remains unchanged in task-review.json. These eight records certify their task scope, not all sibling story requirements or operational rollout.

TypeScript requirement review found that the root solution omitted the worker. Added its project reference; the root dry build now includes all seven runtime code projects, and normal root typechecking passes. Full library checking remains incomplete: enabling it for the database package produces 144 dependency declaration errors in the installed Drizzle types, saved in database-library-type-errors.txt. UI still relaxes exact optional properties and unchecked indexed access. These exceptions prevent blanket strict-mode acceptance and remain repair work.

### Restore strict optional-property and indexed-access checks in UI

Removed the UI package's two strictness overrides. Calendar/date-picker wrappers now omit unset optional properties, and the toast wrapper normalizes unsupported theme names to the supported system theme while preserving explicit caller overrides. No type assertions or compiler suppressions were added.

Review and validation: enabling both checks initially reported four component errors. The repaired UI and downstream root typechecks pass. All ten UI tests pass, including six toast-theme checks. All twelve Chromium date-picker interaction checks pass, covering single/range selection, locale switching, focus, mobile presentation and account timezone/DST behavior. Root build, targeted lint, formatting and whitespace checks pass. Library checking exceptions in API, web, worker, database and shared packages remain open.

### Full regression and combined coverage after workspace/cache repairs

The serial workspace run at 940746c passes 4,945 tests across 422 files, retaining valid cache hits for unchanged inputs. All 252 Chromium checks pass at 86d9f49 with zero retries or skips. The intervening commit changes only nine generated README source locations in the traceability ledger; application and test sources are identical. Browser collection maps 252 records to 194 files and merges four package reports.

The updated combined-coverage-checkpoint.json has no checker errors. Seven of thirteen groups still fail, down from eight: shared general coverage now passes at 86.83% lines and 76.57% branches. Shared critical branches pass at 85.59%, but its 88.48% lines remain below 90%. API critical, both web groups, database general, i18n critical and UI general also remain below required gates. No threshold or exclusion was relaxed. All 46 loop tests pass; queue validation reports 1,355 tasks and 116 traceability entries after regeneration. Root lint, formatting, contract, bundle and database snapshot checks pass. The saved production images remain the older 2aeaf54 checkpoint.

### Enable library checking in shared code

A version-bound pnpm patch corrects the Nodemailer SMTPError declaration so its optional code property matches the Node ErrnoException interface under exact optional-property checking. The patch changes one type declaration, not runtime delivery code. Removed skipLibCheck from the shared production configuration. Dependency versions are unchanged; the lockfile records the patch hash for each existing consumer.

Review and validation: full shared library checking failed with one TS2430 declaration error before the patch and passes afterward. Root typechecking and frozen installation pass with the patch applied. Shared authentication/notification delivery tests pass. Formatting and whitespace review pass; Docker build contexts include the patch directory. API, web, worker and database library-check exceptions remain open, including the recorded Drizzle declaration failures.

### Repair root test discovery and per-project database setup

Replaced the obsolete Vitest workspace file with root projects configuration for the installed Vitest 4 API, following its [migration guide](https://v4.vitest.dev/guide/migration). Added the previously unwired configuration package tests to the normal Turbo test commands. Their old whole-package threshold assertions now describe the existing separate changed-code gate policy; production threshold configuration did not change.

Database fixture paths now resolve from their source files. Global setup assigns each project's test database through its own environment and returns a teardown bound to its own container. It cleans up failed bootstrap attempts. Root discovery excludes the separate Node snapshot test from Vitest, while check:db-snapshot continues to execute it.

Review and validation: the installed package has no defineWorkspace export. A root database test reproduced the working-directory failure; all 434 schema tests then passed. A combined API/database/worker selection passed 56 tests. Three focused setup checks verify independent environment/teardown ownership and cleanup after query or pool-close failures. The first full root run passed all 4,951 assertions but failed on accidental collection of the Node test file. After correcting discovery, the final root run passes 4,951 tests across 423 files and eight projects. Separate Node snapshot checks pass both cases and the no-drift check. Root types pass without cache, root lint and formatting pass, and no duplicate test paths remain in discovery.

### Validate receipt file identity and preserve browser upload MIME

Receipt helpers now require a permitted filename extension, matching supplied MIME, a canonical attachment key, matching storage category, and valid optional metadata types. Blank browser MIME is derived from the extension and carried consistently through presign, PUT and attachment recording for all four upload callers. This fixes PNG/WebP files previously labelled JPEG. Server byte inspection already existed; these helper gaps are not claimed to bypass it.

Review and validation: twelve negative cases failed before the repair. Final shared receipt tests pass 80 cases across two files; browser upload and caller tests pass 36 across three files, including rejection before network requests and consistent MIME through the full upload sequence. API receipt tests pass 75 cases across seven files. Root types, targeted lint, formatting and whitespace checks pass. Existing nullable optional metadata remains supported.

### Reject invalid persisted quota counts

Both PostgreSQL increment paths now reject missing, non-positive, fractional, unsafe or malformed returned counts instead of granting quota or returning invalid remaining counts. Decimal bigint strings remain supported. Peeking returns zero for an absent row only; a malformed existing row fails. Fixed-window comments now describe the actual boundary behavior without claiming sliding-window enforcement.

Review and validation: 33 new cases failed before the repair. All 59 shared rate-limit tests pass afterward, including cleanup start/stop/restart and recovery after a failed cleanup query. API login, proxy and OTP regressions pass 17 cases across three files. Shared typechecking, targeted lint and whitespace checks pass. SQL and quota windows are unchanged; full sliding-window acceptance remains open.

### Make suppression scanning fail on incomplete inspection

Replaced the shell find/grep pipeline, which discarded scan failures, with a Node scanner. It detects all three TypeScript suppression directives and module-source extensions, handles paths with spaces, and fails on missing scan roots or source symlinks. The only generated-file exemption is nocheck in the exact TanStack route-tree file; other directives and other generated filenames remain checked. Existing conservative text matching is retained, so directive mentions in strings also require removal.

Review and validation: the root command runs eight negative/positive fixture tests before scanning the repository. All pass, including missing-root and broken-link failure cases, exact generated exemption, test/build exclusions and line reporting. Repository scan, targeted lint, shell syntax and whitespace checks pass. No production handwritten suppression was added or exempted.

### Wait for worker fixture connections before dropping its database

The next full coverage attempt failed despite all 367 worker assertions passing: PostgreSQL emitted an unhandled administrator-termination error on a fixture connection. Inspection of the installed pg-pool implementation showed end resolves after removing clients from its internal list, before client sockets necessarily close. The subsequent forced database drop could therefore terminate an idle fixture socket.

Fixture teardown now records each connection's end event and waits for all connections after pool.end, before dropping its isolated database. No error listener swallows unexpected failures. All six compiled-worker lifecycle tests pass after repair, including database outage, in-flight shutdown and forced deadline. Targeted lint, formatting and whitespace review pass. The failed coverage attempt is not counted as a successful regression checkpoint.

### Restore standalone PostgreSQL fixture callers

The full browser attempt at 711ad50 failed on the live API fixture: it still called the old argument-free setup and removed teardown export. That attempt had 212 passes, one failure and 39 tests not run. The preceding uncached workspace run passed 5,049 tests across 423 files; it did not cover this standalone caller.

Extracted an explicit startTestPostgres API returning a connection URL and owned close function. Vitest retains project-specific environment assignment through its adapter. Updated both standalone callers found in the repository: the live admin API fixture and constraint inventory script. The API fixture now cleans up acquired resources after startup failures as well as normal termination. The constraint script always closes its container even if pool teardown fails.

Review and validation: all four setup tests pass, including the standalone API and unchanged global environment. All forty live admin browser flows pass against the migrated API in both locales. The constraint inventory script runs successfully and finds all eighty expected legacy constraint names; refreshed inventory includes the later migration constraints and corrected callback processing state. This inventory is not a substitute for behavioral constraint tests. Root types, targeted lint, formatting and whitespace checks pass. Full browser coverage still needs a successful rerun.

### Combined coverage reaches six remaining failing groups

At 89e71e8, all 252 Chromium checks pass with zero retries, skips or runner errors. Collection maps 252 records to 194 source files and merges four package reports. The database coverage rerun passes 607 tests across 81 files after the standalone fixture repair. Other package reports come from the uncached 5,049-test full run at 711ad50; none of their covered source files changed between those revisions, verified against the complete report path sets. The browser application assets likewise have unchanged source. These checks provide 5,050 current unit/integration assertions across 423 files, with the revision distinction retained here.

The combined checkpoint has no checker errors and six of thirteen groups fail, down from seven. Shared critical now passes at 90.24% lines and 87.51% branches. Remaining failures are API critical, both web groups, database general, i18n critical and UI general. No threshold, critical classification or coverage exclusion was relaxed. Root build, typechecking, lint, formatting, contract and bundle checks pass; queue validation remains 1,355 tasks and 116 traceability entries. Production images still require refresh after the recent runtime repairs.

### Validate cached wallet payment outcomes before replay

Cached wallet-to-invoice responses now require consistent invoice/profile/ledger identity, a completed payment debit exactly matching the positive decimal amount, a supported prior state and valid timestamps. The service also binds the cached ledger idempotency key to the current request. Invalid snapshots fail with the existing conflict response before money/date conversion or successful replay. Paid-state ledger recovery with an empty historical audit identifier remains supported.

Review and validation: twenty helper cases and five migrated PostgreSQL cases failed before repair. All 37 helper tests and 56 API service, integration and concurrency tests pass afterward. The corruption cases verify unchanged wallet balances, ledger rows and audit history, with no second debit. Existing exact-money and idempotent concurrent payment checks remain passing. Root typechecking, targeted lint, formatting and whitespace checks pass. The latest combined coverage report predates this repair; no updated coverage claim is made here.

### Localize shared table controls and block hidden-row selection

The shared DataTable now has Persian/English control dictionaries, explicit locale and numeral options, locale-aware text sorting, logical alignment/spacing and an announced busy state. Select-all is disabled while loading or empty so it cannot change selection for rows hidden by the loading display. Custom empty text remains supported. Language changes retain selection and do not emit user-change callbacks.

Review and validation: three browser regressions failed before repair. All eight table browser checks pass afterward, including the existing keyboard sorting and controlled/uncontrolled selection cases plus both locale states, direction changes and Latin digits within Persian labels. Root typechecking, targeted lint, formatting and whitespace review pass. This is shared-component acceptance; no current feature page imports DataTable, and broader account-preference/localization acceptance remains open.

### Restore accessible multi-select chip removal

ComboBoxChip now renders the Base UI native removal button with a required localized action label and a decorative icon inside it. The former SVG replacement had no accessible button name. The button has a 24-pixel target and visible keyboard focus. Popup children now accept the underlying list's render-function contract, allowing typed filtered-item rendering. Option padding and indicator placement use logical directions. This follows the installed Base UI implementation and its [combobox documentation](https://base-ui.com/react/components/combobox).

Review and validation: four browser cases failed before repair; the search/keyboard case already passed. All five pass afterward, covering Persian/English accessible names, native button semantics, removal and input focus, filtered selection, Backspace deletion, and disabled/read-only protection. Root typechecking, targeted lint, formatting and whitespace checks pass. No existing application caller needed a label migration. Base UI's global direction context is a separate unresolved wiring issue found during this review.

### Align Base UI direction and forward tab orientation

The app root now supplies Base UI direction from the shared document locale and keeps the HTML direction synchronized during language changes. A dedicated UI package entry exposes the provider without requiring a root barrel import. Tabs now forward orientation to the primitive, so vertical tabs expose the correct accessibility state and respond to up/down arrows. Tab icon spacing and vertical indicators use logical directions.

Review and validation: browser checks reproduced the missing RTL context and dropped vertical orientation. Initial tests also assumed automatic activation and a single panel during transitions; corrected them to press Enter for the installed primitive's manual activation mode and target the named panel. All 22 direction/date-picker/multi-select checks and all 59 application form/dialog checks pass. Direction changes preserve tab selection. Root build, types, targeted lint, formatting and bundle gates pass; login is 143.59 KB gzip under its 150 KB budget. These tests do not certify every remaining shared widget or full screen-reader acceptance.

### Refresh production image verification after runtime and UI repairs

Built all three production images from clean b6c646c using pnpm 10.11.1. The disposable production-image suite passes all four checks: non-root/read-only boot and packaged migrations, database outage/recovery, concurrent finance/notification shutdown, and interrupted-job retry with one committed result. Web and API terminate cleanly. Exact image identities are recorded in production-image-checkpoint.json.

The forced-deadline fixture explicitly terminates orphaned PostgreSQL sessions and shortens the durable lease before retry. It does not establish natural disconnect or production lease timing. No deployment, existing database, external provider or scheduler was changed.

### Review four more infrastructure task requirements

Recorded two verified tasks for typecheck/suppression enforcement and Turbo test orchestration, using their exact canonical task blocks and source hashes. Recorded two partial tasks for the absent TanStack Start pipeline and six remaining combined coverage failures. Passing builds do not satisfy the missing server-rendering requirement, and passing test assertions do not satisfy failing coverage gates. The register now contains 16 assessed tasks: 13 verified, three partial, and 306 still pending individual acceptance review.

### Reject malformed Redis quota results

The general limiter now rejects nonpositive, fractional, unsafe or nonnumeric Redis counts and malformed TTL values before calculating quota responses. Redis protocol sentinel TTL values remain supported. Invalid replies use the existing PostgreSQL fallback instead of returning NaN quota fields or allowing a request from a negative count.

Review and validation: 15 regression cases failed before repair; all 74 rate-limit tests pass afterward. Shared typechecking, targeted lint and formatting pass. This change does not make the separate Redis increment/expiry commands atomic, reconcile general counters across Redis loss, or replace fixed windows. Security counters remain PostgreSQL-authoritative. The production image checkpoint predates this follow-up.

### Make Redis quota increment and expiry atomic

Replaced separate INCR/PTTL/PEXPIRE calls with one parameterized Lua operation. A client disconnect between those former commands can no longer leave a newly incremented key without expiry. Existing deadlines remain unchanged, and legacy keys without expiry receive one without resetting their accumulated count. Script response shape, count and TTL are validated before use. Redis documents server-side script atomicity at https://redis.io/docs/latest/develop/programmability/eval-intro/.

Review and validation: all 81 rate-limit unit checks and four tests against a disposable Redis 7 container pass. Real Redis tests exercise 100 competing requests with exactly 20 admitted, existing deadline preservation, legacy missing-expiry repair and expired-key renewal. Root typechecking, targeted lint and formatting pass. General Redis/PostgreSQL fallback reconciliation and the canonical sliding-window/token-bucket requirement remain open. This does not claim resilience to Redis data loss or Lua command failures after a partial script write.

### Refresh combined coverage after wallet, UI and quota repairs

At f238418, the full workspace run passes 5,102 tests across 424 files. Turbo completes 12 tasks with four cache hits. All 266 Chromium checks pass in 2.5 minutes. Browser collection maps 266 records to 198 source files and merges four package reports. The combined checker reports no collection errors; six of thirteen groups still fail. Thresholds and exclusions remain unchanged.

This checkpoint includes cached payment validation, table localization, accessible multi-select removal, direction/orientation repairs, malformed Redis result validation and atomic Redis expiry. It does not certify the newly identified dashboard wallet placeholder or wallet HTTP precision defect. Those repairs follow this checkpoint.

### Preserve exact wallet balances at the HTTP boundary

Wallet read and create responses now serialize available, posted and reserved IRR balances as decimal strings instead of converting bigint values to JavaScript numbers. A missing wallet returns the same string representation for zero. The wallet page declares the string contract and explicitly formats it through BigInt.

Review and validation: a migrated AppModule HTTP test reproduced rounding above Number.MAX_SAFE_INTEGER. All 19 wallet-controller/profile-access tests pass after repair, including exact read and idempotent create responses and existing capability checks. All 15 wallet page tests pass, including exact Persian/English large-balance display. The display cases already passed in the installed runtime when given strings; the reproduced defect was the API conversion. Root typechecking, targeted lint, formatting and the existing contract gate pass. External consumers of these balance fields must consume decimal strings; the only repository HTTP reader is updated. No ledger value or amount was changed.

### Replace the dashboard wallet placeholder with scoped live data

The dashboard now resolves one active profile context, calls the wallet service for its exact available balance, returns the profile name and compares available funds with that profile's due unpaid invoices. A legal-only agent receives no wallet data. Missing active membership returns 404; database read failures propagate instead of returning successful zero counts. The existing quick-count queries reuse the same resolved profile.

The page uses the current document language, displays exact IRR and rounded toman amounts through BigInt, and offers a localized retry that restores data without reloading the document. Quick-card counts are localized, direction spacing is logical, and ticket links now reach the ticket list.

Review and validation: three real HTTP regressions failed before repair. All 15 dashboard/profile tests pass, including revoked membership, due versus future liabilities, exact balances and failed reads. All 42 live API browser flows pass, including the two new dashboard flows in Persian and English. An initial combined browser run also exposed two undefined locale references introduced while updating tests and an alert selector that became ambiguous after adding the dashboard alert. Corrected those test defects; all six profile-switch checks now pass, including cross-tab refresh and stale-response isolation. Root build, types, targeted lint, formatting, contract and bundle checks pass.

Contract counts still derive from confirmed orders until the separate contract module exists, and the future order/contract filtered-list consumers remain incomplete. The dashboard summary is informational; it does not authorize payments or provide a transactionally frozen financial snapshot. The current full coverage and production-image checkpoints predate this repair.

### Record dashboard acceptance boundaries

The task register now has 19 assessed tasks: 14 verified, five partial, and 303 pending individual review. The wallet balance card is verified against its current requirements using real API/browser evidence. Dashboard layout and quick-status parents remain partial because dedicated contract counts and future filtered order/contract pages are not complete. Original merged PR evidence remains separate and unchanged.

### Keep unpublished branding out of public responses

The brand configuration service now returns active values or safe defaults unless a staff caller explicitly requests draft fallback. The permission-checked administrator read retains preview access; the unauthenticated public read cannot publish the first draft implicitly.

Review and validation: a real HTTP regression exposed the first draft before activation. All 16 brand service/controller and migrated HTTP checks pass after repair, including staff preview, activation and retaining published values while the next draft is edited. Two initial unit failures came from obsolete queued mock responses after the public query stopped reading drafts; corrected the expectations and reset mocks between tests. Root typechecking, targeted lint and formatting pass. Existing activation/version-history concurrency and audit behavior still require review; this bounded repair does not certify the whole branding task.

### Preserve branding revisions and bind publication to the reviewed draft

Brand saves now append immutable versions under a transaction lock, require the current version, and supersede previous drafts without overwriting their payloads. Activation requires the exact saved draft ID and version. Both mutations recheck current staff permissions under lock, require recent step-up authentication, and commit their audit event with the configuration change. Public reads retain published values while staff preview the newer draft. The UI captures the confirmed operation and prevents activation with unsaved edits.

Review and validation: two real HTTP regressions reproduced overwritten history and concurrent lost updates. Seven migrated HTTP checks now pass, including competing saves, stale/repeated activation, revoked permissions, step-up and audit-failure rollback. The related three-file service/controller run passed 16 tests before the final test-only response parser change; the final seven HTTP cases and root types pass afterward. Three production browser checks pass, including Persian/English publication flows and label associations. Root build, types, contract, bundle, targeted lint and formatting pass.

Migration 0119 only expands the existing enum with superseded; existing rows remain intact. Its journal time follows the previous entry, whose timestamp was ahead of the generator clock. Five migration tests pass for clean startup and representative upgrade. The snapshot check's negative fixture now discovers the latest snapshot instead of hardcoding 0118; both checker tests and schema validation pass. Old SQL-sequence mock tests were replaced by real transaction checks.

Remaining branding gaps include persistent logo uploads, full page localization, account-timezone dates and downstream theme consumers. This repair does not certify the whole branding task. Production image and combined coverage checkpoints predate it.

### Store branding logos as verified immutable assets

The logo selector now uploads through the existing presign, PUT, verify and record transaction. Saving a draft seals the current verified bytes into a separate immutable object owned by that branding revision. Source upload changes cannot alter a saved logo. Both server and browser enforce a 2 MB PNG/JPEG/WebP limit; SVG is no longer offered. Upload errors remain visible, outstanding uploads disable save/activation, cancellation propagates, and temporary preview URLs are revoked.

Saved images have stable application URLs. Staff preview reads require branding permission, while public reads require a matching active configuration. Reads enforce the stored size and SHA-256 digest and return nosniff image responses. Configuration input rejects blob, data, javascript and plain HTTP URLs; made-up internal image references cannot be saved. External HTTPS image URLs remain supported. CDN hosting/cache policy remains an operational follow-up; these authenticated draft and active-only public endpoints deliberately use no-store.

Review and validation: 27 branding API tests pass, including a real migrated upload/publication flow, draft privacy, wrong uploader/purpose, oversized or altered sources, corrupted sealed objects and durable cleanup intent after audit rollback. All 22 ticket/legal attachment regression checks pass after extending the shared sealing service. Ten browser-upload helper tests pass for stage failures, content rejection, invalid files and cancellation. Three production browser checks pass, including actual PNG rendering after reload in both languages. Root build, types, targeted lint, formatting, contract and bundle checks pass. The initial typecheck caught an extra argument accidentally added to activation while editing save handling; corrected before these passing checks.

No storage migration or live object changes were made. Browser/API storage fixtures are local S3-compatible test servers, not evidence of deployed CDN configuration. Full page translation and downstream theme acceptance remain open.

### Localize branding controls and display account-timezone dates

The branding page now translates labels, actions, confirmations, upload failures, loading messages and version information in Persian and English. Its dictionary is loaded only by the branding route, avoiding additional shared route bundle weight. Review caught the previous step's upload messages inserted into the opposite language dictionaries; corrected and covered by explicit language checks and rejected-upload browser flows.

Shared formatInTimezone, formatDate and formatTime helpers now format UTC instants using an explicit account timezone. Ambiguous local timestamp strings and invalid timezones fail instead of silently using the browser timezone. Branding uses the account preference and hides saved timestamps with a retry message if that preference cannot be loaded. Changing language does not refetch and discard unsaved form edits.

Review and validation: all 27 i18n tests pass, including midnight rollover, Persian calendar display, spring DST gaps, repeated autumn hours, explicit offsets, Date/millisecond inputs and invalid values. Three production browser checks pass, with real saved account timezones, localized upload failures, timezone read failure/retry and persistent logo publication in both languages. Root build, types, targeted lint, formatting and route bundle checks pass. These helpers are wired to branding; remaining timestamp displays still need individual migration and acceptance review.

### Apply published branding to current-page component colors and favicon

Brand activation now refreshes the current page's public theme after the save completes. The provider validates responses before changing the document, maps brand colors into shared component tokens, restores the original favicon when an active configuration removes it, cancels superseded requests and restores its document changes on unmount. Failed reads retain the last valid theme.

Foreground colors now use linearized sRGB relative luminance and choose the higher black/white contrast ratio, following the [W3C contrast definition](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The old weighted RGB shortcut incorrectly chose white for #777777. This verifies foreground contrast against these solid brand backgrounds; it does not certify every text/link/background combination in the application.

Review and validation: all four new regressions failed against the previous provider. Seven provider tests pass after repair, including stale replies, unmount cleanup, network failure and favicon removal with and without an original icon. Three production browser checks pass, including both languages updating the document title and component color/foreground tokens immediately after real API activation. Root build, types, targeted lint, formatting, suppression and bundle checks pass. Email/notification brand consumers and comprehensive dark-mode acceptance remain open.

### Refresh full regression evidence after branding repairs

Clean implementation HEAD `df62d17d69d844d84dd07c190effa13371594406` passes 5,148 tests across 428 files: shared 932, UI 10, i18n 27, web 143, database 607, worker 367, API 3,059 and TypeScript configuration 3. Turbo reports 12 successful tasks with four cache hits. All 270 production Chromium checks pass. Browser coverage maps 270 records to 201 source files and merges into four workspace packages. Root lint, formatting, types, build, bundle, contract, suppression, schema snapshot and backlog checks pass.

The combined changed-code report still fails six of 13 groups with no collection errors. API critical is 90.23% lines / 76.27% branches; web general 62.41% / 58.46%; web critical 74.61% / 71.96%; database general 81.14% / 59.52%; i18n critical 100% / 83.33%; UI general 51.18% / 64.82%. Required thresholds are unchanged. Passing tests do not satisfy these remaining coverage gates. Production image evidence still predates the branding runtime changes.

The task acceptance register now contains 22 assessments: 14 verified and eight partial, with 300 still awaiting individual closure. Branding settings, theme application and timezone utilities are explicitly partial with the remaining requirements above; their merged PR evidence is preserved separately.

### Use account timezone for six administrator timestamp consumers

Failed jobs, contract template history, upload policy history, reconciliation, AI model test times and staff activation/login dates now share one account-time formatter per screen. A failed preference read shows a localized retry and unavailable times instead of a guessed browser timezone. Staff permission history already used the account preference and was retained.

Reconciliation's datetime filters also used device-local conversion. They now resolve the entered Gregorian wall-clock values in the account timezone, preserve the exclusive end bound and reject invalid/skipped DST times. Both language hints identify the account timezone.

Review and validation: all 60 selected production browser checks pass, including all live administrator flows, explicit account-zone date assertions, exact UTC reconciliation filter values and rejection of the Los Angeles spring DST gap. Two formatter-hook tests pass for unavailable preferences, successful retry and timezone changes. Root build, types, targeted lint, formatting and bundle checks pass. Existing browser fixtures now provide a timezone response independently from intentional business endpoint failures. General customer/finance/TOS timestamp displays remain to be migrated. The combined full-suite checkpoint predates this step.

### Fail closed when upload policy enforcement is unavailable

A failed policy query now returns 503 instead of applying potentially looser deployment limits. A successful read with no active policy still uses deployment defaults. Policy resolution happens before opening the object stream, so a failed lookup cannot leave an unread storage response. Verification and final recording also recheck the active extension allowlist, including policies tightened after upload URL issuance.

Review and validation: one migrated HTTP regression reproduced upload URL issuance during a policy-read failure; another reproduced verification accepting an extension removed after issuance. All 58 selected API tests across five files pass after repair, including denied issuance without a new reservation, verification/record failure and recovery, current-extension enforcement, storage records, branding and invoice receipt uploads. Four live browser flows pass for both upload-policy editing and logo publication in Persian/English. API build through integration setup, root types, targeted lint, formatting and contract checks pass. Policy-query failures deliberately make uploads unavailable until the required rules can be read.

### Show exact account-local session and consent timestamps

Session creation, activity, absolute expiry and idle expiry now use the account timezone, including the revoke confirmation. The former relative formatter rendered every future expiry as "just now"; both language regressions reproduced that error before repair. Consent change times also use the shared account formatter, with the same visible retry when preferences cannot be read. Review found and added three missing English/Persian session labels, including the pending revoke-all action.

Review and validation: six production browser cases pass for both languages, asserting future expiry across a calendar-day boundary, translated labels, consent save timestamps and existing revoke-dialog focus/pending/error behavior. Root build, types, targeted lint, formatting and bundle checks pass. Broader timestamp consumers and the full-plan coverage gates remain open.

### Use account timezone for team and ticket dates

Ownership-transfer deadlines, member join dates and customer/staff ticket timestamps now use the saved account timezone. Team rows share the screen's single preference read. A failed preference read offers retry without displaying device-local guesses. Ticket related-record, SLA and comment timestamps use the same formatter.

Review and validation: six added assertions failed before repair, reproducing wrong calendar days in both languages and a device-local ownership deadline. All 15 team/ticket production browser checks pass after repair, preserving invitation/role confirmation, transfer decisions/sign-out, attachment retries, internal notes and stale-result behavior. Root build, types, targeted lint, formatting and bundle checks pass.

### Separate finance timestamps from payment calendar dates

Customer invoice lists and correction chains now display issue/due instants in the saved account timezone. Every correction card shares the page's formatter. Staff receipt submission times follow the same preference; the payment's date-only business value stays on its original calendar day. The obsolete browser-local invoice helper was removed.

Review and validation: 24 invoice/receipt unit checks and four production browser checks pass. Browser cases verify issue/due/submission instants crossing midnight in both languages while the payment day remains fixed. The initial browser fixture had no profile and correctly redirected invoice navigation to onboarding; providing its active profile fixed the fixture. Root build, types, targeted lint, formatting and bundle checks pass. Staff due-date editor conversion still requires a separate repair.

### Bind invoice due-date edits to the account timezone

The staff due-date editor previously showed UTC summaries but initialized and submitted wall-clock inputs in the device timezone. Display and conversion now use the loaded account timezone. Invalid Gregorian dates, invalid zones and skipped DST times are rejected. Saving an unchanged displayed minute preserves the original instant, including seconds and the first occurrence of a repeated autumn hour. After an account timezone change, editing requires an explicit invoice reload so an existing wall-clock value cannot be silently reinterpreted.

Review and validation: seven helper/component checks and six finance production browser checks pass. The two new browser flows assert the exact outgoing UTC values, unchanged repeated-hour preservation, no request for the spring gap, and disabled editing until reload after changing Los Angeles to Tokyo. Root build, types, targeted lint, formatting and bundle checks pass. These browser tests isolate conversion with controlled API responses; earlier service/HTTP finance evidence remains separate.

### Use account time in CRM and delivery administration

CRM profile/address/account/session dates, failed-notification history and email-provider test/activation times now use the shared account formatter. Embedded panels can explicitly select their display locale while retaining the saved account timezone. Preference-read failures remain visible and retryable.

Review and validation: three formatter-hook checks and ten production browser checks pass. Both languages assert CRM, failure-history and provider timestamps across a date boundary while retaining permission, paging, step-up, edit failure and field-label checks. Root build, types, targeted lint, formatting and bundle checks pass. Broader CRM translation and TOS/invitation timestamps remain open.

### Make terms and invitation dates deterministic

Signed-in invitation and terms-review banners now use the account timezone and their explicit locale. Administrator terms history/detail uses the same account formatter. The unauthenticated public terms page uses the product's Tehran default without requiring a private settings request; malformed timestamps display a localized invalid-time message instead of crashing the content.

Review and validation: seven production browser checks pass for both public/signed-in language flows, date-boundary conversion, registration consent binding and terms-detail keyboard focus. Root build, types, targeted lint and formatting pass. The initial bundle check failed: electricity ordering reached 252.02 KB against its unchanged 250 KB limit. The earlier progress entry incorrectly described this check as passing; the follow-up below records the correction. Existing scoped formatters that already supplied an account timezone remain in place. Administrator terms text still contains untranslated controls and requires a separate localization repair.

### Restore the ordering bundle budget after timestamp repairs

Provider and contract-template administration dictionaries now load with those routes. Their messages and fallback lookup behavior are preserved, including the shared navigation title. The complete electricity-ordering payload is 249.45 KB gzip against the unchanged 250 KB limit, down from 252.02 KB. Root build/types, targeted lint, formatting, all 27 i18n checks and seven focused production browser checks pass. The bundle has little headroom, so subsequent shared additions still require measurement.

The full regression attempted during this work found one upload unit fixture using a JPG key in the document category. Policy validation now rejects that extension before storage reads. That failed run is not a clean coverage checkpoint; the next repair corrects its missing-object setup and verifies rejection before storage access. The last complete combined coverage report remains the earlier branding checkpoint.

### Correct missing-object coverage after upload policy enforcement

The missing-object unit fixture now uses a deployment-permitted PDF key in the document category. A separate assertion proves a disallowed JPG key is rejected before storage is opened. This preserves both expected behaviors rather than weakening policy enforcement to satisfy the old fixture. All 32 controller checks, targeted lint, formatting and diff review pass. No production behavior changed in this step.

### Keep independent terms and timezone errors covered

The full regression at `5001fda` passed all 5,159 unit/database checks but failed two of 280 browser cases: the terms dismissal test assumed only one alert, while the page also correctly exposed a failed timezone read. Its locator now selects the terms HTTP error and asserts that dismissing it preserves the independent localized timezone error. Both English and Persian production browser cases, targeted lint, formatting and diff review pass. No production behavior changed. The failed full browser run is not a successful combined coverage checkpoint.

### Full timestamp regression checkpoint

At clean commit `3fd042175e506822180ead17badff01bfcf8feca`, all 280 production Chromium checks pass. The 5,159 unit/database checks passed at `5001fda`; the intervening commit changes only the reviewed browser test and this audit. Browser coverage maps 280 records to 213 sources and merges into four package reports. `combined-coverage-checkpoint.json` records this revision against the original audit baseline with no collection errors.

Six of thirteen required coverage groups still fail: critical API (90.23% lines / 76.27% branches), general web (63.44% / 59.16%), critical web (76.18% / 72.82%), general database (81.14% / 59.52%), critical i18n (100% / 70%), and general UI (51.18% / 64.82%). Thresholds are unchanged. Root lint/format, backlog, suppression, schema snapshot and contract checks pass; the preceding runtime build/type/bundle checks also pass. This is a passing regression checkpoint with an explicitly failing coverage gate, not plan completion.

### Reject unsuccessful browser runs during coverage collection

Coverage collection previously checked the count of records without rejecting failed test summaries. It now requires a positive integer passing-test count, zero failures/flaky/skipped cases and an empty global error list whenever a browser results file is provided. Invalid collection leaves an explicitly invalid report. The new regression failed before repair; all ten coverage pipeline tests pass afterward, including failed/malformed summaries and a valid summary. Targeted lint, formatting and diff review pass. The prior 280-case checkpoint already satisfies the stricter summary requirements.

### Bind upload format restrictions to the filename and stored content

Under a JPG-only administrator policy, the API previously issued a URL for PNG content named `.jpg`: extension and category MIME membership were checked independently. Permitted filename formats now narrow the category MIME set at both presign and stored-content inspection. A mismatched claim creates no reservation; disguised stored bytes return `type_mismatch` and cannot be sealed as a verified record. The unrestricted general category retains its documented extension behavior.

The real migrated HTTP regression reproduced the bypass before repair. All 72 upload/policy/branding API checks and four live upload-policy/branding browser flows pass afterward. API types, targeted lint, formatting and diff review pass; the first type check caught a missing test-helper type declaration, corrected before completion. Container format detection remains a separate open defect: ZIP/OLE signatures alone do not distinguish their document formats. This step closes filename/content mismatches for unambiguous detected formats without claiming full document validation or upload-task acceptance.

### Inspect OpenXML containers before accepting document uploads

An ordinary ZIP named `.docx` previously verified as a Word document. OpenXML uploads now use the pinned `file-type` 21.3.4 parser on a complete container bounded by the active upload size limit. ZIP magic alone no longer produces Office MIME candidates. Malformed containers return a format mismatch; oversized streams are rejected and cancelled even when storage metadata understates their size. This is format identification, not a guarantee of document integrity or malware scanning; the [parser's documented scope](https://github.com/sindresorhus/file-type) makes the same distinction.

The real HTTP regression failed before repair. The four-file upload suite passes 91 checks, and the final 22-case HTTP rerun additionally verifies recording valid Word/spreadsheet fixtures while rejecting plain ZIP and renamed spreadsheet content. API build/types, targeted lint, formatting and diff review pass. Test fixture module-path compatibility and two obsolete ZIP-as-Office expectations were corrected during review. Legacy OLE `.doc`/`.xls` discrimination remains open and is not covered by this OpenXML repair.

### Distinguish legacy Office containers and isolate document parsing

OLE signatures no longer imply both Word and Excel formats. The pinned `cfb` parser inspects root document/workbook streams and their format headers; generic compound files and renamed spreadsheets are rejected. Office parsing now runs in a separate worker thread with a three-second deadline, at most two concurrent parsers and bounded V8 heaps. Capacity is released only after worker termination. The API reports temporary unavailability for busy, crashed or timed-out inspection rather than blocking its event loop. The worker is explicitly packaged with the API build.

The legacy HTTP bypass reproduced before repair. All 93 focused upload tests pass, including actual legacy/OpenXML verify-and-record flows, generic/renamed container rejection, parser capacity recovery and deadline termination. Four compiled-artifact parser checks pass, as do API build/types, lint, formatting and diff review. Fixtures prove container/header identification, not full Office application compatibility or malware freedom. Parser API evidence: [CFB documentation](https://github.com/SheetJS/js-cfb); workbook header reference: [Microsoft BOF specification](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/4d6a3d1e-d7c5-405f-bbae-d01e9cb79366).

### Make allowed CSV uploads usable and validate their complete text

CSV was listed as allowed, but the signature detector never returned `text/csv`, so valid uploads could not be recorded. CSV now uses complete, size-limited UTF-8 validation in the same bounded document worker. It checks quoted fields, escaped quotes and consistent columns, supporting Persian text, BOM, one-column files and common line endings. Invalid encoding, embedded control bytes, unterminated quotes and trailing text after a quoted field are rejected. CSV has no unique magic signature; one-column plain text can also be valid CSV, as reflected by its [registered format](https://www.rfc-editor.org/info/rfc4180/).

The valid CSV HTTP workflow failed before repair. All 59 focused document/controller checks pass, including nine CSV payload cases through verify and record, Office regressions and parser lifetime/capacity checks. Compiled-artifact CSV checks, API types, targeted lint, formatting and diff review pass. The document worker and its asset declaration were renamed to reflect the expanded scope.

### Require explicit instants for upload-policy scheduling

Policy start/end inputs previously accepted local datetimes and interpreted them in the server's timezone. Controller and service validation now require an explicit UTC marker or offset; omitted timestamps still mean now. The HTTP regression reproduced acceptance of an ambiguous local start before repair. All 36 policy HTTP/controller/service checks pass afterward, including no row creation for a local timestamp and exact persisted UTC values for positive/negative offsets. API types, targeted lint, formatting and diff review pass. Stale comments claiming administrator-only permissions and a deferred UI were updated to match the implemented permission checks and interface.

### Account for copied parser code in process coverage

The full regression at `e9a2d85` failed during coverage generation: the copied document worker has no compiler map, and binary fixtures under `src` were incorrectly treated as executable source. Fixtures now live under `test/fixtures`. Process coverage explicitly registers the copied worker and requires its emitted bytes to exactly match source before mapping its execution ranges directly. Unregistered compiled modules still require source maps; stale or missing copied source fails rather than being omitted.

Eleven mapping/alignment checks pass. A focused 25-test diagnostic run with command-line package floors disabled verifies coverage plumbing only, not the coverage gate: 35 process records map successfully and the parser records 62/64 statements and 55/58 branches. Repository thresholds remain unchanged and the full required gate must be rerun. Targeted lint, formatting and diff review pass. Root build/types/lint/format/bundle/contract/backlog/suppression/snapshot checks passed before this coverage repair. The last valid combined checkpoint remains `3fd0421`; no failed or diagnostic run replaces it.

### Reject unsupported and malformed video container headers

Unknown ISO container brands were guessed as MP4, and generic EBML content was guessed as Matroska unless arbitrary bytes contained the text `webm`. Detection now requires a complete bounded file-type box with a recognized supported brand, or a structurally parsed EBML DocType header. Unknown, truncated, unbounded and duplicate document-type headers fail closed. This identifies supported container types; it does not validate every codec or media frame. References: [registered ISO brands](https://mp4ra.org/registered-types/brands) and [EBML specification](https://www.rfc-editor.org/rfc/rfc8794.html).

Two new regressions reproduced the incorrect guesses before repair. All 82 sniffer/controller/HTTP checks pass afterward, including five real upload verify-and-record paths for supported and disguised video content. Existing synthetic fixtures were corrected to contain their declared header length. API types, targeted lint, formatting and diff review pass.

### Upload regression and acceptance checkpoint

Clean revision `656e91f29c0c4c2fbcc667a03b40be8490b075f6` passes all 5,172 unit/database tests across 430 files with package coverage floors enforced, plus all 280 production Chromium checks. Browser coverage maps 280 records to 213 sources and merges into four packages. The combined report has no collection errors, but six required groups still fail: critical API 90.21% lines / 76.28% branches; general web 63.21% / 58.89%; critical web 76.18% / 72.82%; general DB 81.14% / 59.52%; critical i18n 100% / 70%; general UI 51.18% / 64.82%. No threshold changes were made.

Canonical requirements and current source/caller evidence close timezone utilities (`01-platform-infrastructure.md#T-06.02.03`) and upload policies (`02-auth-users-admin.md#T-09.12.05`) at this revision. The acceptance ledger now contains 23 assessed tasks: 16 verified, seven partial and 299 still pending. These functional closures do not clear global coverage or operational gates. The next reviewed gap is the administrator TOS editor: required rich text, preview/comparison and localized controls are absent; draft mutations need transactional audit and current-permission rechecks, and single-draft creation can race. No new feature-loop dispatch is authorized by this checkpoint.

### Make TOS administrator mutations atomic and auditable

Draft creation, editing, publication and discard now recheck the current editor permission inside their transaction, serialize shared draft decisions across editors, lock the selected draft and commit its audit event with the content change. Audit records include the actual request IP. Public acceptance locks the account before the version to match the administrator lock order. Published content remains immutable.

Four real HTTP regressions failed before repair and pass afterward: missing draft audit, writes surviving audit failure, duplicate drafts and permission revocation while waiting. The final tests also cover creation rollback and concurrent requests from different editors. All 23 focused TOS tests, API types, targeted lint, formatting and diff review pass. Minor publication activation, consent lineage and the required rich-text preview/comparison remain separate open work; this step does not close TOS acceptance.

### Publish minor TOS corrections without resetting material consent

Every TOS publication now becomes the current document. Consent checks use one database snapshot of the active publication, latest material publication and accepted published version. Minor corrections preserve existing material consent, while users who missed a major change still need to accept the latest document. First publication can be minor and still requires initial consent. Publication time is captured after acquiring the shared lock. Historical ambiguous equal timestamps are treated conservatively unless the accepted document is the material or current publication.

Both minor-publication HTTP failures reproduced before repair. All 25 focused TOS and registration checks pass, including two successive material/minor cycles, first consent, stale-version rejection and concurrent draft publication. The registration fixture now explicitly marks its material publications, and its lock-wait assertion follows the new row-lock query. API types, targeted lint, formatting and caller/diff review pass. Existing immutable records are not rewritten. Production history reconciliation and TOS editor requirements remain open.
