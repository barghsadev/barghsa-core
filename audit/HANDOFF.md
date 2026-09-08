# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements/evidence. Directory reconciliation is complete; do not routinely reread the archive.

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Check actual HEAD/worktree. Latest product `e48bf58` repairs invitation creation/withdrawal/decline current authorization, private invited-username checks, expiry/audit rollback and acceptance/decline deadlock. [Step review](evidence/step-reviews.json#R01-invitation-authority) records120 distinct API/unit cases and quality/contract checks. Failed runs and fixture corrections are retained. No frontend or broad checkpoint renewal.

Next R01: ownership initiation/acceptance/decline/cancel. Both AgentsService methods were fully read. They take actor userId only; no current actor session/CSRF/step-up check occurs after guards. Initiation locks profile and target membership/account but not the actor account/session. Resolution locks profile then transfer; only acceptance locks sorted owner accounts before target membership. Audit lacks verified time and request correlation. Transfer expiry is checked only before writes. Repair those boundaries; preserve successful dual-owner credential invalidation, no-op/one-owner behavior and the durable Expired transition that commits before returning409. Reuse417ab33 ownership credential evidence. Then agent/invitation presentation and current domain-role acceptance. Lost-contact policy remains pending; do not ask again.

Common helper: requireCurrentSession now contains the previous locked-session SQL/CSRF/deadline checks; requireSessionStepUp additionally requires fresh verified time. Invitation operations intentionally do not require step-up. Exact preserved code and unchanged acceptance/agent methods are logged.

41 new HTTP cases replace obsolete invitation SQL mocks. Existing concurrency tests now follow recursive blocking chains and actual current lock queries. Combined fixture tests clear only their per-IP decline quota between independent cases. Production limits remain active. Tests are sequential within the fixture.

Counts remain53 recorded verified /18 partial /251 pending claims;12 older verified-record source drifts remain. Saved inventory301 PRs/58 skips and945 indexed logs. These are review counts, not coding effort. GitHub refresh awaits access.

Use `rtk` and prefer codebase-memory. Freeze scope, keep output small, reuse valid evidence. Build frontend before production-browser checks; the runner serves existing dist. Playwright global setup rebuilds API/shared, so finish browser runs before consumer typechecks. Local edits and explicit commits only; no push, PR publication/merge, scheduler or deployment action.
