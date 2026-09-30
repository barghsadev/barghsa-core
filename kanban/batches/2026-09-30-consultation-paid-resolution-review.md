# Paid consultation resolution review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for staff cancellation, rejection, and recovery of an uncovered wallet refund on a paid consultation. The shared bilingual confirmation shows the customer, service, current and resulting status, any unpaid charge invoice to cancel, each paid invoice's refund allocation, the credit amount issued by closure, and the total wallet refund requested. Recovery shows the existing uncovered credit and allocates it without issuing another credit.

The preview locks the consultation, related invoices, and finance policy. Each command rebuilds the same plan under those locks and requires its exact hash before cancelling an invoice, issuing credits, or requesting refunds. Changes to invoice state, available balance, status, or reason invalidate stale confirmation. The committed review is returned to the UI, retained in the audit, and verified on exact-key retries.

The shared financial summary now uses full foreground contrast for labels and notices after the Persian Chromium accessibility scan exposed a borderline muted-text contrast failure.

Validation: paid consultation HTTP integration tests including stale-invoice and retry cases, staff page review test, shared parser test, API/web typechecks and builds, OpenAPI contract, lint, formatting, bundle budgets, Chromium consultation journey, and backlog validation. Other cross-command financial review tasks remain partial.
