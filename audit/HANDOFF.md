# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. Latest product e869362. R01: finish OTP-first password reset for 02-auth-users-admin.md#T-02.03.02. Verify OTP before showing password entry while preserving short-lived single-use authorization, five-attempt destination limits, history, atomic audit and all-session revocation. Backend reset repairs and acknowledged login redirect e869362 pass 54 distinct API and 10 browser cases, types/lint/format and 41 route budgets. Task is partial because current UI still submits OTP and password together. Then resume remaining rotation/cookie review; current-session refresh, location and caller matrices remain. Lost-contact policy question is pending. Counts now 49 verified / 19 partial / 254 pending. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
