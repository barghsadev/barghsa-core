# Electricity increase expiry and invoice reconciliation

Canonical scope: the end-of-term lifecycle and financial evidence in `03-core-business.md#T-03.08.01.07` and `.08`. This batch follows the customer quantity increase signature and payment path on `main`.

The worker expires pending, approved-unsigned and signed-but-ineffective requests after the delivery period. The database transition records immutable expiry time and audit evidence, and notifies the customer. If an adjustment invoice has no confirmed payment, the transition cancels it. If a payment or receipt needs attention, it preserves the invoice and marks the expired request for staff finance review. The customer sees the cancelled invoice or follow-up status; staff can filter expired requests and inspect the invoice state and confirmed amount. The payment guard blocks a new adjustment payment after expiry.

For current-period increases, the reviewed adjustment quote uses the next five-minute delivery boundary. Payment cannot activate the extra quantity before that priced boundary. The customer sees the pricing and activation start. This prevents the displayed amount from changing between review and signature within the quote window and prevents unpriced delivery.

Validation: seven migrated HTTP increase paths cover approval, signature, full payment, activation, pending and unsigned expiry, invoice cancellation and paid finance review. Related API unit, worker and customer/staff UI tests pass. Database snapshot, relevant builds/typechecks, lint, OpenAPI contract and backlog consistency were checked. Confirmed payments and receipts that reach expiry still need human finance resolution; this batch does not auto-refund them. Staff-initiated price adjustments remain separate work.
