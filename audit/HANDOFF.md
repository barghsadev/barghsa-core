# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. Latest product a22de92. R01: finish trusted-device management for 02-auth-users-admin.md#T-02.01.02. Add own-device list/revoke UI and API, serialize trust authorization with session creation/revocation, and review focused ownership/CSRF/step-up/concurrency cases. Network trust fix a22de92 passes 46 API and 6 migration cases across focused runs. Then align or benchmark Argon2id settings and review .03 OTP / .04 forced password change. Reuse unchanged prior evidence; lost-contact policy question remains pending. Task counts remain 46 verified / 18 partial / 258 pending; this bounded repair does not close login acceptance. Set PLAYWRIGHT_BASE_URL explicitly to a local preview for built-app checks. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
