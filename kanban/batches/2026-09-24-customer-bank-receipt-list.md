# Customer bank-receipt list

Canonical scope: `07-ui-ux-design.md#T-07.18.03.03`, the customer bank-receipt list pattern.

Customers can open a bilingual receipt list from the invoice page, see receipts across invoices on the active profile, filter by review state, and page through the newest receipts. Each row links to its receipt in the invoice payment timeline, where the existing detail, attachment, and review history remain available. The API checks the live session and active profile, excludes draft invoices, and uses a stable, microsecond-precision cursor. A profile and creation-time index supports the list query.

Validation: PostgreSQL HTTP tests cover ownership, pagination boundaries, filters, and invalid cursor input. UI tests cover bilingual rendering, pagination, filtering, retry, and detail navigation. Build, typecheck, lint, formatting, OpenAPI, database snapshot, and backlog checks run before push.
