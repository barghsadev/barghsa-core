# Actionable next steps in customer electricity orders

Canonical scope: `03-core-business.md#T-03.07.04.01` and `03-core-business.md#T-03.07.04.03`.

The customer order list now exposes the linked invoice and contract IDs from the existing profile-scoped order query. A next-step callout can open the payable invoice, its payment-review or refund status, the published contract, or the order detail where requested corrections and delivery progress appear. Informational states remain plain text; malformed references do not create broken links. The existing order detail remains the place for actions that need a full review.

Validation: the real PostgreSQL electricity-order HTTP test checks linked references in the customer list; UI tests check payment, contract and correction routes while preserving list pagination. Production build, raw typecheck, lint, formatting, OpenAPI contract and backlog checks run before the direct `main` push. GitHub CI runs on the pushed commit.
