# Bank-receipt wallet top-up financial review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`, applied to customer bank-receipt wallet top-ups (`T-04.2.02.03`). The cross-command review tasks remain partial.

After uploading a receipt, the customer sees a server-confirmed profile, exact IRR amount, transfer details, verified file name, and the rule that wallet credit waits for finance confirmation. Submission requires the reviewed hash at the HTTP boundary. The service checks it against locked receipt and storage state before sealing the attachment or creating a Pending ledger entry. The confirmed snapshot is retained in transaction metadata and audit; retries retain the original receipt and review.

The bilingual review dialog and its action code load only when needed. The same batch resolves the high-severity dependency advisories that blocked the previous main CI run, and keeps the shared mobile header inside the viewport at 390 px.

Validation: focused API, shared, and web tests; customer-receipt Chromium journey; API, worker, and web builds and typechecks; lint; generated OpenAPI contract; all route and interaction budgets; formatting; dependency audit at the CI high threshold; and backlog validation pass locally. Main CI will run after the push.
