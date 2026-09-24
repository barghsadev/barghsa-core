# Gift-code management at scale

Canonical scope: `03-core-business.md#T-03.02.02.02` and the usage-statistics portion of `03-core-business.md#T-03.02.02.05`.

The admin gift-code list now filters by eligibility and expiry in addition to code, status, and discount type. The page requests 50 codes at a time and loads older codes by a stable database cursor, retaining loaded rows while staff inspect or edit one. The list query selects the page before counting redemption history, so usage aggregation is bounded by the visible codes. The existing array response remains valid for callers that do not request pagination.

Editing a code now exposes its per-profile usage and 25 most recent redemptions, including restoration time where applicable. Profile names, amounts, and dates are readable in Persian or English with the account timezone. Loading errors can be retried without discarding the list.

Validation: real PostgreSQL HTTP tests cover filters, pagination, invalid cursors, and existing gift-code routes. A rendered UI test covers loading another page, retaining it during editing, usage history, and filter submission. API/web typecheck, build, lint, formatting, OpenAPI contract, and backlog checks pass before pushing to `main`.
