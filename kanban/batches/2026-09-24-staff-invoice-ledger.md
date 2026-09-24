# Staff invoice ledger and detail

Canonical scope: staff portion of `07-ui-ux-design.md#T-07.18.03.02` and the finance side of the electricity order → invoice → payment journey.

Finance staff can browse 25 invoices at a time, filter by lifecycle state, or find an exact invoice ID. The page cursor preserves PostgreSQL microseconds and uses the invoice ID to break timestamp ties. The permission-checked detail shows profile and order references, exact IRR amounts, line items and VAT, and wallet payment, bank receipt, and refund history. A receipt opens directly in the existing finance review view, including its attachment; the invoice ID can also be sent to the existing due-date tool. The ledger includes drafts for authorized staff and does not expose itself to other roles.

The customer invoice page already covers the public half of this pattern. The staff view uses invoice IDs because the data model has no separate invoice number, and line descriptions remain the source of service-period detail until a structured invoice period is available. This batch does not change invoice settlement rules or financial state.

Validation: real PostgreSQL HTTP coverage for permission, filtering and detail SQL; service pagination and controller validation tests; staff UI and receipt handoff tests; build, typecheck, lint, OpenAPI contract, formatting and backlog checks. GitHub CI runs after the direct `main` push.

The optional full-mode route budget check still reports oversized login, registration, password recovery, electricity ordering and admin TOS routes. The admin invoice route passes at 405.48 KB gzip against its 500 KB limit. Full route budgets are currently disabled in direct-main CI by `FULL_CI`; the checker unit tests still run.
