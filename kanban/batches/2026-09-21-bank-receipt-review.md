# Bank-receipt financial review

Branch: `codex/bank-receipt-review`. Prepared from the approved PR332 HEAD, then rebased onto its verified merge `f665d50535040e3c45699cc14aafaa2367a71bad`.

This continues `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` for the existing staff wallet bank-receipt screen, including optional allocation to an invoice and excess wallet credit. The separate invoice-receipt workflow and other financial commands remain open. These cross-command tasks remain partial.

The backend extracts the existing issued-invoice reader, adds an exact receipt/approval/allocation snapshot, verifies confirmation before approval or settlement, includes its hash in the two-person approval binding, and persists the full review for safe replay. The customer wallet snapshot retains its original data and hash format. No migration is needed.

Current status: implementation and focused validation complete; independent review and CI remain. The bilingual staff screen displays the authoritative receipt, invoice breakdown, contracts, wallet balances and approval conditions. Confirmation captures that hash through step-up and rejects stale or malformed reviews. A 409 disables confirmation until a fresh review. Both summaries share the page-owned account timezone state.

Validation: 231 related API tests pass, including 103 HTTP authority/concurrency cases, exact two-person review binding, threshold changes, stale allocation, legacy approvals and replay; 42 related UI tests, 995 shared tests, and 53 dictionary tests pass. All 70 production browser cases pass across Chromium, Firefox, WebKit and both mobile projects, covering bilingual review, accessibility, stale refresh, malformed data, emergency step-up and the existing wallet payment flow. API/web types, scoped lint, OpenAPI generation, all 44 bundle budgets and canonical backlog validation pass. The focused API coverage run passes all assertions but exits nonzero against whole-package coverage floors; this is not a full-package coverage pass. Final changed-source coverage and CI remain.

The HTTP tests caught a changed lock order while review waits for wallet balances. Saved approver authority is now locked before reading those balances, preserving the existing concurrency guarantee; all regression cases pass.

Legacy pending receipt approvals that lack a financial snapshot cannot be retroactively authorized. Finance must reject an unresolved pending request with a customer-visible reason, reconcile the bank evidence, and have a replacement receipt submitted for a fresh review. An already-approved legacy request requires explicit administrative reconciliation; this batch does not fabricate earlier consent or automatically settle it. Changed approval thresholds or reviewed financial facts similarly require reconciliation rather than silently accepting different terms.

Keep the scheduler and historical supervisor state unchanged. Other financial commands, including the separate invoice-bank-receipt workflow and generic approval review UI, remain outside this batch; canonical CC.07 tasks remain partial.
