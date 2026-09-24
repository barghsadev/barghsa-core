# Privacy-safe product analytics

Canonical scope: `01-platform-infrastructure.md#T-06.04.01`.

The customer and admin shells now ask for account-level analytics consent before sending optional product events. Customers can change the choice later in Settings. The shared event contract permits only fixed event names and enum dimensions; it discards paths, identifiers, free text, credentials and any extra fields before either provider sees an event. The authenticated self-hosted API checks the current account's consent under a database lock and stores anonymous event dimensions without a user identifier. Consent changes are audited transactionally. Operational business/audit events continue on their existing server-side paths regardless of optional analytics consent.

A Google Analytics adapter is available for hosts that install `gtag`; this batch does not load a third-party script or enable Google by default. The adapter receives events only after opt-in through the same gate. A separate configured script loader remains necessary if Google Analytics is to run in production.

Validation: focused shared, web and PostgreSQL tests cover redaction, both adapters, explicit opt-in/revocation, unauthorized requests, anonymous storage and audit rollback. The full database suite passes (109 files, 941 tests), including two corrected historical migration assertions that previously failed on the additive theme column. Six Chromium cases cover bilingual consent and existing branding flows. Workspace build/typecheck, root lint, OpenAPI contract, database snapshot and backlog validation pass.

The optional full bundle-size gate remains over its limits for login, registration, password recovery, electricity ordering and one admin route. An isolated build of the prior `main` commit failed the same routes; this batch adds about 0.5–1.5 KB to those measured payloads. The gate is currently disabled in fast CI, as configured in the workflow.
