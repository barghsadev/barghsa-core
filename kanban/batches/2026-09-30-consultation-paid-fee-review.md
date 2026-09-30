# Consultation paid-fee adjustment review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for staff changes to an accepted, paid consultation fee. Staff now review the current service, customer, agreed fee, paid invoice, revised fee, reason, deadline, and exact charge or credit amount before confirming. A decrease also shows the wallet refund amount allocated to each paid invoice. The shared bilingual financial review layout explains that an increase creates another invoice for customer acceptance and payment, while a decrease issues a credit and starts finance-reviewed wallet refunds.

The preview locks the consultation, related invoices, and financial policy. The mutation rebuilds the same snapshot under those locks and requires its exact hash before issuing an adjustment or refund requests. Changed invoice state, fee, terms, or available refund balance rejects stale confirmation. The confirmed snapshot is returned to the UI and retained with the idempotent audit result.

Validation: paid consultation HTTP integration tests, staff page test, shared parser test, API/web typechecks and builds, OpenAPI contract, lint, formatting, bundle budgets, and backlog validation. The wider cross-command financial review tasks remain partial.
