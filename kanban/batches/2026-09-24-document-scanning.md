# Document scanning batch

Task: `05-notifications-documents-ai.md#T-05.11.03` (P0).

Configured ClamAV scanning now holds confirmed uploads in `PendingScan` with a
durable database job. The worker verifies the sealed private copy and its
checksum before scanning. Clean files become `Available`, with any previous
version superseded in the same transaction; infected files become
`Quarantined`. Scanner or storage failures retain the pending state and retry
with bounded exponential backoff. Active admins receive in-app alerts for
malware and after three failed attempts. Document events and audit entries
record each verdict. With no scanner configured, the existing explicit
`not_configured` path remains.

Validation: full document HTTP integration suite (including clean, replacement,
infected, alerts, and retry), ClamAV protocol tests, root build and typecheck,
focused lint, database snapshot check, and backlog check. Operational setup is
documented in `docs/operations/document-scanning.md`.
