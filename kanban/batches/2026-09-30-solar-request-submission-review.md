# Solar construction request submission review

Canonical work: `03-core-business.md#T-03.11.03.02` and `.03`, with pre-action review coverage toward `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`. The cross-command review tasks remain partial.

The customer now sees the authoritative solar request details, site address, accepted terms version, and explicit no-contract/no-invoice consequence before final submission. The API issues a scoped review hash. Submission rechecks the address and terms under the profile submission lock, requires the hash, persists the review with the request, and records its hash in the audit event. A retry with the same submission key and unchanged input returns the original request even if its address later changes; changed input is rejected. Existing requests created before this review require a new submission key for another attempt.

The bilingual review dialog is exercised in both solar browser journeys. The real-PostgreSQL integration test covers missing review hashes, unauthorized review, stale address, mismatched retry, and safe replay. This batch also updates the bank-receipt schema assertion missed by the previous main CI run.

Validation: focused API and database tests, web unit tests, two Chromium solar journeys, API and web builds, repository typecheck and lint, database snapshot, OpenAPI contract, bundle budgets, and backlog validation pass locally. Main CI will run after the push.
