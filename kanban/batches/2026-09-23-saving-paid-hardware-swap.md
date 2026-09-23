# Paid saving order hardware swaps: equal-price batch

Canonical scope: the staff-only postpayment hardware part of `03-core-business.md#T-03.09.04.05`.

Staff can swap a paid saving order's device before delivery, while its contract is awaiting customer acceptance or active. The replacement must still be assigned to the saving plan, active, and have the same effective price and VAT rate as the paid hardware line. The endpoint requires `contracts:write`, step-up authentication, a reason, an idempotency key, the expected contract version, and the expected current hardware. It rejects pending cancellation or refund, incomplete payment, archived profiles, and delivery or installation that has progressed.

The transaction writes an immutable amendment linked to the paid invoice and published contract version, changes the current device, returns the previous allocated stock, allocates the replacement, audits the swap, and notifies the customer. Customer and staff details show the current device and amendment history. The paid invoice, pricing snapshot, and published contract content remain unchanged.

Price-changing swaps remain open. They require an adjustment-invoice or credit flow before the replacement becomes effective; this batch deliberately exposes only zero-delta replacements.

Validation: saving-order HTTP integration tests cover permission, stale version, idempotency, a price mismatch, out-of-stock rejection, stock movement, customer visibility, immutable history, and the delivery-stage guard. Migration and schema checks, build, typecheck, lint, formatting, OpenAPI contract, and backlog validation pass.
