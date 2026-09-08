# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Check actual HEAD and worktree first. Staff editing task T-05.02.02 is verified locally at `0023f20`; product and test changes are committed. Continue T-05.02.06 archive acceptance, then profile/list review. Reuse the 201-case CRM batch, subsequent 21-case legal HTTP run and 92 distinct passing browser cases across focused runs. No single green 92-case invocation, whole-suite or global coverage renewal is claimed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
