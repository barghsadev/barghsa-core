# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. CRM users list T-05.01.01 is verified at c8e6a91. R01: review 02-auth-users-admin.md#T-05.01.02 CRM filters/search. Inspect full-text/trigram name matching, combined filters/staff-only, removable search tags, debounce, Jalali dates and clear-all. Reuse T-05.01.01 evidence: 44 distinct API and 20 distinct built-app browser cases. Then review T-05.05.01 pending widget. T-05.02.06 remains partial for contracts/retention policy. Lost-contact approver/evidence question remains pending. Set PLAYWRIGHT_BASE_URL explicitly to a local preview for built-app evidence. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
