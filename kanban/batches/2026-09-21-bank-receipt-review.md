# Bank-receipt financial review

Branch: `codex/bank-receipt-review`. Prepared from the approved PR332 HEAD, then rebased onto its verified merge `f665d50535040e3c45699cc14aafaa2367a71bad`.

This continues `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` for the existing staff wallet bank-receipt screen, including optional allocation to an invoice and excess wallet credit. The separate invoice-receipt workflow and other financial commands remain open. These cross-command tasks remain partial.

The backend extracts the existing issued-invoice reader, adds an exact receipt/approval/allocation snapshot, verifies confirmation before approval or settlement, includes its hash in the two-person approval binding, and persists the full review for safe replay. The customer wallet snapshot retains its original data and hash format. No migration is needed.

Current status: backend built, not ready to release. The staff UI must display and send the newly required hash before this batch can ship. Dual-approval snapshot regression coverage, HTTP coverage, UI and bilingual browser cases, OpenAPI update, final coverage, independent review and CI remain.

Validation so far: 34 existing wallet snapshot/API tests pass after extracting invoice facts; 18 shared parser tests pass; 62 related bank-receipt API/controller/service tests pass, including exact committed snapshot, stale allocation rejection, altered replay hashes and replay invoice identity. Types and foundation lint pass. This is focused evidence, not whole-package coverage.

Keep the scheduler and historical supervisor state unchanged. Legacy pending approvals without a financial snapshot need explicit handling before shipping; do not silently treat them as reviewed.
