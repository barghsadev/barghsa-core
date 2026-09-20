# Refund storage and reservation limits

Branch: `codex/refund-storage-batch`.
Status: PR #307 reviewed, validated and merged.

## Task scope

- `04-invoices-wallet-contracts.md#T-04.4.01.01`: additive refund table, exact integer amounts, ownership/actor references, idempotency, destination/reconciliation fields, timestamps, and indexes.
- `04-invoices-wallet-contracts.md#T-04.4.01.03`: serialized database refund budget. PostgreSQL cannot implement the proposed cross-table CHECK subquery, so triggers lock the invoice and enforce the equivalent limit across all outstanding requests.

Requested, Approved, Processing, and Failed refunds reserve funds. Rejected and Cancelled requests release their reservations. Completion atomically increments the invoice's refunded amount exactly once, including when the invoice already has legacy refunds. Identity and terminal history cannot be rewritten or deleted. Invoice amount edits cannot invalidate existing reservations. Each reservation also changes the invoice row version, so stale repeatable-read/serializable transactions must retry rather than reuse an old aggregate snapshot.

The database owns that completion counter increment. A statement-level transition-table trigger groups newly completed refunds by invoice, so bulk completion and repeated updates preserve the same exact totals. A future processor must write its wallet transfer and refund completion in one transaction and must not independently increment the counter. The existing invoice state machine can then validate the resulting amounts and change invoice state in that transaction.

## Boundaries

This is storage and integrity work. It exposes no refund endpoint or worker. Staff permissions, audit events, complete transition guards, payment allocation links, wallet transfers, dual approval, independent bank reconciliation, retry handling, and customer history remain in `T-04.4.01.02` and `.04` through `.07` and their dependent tasks. Basic database bank-reference checks do not satisfy the independent reconciliation workflow.

## Validation

The production migration is exercised against PostgreSQL. Tests cover exact amounts beyond JavaScript's safe integer range, ownership, invalid amounts, idempotency, concurrent reservations at default and repeatable-read isolation, legacy refunded balances, failed requests retaining reservations, released reservations, completion retries, rollback, immutable history, and external completion prerequisites. The final database suite passed 771 tests across 96 files, including 10 refund migration cases. The multi-row completion regression was reproduced before the fix and passes afterward; typecheck and formatting also pass after the fix. Full workspace build, typecheck, lint, formatting, contract, generated-schema drift, changed-file coverage, kanban, and audit checks passed. No task is claimed merged until GitHub confirms its reviewed PR merge.

## Merge confirmation

PR #307 is merged at `e326bdbecf94ff37a69932500f6a720546f8830f`. Exact reviewed HEAD `c0fdd848352bc25ff71ccf6f281d9521b9e3300e` and approval [5749567332](https://github.com/barghsadev/barghsa-core/pull/307#issuecomment-5749567332) were verified before and after merge. CI run 35508429899 passed all active checks, including 771 database, 458 worker and 5,180 API tests. Combined coverage reported the authorized temporary PR exemption; no new coverage claim is made.
