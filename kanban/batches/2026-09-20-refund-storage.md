# Refund storage and reservation limits

Branch: `codex/refund-storage-batch`.
Status: prepared locally while PR #306 runs CI; not published, reviewed, or merged.

## Task scope

- `04-invoices-wallet-contracts.md#T-04.4.01.01`: additive refund table, exact integer amounts, ownership/actor references, idempotency, destination/reconciliation fields, timestamps, and indexes.
- `04-invoices-wallet-contracts.md#T-04.4.01.03`: serialized database refund budget. PostgreSQL cannot implement the proposed cross-table CHECK subquery, so triggers lock the invoice and enforce the equivalent limit across all outstanding requests.

Requested, Approved, Processing, and Failed refunds reserve funds. Rejected and Cancelled requests release their reservations. Completion atomically increments the invoice's refunded amount exactly once, including when the invoice already has legacy refunds. Identity and terminal history cannot be rewritten or deleted. Invoice amount edits cannot invalidate existing reservations.

The database owns that completion counter increment. A future processor must write its wallet transfer and refund completion in one transaction and must not independently increment the counter. The existing invoice state machine can then validate the resulting amounts and change invoice state in that transaction.

## Boundaries

This is storage and integrity work. It exposes no refund endpoint or worker. Staff permissions, audit events, complete transition guards, payment allocation links, wallet transfers, dual approval, independent bank reconciliation, retry handling, and customer history remain in `T-04.4.01.02` and `.04` through `.07` and their dependent tasks. Basic database bank-reference checks do not satisfy the independent reconciliation workflow.

## Validation

The production migration is exercised against PostgreSQL. Tests cover exact amounts beyond JavaScript's safe integer range, ownership, invalid amounts, idempotency, concurrent reservations, legacy refunded balances, failed requests retaining reservations, released reservations, completion retries, rollback, immutable history, and external completion prerequisites. The database suite passed 769 tests across 96 files. No task is claimed merged until GitHub confirms its reviewed PR merge.
