# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Check actual HEAD and worktree first. Archive confirmation/local acceptance is at `1da0e6a`. T-05.02.02/.03/.04/.05 remain verified. Next review T-05.02.01 whole-profile/list requirements. T-05.02.06 remains partial for future contract integration and approved retention policy. Reuse 104 passing API cases across focused runs, eight final archive browser cases, 50 i18n cases and prior invoice/wallet evidence. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
