# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. Latest product 53a8bec. R01: review 02-auth-users-admin.md#T-02.01.03 OTP, including durable trust-creation audit and challenge validity after lock waits, then .04 forced password change. Login flow .02 is locally verified through 53a8bec using reviewed backend evidence and 36 production-browser cases. Reuse valid evidence; lost-contact policy question remains pending. Counts now 47 verified / 18 partial / 257 pending. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
