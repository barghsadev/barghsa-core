# Electricity payment review and refund actions

Canonical scope: `03-core-business.md#T-03.07.01.04` and `03-core-business.md#T-03.07.04.03`.

An approved electricity order with a bank payment under review now tells the customer to wait for payment confirmation instead of asking them to pay again. The next-action callout links to the invoice where the review can be tracked. Refund-pending orders also link that callout to the invoice. Both messages are localized in Persian and English.

Validation: electricity status unit tests and customer order-detail UI tests cover payment review and refund navigation; build, typecheck, lint, formatting, OpenAPI contract, and backlog checks passed.
