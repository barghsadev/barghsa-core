# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. Latest product 9469d35. R01: finish 02-auth-users-admin.md#T-02.02.01 rotation/cookie review. Reconcile login/password/privilege/recovery boundaries with existing source-bound evidence, then finalize centralized SameSite/path policy against E06 and retained Vite SPA. MFA step-up 9469d35 is atomic and passes 131 focused API and 16 production-browser cases plus types/lint/format. Current-session list refresh after rotation is a known follow-up; approximate location and remaining revocation/CSRF/caller matrices remain. Lost-contact policy question is still pending. Counts remain 49 verified / 18 partial / 255 pending. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
