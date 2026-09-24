# Capability maintenance controls

Canonical scope: `06-security-testing-observability.md#T-06.17.02.01` through `T-06.17.02.05`.

Staff can pause new electricity checkout, saving orders, solar requests, and wallet top-ups independently from the admin maintenance page. The AI-chat flag is ready for a future customer chat endpoint; no customer chat endpoint currently consumes it. An active flag requires a bilingual reason, future estimated return, and owner. Changes require config-write permission and recent step-up verification, use an expected version, and write the previous and next values to the audit log.

Paused writes return HTTP 503 with `MAINTENANCE:ACTIVE`, the capability, a localized reason, estimated return, and `/tickets` support path. Customer forms show the notice and hide their submit flow. Existing orders, invoices, refunds, wallet history, support, and unrelated new actions remain available. The staff dashboard shows active flags.

Health checks should continue to use `/api/health/live` and `/api/health/ready`; a paused capability does not make the whole application unhealthy. Any synthetic check that exercises a new action should first read `/api/maintenance` and classify `MAINTENANCE:ACTIVE` as an intentional pause for that capability. No deployed synthetic new-action runner exists in this repository.

Validation: real HTTP integration tests cover the blocked and unaffected actions, health, staff authority, step-up, version conflict, and audit record. Browser tests cover the bilingual customer notice, unaffected intake, and staff change form. API/web/i18n/shared builds and typechecks, OpenAPI contract, lint, formatting, and backlog checks run for the batch.
