# Electricity order financial closure

Canonical scope: `03-core-business.md#T-03.07.04.02` and `03-core-business.md#T-03.07.04.03`.

The customer order detail now shows an amount remaining to pay only for orders that can still proceed. Rejected and cancelled orders instead show the confirmed payment still awaiting refund, or state that no refund is required when nothing was paid. The existing refund status and timeline remain visible. Pending settlement text covers both wallet and external refunds.

Validation: focused order-detail tests cover a partial refund, completed refund and cancellation before payment. Web production build, full typecheck, lint, formatting and diff checks pass. GitHub CI runs on the pushed commit.
