# Repair status and handoff

Updated 2026-09-08. Read this file first. The original 23-group fix plan remains open; this checkpoint is not whole-plan completion.

## Workspace and authority

- Repo `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Current implementation/test/image revision `9529872`; read HEAD before changing anything. Original audit baseline `2f80d92df51556d47f778b5230e5eea577e2a8d4`.
- Local edits and commits only. No push, PR, merge, deployment, scheduler/state or PR304 action. User authorized Codex implementation directly despite the Cursor/Codex loop split.
- Retain Vite SPA under ADR004. No identity provider exists; automatic verification stays unavailable/fail-closed, manual verification supported. Dependency license allowlist restriction was waived.
- Fix confirmed original-plan defects. Review each step and run focused checks. Reuse unchanged evidence, batch full regressions, defer new noncritical improvements and exhaustive historical acceptance. Do not weaken gates or invent passes.
- Commands start with `rtk`; explicitly stage paths. Prefer codebase-memory project `Users-majid-www-barghsa-barghsa-core`. Avoid API typechecks during Vitest package rebuilds and builds during browser fixtures. Commit clean source before collecting browser coverage; generated Python caches can invalidate its clean-tree binding.

## Previous full checkpoint at 9529872

| Check | Result |
| --- | --- |
| Unit/integration | 5,923 tests, 465 files pass using the 5,815-test full run plus affected package refreshes. This is not one new full workspace run. |
| Production browser | 408/408 Chromium cases pass at 9529872, no skips/flakes/failures. Focused repairs also pass across five browser profiles. |
| Browser coverage | 408 records mapped to 224 files and merged on the exact clean revision. |
| Types/lint | All 11 workspace typechecks and root lint pass. |
| Route payload | All 41 unchanged complete-route gzip budgets pass. |
| Production images | API, worker and web rebuilt at 9529872. Disposable PostgreSQL migrations, read-only/non-root startup, outage recovery, shutdown and retry checks pass. Containers/network removed. |
| Unchanged checks | Prior backlog, 55 loop tests, OpenAPI and migration chain/snapshot through 0120 reused. |

Exact revision bindings, image IDs and logs: `audit/final-repair-checkpoint.json`. Image test procedure/limits: `audit/production-image-review.md`.

## Latest verified steps after the full checkpoint

F14 callback recovery: require persisted release/failure/reopen/final statuses; reject event IDs bound to another order or terminal credit claims without ledger credit. Hold the advisory lock until duplicate ledger lookup settles. Historical credited events with Pending/Failed/Rejected intents now release the original intent on replay without another credit.

Ten PostgreSQL regressions reproduced false success before repair. Final wallet suite passes **559 tests in 28 files**, including 15 new database recovery cases and a delayed-read lock case. API types, focused lint and diff checks pass. Existing replay tests now require rejection instead of accepting another order's transaction ID. Logs `/tmp/barghsa-callback-recovery-red.log`, `/tmp/barghsa-wallet-callback-regression.log`, `/tmp/barghsa-callback-types.log`, `/tmp/barghsa-callback-lint.log`.

F09/F17 notification administration: validate list/save/publication results, retain localized retry, bind returned template identity/content, freeze saving fields, and handle password step-up for create/edit/publish/unpublish/delete/test-send through the existing shared dialog. Capture the original action and ignore late challenges after an editor closes. Unpublishing validates the server's archived state; test-send still requires actual channel/delivery acknowledgement.

Four browser regressions reproduced failures before repair. **55 checks across five browser profiles** pass, plus **17 focused Chromium notification checks** covering existing history/read-only/template behavior. Web types, focused lint, 50 dictionary tests, production build and all 41 route budgets pass. Logs `/tmp/barghsa-notification-recovery-red.log`, `/tmp/barghsa-notification-recovery-final.log`, `/tmp/barghsa-notification-all-profiles.log`, `/tmp/barghsa-notification-types.log`, `/tmp/barghsa-notification-lint.log`, `/tmp/barghsa-notification-budgets.log`. Existing error-message assertions were changed to the localized error instead of raw server text. No real notifications sent.

Source changed after 9529872. Its full coverage/image results remain historical; these repairs have focused evidence only. Coverage refresh is batched; do not cite the prior percentages as measurement of these new sources. No external payment service was called and no remote action occurred.

## Latest completed repairs

- Receipt transitions require persisted expected states before committing money, notices or approvals; PostgreSQL failure-injection checks verify rollback and retry.
- Login, registration and password recovery validate acknowledgements/challenges and preserve retry; body-independent rate limits work.
- Privileged CRM, provider, template, branding and list boundaries have added capability, revocation, input and actor-binding checks.
- Geography has localized keyboard-managed dialogs, response validation and retry; fallback primary contrast repaired.
- Email provider mutations validate outcomes and recover through password step-up for create/edit/test/activate/disable/rollback. No external email sent.
- Role lookup validates data and requested identity, cancels obsolete requests and clears stale permissions. 25 five-profile checks pass.
- OTP boxes normalize Persian/Arabic digits, preserve left-to-right order in RTL, and submit exact ASCII codes. 20 five-profile checks pass.
- Coverage classifier now recognizes PascalCase/camelCase critical files. Older 11/13 gate results missed 41 critical files and are superseded.

## Remaining local work

Coverage still fails **3 of 13 groups**, with no report errors. Thresholds and scope have not been waived:

| Group | Lines | Branches | Required |
| --- | --- | --- | --- |
| API critical | 92.34% | 81.07% | 90% / 85% |
| Web critical | 73.07% | 70.42% | 90% / 85% |
| Web general | 66.38% | 62.02% | 80% / 75% |

- Broader coverage/acceptance work remains. Prioritize meaningful critical-path regressions; do not add implementation-mirroring tests for percentages.
- Customer purchase paths still use lazy loading. Earlier eager-loading attempts exceeded auth/order budgets and were reverted. No requirement or threshold was weakened; architecture work remains.
- Strict DB dependency declarations still have 146 errors, primarily upstream Drizzle declarations. `skipLibCheck` remains. UI strict consumer checks pass; no dependency patch/upgrade has resolved the DB gap.
- Historical role/session/notification/finance/localization/operations acceptance, AI chat/KB/policy-test acceptance and remaining branding consumers are not certified.

## External and deferred acceptance

- No real identity provider; delivery, TLS/DNS, backups/restore, production proxy/cancellation, legacy notification secrets/attempts and address/order/orphan-upload inventories remain unverified.
- Legacy receipt approvals without trusted fingerprints require manual reconciliation while preserving history. Remote loop recovery/PR304/scheduler/state remains outside this local authorization.
- Historical ledger unchanged: 35 verified, 13 partial, 274 pending. Of 58 skips, 3 verified must not be rebuilt; 55 remain pending. Always use `<epic filename>#<task ID>`.
- No new skipped-task features. Future refund/contract/profile-credential/document-processing dependencies remain separate.

## Read only what the next fix needs

- `audit/fix-plan.md`: original 23 groups, not a current completion percentage.
- `audit/current-task-requirements.json`: current requirements overlay.
- `audit/combined-coverage-checkpoint.json`: current gate details.
- `audit/acceptance-closure.json`, `audit/current-skipped-tasks.*`: unchanged individual dispositions.
- `audit/resumed-repair-evidence.md`: chronological resumed evidence, only if a specific prior check needs investigation.
- `audit/repair-progress.md`: older large archive; do not reload routinely.
