# Paid saving hardware credits

Canonical scope: the lower-price, staff-only postpayment hardware part of `03-core-business.md#T-03.09.04.05`.

For an eligible paid order before delivery, staff with both contract and invoice write permission may replace the current device with a cheaper assigned device. The system keeps the original plan price and gift discount, recalculates VAT on the new hardware, and issues a linked non-payable credit note for the exact decrease. The current device, allocated stock, immutable hardware amendment, audit event, and customer notification change in one transaction. Customer and staff history show the credit and its invoice link. Later equal-price swaps use the revised total as their basis.

Contract cancellation includes these credit notes in its financial fingerprint. A decision prepared before a credit becomes stale, and execution cancels outstanding hardware credit notes before returning the original paid amount. This prevents the credit note from remaining alongside a full cancellation refund.

The credit note records the amount owed; customer payout follows the existing finance workflow. Higher-price swaps, which require replacement-stock reservation and payment before activation, remain open.

Validation: saving-order and contract-cancellation integration tests exercise credit creation, permission, idempotency, stock transfer, immutable financial snapshots, revised price basis, stale cancellation decisions, and credit-note cancellation. Migration, schema, build, typecheck, lint, format, OpenAPI, and backlog checks run before push.
