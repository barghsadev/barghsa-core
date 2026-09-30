# Saving fulfillment stage review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` (staff fulfillment-stage completion and optional equipment-handover skip portion). Other cross-command review actions remain partial.

Staff now previews the exact fulfillment stage transition before confirming it. The preview includes the current and next stages, payment and contract state, order context, agreement, explanation, and any equipment handover description. Completing or skipping a stage recomputes the snapshot under order and stage locks, requires its hash, and records the confirmed snapshot in the audit. A changed stage, payment, contract, or pending hardware charge invalidates the confirmation.

The staff confirmation displays the outcome in Persian and English. Focused API integration coverage checks valid transitions, skip rules, prerequisites, missing or mismatched hashes, and the customer-visible stage history. The staff page test checks that the previewed hash reaches the mutation.

Validation: 7 API integration tests, 4 staff-page tests, the Chromium customer saving journey, API/web builds and typechecks, shared export checks, lint, OpenAPI consistency, all 57 route budgets, formatting, and backlog validation pass locally. Remote main CI is pending.
