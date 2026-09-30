# Async jobs backend

Task context: `05-notifications-documents-ai.md#T-05.24.01`–`T-05.24.03`.

The new `async_jobs` table tracks one-shot work separately from the recurring worker failure ledger. Product services can inject `JobService` and call `submit(type, payload, createdBy)` to return a UUIDv7 job ID immediately. The worker claims queued jobs atomically across replicas, renews a lease while a registered handler runs, updates progress, and reclaims an interrupted job. Handler failures are stored as safe codes without leaking exception text; the owner can retry a failed job. The worker accepts only handlers registered in code and leaves other types queued during rolling deployments. Completed result URLs must be app-relative.

Authenticated `GET /api/jobs/:id` and `/status` return a status without the stored payload. `/result` returns 202 while work is pending, redirects only the owner to a completed relative URL, returns 204 for completed work with no URL, or returns 409 after failure. `POST /api/jobs/:id/retry` requeues only the owner's failed job with CSRF protection. No public endpoint accepts arbitrary job submissions. A product operation must register its handler before it starts submitting that job type; no production job type is registered in this foundation batch.

Validation: real PostgreSQL migration/claim race and lease recovery tests, authenticated API ownership/result/retry integration tests, root build and static checks.
