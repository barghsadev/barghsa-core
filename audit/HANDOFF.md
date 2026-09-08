# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements/evidence. Directory reconciliation is complete; do not routinely reread the archive.

## Feature-batch execution, approved September 8

Use the [feature-batch rules](fix-plan.md#feature-batch-rules) for subsequent review and repairs. Finish any change/check already running, then continue within one coherent feature batch. The detailed next_action below is the starting point inside the batch, not a separate full review cycle for every small fix.

First batch: agents, invitations and ownership, saved PRs #131–#135, tasks `02-auth-users-admin.md#T-05.04.01` through `T-05.04.05`. Combine their remaining requirements and PR132 deferrals into one checklist, reuse the recorded repairs, fix confirmed gaps, review each meaningful change, then run one affected-workflow regression and save one batch report. Close each task/PR on its own evidence. Assign cross-domain role checks to their owning feature batches and keep T-05.04.04 open until those checks are linked. Preserve the existing R01–B01 order and skipped-task scope.

Report explicit PR review closure, partial/blocked items and exact remaining defects. “Mapped tasks verified” alone is not PR closure. Batch size follows shared behavior, not a fixed number of PRs. Avoid repeated full checks and audit rewrites after each small edit. Full procedure and recording rules are in the plan.

## Current work and evidence

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Latest product `1bf4680`, following `bcbbe1b`; check actual HEAD/worktree. [Consolidated feature-batch review](evidence/step-reviews.json#R01-agents-invitations-ownership) covers saved PRs131–135.

Local batch work is complete. **4 PR reviews closed /1 open /0 blocked**. Tasks T-05.04.01/.02/.03/.05 are verified. T-05.04.04/PR134 stays partial/open for linked wallet/receipt/payment/refund, invoice, contract/document and order/address role evidence. Exact assignments remain in progress.json.active_batch. All three PR132 deferrals are satisfied locally. PR dispositions are distinct from task-mapping counts and GitHub actions.

Repairs: team table; invitation modal and named preview; private entity details through native disclosure; atomic localized in-app notice; pending invitation discovery after real registration without automatic membership; bounded audited expiry worker. Ownership verifies the password before selecting and confirming an eligible recipient. Named success remains. Final review preserved existing confirmation focus outside ownership.

Evidence:92 API checks,13 real-PostgreSQL/compiled-worker checks,80 distinct production-browser cases and50 i18n checks pass. Applicable types/lint/format/OpenAPI and all41 unchanged route budgets pass.16 final focus rechecks overlap the80. Ownership API bodies are unchanged; reuse b4a0c83 evidence.1047 logs are indexed, including failures. No broad checkpoint, coverage, image or deployed-operation renewal.

Native details and45 team-page-only translation keys moved to a separate entry keep payloads within budget. Optional chunk extraction did not satisfy the complete-route gate and was replaced. Theme scans wait for finite animations; duplicate table landmark is repaired. Preserve completed work and valid checks.

Next: select the next bounded R01 account/session recovery batch from saved requirements and PR evidence. Keep staff/CRM/invitation/ownership repairs and R01–B01 order. Lost-contact approver/identity policy remains pending; do not ask again. Confirmed contacts are implemented: info@barghsa.com,021-26658042,09002550292.

Counts:57 verified /19 partial /246 pending =322 claims.265 unresolved reviews are not a coding-effort estimate. Twelve older source/dependency drifts remain. Saved inventory301 PRs and58 skips,3 verified/55 pending; latest saved merge September3. GitHub refresh awaits access.

Use rtk and prefer codebase-memory. Keep output small and scope frozen. Build changed dependencies before web, including i18n after dictionary changes. Production browser runner serves existing web dist and its setup rebuilds API/shared. Never overlap API/shared builds or browser setup with consumer typechecks. Local edits and explicit commits only; no push, PR publication/merge, scheduler, deployment or PR304 action. Continue feature batches and record one consolidated report at each checkpoint.
