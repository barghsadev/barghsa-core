# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Check actual HEAD and worktree first. Staff editing task T-05.02.02 remains verified at `0023f20`. Invoice archival repairs are committed at `8f86af0`. Continue T-05.02.06 with wallet balance writers and their transaction-owning callers; profile locks must precede staff/ledger/wallet locks. Then verify balance/owner constraints, confirmation checklist, response target/timestamp and retention disposition. Contracts remain an unimplemented dependency. Reuse the 28 passing archive/invoice cases and 109 existing related cases across focused runs. No whole-suite or global coverage renewal is claimed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
