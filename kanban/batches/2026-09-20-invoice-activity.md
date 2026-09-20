# Invoice activity API and customer history

Branch: `codex/invoice-activity-batch`.
Status: implementation and local validation complete; rebased onto merged PR #307 for independent review and CI.

## Task scope

`04-invoices-wallet-contracts.md#T-04.3.02.01`: extend the existing customer invoice detail API with payments, bank receipts and refunds. Existing invoice lines and replacement/adjustment chains are reused.

`04-invoices-wallet-contracts.md#T-04.3.02.03` and `.04`: complete the remaining invoice/receipt history displays and English/Persian state labels and descriptions. The wallet-history portion was merged in PR #306.

The new arrays describe the viewed invoice only. Payments include wallet debits with their current state and confirmed bank receipts with their net invoice allocation after any excess wallet credit. Receipt history includes all receipt states, public references, customer notes and rejection reasons. Refund history includes amounts, state, destination and timestamps. Empty histories return empty arrays. Money remains decimal strings and records are ordered by time then ID. Every query is scoped to the authorized profile and invoice, inside the existing session/profile permission checks. Staff identity, storage keys, idempotency keys, internal metadata and bank reconciliation references are not exposed.

## Boundaries

The existing invoice page now shows payment, bank receipt and refund history with empty states, exact amounts, localized labels/descriptions, safe customer text and responsive RTL layouts. Initial load failures have a retry action. Successful receipt submission refreshes history; a refresh failure preserves the saved-receipt confirmation and offers a separate retry.

This batch does not create refunds or replace the pending refund lifecycle/processor tasks. Frontend history arrays remain optional during rolling API deployment.

## Validation

The three focused invoice service/controller/HTTP suites pass 38 tests. New HTTP cases exercise exact int8 amounts, net receipt allocations, foreign-wallet reference isolation, cross-profile denial, empty histories, unconfirmed receipt states and private-field omission. API/dependency build passes. API typecheck, changed-file lint/formatting and backlog validation pass. The complete frontend suite passes 823 tests; the final page suite passes 13 tests after adding saved-receipt refresh-failure coverage, and six optimized production-browser checks pass for English/Persian receipt flows, history refresh, mobile layout and accessibility. Independent review is pending.
