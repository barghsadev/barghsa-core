# Solar postal-decision review

Canonical work: `03-core-business.md#T-03.12.03.03`–`.06` and the postal-decision portion of `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04`. Other cross-command review work remains partial.

Staff now review the current solar request and shipment before confirming receipt, marking originals incomplete, or reporting a shipment missing. The preview includes courier, tracking number, send date, optional receipt ID, reason, and resulting postal and request statuses. The API recomputes the snapshot under the request and postal locks and rejects a changed shipment, status, decision, or reason. The audit retains the exact confirmed snapshot.

The bilingual staff dialog displays the server snapshot and sends its hash with the decision. A stale shipment requires another review. These decisions create no contract, invoice, charge, or refund.

Validation: real-PostgreSQL solar postal integration tests (including stale shipment and reason and audit binding), staff queue unit tests, Chromium solar journey, API and web builds, root typecheck, lint, formatting, OpenAPI contract, route bundle budgets, and backlog validation pass locally. Main CI runs after push.
