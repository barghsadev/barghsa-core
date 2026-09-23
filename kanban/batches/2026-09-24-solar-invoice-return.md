# Solar invoice return — September 24, 2026

Canonical scope: connect the solar contract invoice in `03-core-business.md#T-03.13.01.02` to the customer invoice detail journey in `04-invoices-wallet-contracts.md#T-04.1.05.04`.

The authorized invoice detail response now resolves the solar request from the original invoice's contract and active profile. The invoice page shows a bilingual link back to that request, including when the customer opens a replacement or adjustment invoice. An unrelated invoice has no solar return link. The existing invoice authorization remains in place; no new payment or contract state is introduced.

Validation: the migrated solar HTTP suite checks the linked invoice response; bilingual invoice-page tests check the return link. API/web/i18n typechecks, API and web builds, targeted lint and format, OpenAPI contract comparison, and backlog validation pass locally.
