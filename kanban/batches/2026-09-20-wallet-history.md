# Wallet history and cumulative invoice receipts

Base: `0b768cf1` (merged PR #305). Branch: `codex/invoice-history-batch`.
Status: published in [PR #306](https://github.com/barghsadev/barghsa-core/pull/306). Initial source review passed; the added CRM search fix and regression tests require renewed exact-HEAD approval and CI before merge. This is a manual batch under the user's September 20 instruction, not a supervisor assignment.

## Task scope

- `04-invoices-wallet-contracts.md#T-04.3.01.06`: existing separate excess credit and idempotency key verified; added cumulative receipt/retry regression coverage.
- `04-invoices-wallet-contracts.md#T-04.3.01.07`: verified Unpaid → PartiallyFunded → Paid across receipts; fixed retry responses to preserve the original remaining-amount snapshot from the confirmation audit.
- `04-invoices-wallet-contracts.md#T-04.3.02.02`: implemented cursor pagination, type/state/date filters, ascending/descending chronological sort, exact signed amounts, and active-profile isolation.
- `04-invoices-wallet-contracts.md#T-04.3.02.03`: wallet transaction component implemented; invoice and bank receipt components remain pending.
- `04-invoices-wallet-contracts.md#T-04.3.02.04`: wallet type/state labels and descriptions localized in Persian/English; remaining invoice/receipt/refund presentation is pending.

No task is claimed merged by this record. Refund storage/workflow is not implemented yet; invoice aggregation must not pretend refund records exist.

## Validation

Full workspace build passed. Focused API integration tests exercise timestamp ties at microsecond precision, both sort orders, filters, malformed and cross-profile cursors, access revocation, exact large amounts, and cumulative receipt retries. UI tests exercise signed amounts, pagination/filter reset, loading/empty/error/retry, Persian RTL, and stale-response isolation after profile switching. Exact final commands and results belong in the PR.

Full regression testing also exposed a CRM search mismatch: full-text parsing discarded literal `%`, `_`, and backslash characters while the substring path escaped them. Such searches now use the literal path. Added tests cover both excluded false matches and matching profile names. Receipt retry/read edge cases and wallet payment/upload failure paths now have regression coverage for the critical-file coverage gate.

## Next batch

Refund storage and reservation limits (`T-04.4.01.01`, `.03`) are prepared separately. Publish that batch after this PR merges, then continue refund workflow and invoice payment/receipt history aggregation (`T-04.3.02.01`, remaining `.03`/`.04`). Keep unmet refund aggregation explicit until its data model and workflow exist.
