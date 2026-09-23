# Resumable solar request intake

Canonical scope: extend `03-core-business.md#T-03.90.17` to the solar request form in `T-03.11.02.01`–`.06`.

The solar intake form now resumes a profile-scoped server draft for seven days. It saves edited site and grid details after a short pause, offers an explicit Save progress action, and waits for a save before sending a customer to address settings. A failed read offers retry without showing an empty form over saved work; a failed write leaves entered values on screen. Agreement acceptance is requested again when the form resumes.

Draft reads and writes require the current session and permission to manage the profile. The API validates incomplete form fields, audits changed saves, and ignores identical repeats. Submission deletes the draft in the same transaction as the request. The form waits for an in-flight save before submitting so that it cannot recreate a stale draft afterward. The migration adds a bounded JSON draft table with an owner key and updated-at trigger.

Validation: migrated solar request HTTP tests cover ownership, validation, resume, expiry, no-op saves, and submission cleanup. Customer UI tests cover bilingual form behavior, restored details, and preserving input after a save error. API/web/DB types, API/web builds, changed-file lint/format, database snapshot, OpenAPI contract, and backlog checks pass locally.
