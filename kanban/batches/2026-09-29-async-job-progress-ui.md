# Async job progress UI

Task context: `05-notifications-documents-ai.md#T-05.24.04`.

`JobProgress` accepts a job ID and polls the owner-scoped status endpoint every two seconds without overlapping requests. It stops after completion or failure, offers a status refresh after a fetch error, and retries a failed job through the CSRF-protected endpoint. The shared `JobProgressView` renders a named status, progress bar, result link, and optional operation-supplied time estimate in Persian and English. It rejects unsafe result links at the client boundary. The development-only component catalogue shows queued, processing, completed, and failed examples; this batch does not put an unfinished job flow on a live page.

The generic job API does not yet supply a time estimate, so the component says that completion time is unavailable unless a product operation provides a real estimate. Product-specific job producers and worker handlers remain future batches.

Validation: web polling/terminal-state test, UI distribution tests, root build, typecheck, lint, and formatting before push.
