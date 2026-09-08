# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements/evidence. Directory reconciliation is complete; do not routinely reread the archive.

## Feature-batch execution, approved September 8

Use the [feature-batch rules](fix-plan.md#feature-batch-rules) for subsequent review and repairs. Finish any change/check already running, then continue within one coherent feature batch. The detailed next_action below is the starting point inside the batch, not a separate full review cycle for every small fix.

First batch: agents, invitations and ownership, saved PRs #131–#135, tasks `02-auth-users-admin.md#T-05.04.01` through `T-05.04.05`. Combine their remaining requirements and PR132 deferrals into one checklist, reuse the recorded repairs, fix confirmed gaps, review each meaningful change, then run one affected-workflow regression and save one batch report. Close each task/PR on its own evidence. Assign cross-domain role checks to their owning feature batches and keep T-05.04.04 open until those checks are linked. Preserve the existing R01–B01 order and skipped-task scope.

Report explicit PR review closure, partial/blocked items and exact remaining defects. “Mapped tasks verified” alone is not PR closure. Batch size follows shared behavior, not a fixed number of PRs. Avoid repeated full checks and audit rewrites after each small edit. Full procedure and recording rules are in the plan.

## Current work and evidence

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Check actual HEAD/worktree. Latest product `a80c807` repairs named ownership-success notice and consistency with the displayed member name. [Step review](evidence/step-reviews.json#R01-ownership-recipient-notice) records36 production-browser team cases, i18n/web builds, web types, lint/format and41 route budgets. API authority repair `b4a0c83` records70 distinct API/unit cases and quality/contract checks. Failed runs and asset hashes are retained. No broad checkpoint renewal.

R01: finish ownership presentation T-05.04.05. API authority/expiry/audit is verified at b4a0c83; named success and selected-name consistency at a80c807. Confirmed remaining requirement: TeamPage selects the member before step-up, while the written sequence requires step-up first, then agent selection and confirmation. Repair that sequence using existing dialog behavior; verify cancel/retry/fresh-CSRF/exact recipient, incoming banner and relevant fa/en/RTL/theme/error states. Then finish invitation list/details/preview/confirmation and current role/domain consumers. Reuse unchanged backend and browser evidence. Lost-contact policy remains pending; do not ask again.

Ownership backend uses profile/transfer → sorted party accounts → actor session → target membership locks. Final checks permit only the exact intentional revocation timestamp on successful acceptance. A savepoint after these locks lets an expired decision restore tentative writes and credentials, then commit only Expired before409. Authentication or audit failure rolls back everything. The HTTP fixture clears only its own initiation quota between independent cases.

Frontend notice is a TeamPage-local successMessage on the selected action, read only after successful mutation. Shared TeamActionDialog is unchanged. TeamPage/Member, dialog and banner were read. Member selection currently precedes the required password prompt; this is a confirmed ordering gap. Do not mark the whole task verified from its notice or API repair.

Reuse e48bf58 invitation and417ab33 agent evidence where sources remain unchanged. Confirmed contacts are already implemented: info@barghsa.com,021-26658042,09002550292.

Counts remain53 recorded verified /18 partial /251 pending claims;12 older verified-record source drifts remain. Saved inventory301 PRs/58 skips and971 indexed logs. These are review counts, not coding effort. GitHub refresh awaits access.

Use `rtk` and prefer codebase-memory. Freeze scope, keep output small, reuse valid evidence. Build changed workspace dependencies before the frontend. In particular build i18n before web after dictionary changes; frontend-only build can silently consume old dist. Build frontend before production-browser checks; runner serves existing dist. Playwright global setup rebuilds API/shared, so finish browser runs before consumer typechecks. Local edits and explicit commits only; no push, PR publication/merge, scheduler or deployment action.
