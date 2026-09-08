# Continue here

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). Follow `next_action`. Do not restart completed reviews or routinely reload the archive.

Workspace /Users/majid/www/barghsa/barghsa-core, branch codex/audit-fixes. Check actual HEAD/worktree first. Latest product 7b15638. R01: implement own trusted-device list/revoke API and Settings > Security UI for 02-auth-users-admin.md#T-02.01.02. Network trust and atomic session authorization/metadata privacy are repaired at a22de92 and 7b15638 with saved focused evidence. Use user-before-trust locks; verify ownership, CSRF, confirmation/step-up and future-login behavior. Then confirm Argon2id settings and review .03 OTP / .04 forced password change. Reuse unchanged evidence; lost-contact policy question remains pending. Counts remain 46 verified / 18 partial / 258 pending. These bounded repairs do not yet close login acceptance. Set PLAYWRIGHT_BASE_URL explicitly to a local preview for built-app checks. No global checkpoint is renewed.

The plan contains remaining fixes, PR reviews, skipped work, decisions and external prerequisites. [Acceptance](acceptance-closure.json) owns statuses; [PR](merged-pr-review.md) and [skip](current-skipped-tasks.md) reports derive from it. [Step reviews](evidence/step-reviews.json) and [logs](evidence/index.json) hold detailed evidence.

Use `rtk` and prefer codebase-memory for code discovery. Stage explicit paths. Avoid API typechecks during Vitest package rebuilds, and builds during browser fixtures. Measure coverage on its required clean revision. Fix one bounded item, review/check it, then update progress. Local implementation/commits only; no remote operation or feature-loop dispatch.
