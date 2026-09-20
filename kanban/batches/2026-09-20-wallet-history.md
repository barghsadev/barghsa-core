# Wallet history and cumulative invoice receipts

Base: `0b768cf1` (merged PR #305). Branch: `codex/invoice-history-batch`.
Status: implemented locally; independent review and CI merge gates pending. This is a manual batch under the user's September 20 instruction, not a supervisor assignment.

## Task scope

- `04-invoices-wallet-contracts.md#T-04.3.01.06`: existing separate excess credit and idempotency key verified; added cumulative receipt/retry regression coverage.
- `04-invoices-wallet-contracts.md#T-04.3.01.07`: verified Unpaid → PartiallyFunded → Paid across receipts; fixed retry responses to preserve the original remaining-amount snapshot from the confirmation audit.
- `04-invoices-wallet-contracts.md#T-04.3.02.02`: implemented cursor pagination, type/state/date filters, ascending/descending chronological sort, exact signed amounts, and active-profile isolation.
- `04-invoices-wallet-contracts.md#T-04.3.02.03`: wallet transaction component implemented; invoice and bank receipt components remain pending.
- `04-invoices-wallet-contracts.md#T-04.3.02.04`: wallet type/state labels and descriptions localized in Persian/English; remaining invoice/receipt/refund presentation is pending.

No task is claimed merged by this record. Refund storage/workflow is not implemented yet; invoice aggregation must not pretend refund records exist.

## Validation

Full workspace build passed. Focused API integration tests exercise timestamp ties at microsecond precision, both sort orders, filters, malformed and cross-profile cursors, access revocation, exact large amounts, and cumulative receipt retries. UI tests exercise signed amounts, pagination/filter reset, loading/empty/error/retry, Persian RTL, and stale-response isolation after profile switching. Exact final commands and results belong in the PR.

## Next batch

Invoice payment/receipt history aggregation and customer components (`T-04.3.02.01`, remaining `.03`/`.04`), followed by the refund schema/workflow dependencies (`T-04.4.01.*`). Keep unmet refund aggregation explicit until the refund data model exists.
