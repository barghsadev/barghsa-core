# Solar final-decision review

Canonical work: `03-core-business.md#T-03.13.01.01`–`.03` and the final-decision portion of `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04`. Other cross-command review work remains partial.

Staff now review the current solar request, confirmed postal state, reason, support route, and exact resulting status before approval, rejection, or closure without a contract. The same permission-scoped API builds the snapshot for preview and recomputes it under the request lock before the command. A changed status, postal record, or reason invalidates the hash. The final decision audit retains the confirmed snapshot. These decisions create no contract or invoice; the separate contract-creation action remains the financial step.

The bilingual staff dialog displays the server values and submits the reviewed hash. The browser fixture now supplies the required staff operating context and verifies the displayed rejection outcome and confirmed request body.

Validation: real-PostgreSQL solar postal/final-decision integration tests, staff queue unit tests, Chromium rejection journey, API and web builds, root typecheck, lint, formatting, OpenAPI contract, route bundle budgets, and backlog validation pass locally. Main CI runs after push.
