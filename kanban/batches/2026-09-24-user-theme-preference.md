# Per-user display theme

Canonical scope: remaining light/dark preference in `01-platform-infrastructure.md#T-06.03.05`.

The signed-in customer and admin shells now offer Default, Light and Dark display choices in Persian and English. Default follows the active admin brand; a user choice overrides it on every device and survives reload. The setting is stored on the user account with a database constraint, authenticated read/write endpoints, CSRF protection, rate limits and an audited transaction. Returning to Default clears the override. Published branding changes still update palette and layout tokens while retaining a user's chosen mode.

Validation: two real-PostgreSQL HTTP tests cover input validation, account isolation, audit history and rollback; four Chromium branding journeys cover both languages and both admin defaults through selection, reload and reset. All workspace typechecks and builds, database snapshot and OpenAPI contract checks, changed-file lint/format, and backlog validation pass. The API contract and generated migration snapshot are committed with the implementation.
