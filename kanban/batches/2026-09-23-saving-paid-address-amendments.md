# Paid saving order address amendments

Canonical scope: the staff-only, postpayment installation-address part of `03-core-business.md#T-03.09.04.05`. Paid hardware swaps and customer change requests after staff approval remain open.

Authorized staff can correct the installation address of a paid saving order before installation begins. The staff detail offers current profile addresses, requires a reason and confirmation, and sends the customer a notification. The customer and staff details show the before/after address, postal code, time, and reason. The endpoint requires step-up authentication, a matching contract version, and an idempotency key. It rejects archived profiles, payment/refund transitions, pending cancellation, and work that has reached installation.

The operation records an immutable amendment linked to the published contract version, updates only the current order and installation-address snapshots, and writes a contract audit event. The paid invoice amount and calculation snapshot, published contract content, and equipment reservation remain unchanged.

Validation: saving-order HTTP integration tests cover staff authorization, stale version, idempotent retry, customer/staff visibility, immutable history, preserved invoice and contract snapshots, and the installation-stage guard. Migration runner and baseline tests, production build, typecheck, lint, formatting, OpenAPI contract, schema snapshot, and backlog validation pass.
