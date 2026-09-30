# Customer dashboard upcoming invoices

Canonical work: `07-ui-ux-design.md#T-07.19.02.06`, using the existing customer dashboard and invoice payment flow.

The dashboard now returns the active profile's first three unpaid invoices by due date, with remaining balances and payment-open times. A single bounded invoice query also calculates the total unpaid balance for the wallet warning. The customer sees localized due dates, days remaining, urgency, and a direct invoice link. Invoices that are not payable yet say “View invoice” instead of offering immediate payment. Agents without invoice-read permission receive no invoice summary. Changing profiles clears the previous dashboard data before the next profile loads.

Validation: PostgreSQL-backed dashboard HTTP integration (ordering, limit, partial balance, foreign-profile isolation), dashboard service tests, customer Chromium flow (due date, payment timing, profile switching), dictionary tests, root build/typecheck/lint/format, OpenAPI contract and bundle budgets. Latest-orders and active-contract widgets remain separate tasks.
