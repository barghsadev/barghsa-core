# Staff and customer operating contexts

Task context: `02-auth-users-admin.md#T-11.02.01` and `02-auth-users-admin.md#T-11.02.02`.

Sessions now carry an explicit staff or customer context. A dual-role account can switch deliberately from the persistent bilingual shell control; switching rotates the session, refresh credential and CSRF token, clears step-up verification, and records the transition. Staff permissions are absent in customer context. The global HTTP policy blocks staff routes in customer context and active-customer routes in staff context, including direct requests from stale tabs. Profile ownership checks still apply within customer context.

Async jobs are tagged with their issuing context. Status and retry reads cannot cross contexts, and the profile-export worker verifies customer context before reading data or touching stored files. New upload reservations bind their URLs and record actions to the issuing context; upload purpose authorization also enforces the context. Existing reservations without a context tag remain usable under their previous rules until they expire.

Validation: real-PostgreSQL API integration and unit tests for context changes, stale credentials, route denial, job isolation, upload URLs and purpose checks; worker export integration tests; bilingual web component tests; Chromium browser test for the visible switch and workspace route; full build, typecheck, lint, formatting, OpenAPI contract, database snapshot and backlog checks.
