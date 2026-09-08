# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. CRM filters/search verified at 4b8ccf8. R01: review 02-auth-users-admin.md#T-05.05.01 pending-verification dashboard widget against current permissions, disabled verification settings, count/latest-five data and Show all link. T-05.01.01/.02 and T-05.02.01/.02/.03/.04/.05 are verified. Reuse 47 API and 20 built-app list cases. T-05.02.06 remains partial for contracts/retention. Lost-contact approver/evidence question remains pending. Set PLAYWRIGHT_BASE_URL explicitly to a local preview for built-app evidence. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
