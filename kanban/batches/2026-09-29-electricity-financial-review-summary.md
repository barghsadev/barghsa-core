# Electricity order financial review summary

Canonical scope: the electricity-order portion of `04-invoices-wallet-contracts.md#T-04.CC.07.03` for simple and advanced ordering. The wider cross-command task remains partial.

Both final order-confirmation screens now present the server's quoted line quantities, unit prices, line totals, discount, VAT, and grand total through the shared accessible `FinancialReviewSummary`. Earlier preview steps retain their existing layout. Submission still sends the exact quote digest; a changed quote triggers a refresh before the customer can confirm again. The page tests assert that the final summary appears, and the controlled browser journey continues through submission, payment, and contract tracking.

Validation: web typecheck, changed-file lint and formatting, 17 focused page tests, all 57 route and interaction bundle budgets after a fresh production build (electricity ordering: 248.38/250 KB gzip), and four production Chromium electricity cases across simple and advanced orders in English/Persian. The prior main CI run for the route-budget batch passed all five jobs.
