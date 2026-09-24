# Quarantined contract original recovery

Canonical scope: `05-notifications-documents-ai.md#T-05.11.01` and `05-notifications-documents-ai.md#T-05.11.05`, plus contract signing evidence.

An earlier document-lineage guard correctly blocked a second live original for one contract version, but the signing integration test still created duplicate originals. The test now uses explicit successor documents and rechecks the financial review after replacement. It also exposed a real dead end: staff could quarantine the original on a pending signing request but could not replace it. The document service and production migration now allow a staff replacement of a quarantined contract original. The prior document becomes `Superseded` while retaining `scan_state=Quarantined`, so the scan result and audit trail remain intact. Other quarantined document roles remain blocked from this replacement path.

Validation: the full contract signature HTTP suite passes (13 tests), all four S3 API suites pass (41 tests), and the shared bucket setup suite passes (13 tests) against the new pinned image. The new migration is applied by the HTTP fixtures. Database snapshot and generated OpenAPI checks, API/DB TypeScript, changed-file lint and formatting pass locally.
