# Financial approval decision review

Canonical scope: the approval decision portion of `04-invoices-wallet-contracts.md#T-04.CC.07.03` for refunds and invoice adjustments.

The final approval dialog now presents the saved request's ID, initiator, reason, invoice, refund destination when applicable, and exact amount in the shared financial review layout. The queue also names the refund destination. The notice distinguishes an approval that leaves a later payment step from an invoice adjustment that issues on approval. This is a display of the persisted approval request; the server still enforces current authorization and state when the decision is submitted.

Validation: nine Chromium approval journeys, including English external-bank and Persian wallet refund reviews and signed invoice adjustment values; web typecheck, i18n tests, lint, formatting, production build and route budgets.
