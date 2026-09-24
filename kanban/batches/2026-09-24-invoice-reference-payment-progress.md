# Customer invoice reference and payment progress

Canonical scope: invoice list/detail composition in `07-ui-ux-design.md#T-07.18.03.02` and customer invoice access in `04-invoices-wallet-contracts.md#T-04.1.05.04`.

The customer invoice list now exposes each full invoice reference and its confirmed paid amount alongside total, state, due date and service period. Each invoice card in the correction chain shows its own full reference, making original, replacement and adjustment invoices distinguishable when a customer discusses a payment with support. References are isolated left-to-right in Persian layouts. The list API serializes the existing `paid_amount` as an exact IRR string; no payment arithmetic or database migration is introduced.

Validation: focused API service/PostgreSQL HTTP and bilingual frontend tests cover the returned paid amount and visible reference. Production build, raw typecheck, lint, formatting, OpenAPI contract and kanban checks run before the direct `main` push. GitHub CI runs on the pushed commit.
