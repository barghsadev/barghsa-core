# Consultation fee offer batch

Canonical scope: `03-core-business.md#T-03.03.03.02`–`03` and the pre-payment guard in `03-core-business.md#T-03.03.03.07`. Customer acceptance, decline, payment-linked status, and staff completion remain in the next batch.

Staff with consultation and invoice permissions can issue a scoped fee offer with deliverables and a validity date. The action issues a linked consultation invoice in one database transaction, records status history and audit entries, and notifies the customer. A revised offer cancels and replaces its unpaid invoice atomically. Paid invoices cannot be replaced; they require an adjustment or refund workflow. Staff cancellation or rejection also cancels an unpaid consultation invoice. The staff UI has the offer form and the customer detail page links to the invoice. Retries use a request key to avoid issuing another invoice.

Validation: HTTP integration covered first issue, idempotent retry, unpaid replacement, status history, paid replacement refusal, and cancellation of an unpaid invoice. Existing invoice replacement tests, root build, typecheck, lint, format, backlog, and OpenAPI contract checks passed.
