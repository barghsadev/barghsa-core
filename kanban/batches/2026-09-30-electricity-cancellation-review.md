# Electricity customer cancellation financial review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` (electricity customer cancellation portion). The cross-command tasks remain partial for other financial actions.

Customer cancellation now previews the locked order, buyer, delivery period, saved product prices and contract terms, invoice balance, and the exact invoice or wallet-refund outcome. Confirmation recomputes the snapshot under mutation locks and requires its hash. A changed invoice or contract rejects stale confirmation; paid cancellations still require session step-up. The audit records the confirmed hash and snapshot, while idempotent replay returns the original result.

The bilingual order dialog displays the authoritative amounts and outcome before cancellation. It also shows whether an unpaid order releases its gift code. The UI submits the preview hash and version and refreshes the order after success or a stale-state failure.

Focused validation: 38 electricity HTTP tests pass, including missing hash, changed invoice, exact paid refund, audit record and replay. The customer order page suite passes 11 tests, including preview-to-confirmation hash submission. API and web typechecks, builds, generated OpenAPI, root lint and formatting, route budgets, backlog validation, and GitHub CI are checked before or after push as applicable.
