# Approved document destruction batch

Task: `05-notifications-documents-ai.md#T-05.14.03` (P1).

The nightly worker prepares bounded manifests only for removed documents past
their retention deadline and free of legal holds. Legal staff review and approve
an exact manifest with a reason and step-up verification. A later pass checks
the current policy, parent closure and holds again, then deletes every S3/MinIO
version of the sealed and original upload keys. It retries partial provider
failures, anonymizes document and storage metadata, and preserves minimal
history and audit events. The admin document workspace shows the queue and
progress counts in Persian and English.

Validation: real PostgreSQL planning, hold, trigger and retry tests; live
versioned MinIO hold/deletion test; document HTTP approval suite; bilingual
document workspace tests; root build, typecheck, lint, formatting, OpenAPI,
database snapshot and backlog checks. Operational rules are in
`docs/operations/storage-retention.md`.
