# External bank refund workspace

Canonical scope: the staff-facing portion of `04-invoices-wallet-contracts.md#T-04.4.01.05` and the refund portion of `04-invoices-wallet-contracts.md#T-04.CC.07.03`.

Finance staff can inspect an invoice's available balance and prior bank refund requests, request a partial or full external refund, approve or dismiss it, record the bank transfer reference, and reconcile that transfer. The existing server keeps the invoice unsettled until a different finance staff member confirms the recorded reference; it also enforces the shared refundable balance and dual approval. The read endpoint is permission-scoped and paginated. The shared invoice workspace keeps wallet and bank refund forms separate while reusing their common flow and confirmation summary.

Validation: 32 wallet and external refund HTTP integration tests; four English and Persian Chromium refund journeys with an accessibility check; API and web typechecks; 53 i18n tests; changed-file lint and formatting; generated OpenAPI contract; production web build, route budgets and canonical backlog validation.
