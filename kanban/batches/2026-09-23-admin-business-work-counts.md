# Admin business work counts batch

Canonical scope: `03-core-business.md#T-03.90.09`.

The admin dashboard now shows linked counts for open consultation requests, electricity orders awaiting staff review, open solar construction requests, and documents submitted for review. The API returns only categories the current staff permissions allow, and the UI handles loading, error, and unavailable categories in Persian and English. Counts refresh while the dashboard is open.

Validation: HTTP integration seeded consultation, electricity, and solar work, checked permission-scoped counts, and denied customer access. The existing admin dashboard UI tests passed. Root build, typecheck, lint, format, backlog, and OpenAPI contract checks passed.
