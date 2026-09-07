# Repair handoff

Updated 2026-09-08. Read this file first; do not reload the repair-progress archive.

## Workspace, authority and scope

- Repository `/Users/majid/www/barghsa/barghsa-core`; existing branch `codex/audit-fixes`.
- Previous full implementation/test checkpoint: `a4e5fa99dfec2279a135fdbd9037e99fdcbeb424`, production build `469641a73df7f8cbd7789bd2a2b05b9069e306ad`. Resumed repairs below supersede those production sources; read current HEAD and the resumed section before reusing evidence.
- Original audit baseline: `2f80d92df51556d47f778b5230e5eea577e2a8d4`.
- Local edits/commits only. No push, PR, merge, deployment, remote scheduler/state or PR304 action. User authorized direct Codex building and review, overriding the Cursor/Codex split.
- AGENTS.md and `/Users/majid/.codex/RTK.md` were read. Prefix commands with `rtk`; stage explicit paths. Prefer codebase-memory project `Users-majid-www-barghsa-barghsa-core`; transport later closed, requiring file-search fallback.
- Work is active. The prior regression checkpoint was not completion of the fix plan. Continue local API critical and web general coverage gaps, then eager purchase-route loading and remaining confirmed plan defects. Review each step, reuse valid evidence and keep external/historical acceptance limits explicit. Do not restart exhaustive historical acceptance or claim unavailable checks passed.
- Automatic identity verification remains unavailable/fail closed; manual verification is supported. Retain Vite SPA under ADR004. User waived the dependency license allowlist restriction.
- Historical ledger unchanged: 35 verified, 13 partial, 274 pending. Of 58 historical skips, 3 were verified and must not be rebuilt; 55 await acceptance. Use qualified `<epic filename>#<task ID>` identities.

## Completed runtime repairs

### F23 rolling authentication limits

Migration 0120 adds serialized PostgreSQL rolling histories. Database time and transaction advisory locks govern increments, peeks and resets per namespace/key; window lengths remain independent. PostgreSQL is authoritative through Redis flush/outage.

Storage retains the latest quota + 1 attempts. Login ceiling is now 10 because ten failures already saturate the existing delay; retaining eleven preserves all lower thresholds during expiry. The sixth concurrent failure still delays. This is not a token bucket. Configured quotas support 1–100000 attempts, with storage bounded by quota + 1 per key/window.

Legacy buckets are imported once at their latest possible timestamp, conservatively retaining protection across epoch boundaries. Truncated history remains conservative if a quota increases. Expired histories use server-time cleanup. Deployment requires draining old fixed-window writers before switching; no deployment occurred.

Review covered lock/snapshot behavior, concurrent admissions and failures from separate database clients, expiry, reset ordering, namespace/window isolation, legacy carry-over, cleanup, Retry-After and Redis loss. Clean installation, historical upgrade, repeat migration and schema snapshot checks pass. Thirteen API regression failures were stale fixture resets/count reads against retired tables; corrected without weakening production quotas. All affected fixtures pass.

### F02 database deadlines

Default pools set PostgreSQL statement_timeout per SQL command, 10 seconds for reads and 30 seconds for writes, including modifying CTEs and transaction completion. Adjacent SET/query pairs prevent concurrent callers exchanging deadlines. Explicit uniform overrides retain their existing behavior. Unknown SQL and multi-statement batches use the write budget; SELECT function side effects cannot be inferred from text.

Final review reproduced COMMIT inheriting a read deadline and corrected it. Broader testing then reproduced duplicate client/server cancellation hitting a following write. Automatic mode now relies on its server deadline for active queries and retains client guards for queued work. Explicit numeric client-cancellation overrides retain their prior implementation. Tests verify server timeout reason, successful following writes, callback behavior and rollback recovery.

Live PgBouncer/proxy behavior remains unverified. Session SET requires session-affine routing; do not claim transaction-pooling compatibility or production cancellation-transport certification.

## Additional repairs and review

- **Database TLS/startup (`3bf1e3a`, `1441f31`):** reproduced URL `sslmode=disable` overriding explicit TLS. Explicit application/environment TLS now removes competing URL parameters. Missing, empty or malformed configured CA certificates fail startup; invalid timeout configuration cannot poison the pool singleton. Eighteen security tests plus existing connection checks pass.
- **Permissions (`9770ffb`):** 144 controller-boundary checks across 22 operations cover denial, unrelated/explicit/wildcard capabilities, admin access, revocation and malformed privileged input. Denied requests never invoke services. This supplements existing HTTP/step-up coverage; the complete historical role matrix remains unaccepted.
- **Money/order boundaries (`71da3fd`, `de0e14f`):** 39 added payment-adapter cases cover exact server amount/order binding, malformed responses, unsafe IRR, uncertain HTTP failures and recovery/idempotency; no external PSP contacted. Thirty-one order cases cover duplicate submission, exact acknowledgement, address persistence and safe retry.
- **Receipt responses (`081eccd`, `799cc66`, `a4e5fa9`):** reproduced four null-JSON crashes in profile lookup, presigning, verification and receipt acknowledgement. Responses are narrowed to objects before field access and malformed acknowledgements cannot confirm success. Tests cover exact int8 IRR, Persian/Arabic-Indic input, failed upload stages, HTTP outages and invalid amount display.
- **Shared formats (`e76c901`):** ESM/CommonJS NodeNext output and conditional types/runtime exports for all 16 public entries. Eighteen build checks verify exports, module identity and strict consumers.
- **Shared UI (`da37b52`):** EmptyState, PageLoading, ErrorState and ErrorBoundary, localized route recovery/support links, live loading announcements, reduced-motion and RTL fixes. Explicit retry/resource-key recovery avoids retry loops and raw exception disclosure. Fourteen focused UI/web checks pass.
- **UI distribution (`427f315`, `5ae5457`):** TSUP ESM/CommonJS with paired declarations and external React. Component entries preserve tree shaking; the initial single-module bundle regression was corrected. Five distribution checks verify runtime identity, consumer rendering and strict types under TS5.9 and workspace TS7. UI-local TS5.9.3 is required for TSUP's compiler API.
- **Clean production builds (`c74ecc5`, `469641a`):** packaged CSS now includes its referenced Tailwind config; pnpm refreshes injected workspace copies after builds. These fix two independently reproduced clean web-image failures.
- **Route experiment:** eager purchase loading exceeded authentication's unchanged 150 KB budget. A dictionary split also pushed ordering above 250 KB and was reverted (`0aa4c97`). Final ordering is 249.62 KB; all 41 budgets pass. Eager loading remains open, and no threshold was weakened.

## Final checkpoint

### Resumed work after ed3f7fd

- Added 49 verification-case controller boundary checks: independent read/create/review capabilities, denial before service access, immediate revocation, malformed correction/decision input, audit actor binding, missing resources and terminal conflicts. All 49 pass; the existing 11 real HTTP cases also pass. API types and explicit lint pass. No production change was needed for this step; coverage checkpoint remains the previous revision until refreshed.
- Do not run API typechecking concurrently with Vitest global setup, which rebuilds shared packages. One such race produced transient missing-declaration errors; the sequential typecheck passed after fixture build completion.
- Authentication controller checks now cover production cookie scopes, device-cookie possession instead of caller fingerprints, OTP/password-change gating, refresh rejection without cookie issuance, logout clearing, malformed input, purpose-bound resends and failed-password step-up. All 49 tests in the focused controller/login-rate/contact HTTP run pass; API types and explicit lint pass. This extends evidence without changing authentication behavior or claiming the critical coverage gate passed.
- Invoice receipt transition repair: PostgreSQL failure injection reproduced confirmation committing money while its receipt update returned no row, rejection emitting a notice without a saved rejection, and approval parking committing without a saved UnderReview state. All three writes now require the returned row to have the expected state before committing. Removed fabricated-success fallbacks. Existing five-file invoice/approval run passed 53 tests; six final injected cases cover suppressed writes and unchanged returned rows, rollback, no stray credits/notices/approvals and successful retry. Initial parameterized tests reused attachment keys; fixed unique fixture keys before the passing run. Production code passed API types and explicit lint. Logs `/tmp/barghsa-invoice-transitions.log` and `/tmp/barghsa-invoice-transition-readback.log`. The prior full regression and coverage are historical evidence, not certification of this new production revision.
- Wallet receipt transitions had the same defect. Four real PostgreSQL cases first reproduced false success for confirmation/rejection with suppressed or unchanged writes. Release/rejection now require the expected returned state and roll back otherwise. All 41 wallet/cross-flow checks pass, including rollback of balance/credits/notices and idempotent successful retries. API types and explicit lint pass. Log `/tmp/barghsa-wallet-transition-green.log`.
- API coverage refreshed at `9babc0e`: all 3,453 tests in 243 files pass. Critical API coverage improved to 91.18% lines / 79.55% branches, still below the unchanged 85% branch requirement; general API passes 93.66% / 80.94%. Log `/tmp/barghsa-resumed-api-coverage.log`. The combined checkpoint file remains historical, pending current web evidence.
- Login acknowledgement repair: successful null/empty responses previously triggered a success toast/navigation; non-string OTP/password-change identifiers entered invalid steps. Login now validates its discriminated response and OTP verification requires session fields before success. Fourteen contract tests pass. Browser evidence: 29 Chromium login/rate/feedback cases, 50 malformed-response cases across five profiles and 10 valid-session cases across five profiles pass. Feedback fixture now returns the real successful-response shape. Web types, explicit lint, production build and all 41 unchanged route budgets pass. Logs `/tmp/barghsa-login-ack-green.log`, `/tmp/barghsa-login-all-browsers.log`, `/tmp/barghsa-login-positive.log`. Browser coverage has not yet been refreshed for this new frontend revision.
- Password-change and resend acknowledgements: four Chromium regressions reproduced reporting success for a null password-change response or a different resend challenge. Both actions now require their response contract before resetting forms/timers or announcing success. All 20 focused cases across five browser profiles pass, preserving input and allowing a valid retry. All 15 response-contract tests, web types, explicit lint, build and all 41 route budgets pass. Log `/tmp/barghsa-recovery-ack-green.log`.
- Geography and provider controller boundaries: 81 focused controller/service checks pass for capability isolation/revocation, malformed input, missing records, pagination and disabled provider defaults. API types and explicit lint pass. No real provider was added or called. Log `/tmp/barghsa-admin-boundaries.log`; coverage will be refreshed after the next batch.

- Geography repair: replaced inaccessible, English-only province dialogs with shared keyboard-managed dialogs and Persian/English text. List requests cancel obsolete results; malformed read/write acknowledgements stay errors, preserving retry. Corrected the shared fallback light-theme primary foreground after a settled dialog contrast failure. Nineteen API response contract tests and 25 focused browser checks across all five profiles pass, covering localized CRUD, conflict/input recovery, focus restoration, dialog axe checks, malformed-list retry, pagination and filters. Web types, explicit lint, build and all 41 route budgets pass. Logs `/tmp/barghsa-geography-unit.log`, `/tmp/barghsa-geography-all.log`, `/tmp/barghsa-geography-other-browsers.log`, `/tmp/barghsa-geography-filters.log`, `/tmp/barghsa-geography-budgets.log`. Combined coverage and full regression remain pending current sources.

Machine-readable revision bindings and log paths: `audit/final-repair-checkpoint.json`.

- **5,634 unit/integration tests across 455 files pass**, using the full regression and affected refreshes: API3355, DB660, worker367, shared934, UI49, i18n50, web216, tsconfig3. The last two invoice checks were a targeted refresh of an existing test file; other source/test evidence remains valid.
- **350/350 production Chromium cases pass at `469641a`**, with no skips/flakes/failures. Collector accepted 350 records mapping 218 source files. Later changes are tests only. This is not a five-browser run.
- Browser coverage was merged at its exact revision before subsequent test commits. The last invoice-helper unit coverage was accumulated only for that unchanged production file after byte comparison with `469641a`; the browser revision was not rewritten and the merger guard was not weakened.
- Root lint and all 11 workspace typechecks pass; later tests pass targeted lint/type checks. Backlog (1355 tasks/116 traceability entries), 55 loop tests, OpenAPI, migration snapshot and clean/upgrade/repeat migration checks through 0120 pass.
- Local API, worker and web production images build. Network-isolated API/worker package/money-parser smoke checks and web health check pass. Temporary smoke containers were removed. No image push/deployment occurred.
- Coverage: **11/13 groups pass**, no report errors. Web critical now passes at **90.12% lines / 88.15% branches**. Database general also passes. Thresholds unchanged; no exception granted.

| Remaining coverage gap | Lines | Branches | Required lines/branches |
| --- | ---: | ---: | --- |
| API critical | 90.93% | 77.86% | 90% / 85% |
| Web general | 65.00% | 62.65% | 80% / 75% |

Full-run log: `/tmp/barghsa-repair-final-regression.log`; affected frontend `/tmp/barghsa-final-frontend-current.log`, `/tmp/barghsa-receipt-followup-coverage.log`, `/tmp/barghsa-invoice-final-tests.log`. Current browser logs use `/tmp/barghsa-current-*`. The older `/tmp/barghsa-final-browser.log` was stale after a failed command chain and is not credited as new evidence.

## External blockers

Provider delivery and real identity-provider availability; real TLS/DNS/backups and production restore/proxy/cancellation behavior; legacy notification secret rotation and attempt reconciliation; historical address/order/orphan-upload inventories; legacy receipt-approval reconciliation; remote loop recovery/PR304/scheduler/state operations. F13 legacy requests without trusted initiation fingerprints fail closed and require manual reconciliation with history preserved. These cannot be certified by local builds/tests.

## Deferred local work and dependencies

- API critical branch and general web coverage remain below policy; broader test expansion remains open. Do not equate test counts with acceptance.
- Strict DB dependency declarations still fail: 146 errors, comprising 144 upstream Drizzle cross-dialect declarations and two Vite test-tool declarations. DB `skipLibCheck` remains; UI strict consumer declarations pass. Log `/tmp/barghsa-drizzle-current.log`.
- Eager purchase-route loading needs further architecture work within existing budgets.
- Remaining historical role, session/rotation, notification, finance, localization/accessibility and operations acceptance; exhaustive 322-task/55-skip review explicitly deferred.
- AI chat/KB and policy-test acceptance (verify exact qualified identity before dispatch), remaining branding consumers, and future refund/contract/profile-credential/document-processing dependencies.

## Evidence map

- `audit/final-repair-checkpoint.json`: current tests, checks, image identities and revision bindings.
- `audit/combined-coverage-checkpoint.json`: current failed gate details; 11/13 pass.
- `audit/authentication-window-review.md`, `audit/database-foundation-review.md`: targeted original constraints and operational limits.
- `audit/fix-plan.md`: original 23 groups; read only the relevant section.
- `audit/current-task-requirements.json`: canonical requirements overlay; historical extracts are provenance only.
- `audit/acceptance-closure.json`, `audit/current-skipped-tasks.*`: unchanged dispositions.
- `audit/repair-progress.md`: large archive; search only a relevant heading if needed.
