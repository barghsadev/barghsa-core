# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements and evidence. Preserve feature batches and valid completed work.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **9526cc5**. Latest consolidated batch: **R01-profiles-onboarding**, PRs102–110. **7 task acceptances verified /1 partial;8 PR reviews closed /1 open**. Four repairs: settings default control ffd77e1; required default endpoint9cc2c70; localized identity digits ba62f29; first invited-profile default ab09a87.

53 distinct affected API cases and29 distinct current/reused production Chromium cases pass. Types/lint/format/build/OpenAPI and42 unchanged budgets pass at relevant revisions. Focused reruns overlap; do not sum all logs.1334 logs indexed. Initial failing reproductions and intermediate fixture failures are preserved. Prior14-file source comparison and additional source/test comparison support reuse; changed controller/agent/forms have focused evidence. No broad V02, coverage, image or deployment evidence renewed.

Profile/onboarding forms, completion, current selection and switching are reviewed. PR106 UI deferral is satisfied by PR108 and current repaired forms; useful slices are retained. Province seed contains31 provinces; city provisioning remains deployment data evidence. PR103/T-03.01.02 remains partial for actual commercial-order submission rejection and blocking UI. No provider exists; automatic verification stays unavailable.

## Next feature batch

Active **R01-account-settings**, saved PRs **111–114**, four tasks T-03.03.03 through .06 in02-auth-users-admin.md. Exact criteria and evidence reuse are in progress.json.active_batch. Review profile edit/verified identity/address history and confirmation; old/new contact OTP, alternate login and session effects; account notification defaults/availability; timezone persistence, preview and actual display consumers. No frozen deferrals in these four PRs. Review current implementation once, repair confirmed defects, check each change, then record one combined disposition. Delivery consumers remain R02 and shared date-display gaps R03 when required.

First account-settings repair is committed at56498a1. Save now requires confirmation, preserves drafts on failure, checks the response profile and prevents duplicate requests. Edit/lock hints use existing icons, native hover text and visible explanations.9 distinct browser cases pass, with2 overlapping final reruns;types/lint/format/build and42 budgets pass. Electricity249.93KB/250KB. No API changes. Exact checks and remaining review are in active_batch.local_repairs/checkpoint. Whole four-task acceptance remains pending.

Notification defaults are repaired ate3981b9 for registration and staff creation, preserving existing choices. Availability/API/audit/UI repair9526cc5 passes8 focused HTTP cases and6 fa/en browser cases;types/lint/format/OpenAPI/build and42 budgets pass. Shared CSRF race71f5e49 binds the submitted token during locked authentication before idle touch.31 focused cases plus89 unchanged passing cases provide120 distinct checks. This is separate from completed pre-login CSRF.

Next review username/contact issuance and completion authority with existing old/new OTP and alternate-login evidence. Then finish profile-update and timezone criteria and consolidate this four-task batch. Notification delivery remains assigned toR02. Preserve earlier source comparisons for unchanged files; notification controller/page and shared authentication now have focused evidence.

## Counts and preserved work

**76 verified /18 partial /228 pending =322 claims.246 unresolved reviews are not coding effort.** Explicit saved PR reviews: **25 closed /5 open /271 not reviewed** of301. Mapping counts222 unresolved/75 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. GitHub inventory stops September3; no fresh query claimed. Preserve12 older evidence-refresh entries and original source bindings.

Preserve registration/OTP atc706820, agents/invitations/ownership at1bf4680, session/recovery at1695680 and completed staff/CRM work. Session/recovery retains callback/telemetry and sensitive-domain assignments; lost-contact policy/execution remains open. Do not ask that policy question again. Keep R01–B01 order; new skipped builds follow repair closure.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency license allowlist waived. No identity provider exists; manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB measured separately. Pre-login CSRF explicitly requested and implemented atf1b879b on11 public-auth routes. Do not rebuild it or ask these questions again. Migration0123 must precede API rollout; no rollout occurred.

Use rtk and codebase-memory; small output, targeted checks and valid evidence reuse. Browser fixtures serve existing web dist and rebuild API/shared in setup. Never overlap builds/setup with consumer typechecks. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Keep work active while meaningful tasks remain.
