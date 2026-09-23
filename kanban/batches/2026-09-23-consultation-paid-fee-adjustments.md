# Paid consultation fee adjustment batch

Canonical scope: `03-core-business.md#T-03.03.03.07`, with the paid portion of `03-core-business.md#T-03.03.01.02`. Paid cancellation remains a separate batch.

Staff with financial permission and a fresh step-up can revise an accepted paid consultation fee. An increase issues a linked charge for only the difference and asks the customer to accept and pay it. A decrease issues a linked credit and reserves wallet refunds across the paid consultation invoices. Adjustment, refund requests, consultation state, history, audit, and notification share a database transaction. The original paid invoice is never replaced or edited. The customer detail shows charges, credits, and refund request states. A repeated request key returns the same result; changing its fee, reason, or validity is rejected.

The ordinary fee replacement path refuses a consultation with any paid invoice. Customer decline and staff cancel/reject likewise refuse to close a paid consultation without a refund review. The remaining paid-cancellation action and recovery after a rejected refund belong to the next financial batch.

Validation: HTTP integration covers payment, incremental charge, reacceptance and payment, split credit/refund across two paid invoices, idempotency, the blocked replacement/decline path, and completion after the revised fee is funded. API/web typechecks, root build and lint, backlog validation, and OpenAPI contract check passed.
