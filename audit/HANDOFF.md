# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Check actual HEAD and worktree first. T-05.02.01 full profile view is verified at `af68316`; .02/.03/.04/.05 remain verified. Next review T-05.01.01 CRM users list. T-05.02.06 remains partial for future contract integration and approved retention policy. Reuse 80 passing built-app CRM cases plus the final eight hover/tab cases and earlier backend checks. Earlier default-server browser labels were corrected to development. Set PLAYWRIGHT_BASE_URL explicitly to a local preview when claiming built-app validation. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
