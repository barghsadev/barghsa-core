# Consultation offer decision review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for customer acceptance and decline of a consultation fee offer. The customer now confirms the authoritative service title, scope, deliverables, offer deadline, invoice, already paid amount, and decision outcome in the shared bilingual financial review layout. A paid-fee increase distinguishes the previously agreed fee from the additional charge invoice and reconciles both to the revised total.

The preview checks profile access and locks the offer and invoice. The accept and decline endpoints require its exact scoped hash, rebuild the review under the same locks, and reject stale offer terms or payment state before changing either record. The confirmed review is returned to the client and retained in the decision audit. Decline still refuses any consultation with payment history; acceptance still hands off to the invoice when payment is due.

Validation: consultation workflow/payment HTTP integration tests, shared review parser, customer browser journeys, shared exports, API/web typechecks and builds, OpenAPI contract, lint, formatting, bundle budgets, and backlog validation. Other irreversible commands in the cross-command review tasks remain open.
