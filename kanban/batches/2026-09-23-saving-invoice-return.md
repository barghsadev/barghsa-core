# Saving invoice return and contract navigation — September 23, 2026

Canonical scope: saving order customer detail in `03-core-business.md#T-03.09.04.04` and invoice-to-origin navigation around `04-invoices-wallet-contracts.md#T-04.1.05.04`.

Customer invoice details now identify the saving order behind the original invoice in a correction chain, scoped to the active profile. The invoice links back to that saving order. Saving order details also keep a direct contract link visible after publication, so customers can revisit a contract after its initial acceptance prompt. Draft contracts remain unavailable through that link.

Validation: a real saving order HTTP submission test confirms the invoice origin, 15 invoice page tests include bilingual return links, and the Chromium saving journey follows catalogue → wizard → order → invoice → order → published contract while preserving English. API/web typechecks, web production build, i18n tests, targeted lint and formatting, contract and backlog checks passed locally. CI is pending after the direct `main` push.
