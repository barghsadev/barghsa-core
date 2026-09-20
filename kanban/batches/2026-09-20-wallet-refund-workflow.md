# Manual wallet refunds and financial approval

Branch: `codex/refund-workflow-batch`.
Status: PR #309 merged at `d8df79866ec002f50df1ff52430db4da515f88c0` after independent approval and all active CI checks passed.

## Task scope

`04-invoices-wallet-contracts.md#T-04.4.01.04`: authenticated finance endpoints request, approve, reject, cancel and process full or partial invoice refunds to the customer wallet. The ledger credit uses `refund-wallet-credit:<refundId>`. Credit, refund completion, database-owned invoice counters, invoice state and audit events commit together. A missing wallet is created in that transaction. Completed replays do not return money again.

`04-invoices-wallet-contracts.md#T-04.4.01.06`: requests at or above the configured threshold create an entry in the existing financial approval queue. The immutable request audit binds the exact approval ID. A different approval with matching details cannot substitute for it. The service verifies current initiator/reviewer finance permission, distinct reviewers, exact amount and identity, current policy, and recent staff step-up before approving or processing. A rejected review remains binding after the policy changes.

`04-invoices-wallet-contracts.md#T-04.4.01.02` remains partial: the nine allowed state edges have a shared model and tests; manual wallet transitions have guards and audit events. Original confirmed payment evidence is recorded with the request, with an explicit flag when legacy evidence is absent. Failure rolls back the synchronous transaction to its previous state and allows a safe retry.

## API use and limits

POST `/api/admin/wallet-refunds` accepts invoiceId, exact decimal-string amount, UUID idempotencyKey and reason. POST `/api/admin/wallet-refunds/:id/:action` accepts approve, process, reject or cancel; reject/cancel require a reason. Both routes require finance permission, CSRF and recent step-up. High-value requests first need approval through the existing second-person approval endpoint, then the refund approve/process calls. If policy increases after a request, replaying its original request creates the newly required review. Conflicting concurrent financial transactions can return 409; retry the same request safely.

This batch does not provide an admin refund page, external bank reconciliation, automatic contract obligations, persisted worker failures/backoff, pending ledger transactions on approval, or customer refund notifications. Those keep their remaining criteria. Rejecting/cancelling a refund does not close a separately pending approval-queue item; its decision cannot revive a terminal refund. External destination support and its approval binding remain part of the next batch. Historical supervisor completion arrays are unchanged.

## Validation

- API build and generated OpenAPI contract check pass.
- API typecheck and changed-file ESLint pass.
- Refund model and real PostgreSQL/HTTP suites pass 25 tests, covering exact int8 amounts, request validation, permissions/CSRF/step-up, reservation races, duplicate processing, bound second approval, changed/corrupt policy, lost reviewer authority, terminal states, missing wallet, archived profiles, audit failure rollback and session expiry during a wallet lock wait.
- Related invoice state, customer history and bank-receipt dual-approval suites pass 40 tests.
- Independent exact-HEAD review and active GitHub checks remain merge gates. PR fast mode does not measure coverage or run the full browser suite; no UI changes are included here.

Independent review approved exact HEAD `f93c20bd533ea99a3420c6790705a79b0e962c32`: [durable review](https://github.com/barghsadev/barghsa-core/pull/309#issuecomment-5749835770). [CI run](https://github.com/barghsadev/barghsa-core/actions/runs/35510921434) passed all five active checks; test job took 18m25s. PR fast mode did not measure coverage or run the full browser suite.
