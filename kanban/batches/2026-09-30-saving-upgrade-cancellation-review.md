# Saving upgrade cancellation financial review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` (unpaid saving hardware upgrade cancellation portion). Other cross-command review actions remain partial.

Staff cancelling an unpaid equipment upgrade now previews the original and replacement equipment, contract and agreement, additional-charge invoice and paid amount, and whether reserved stock will be released. The cancellation recomputes the same snapshot under invoice, request and order locks, requires its exact hash, and retains the confirmed review in the audit. A payment or overdue transition makes the request ineligible, so a stale confirmation cannot cancel a settled or expired upgrade.

The staff confirmation displays the financial outcome in Persian and English before step-up. Its dedicated staff dictionary stays out of the eager customer route. Focused API integration tests cover missing and changed hashes, overdue expiry, reservation release, audit persistence and idempotent replay; the staff page test checks preview-to-confirmation submission. API/web builds and typechecks, the Chromium saving journey, OpenAPI, route budgets, lint, formatting and backlog validation are batch checks.
