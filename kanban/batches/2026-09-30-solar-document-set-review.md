# Solar document-set decision review

Canonical work: the staff document-stage decisions in `03-core-business.md#T-03.12.02.04` and `.05`, plus their portion of `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04`. File approval and rejection already use the shared document service's revision guard; those commands are unchanged.

Before requesting another file or advancing a solar request to postal submission, staff review the current request status, every linked document's file name, state and staff decision, existing file requests, the new request description when applicable, and the resulting status. The API reads the set under transaction locks and requires its exact hash at confirmation. A changed description, document revision/state, or request status rejects the command. The confirmed snapshot is retained in the audit event.

The bilingual staff dialog displays the server snapshot and sends its hash. These decisions create no contract or invoice. The subsequent postal and final-decision flows remain separate.

Validation: real-PostgreSQL document and postal integration suites (6 cases, including stale set and description), document UI unit test, Chromium solar journey, API and web builds, root typecheck, lint, formatting, OpenAPI contract, route bundle budgets, and backlog validation pass locally. Main CI runs after push.
