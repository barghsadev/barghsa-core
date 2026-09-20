# External bank refunds and reconciliation

Branch: `codex/external-refund-batch`.
Status: implementation and local validation; independent review and CI pending.

## Task scope

`04-invoices-wallet-contracts.md#T-04.4.01.05`: finance staff can request external bank refunds, approve them, and record a bank transfer reference. Recording a transfer moves the refund to Processing with Pending reconciliation. A distinct finance staff member must submit the same reference to reconcile it. Only then do the refund, invoice counter, invoice state and audit events complete in one transaction. External refunds never create wallet credits.

`04-invoices-wallet-contracts.md#T-04.4.01.06`: extends the preceding wallet approval integration to external refunds. The approval binds the destination as well as refund, invoice, profile, amount and initiator. Threshold and approval authority are rechecked before recording the transfer. Reconciliation checks the immutable transfer evidence and a distinct, currently authorized finance reviewer; later policy changes or recorder offboarding do not invalidate an already recorded transfer. This completes destination coverage, while automatic system obligations remain a separate workflow.

`04-invoices-wallet-contracts.md#T-04.4.01.02` remains partial. External transitions reuse the same guarded/audited service as wallet refunds, but worker failure/retry behavior and pending ledger entries on approval still have remaining criteria. Completed and rejected manual refunds now notify the current profile owner through the in-app notification center, in English/Persian, in the same transaction. Notices include the exact amount and invoice link, omit private staff reasons/bank references, and are not repeated on an idempotent replay. External email/SMS delivery is not claimed.

## API and operational boundaries

POST `/api/admin/external-refunds` accepts the same invoiceId, decimal-string amount, UUID idempotencyKey and reason as wallet refunds. POST `/api/admin/external-refunds/:id/:action` accepts approve, reject, cancel, record-transfer and reconcile. Transfer/reconcile require bankReference; reject/cancel require reason. Wallet routes retain their existing request shape and reject external refund IDs.

One transfer reference belongs to one refund, with exact case-sensitive matching after trimming. Concurrent reference claims serialize. A reference cannot be edited once recorded; processing refunds cannot be dismissed through reject/cancel. A completed matching reconciliation is a harmless replay. The recorder needs finance authority when recording the transfer, and the reconciler needs current finance authority when confirming it. The API records an already performed bank transfer; it does not send money through a banking provider. No admin page or automatic bank-feed reconciliation is claimed.

## Validation

The combined wallet/external/model suite passes 35 tests against real PostgreSQL and HTTP. New cases cover recording without settlement, second-person confirmation, incorrect/missing/control-character references, destination isolation, duplicate transfer references under concurrency, exact int8 amounts, destination-bound approval, changed policy during reconciliation, mixed external/wallet refunds, current reconciler authority, recorder offboarding, archived profiles, audit failure rollback, localized owner-only outcome notices, duplicate notice prevention and rollback of wallet credit/counters if a notice cannot be persisted. API build, typecheck, changed-file lint and generated contract checks pass. Independent exact-HEAD review and active CI checks remain required before merge.

The refund critical-source coverage run passes 35 tests with 96.53% lines and 89.42% branches, above the unchanged 90%/85% floors. The combined refund/template-isolation run passes 36 tests. The pinned full Semgrep scan passes all five rule fixtures across 824 files with zero findings and zero scanner errors.

Related regression checks pass all 115 cases in `wallet-credit.integration.test.ts` and `dual-approval-http.integration.test.ts`.
