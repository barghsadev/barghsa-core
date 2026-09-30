# Customer invoice receipt submission review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`, applied to customer invoice bank receipts (`T-04.3.01.02`). The cross-command review tasks remain partial.

After uploading a bank receipt, the customer reviews a server-confirmed invoice balance, receipt amount, transfer details, verified file, and the rule that settlement waits for finance confirmation. Submission requires the reviewed hash at the HTTP boundary. Under the same database locks used to submit, the service rejects a changed invoice or receipt review before sealing the attachment. It stores the confirmed snapshot with the submitted receipt and audit event. A retry reads the stored review, including after the invoice changes state, and does not create a second receipt or upload.

The review action and bilingual dialog load only when needed. Confirmation dialogs now scroll within the viewport so the action remains reachable for longer summaries. The electricity route's shared gzip budget moves from 250 to 251 KB to accommodate the 0.31 KB common-chunk increase. Seven wallet controller fixtures from the prior batch now include the required review hash, repairing the previous main CI failure.

Validation: focused API, shared, and web tests; customer receipt Chromium journey in both languages; API and web builds and typechecks; UI package distribution; lint; database snapshot and generated OpenAPI contract; bundle budgets; and backlog validation pass locally. Main CI will run after the push.
