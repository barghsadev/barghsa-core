# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. Latest product f39132f. R01: implement required MFA step-up session rotation for 02-auth-users-admin.md#T-02.02.01 and security T-06.01.04.03. Make verification, replacement session/refresh/CSRF, step-up stamp and audit atomic; deliver new cookies and check sensitive-action retry callers for stale CSRF/session IDs. Then finish rotation triggers and centralized cookie policy. Session deadline repair f39132f passes 78 distinct focused API cases, types/lint/format. T-02.02.01 stays partial. Lost-contact policy question remains pending. Counts remain 49 verified / 18 partial / 255 pending. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
