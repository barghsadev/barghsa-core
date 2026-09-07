# Repair handoff

Updated 2026-09-08. Repairs resumed at user request; the prior checkpoint is historical. Read this file first; do not reload the full repair-progress archive.

## Workspace and authority

- Repository `/Users/majid/www/barghsa/barghsa-core`, existing branch `codex/audit-fixes`.
- Prior checkpoint runtime: `9898b4fb07140607d79cddb1c2c079a5e9aacc49`; resumed shared-build revision: `e76c901`. See follow-up evidence below for subsequent UI work.
- Original audit baseline: `2f80d92df51556d47f778b5230e5eea577e2a8d4`.
- Local edits and commits only. No push, PR, merge, deployment, remote state/scheduler change or PR304 action was performed. Those actions remain outside authority.
- User authorized Codex to build and review these repairs directly, overriding the Cursor/Codex role split for this pass.
- Read AGENTS.md and `/Users/majid/.codex/RTK.md`; prefix commands with `rtk`, stage explicit paths. Codebase-memory MCP works with project `Users-majid-www-barghsa-barghsa-core`.

## Scope and decisions

The bounded pass addressed the concrete carry-forward authentication-window and database-timeout defects, with review after each change and a final regression checkpoint. It does not certify the complete original fix plan or 322 historical tasks. Keep replies/tool output short and reuse evidence for unchanged sources.

- Automatic identity verification remains unavailable/fail closed; manual verification is supported. No provider contract was invented.
- Retain Vite SPA under ADR004. User waived the dependency license allowlist restriction.
- Exhaustive historical acceptance and newly discovered noncritical improvements remain deferred. Do not turn pending acceptance into missing implementation or blanket sign-off.
- Historical ledger is unchanged: 35 verified, 13 partial, 274 pending. Of 58 historical skips, 3 were verified and must not be rebuilt; 55 await acceptance review. Use qualified `<epic filename>#<task ID>` identities.

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

## Final validation evidence

See `audit/final-repair-checkpoint.json` for revision bindings and log paths.

- 5,366 passing unit/integration tests across 448 files. Latest shared-pool revision was followed by full database/API/worker refreshes: 642 database tests, 3,172 API tests and 367 worker tests. Other package results remain valid for unchanged sources.
- 350 production Chromium cases passed at `d27d351c506ba6266ccb28ae05bc15c6787720f8`, before the final database-only deadline corrections. No skipped/flaky/failed cases. Collector validated 350 records and mapped 230 source files; coverage merged into web/shared/i18n/UI. Those frontend sources remain unchanged. This is not a full five-browser run or browser testing of later backend revisions.
- Root lint and all 11 workspace typechecks pass after the final correction.
- Backlog validation and 55 loop-script tests pass; loop code remained unchanged.
- OpenAPI contract check passes. All 41 route budgets pass on the existing unchanged frontend production build. Migration snapshot validation passes; full database refresh includes clean/upgrade checks through 0120.
- Coverage gate remains **failed**, 9 of 13 groups passing, with no missing/invalid reports. Thresholds were not weakened and no exception was granted.

| Failing group | Lines | Branches | Required lines/branches |
| --- | ---: | ---: | --- |
| API critical | 90.40% | 76.65% | 90% / 85% |
| Web general | 64.94% | 62.54% | 80% / 75% |
| Web critical | 77.04% | 74.24% | 90% / 85% |
| Database general | 86.92% | 71.93% | 80% / 75% |

## Carry-forward concerns by original group

These are remaining limits and acceptance/dependency concerns, not a fresh audit or proof that the historical work is absent.

| Group | Remaining concern |
| --- | --- |
| F01 loop identity/state | Local protocol and completion-correction protections built/tested. Generic recovery and remote operations/PR304 reconciliation remain unverified; remote actions outside current authority. |
| F02 migrations/database | Clean/upgrade paths through migration 0120 tested. Distinct 10-second read / 30-second write server deadlines repaired. Production restore and live proxy evidence remain external. |
| F03 sessions/CSRF | Core repair exists; remaining legacy rotation/session edge acceptance. |
| F04 staff permissions | Core repair exists; full privileged-role matrix and real staff-data review remain. |
| F05 registration/OTP | Delivery/consent repairs exist; external delivery and crash/operations acceptance remain. |
| F06 verification | Unsafe unconditional success removed. Real-provider approval unavailable by explicit user decision. |
| F07 agents/ownership | Implemented repairs need remaining role/dependency acceptance; future contracts/profile credentials are dependencies. |
| F08 addresses | Schema/deletion repair exists; historical production address/order evidence remains. |
| F09 external notifications | Delivery repair exists; legacy secret rotation and external attempt reconciliation remain. |
| F10 retries/quiet hours | Significant repairs/tests exist; consult targeted records before claiming complete acceptance. |
| F11 notification center | Active-context/toast/title repairs exist; broader notification acceptance remains. |
| F12 overdue/refunds | Existing transitions repaired; future refunds remain a dependency. |
| F13 dual approval | Repair exists; legacy requests without trusted fingerprints fail closed and require external manual reconciliation. |
| F14 invoices | Extensive regression work; four calculation tasks verified. Broader finance acceptance remains. |
| F15 CRM | Repair exists; future invoice/contract ownership tables remain dependencies. |
| F16 tickets/uploads | Workflow repairs exist; legacy orphan-upload inventory remains. |
| F17 administration | Broad screens/consumers repaired; AI chat backend/KB and policy-test task `02...#T-09.11.04` remain, plus future document processing. Verify exact qualified key before dispatch. Branding email/CDN/other consumers remain partial. |
| F18 production/workers | Image evidence is older, at 11d46d5. Real TLS/DNS/backups/production operations remain unverified. |
| F19 quality/architecture | Four coverage failures above; previously reported 144 upstream Drizzle declaration errors/DB skipLibCheck remain; eager purchase-route requirement remains. Vite decision closed. Nightly work tested locally, not a claim of remote CI execution. |
| F20 localization/UI | Many repairs and focused browser tests; broader translation/a11y acceptance remains. Shared package dual ESM/CJS TSUP output and required shared EmptyState/PageLoading/ErrorBoundary were noted as missing, not newly implemented. DatePicker task verified. |
| F21 duplicates/drift | Mostly reviewed/consolidated; public toast manager/renderer mismatch fixed. Do not rebuild repeated task IDs without qualified identity. |
| F22 acceptance | 274 pending, 13 partial. Exhaustive review now explicitly deferred. Continue critical-path evidence needed for the bounded repair pass; no blanket completion from test counts. |
| F23 auth limits | Account+IP failure identity, threshold and PostgreSQL fallback repaired. Rolling histories repaired in migration 0120. Concurrency, expiry, reset, HTTP and Redis-loss checks pass. |


## External blockers and deferred work

External: provider delivery/identity-provider availability; real TLS/DNS/backups and production restore/proxy/cancellation behavior; legacy notification secret rotation and attempt reconciliation; historical address/order/upload inventories; legacy receipt-approval reconciliation; remote loop recovery, PR304 and scheduler/state operations. F13 legacy requests without trusted initiation fingerprints already fail closed; preserve their history for manual reconciliation.

Outstanding original-plan work: the four coverage deficits above, upstream Drizzle declaration debt/skipLibCheck, remaining shared UI/build-format and eager-route requirements, broader role/localization/accessibility acceptance, AI chat/KB and policy-test acceptance, remaining branding consumers, and future refund/contract/document-processing dependencies. No blanket acceptance or coverage sign-off was issued. Exhaustive historical task/skip review remains deferred under the approved finish scope.

User requested continued local blocker repair and building on 2026-09-08. Work is active: close locally fixable blockers and failed coverage gates, then remaining known build gaps. External/remote restrictions still apply. Do not restart exhaustive historical acceptance.

Current step: permission-boundary evidence. Connection-security repair committed at `3bf1e3a`: real pg configuration proved URL sslmode=disable overrode explicit TLS enablement. Explicit application/environment TLS now removes competing URL TLS parameters. Missing/empty/malformed CA files fail startup, and timeout validation precedes singleton creation. Added certificate-verification opt-out and pool-ownership checks; 18 security tests pass. Full database coverage refresh passes and the database general gate now passes (10/13 groups pass; API/web deficits remain). Logs: `/tmp/barghsa-db-followup-coverage.log`, `/tmp/barghsa-current-gates.json`. Broader affected regression will follow shared changes.

## Evidence map

- Resumed full package regression at `e76c901`: all 12 Turbo tasks pass, 5,528 unit/integration tests (DB660, API3316, worker367, shared934, web155, UI43, i18n50, tsconfig3). Log `/tmp/barghsa-resumed-regression.log`. This predates the UI changes below; backend evidence remains reusable. All 11 workspace types also pass (`/tmp/barghsa-states-all-types.log`).
- Shared UI follow-up (`T-06.03.06`): exports `EmptyState`, `PageLoading`, `ErrorState`, and render-catching `ErrorBoundary`. Added localized route recovery with support/home links and live loading announcements; removed raw exception details and visible reduced-motion loading text. Skeleton animation now uses motion-safe CSS; alert layout uses RTL logical properties. Fourteen focused UI/web tests pass, including explicit retry, resource-key recovery, persistent-failure loop safety, no private exception leakage, and live Persian/English changes. Explicit lint passes. Production browser and refreshed frontend coverage are pending.

- Permission follow-up: `apps/api/src/admin/admin-permission-boundaries.test.ts` adds 144 passing checks across 22 operations, covering denied/unrelated capabilities, explicit grants, wildcard/admin access, capability revocation and malformed privileged inputs. API typecheck and explicit lint pass. These controller checks supplement existing HTTP/step-up tests; they do not certify the complete historical role matrix. Full API coverage refresh remains pending.
- Shared build follow-up (`T-06.01.01`): `packages/shared` now emits ESM and CommonJS through TypeScript NodeNext compilation, conditional runtime/type exports, preserved module boundaries and no test files in the output. All 16 public module entry points load in both formats; root/subpath identity and strict `.mts`/`.cts` consumer checks pass (18 build checks). No added build dependency. UI package TSUP format requirement is separate and remains open. Broader shared-dependent regression is next.
- UI distribution follow-up (`T-06.03.01`): TSUP now emits ESM/CommonJS and paired declaration files with conditional exports; React/dependencies remain external and CSS is marked as a side effect. CSS scans built classes for packaged consumers. Five distribution checks pass: both entries load in each format, components render with consumer React, strict ESM/CommonJS declarations pass under TypeScript 5.9 and workspace 7. TSUP needs its UI-local TypeScript 5.9.3 compiler API; wildcard development aliases are disabled only during declaration generation to avoid malformed external React types. Root lint and all 11 types pass. Build smoke filenames avoid Vitest double-discovery. Log `/tmp/barghsa-ui-distribution.log`; production browser/route budgets are next.
- Distribution review caught a real bundle regression in the initial single-module UI output. Emitting component entries with shared chunks restores consumer tree shaking. All five distribution checks and all 41 production route budgets pass (`/tmp/barghsa-ui-budget.log`). Eager purchase-route experiment remains uncommitted: authentication grows to 165–176 KB against the unchanged 150 KB limit; next step is isolating purchase dictionaries instead of loading all application translations.

- `audit/final-repair-checkpoint.json`: final test/gate results with source revisions.
- `audit/combined-coverage-checkpoint.json`: failed coverage gate details at the latest runtime revision.
- `audit/authentication-window-review.md`: original rolling-window constraints, historical analysis before implementation.
- `audit/database-foundation-review.md`: database repair evidence and operational limits.
- `audit/fix-plan.md`: original 23 groups; read only the relevant section.
- `audit/current-task-requirements.json`: canonical requirements overlay; historical task-review extracts had context errors and are provenance only.
- `audit/acceptance-closure.json` and `audit/current-skipped-tasks.*`: unchanged acceptance/skip dispositions.
- `audit/repair-progress.md`: large archive; search only a relevant heading when needed.
