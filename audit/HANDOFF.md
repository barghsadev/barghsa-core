# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only the selected requirements/evidence. Keep feature batches and completed work. Do not routinely reread the archive.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **1695680**. Three local repairs are complete and reviewed:

- `b68f408`: session bearer IDs and raw exception/URL data removed from auth/session and HTTP error logs.53 API cases pass.35 auth/session method bodies compare unchanged outside logging and unused catch bindings.
- `f1b879b`: owner-requested pre-login CSRF.11 public-auth exemptions replaced with browser-bound anonymous/current-session tokens. PostgreSQL challenges expire after30min, consume before auth and never become user sessions. All browser callers bootstrap.217 distinct API cases across17 files,98 distinct Chromium cases across10 files,11 helper units and40 migration checks pass. Failed intermediate checks remain archived; passing follow-ups replace only their affected files.
- `1695680`: password recovery uses the shared six-digit OTP input, with normalized paste, keyboard controls, automatic submission, pending serialization and clear-on-error.31 affected browser cases pass, including2 new mobile fa/en cases. API code is unchanged; reuse f1b879b and prior reset transaction evidence.

Applicable types/lint/format, production build, OpenAPI, snapshot and42 payload gates pass. Migration0123 must precede API rollout. Its generated snapshot adds one table;94 existing tables are unchanged. No rollout occurred.1218 logs are indexed. This does not renew broad V02, coverage, images or deployed-operation evidence.

## Next feature batch work

Active **R01-session-recovery**, saved PRs #89–#93, #99 and #100. Exact membership, repairs and evidence are in progress.json.active_batch. No confirmed local defect remains in that checklist. **Next consolidate acceptance per task and PR**, reconciling session callers/revocation, forgot-password intake, refresh CSRF and assigned domain-sensitive actions. Preserve verified T-02.03.02. Read original criteria and remaining partial limitations; do not rebuild completed repairs or repeat unchanged checks.

Keep finance/callback/payment-return and telemetry checks with their owning batches. Sensitive-domain matrices remain open. Lost-contact owner policy is unanswered; do not ask again or invent approvers/evidence/retention/provider rules. Partial dependencies do not prevent other items closing. Record one consolidated batch review before updating acceptance/PR counts.

## Preserved work and counts

Registration/OTP batch is complete at c706820:9 tasks verified and9 saved PR reviews closed, #68–#76. Agents/invitations/ownership:4 reviews closed; PR134 and T-05.04.04 remain open for linked domain-role evidence. Their detailed checks remain in step-reviews.json. Preserve staff/CRM and all other completed repairs.

**66 verified /19 partial /237 pending =322 claims.**256 unresolved task reviews are not coding effort. **13 explicit PR reviews closed /1 open /287 not reviewed** from301 saved merged PRs. Mapping counts233 unresolved/64 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. Latest saved GitHub merge September3; no current GitHub coverage is claimed. Preserve older source bindings and the12 recorded evidence-refresh items for V01.

## Decisions and execution

Retain Vite SPA/ADR004; dependency license allowlist is waived. No identity provider exists. Support: info@barghsa.com,021-26658042,09002550292. Owner-approved auth budget covers initial load, estimator measured separately;150KB auth and900KB estimator limits remain. Owner explicitly requested pre-login CSRF; it is implemented. Do not ask these questions again.

Keep R01–B01 order and skipped-build scope. Use rtk and codebase-memory; small output, targeted checks, valid evidence reuse. Build dependencies before web; browser runner serves existing web dist and rebuilds API/shared in setup. Never overlap builds/setup with consumer typechecks.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Keep the goal active while meaningful work remains.
