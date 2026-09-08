# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements/evidence. Directory reconciliation is complete; do not routinely reread the archive.

## Feature-batch execution, approved September 8

Use the [feature-batch rules](fix-plan.md#feature-batch-rules) for subsequent review and repairs. Finish any change/check already running, then continue within one coherent feature batch. The detailed next_action below is the starting point inside the batch, not a separate full review cycle for every small fix.

Completed first batch: agents, invitations and ownership, saved PRs #131–#135, tasks `02-auth-users-admin.md#T-05.04.01` through `T-05.04.05`. Its consolidated review and repairs are already recorded. Use the same combined-checklist procedure for each subsequent batch. Close each task/PR on its own evidence. Assign cross-domain role checks to their owning feature batches and keep T-05.04.04 open until those checks are linked. Preserve the existing R01–B01 order and skipped-task scope.

Report explicit PR review closure, partial/blocked items and exact remaining defects. “Mapped tasks verified” alone is not PR closure. Batch size follows shared behavior, not a fixed number of PRs. Avoid repeated full checks and audit rewrites after each small edit. Full procedure and recording rules are in the plan.

## Current work and evidence

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product commits `029905c` and `adf9020`; check actual HEAD/worktree. Active batch is **registration and OTP**, saved PRs #68–#76, tasks `02-auth-users-admin.md#T-01.01.01`–`.06` and `T-01.02.01`–`.03`. Exact checklist, reviewed repairs, source hashes and logs are in `progress.json.active_batch`. This is an interruption checkpoint, not batch acceptance closure.

Completed UI repair: masked destination hints; password meter focus/blur/submit behavior with stable layout during clicks; localized toast and alert; mobile branding stack; serialized OTP verify/resend; elapsed-time cooldown; expiry navigation cleanup; registration through the existing `/app` route to onboarding. Preserve `/_app/app`; an unnecessary new alias was removed during review. **76 distinct production-browser cases pass** across focused Chromium/mobile Chrome runs, including login/reset consumers. Web types, focused lint/format and all41 unchanged route budgets pass.

Completed API repair: `user_created` audit, accepted publication ID/time and both language content hashes commit atomically with user/consent/OTP/session/refresh. Expiry during consent, session, refresh or audit waits rolls everything back. Audit failure permits one concurrent retry. **21 distinct API cases pass**, including actual delivered-code registration. API types and focused lint/format pass. No schema, dependency, API response or cookie-policy change.1073 logs are indexed, including failed/interrupted checks; new logs are bound from the active batch. No broad regression, coverage, image or deployed-operation renewal.

Next: finish registration deduplication and admin-configurable OTP expiry. Review backend username normalization, aggregate device quota, strength-estimator equivalence, literal terms-link behavior and remaining cookie/session/CSRF criteria. Reuse the UI and atomic-audit evidence. Resolve PR71/73/74 historical claims and make one consolidated nine-task batch report. No task/PR from this active batch is closed yet.

Previous agents/invitations/ownership batch remains locally complete:4 PR reviews closed, PR134 open for linked domain-role evidence. T-05.04.01/.02/.03/.05 verified; T-05.04.04 partial. All three PR132 deferrals satisfied. Exact remaining domain assignments are in `progress.json.open_domain_reviews`; consolidated evidence remains in `evidence/step-reviews.json#R01-agents-invitations-ownership`. Do not rebuild completed staff, CRM, invitation or ownership work.

Counts remain57 verified /19 partial /246 pending =322 claims.265 unresolved reviews are not a coding-effort estimate. Saved inventory301 PRs and58 skips,3 verified/55 pending; latest saved merge September3. GitHub refresh awaits access. Keep older source/dependency drifts visible; reconcile reviewed shared-file changes at batch closure without discarding valid evidence.

Lost-contact approver/identity policy remains pending; do not ask again. Contacts are implemented: info@barghsa.com,021-26658042,09002550292. Preserve Vite SPA/ADR004 and the license-policy waiver. No identity-verification provider exists.

Use rtk and prefer codebase-memory. Keep output small, scope frozen and R01–B01 order. Build changed dependencies before web, including i18n after dictionary changes. The production browser runner serves existing web dist; its setup rebuilds API/shared. Never overlap API/shared builds or browser setup with consumer typechecks. Local edits and explicit commits only; no push, PR publication/merge, scheduler, deployment or PR304 action.
