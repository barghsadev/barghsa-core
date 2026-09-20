# Invoice activity API

Branch: `codex/invoice-activity-batch`.
Status: local build and validation; depends on refund storage PR #307.

## Task scope

`04-invoices-wallet-contracts.md#T-04.3.02.01`: extend the existing customer invoice detail API with payments, bank receipts and refunds. Existing invoice lines and replacement/adjustment chains are reused.

The new arrays describe the viewed invoice only. Payments include wallet debits with their current state and confirmed bank receipts with their net invoice allocation after any excess wallet credit. Receipt history includes all receipt states, public references, customer notes and rejection reasons. Refund history includes amounts, state, destination and timestamps. Empty histories return empty arrays. Money remains decimal strings and records are ordered by time then ID. Every query is scoped to the authorized profile and invoice, inside the existing session/profile permission checks. Staff identity, storage keys, idempotency keys, internal metadata and bank reconciliation references are not exposed.

## Boundaries

This batch changes the read API only. Invoice and receipt history components and their localized state labels remain under `T-04.3.02.03` and `.04`. It does not create refunds or replace the pending refund lifecycle/processor tasks.

## Validation

The three focused invoice service/controller/HTTP suites pass 38 tests. New HTTP cases exercise exact int8 amounts, net receipt allocations, foreign-wallet reference isolation, cross-profile denial, empty histories, unconfirmed receipt states and private-field omission. API/dependency build passes. API typecheck, changed-file lint/formatting and backlog validation pass. Independent review is pending.
