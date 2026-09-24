# Electricity order revisions after staff requests changes

Canonical scope: `03-core-business.md#T-03.07.01.01`, `03-core-business.md#T-03.07.04.02`, and `03-core-business.md#T-03.07.04.03`.

Customers can now revise a simple or advanced electricity order after staff request changes. The order detail offers a current-price preview for a new period, quantity, product mix, gift code, and delivery address. Submission requires the reviewed quote digest and current contract version. The existing address-only correction remains available when commercial terms do not change.

Each revision atomically appends immutable order lines, creates a new contract version, cancels the unpaid invoice, issues a linked replacement invoice, and returns the order to staff review. Previous contract, invoice, gift redemption, and line records remain available for audit. A changed quote, stale version, payment activity, or invalid geography blocks submission.

Validation: PostgreSQL integration tests cover simple and advanced revisions, repeated corrections and invoice replacement chains, limited gift-code reuse, staff approval, and idempotent retries. Customer UI tests cover price preview, resubmission, and delivery-city changes. Typecheck, lint, formatting, build, OpenAPI contract, schema snapshot, and kanban checks pass. The existing route-budget check still fails for Login, Register, Password recovery, and Electricity ordering.
