# Contract original document lineage

Canonical scope: original-document replacement under `04-invoices-wallet-contracts.md#T-04.5.04.03` and automatic electricity contract PDFs.

An authorized staff upload can create only one live original root for a contract version. Concurrent attempts serialize on the contract; a successful request remains idempotently replayable. Staff can remove an unfinished upload and start again. Once an original has been reviewed and rejected, its next copy must use the existing Replace action so the supersession history remains linked. The order-linked electricity contract screen no longer offers a second original upload when the order submission snapshot records the generated PDF; manually created order-linked contracts retain the upload action. Staff see bilingual replacement guidance.

Validation: 22 document HTTP integration tests, 2 automatic electricity contract PDF integration tests, 43 contract-workspace web tests, root build and typecheck, edited-file lint and formatting, OpenAPI contract check, and backlog validation passed. The uniqueness rule is enforced in the document API transaction; no database constraint was added in this batch.
