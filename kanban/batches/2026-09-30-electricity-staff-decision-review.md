# Electricity staff decision financial review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` (electricity staff decision portion). The cross-command tasks remain partial for other financial actions.

Staff preview for electricity approval, change requests, and rejection now captures the locked order, current contract version and terms, price snapshot, invoice amounts, and the exact resulting contract, invoice, or refund obligation. Approval and rejection recompute that snapshot under the mutation locks and require its hash. The audit records the confirmed hash and full snapshot. A repeated idempotent request retains the original confirmed result.

The bilingual staff dialog uses the server snapshot for period, quantity, product prices, discount, VAT, invoice state, total, refund amount, and contract terms. It does not offer a decision when the preview is stale or unavailable. An order switch invalidates an in-flight preview.

Focused validation: the electricity HTTP and service suites pass 39 tests, including missing hash, stale invoice state, exact paid-refund amount, audit persistence and replay. The staff web suite passes three tests, including preview-to-confirmation hash submission. The Chromium electricity journey passes with the displayed total and confirmed hash. API and web builds and typechecks, shared exports, root lint and formatting, generated OpenAPI, all 57 route budgets, and the 1,355-task backlog validator pass locally. GitHub CI on the pushed `main` commit is the remote gate.
