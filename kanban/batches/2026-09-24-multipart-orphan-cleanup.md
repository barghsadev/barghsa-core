# Resumable multipart upload and orphan cleanup batch

Tasks: `05-notifications-documents-ai.md#T-05.15.01` (P0) and
`05-notifications-documents-ai.md#T-05.15.02` (P1).

Files above 5 MiB use authenticated multipart sessions bound to the original
upload reservation. Part URLs write directly to S3-compatible storage; the
server lists completed parts for resume and verifies the exact authorized
size before completion. Large business documents use the same flow and then
pass through existing inspection, scan and immutable-copy checks.

An hourly worker scans incomplete provider uploads in bounded pages, aborts
uploads past the admin-configured age (24 hours by default), records outcomes
in `upload_cleanup_log`, and persists its scan cursor. A seven-day S3 bucket
rule is the fallback. The storage runtime forwards multipart operations and
approved document destruction to its active provider.

Validation: live MinIO multipart HTTP and document-confirmation tests, real
PostgreSQL and MinIO cleanup test, storage policy authorization and versioning
tests, browser resume tests, build, typecheck, lint, formatting, OpenAPI,
database snapshot and backlog checks. Operational details are in
`docs/operations/storage-retention.md`.
