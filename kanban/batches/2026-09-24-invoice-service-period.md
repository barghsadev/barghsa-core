# Electricity service period on invoices

Canonical scope: invoice list/detail period in `07-ui-ux-design.md#T-07.18.03.02`, completing the customer electricity order → payment → contract visibility and matching finance detail.

Customer invoice list and correction-chain detail, plus the staff invoice ledger and detail, now show the electricity service period saved with each invoice. The API reads the immutable `invoice_calculation_snapshot` rather than the order's current dates. Original and replacement invoices therefore retain their own periods after a revision. Non-electricity and malformed snapshots omit the period. The exclusive period end is displayed as the final included calendar day in the viewer's account timezone, with Persian and English labels.

The previous direct-`main` CI run exposed TypeScript errors in the staff ledger controller and HTTP tests. This batch narrows the ledger service's session input to the three fields it uses, types the JSON test responses, and corrects the synthetic request fixture so the same API typecheck succeeds.

Validation: focused API and web tests cover snapshot parsing, original/replacement separation, real PostgreSQL customer and staff reads, list/detail rendering, and the exclusive-end date boundary. Production build, typecheck, lint, formatting, OpenAPI contract and kanban checks run before the direct `main` push. GitHub CI runs on the pushed commit.
