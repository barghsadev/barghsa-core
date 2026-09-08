# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. Latest product b18fffd. R01: finish 02-auth-users-admin.md#T-02.01.02 login acceptance by aligning Argon2id hashing parameters with 37 MiB/t3/p1 or proving a benchmarked equivalent. Preserve verification of existing encoded hashes. Network trust, atomic authorization/privacy and own-device management are repaired through b18fffd, with 17 API/cookie and 60 browser cases for the latest step. Then review .03 OTP, including trust-creation audit, and .04 forced password change. Reuse valid evidence; lost-contact policy question remains pending. Counts remain 46 verified / 18 partial / 258 pending. Device management is reviewed, but login acceptance still needs the remaining hash/flow criteria. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
