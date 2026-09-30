# Consultation staff fee-offer review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for staff issue and replacement of an unpaid consultation fee offer. Before opening the step-up confirmation, staff see an authoritative snapshot of the customer profile, service, scope, deliverables, fee, deadline, and the old invoice and reason when replacing an offer. The shared bilingual financial review layout shows whether the action will issue a new unpaid invoice or cancel and replace an existing one.

The preview checks the current consultation and invoice under locks. Issuance requires its exact scoped hash and rebuilds the review in the write transaction; changed terms, invoice state, or payment history reject the action. The confirmed review is stored in the audit and returned to the UI. Exact-key retries read the stored review instead of issuing a second invoice.

Validation: focused consultation API integration tests, staff page test, shared parser test, Chromium customer/staff journey, API/web typechecks and builds, OpenAPI contract, lint, formatting, bundle budgets, and backlog validation. Paid-fee charge and credit adjustments remain a separate staff review batch; the wider cross-command review tasks remain partial.
