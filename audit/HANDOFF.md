# Repair handoff

Updated 2026-09-07. Read this first. Use the linked records only for the next repair; do not reload the full audit history.

## Workspace and authority

- Repository: `/Users/majid/www/barghsa/barghsa-core`.
- Continue the existing checkout and branch `codex/audit-fixes`. It was clean before this handoff.
- Pre-handoff HEAD: `dd41a045f14ab0b716e00b6ac59565d7455642a5`.
- Last runtime-code revision: `46346b2340850a44e50feb4375c75eac595b8680`.
- Original audit baseline: `2f80d92df51556d47f778b5230e5eea577e2a8d4`.
- Local changes and local commits only. Do not push, create PRs, merge, deploy, change remote loop state, touch PR #304, or start/change Hermes scheduling. The original scheduler ran on another machine; user said to ignore that machine.
- Read project AGENTS.md and `/Users/majid/.codex/RTK.md`. Prefix shell commands with `rtk`; `rtk proxy` works. Stage explicit paths.
- Prefer codebase-memory MCP for discovery. It previously failed with `Transport closed`; try availability, then use targeted searches if unavailable.

## User decisions and working style

- Continue the fix plan step by step; review each completed step. Preserve already built work.
- No identity-verification provider exists. Keep automatic verification unavailable/fail closed; manual verification is supported. Do not invent a provider contract.
- User waived the license allowlist restriction and permits needed dependencies.
- Retain Vite SPA. Requirements were updated through ADR004. Do not restart an SSR migration.
- User is concerned about excessive tokens/time. Be concise, reuse valid evidence, limit tool output and avoid repeated broad audits/full suites.
- Caveman communication requested; keep code and documents readable and technically precise.
- The user explicitly adopted the lower-token rules and narrower finish scope on 2026-09-07. Finish confirmed defects remaining in the original plan, prioritize critical authentication/permissions/money/migrations/loop safety, and defer exhaustive review of all 322 historical tasks. Record newly discovered noncritical improvements separately. Do not mark deferred requirements as verified.

## Approved finish and token budget discipline

1. Freeze scope to remaining confirmed defects in the original plan. Record new noncritical improvements for later. Address a newly discovered critical defect before claiming the affected path safe.
2. Maintain this compact file for all 23 groups, outstanding defects and latest evidence. Avoid rereading the full progress archive.
3. Review each fix and run targeted checks. Run one complete final regression checkpoint; broaden earlier only for shared impact, failures or unresolved concerns.
4. Reuse evidence when relevant code and dependencies have not changed. Never relabel stale evidence as testing newer code.
5. Defer exhaustive historical acceptance paperwork. Prioritize critical authentication, permissions, financial paths, migrations and loop safety. Keep the deferred list separate from actionable defects.
6. Save full logs to files, inspect failures and return small tool outputs.
7. Use Light effort for straightforward edits/record updates and Medium for complex fixes/critical review when the user or environment can select it. Do not claim effort changed without a supported setting change; do not create extra tasks to change models.

Finish sequence: remaining confirmed defects -> focused review after each -> one final regression run -> concise handoff listing deferred work and external blockers. Completion of this bounded repair pass is distinct from exhaustive original-plan acceptance. Report both truthfully. The previous 70% overall estimate applied to the broader original plan, not a measured estimate of this newly bounded scope.

## Progress: distinguish implementation from sign-off

Substantial repair implementation exists. Latest conversational estimate was about **85% implementation / 70% overall plan**, with roughly +/-10 percentage points uncertainty. These are judgment estimates, not a measured completion ledger. Do not present them as audited percentages.

The separate historical acceptance ledger contains 322 tasks: **35 verified, 13 partial, 274 pending**. Thus 48 reviewed and 11% formally verified. Pending means not individually signed off, not absent implementation. The earlier answer calling the plan 11% complete was misleading and was corrected.

Historical skips: 58 preserved; 3 now verified and must not be rebuilt; 55 still need acceptance review before deciding what to build. Do not infer missing code from this count.

## Current validation evidence

At runtime revision `46346b2`:

- 5,354 unit/integration tests across 446 files passed, including 630 database tests.
- 350 production Chromium browser cases passed, with no skipped, flaky or failed results.
- Browser collector validated 350 records and mapped 230 source files. Coverage was merged into web/shared/i18n/UI.
- 9 of 13 coverage groups pass. Remaining failures:

| Group | Lines | Branches | Required lines/branches |
| --- | ---: | ---: | --- |
| API critical | 90.40% | 76.65% | 90% / 85% |
| Web general | 64.94% | 62.54% | 80% / 75% |
| Web critical | 76.87% | 74.24% | 90% / 85% |
| Database general | 87.70% | 70.55% | 80% / 75% |

No missing/invalid coverage reports. Critical i18n is 100%/100%; shared UI passes. Do not weaken thresholds or source-map matching to pass.

All 41 production route budgets passed after the latest frontend change. Ordering is close to its unchanged 250 KB limit. Root lint passed before the final database change; changed database paths passed explicit ESLint and database typechecking.

Focused suites ran across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari. The latest full 350-case run was Chromium only; do not call it a full five-browser run.

## Remaining work by repair group

These are carry-forward limits and next review targets, not a newly completed per-group audit. Read the relevant original criteria and existing implementation before editing.

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
| F13 dual approval | Repair exists; legacy receipt binding remains a concern. |
| F14 invoices | Extensive regression work; four calculation tasks verified. Broader finance acceptance remains. |
| F15 CRM | Repair exists; future invoice/contract ownership tables remain dependencies. |
| F16 tickets/uploads | Workflow repairs exist; legacy orphan-upload inventory remains. |
| F17 administration | Broad screens/consumers repaired; AI chat backend/KB and policy-test task `02...#T-09.11.04` remain, plus future document processing. Verify exact qualified key before dispatch. Branding email/CDN/other consumers remain partial. |
| F18 production/workers | Image evidence is older, at 11d46d5. Real TLS/DNS/backups/production operations remain unverified. |
| F19 quality/architecture | Four coverage failures above; 144 upstream Drizzle declaration errors/DB skipLibCheck remain; eager purchase-route requirement remains. Vite decision closed. Nightly work tested locally, not a claim of remote CI execution. |
| F20 localization/UI | Many repairs and focused browser tests; broader translation/a11y acceptance remains. Shared package dual ESM/CJS TSUP output and required shared EmptyState/PageLoading/ErrorBoundary were noted as missing, not newly implemented. DatePicker task verified. |
| F21 duplicates/drift | Mostly reviewed/consolidated; public toast manager/renderer mismatch fixed. Do not rebuild repeated task IDs without qualified identity. |
| F22 acceptance | 274 pending, 13 partial. Exhaustive review now explicitly deferred. Continue critical-path evidence needed for the bounded repair pass; no blanket completion from test counts. |
| F23 auth limits | Account+IP failure identity, threshold and PostgreSQL fallback repaired. Rolling histories repaired in migration 0120. Targeted checks pass; final checkpoint pending. |

## F23 rolling authentication limits, repaired locally

PostgreSQL now serializes rolling histories, peeks and resets per namespace/key using transaction advisory locks and server time. Histories retain the latest quota + 1 attempts. Login uses ceiling 10 because ten failures already saturate the existing delay; retaining eleven preserves every lower threshold during expiry. No token-bucket refill is used.

Migration 0120 adds the rolling store and functions. Legacy buckets are consumed once using their latest possible timestamp, conservatively preserving protection across old boundaries. Truncated history stays conservative if a quota increases. Quotas support 1–100000 attempts; storage is bounded by quota + 1 per key/window. Expired keys are reaped with server time. Old writers must be drained before deployment; no deployment was performed.

Reviewed locks/snapshots, reset ordering, truncation/expiry, Retry-After, namespace/window separation and migration journal ordering. Targeted evidence: 8 real PostgreSQL rolling tests, 83 shared limiter tests, 17 authentication HTTP/Redis cases, clean/legacy-upgrade and lineage migration checks, database snapshot check, API/shared/database types and explicit changed-path ESLint pass. One historical-upgrade fixture initially retained new objects while simulating an old schema; corrected its rollback fixture and reran successfully. SMS limiter mock updated for the new database response. Full final regression pending.

F02 timeout repair now sets server statement_timeout per SQL command, default read 10s/write 30s, and retains cancellation guards. Adjacent SET/query pairs prevent concurrent callers exchanging deadlines. Explicit uniform overrides remain supported. Three new PostgreSQL policy checks and 25 existing pool/cancellation/health/options checks pass; types and explicit lint pass. Live PgBouncer transaction pooling is not certified; per-session SET requires session-affine routing. Production restore evidence remains external. F13 legacy receipt requests already deliberately fail closed without trusted initiation fingerprints; manual reconciliation is an external blocker, not an unimplemented approval bypass. Evidence: repair-progress F13.4.

## Evidence map and efficient validation

- `audit/fix-plan.md`: original 23 groups and exit criteria. Read only the active section.
- `audit/repair-progress.md`: large chronological archive, approximately 481 KB. Search targeted headings; do not load whole file.
- `audit/current-task-requirements.json`: canonical requirement overlay for the 322 historical keys. Use this for new reviews.
- `audit/acceptance-closure.json`: verified/partial/pending evidence.
- `audit/current-skipped-tasks.md` and `.json`: current skip dispositions.
- `audit/combined-coverage-checkpoint.json`: latest combined coverage.
- `audit/database-foundation-review.md`, `finance-review-followups.md`, `production-image-review.md`: targeted evidence.

The old audit generator attached wrong story context to 98 infrastructure tasks and included a following story in 22 extracts. This was fixed by delegating to the canonical backlog parser. Historical `task-review.json` remains provenance; do not use its old context over the current overlay. Qualified keys are always `<epic filename>#<task ID>`.

For each repair: reproduce the defect where useful, implement narrowly, review the diff, run relevant tests/types/explicit lint, update concise status, commit locally. Broaden testing when shared impact or failures justify it. Avoid tests that merely mirror implementation.

Package-level API/web lint commands can exit successfully while saying there is no lint script. Use explicit ESLint or root `pnpm lint`; do not credit a no-op as validation.

For an eventual full coverage checkpoint, use a clean committed code revision and run sequentially:

```sh
rtk proxy pnpm exec turbo test:coverage --concurrency=1
rtk proxy env BARGHSA_BROWSER_COVERAGE=1 pnpm --filter @barghsa/web build
rtk proxy env BARGHSA_BROWSER_COVERAGE=1 node scripts/run-production-browser.mjs
rtk proxy node scripts/collect-browser-coverage.mjs
rtk proxy node scripts/merge-browser-coverage.mjs apps/web/test-results/browser-coverage.json
rtk proxy /Users/majid/.local/bin/python3.11 scripts/check-changed-coverage.py --base 2f80d92df51556d47f778b5230e5eea577e2a8d4 --report audit/combined-coverage-checkpoint.json
```

Do not rebuild shared/API packages while browser fixtures are running. Never collect/merge a failed browser run. Existing temporary merged maps are stale. A failed coverage gate remains failed even when all tests pass.

If acceptance records change, regenerate/check current skipped dispositions. The current requirement and skip generators have 11 combined tests. Preserve historical evidence and exact source-revision bindings.

Maintain this compact handoff as current state. Add brief historical evidence to the progress archive only when needed. Do not restart the original audit or repeat completed repairs. Finish the approved bounded pass and clearly list deferred requirements; do not claim full original-plan acceptance.

## Bounded-pass disposition before final checkpoint

Locally actionable confirmed carry-forward defects F23 rolling windows and F02 timeout defaults are implemented and reviewed. F13 legacy receipt approvals already fail closed; do not invent missing initiation evidence. Remaining original-plan acceptance is not certified.

External blockers: live provider delivery and identity provider availability; production TLS/DNS/backup-restore/proxy behavior; legacy notification secrets/attempt reconciliation, address/order/upload inventories, and receipt approval reconciliation; remote loop recovery and PR304/scheduler state. No remote actions authorized or performed.

Deferred work: exhaustive 322-task acceptance and 55 historical-skip reviews; broader role/translation/accessibility matrices and legacy edge acceptance; four existing coverage gates and upstream Drizzle declaration debt; missing shared UI/build-format requirements, eager route loading, AI chat/KB and policy-test acceptance, branding consumers, and future refund/contract/document-processing dependencies. These remain open requirements, not verified implementation. Final regression is the next step, with no new broad audit.

Final checkpoint progress: the first full run passed every non-API package, including all 641 database tests. API had 13 failures in five fixtures still clearing or inspecting retired fixed-window tables. Updated those fixture resets/count assertions without weakening quotas or production behavior; all 55 checks in those five files now pass, plus explicit lint. The full API coverage run will be refreshed. Root lint, backlog validation and all 55 loop-script tests pass. Runtime revision remains d4377bc.

Final-review correction: a real PostgreSQL reproduction showed COMMIT inheriting the preceding read's server deadline. Removed the transaction-command exemption so transaction completion also receives the write budget; aborted SET errors still permit ROLLBACK recovery. All 10 focused timeout/cancellation tests, database types and explicit lint pass. Database/API/worker coverage will be refreshed because the shared pool changed. Browser checkpoint at d27d351 passed 350 Chromium cases with no skipped/flaky/failed cases; collector mapped 350 records to 230 source files and merged web/shared/i18n/UI coverage. Those frontend sources remain unchanged.
