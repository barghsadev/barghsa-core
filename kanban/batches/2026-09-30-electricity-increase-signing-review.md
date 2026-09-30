# Electricity quantity-increase signing review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for the customer signing step of a paid electricity contract quantity increase. The customer now sees the paid original invoice, added quantity, delivery and effective dates, original price share, every finalized price-change share, the adjustment invoice amount, and the payment-gated activation rule in the shared bilingual financial review layout.

The customer GET returns a scoped, hashed snapshot alongside the existing quote. Signing requires that exact hash in addition to the approved amendment digest and amount. The command recalculates the review under the profile and contract transaction locks, rejects stale values, and stores the confirmed review with the immutable pricing snapshot; the audit event records its hash. The page refuses malformed or amendment-mismatched reviews and resets consent after reloading current data. A five-minute pricing boundary can require a fresh review before signing.

Validation: all 37 electricity-order API integration tests, six customer panel tests, two shared parser tests, shared package exports, API/web typechecks and builds, OpenAPI contract, lint, formatting, bundle budgets, and backlog validation. The cross-command financial review tasks remain partial.
