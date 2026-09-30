# Portable profile data export

Task context: `02-auth-users-admin.md#T-11.01.02`.

The active profile owner can now queue an export from a typed privacy support request. Queueing is atomic and idempotent per request; the existing async-job worker builds a ZIP with a versioned `data.json` manifest and customer-visible document bytes. The manifest uses explicit field allowlists for account and profile details, addresses, orders, invoices and lines, refunds, contracts, electricity order details, wallet balances and transactions, and customer-visible support messages. It excludes credentials, internal support notes, private storage keys, and staff/security metadata. Contract documents are included only after their version is published, matching customer document access.

The settings page shows queued, processing, completed and failed states through the shared bilingual progress component, with retry and support-thread access. A completed job links to an API route that rechecks the current active profile owner and job completion, records a download audit event, and issues a signed URL capped at five minutes and the export's remaining life. The export expires after 24 hours; the worker removes expired objects, and the `tmp/` bucket lifecycle provides a second expiration path for versioned storage. Failed attempts and retries cannot expose a stale archive.

Exports fail with a support action when the profile exceeds the bounded limits of 5,000 rows per data set, 500 documents, 1 GiB of document bytes, or 20 MiB of JSON. Additional domain-specific data sets can be added to the manifest without changing the download format.

Validation: real PostgreSQL API tests for idempotent queueing, ownership and expiry; real PostgreSQL worker tests for ZIP contents, allowlisted fields, document bytes, audit and cleanup; bilingual UI tests for request recovery and progress; root build, typecheck, lint, formatting, OpenAPI, migration snapshot and backlog checks.
