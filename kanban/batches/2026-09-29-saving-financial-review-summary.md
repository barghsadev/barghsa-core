# Saving order financial review summary

Canonical scope: the saving-order portion of `04-invoices-wallet-contracts.md#T-04.CC.07.03`. The cross-command task remains partial.

The final saving-order confirmation now uses the shared accessible `FinancialReviewSummary` for the authoritative server quote. It shows each plan/hardware line, line discount and VAT, subtotal, discount, VAT, and total before the customer submits for staff review. The existing quote refresh clears stale values; submission remains bound to its exact review digest.

Validation: web typecheck, changed-file lint and formatting, two focused page tests, the production Chromium saving journey through staff review and fulfillment, a fresh production build, all 57 route and interaction bundle budgets, and canonical backlog validation.
