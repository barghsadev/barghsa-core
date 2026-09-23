# Paid saving hardware upgrades

Canonical scope: the higher-price, staff-only postpayment hardware part of `03-core-business.md#T-03.09.04.05`.

Before delivery, staff can request a more expensive device assigned to the saving plan. The exact positive difference becomes a linked charge invoice. Tracked replacement stock is reserved, while the current device and the original paid invoice and published contract remain unchanged. The customer sees the pending charge in the order detail and next action on both the order detail and list.

The invoice payment transaction applies the replacement only after full payment. The database transfers allocated stock, records an immutable amendment, closes the upgrade request, and sends an audit event and customer notification. Delivery and another hardware change are blocked while the charge is pending. Staff can cancel an unpaid request, and an overdue invoice closes it; both release its reservation. A closed request cannot be paid later. Contract cancellation also cancels any pending charge and releases its reservation.

Validation: saving-order HTTP integration covers reservation, idempotency, delivery blocking, cancellation and payment, stock transfer, immutable original invoice, and customer visibility. Contract cancellation HTTP tests, DB migration baseline and schema snapshot, web next-action and order tests, API/web typechecks, web build, lint, OpenAPI, and backlog checks run before push.
