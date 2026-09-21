# Contract cancellation and refund obligations

Canonical tasks `04-invoices-wallet-contracts.md#T-04.5.01.05`, `04-invoices-wallet-contracts.md#T-04.4.02.01` through `.05`, and the cancellation consumer of `04-invoices-wallet-contracts.md#T-04.CC.07.01`.

This batch is in progress on verified editor PR #327 merge `cac42489bf39a7b08443d1acb547480cf8572cee`. The cancellation command, automatic wallet fulfillment, derived financial closure and bilingual interface are implemented. Final coverage, independent review and CI remain.

## Built foundation

The staff cancellation-preview endpoint reads the exact contract version and associated invoice/refund facts in one SQL statement. It distinguishes the outstanding paid balance from the portion already reserved by pending refunds, preserves bigint precision, returns a fingerprint for later commit-time comparison, and exposes archived/terminal/payment/refund blockers. Ambiguous order invoice associations and inconsistent cross-profile links block a decision without exposing another profile's amounts. The endpoint requires contract write permission and makes no state or financial changes.

The storage foundation adds immutable cancellation intents, execution evidence and refund obligations. It binds financial approvals to exact decisions and prevents dismissal of linked mandatory refunds. Migration0145 extends the approval action constraint and preserves historical data. Commit-time completeness and wallet processing are implemented below. Closure and UI remain unfinished; the batch is not ready for publication.

Focused validation passes40 unit/HTTP cases,89 related migrated database cases and5 approval-schema cases. API/database types, targeted lint, generated OpenAPI and database snapshot checks pass. Review, coverage and CI are not yet claimed.

## Required before the batch is ready

- Staff cancellation must bind an exact current version, reason, explicit refund decision and fresh financial snapshot. Recheck current authority and step-up in the transaction. Enforce applicable dual approval before the irreversible command.
- Serialize against invoice payments, refund reservations, activation/completion and concurrent cancellation. Existing in-flight refunds must never cause a second return of the same funds. Resolve ambiguous invoice ownership before committing a decision.
- A paid electricity cancellation must create a durable full wallet-return obligation atomically. Include partially funded balances, original payment references and existing completed refunds. Do not replace this with an optional staff refund or bypass financial approval rules.
- Process through the immutable wallet ledger with obligation-bound idempotency. Retries and exhaustion remain visible to finance; a mandatory obligation cannot be dismissed. Notify the customer of completion and unresolved failure with a support path.
- Separate service cancellation from financial closure. Do not report the contract/order financially closed until every required return completes. Keep cancelled/completed history immutable and preserve legacy rows without invented evidence.
- Provide the staff review/confirmation flow and customer-visible outcome in both languages, with focused migrated database, real HTTP/worker, concurrency, upgrade and production-browser evidence.

The customer cancellation-request workflow, amendments and template PDF generation remain separate tasks. This foundation is not evidence that cancellation or automatic refund acceptance criteria have been completed.

## Cancellation command checkpoint

Staff prepare/read/execute endpoints now bind the current version, financial fingerprint, reason, refund decision and threshold policy to an immutable intent. Execution rechecks permissions, step-up, financial facts and any second financial approval, then atomically records cancellation, mandatory refund obligations, original payment references and audits. Generic approval creation cannot create unbound cancellation approvals. Shared action types and approval labels include cancellation in both languages.

Validation passes 71 focused API unit/HTTP tests and 19 shared approval tests, API/web typechecks, targeted lint and generated OpenAPI consistency. HTTP coverage includes paid and partially funded electricity, unpaid invoice cancellation, idempotent retries, conflicting payloads, concurrent execution, stale versions/funds/policy, revoked reviewer permission, discretionary finance permission, CSRF/step-up, unresolved refunds/review, and rollback on audit failure. This is local validation, not independent approval or final coverage evidence.

Next: enforce database cancellation evidence/completeness at commit and payment-source races; fulfill obligations through the wallet ledger and bounded retry jobs; integrate external returns, derive financial closure, then add the bilingual staff/customer flow. Do not publish the currently incomplete command alone.

## Atomic obligations and wallet fulfillment checkpoint

Migration0145 now defers cancellation completeness enforcement until commit: new cancellation requires immutable execution evidence, every promised refund, matching actual financial impact and full per-invoice electricity wallet obligations. Existing terminal rows retain their history. Lifecycle tests now create valid cancellation evidence instead of directly assigning terminal state.

Execution atomically approves its bound obligations and queues wallet returns in the existing retry system. The processor recognizes immutable cancellation authority, supports partially funded invoices, records contract/intent provenance on the wallet credit and audit, and remains idempotent under concurrent attempts. Role or threshold changes after committed cancellation do not erase the recorded debt; discretionary manual refunds retain their current-permission checks. Exhaustion alerts finance and the customer, preserves the obligation and cannot be dismissed.

Validation:70 real HTTP cases covering cancellation and wallet refund regressions;41 lifecycle/upgrade database cases;55 refund/storage database cases, with9 cancellation cases overlapping those database suites. Database/API types, targeted lint and snapshot comparison pass. Exact-head review, final combined coverage and CI remain for the complete batch.

Next: payment-source race guards and prevention of further payment/invoice reassociation after cancellation; external-bank obligation integration; truthful derived financial closure; bilingual staff confirmation and customer status. Do not publish this partial workflow yet.

## Payment races and external fulfillment checkpoint

Cancellation preview and deferred execution guards now detect submitted/under-review receipts and pending/reserved wallet payments independently of the invoice state. Payment evidence locks the invoice and associated contracts. Cancelled-contract invoice associations, paid totals and charges cannot change, invoices cannot be added/deleted, and new receipt/wallet payments cannot enter terminal history. Locks reject a racing operation so it can retry against current facts. Refund updates remain permitted.

Bound external-bank obligations now use the existing finance transfer/reconciliation workflow for both fully paid and partially funded invoices. A second finance user must reconcile the bank reference before refund totals or invoice settlement change. The immutable obligation remains the authority for the promised return.

Validation:44 focused cancellation/snapshot/wallet HTTP cases;43 cancellation/external-refund/bank-confirmation HTTP cases, with cancellation cases overlapping;86 lifecycle/refund DB cases plus one newly added direct-write reconciliation case, verified in a10-case cancellation suite. API types,targeted lint and snapshot checks pass. No final coverage,independent approval or CI is claimed for the batch yet.

Next: expose truthful derived financial closure and refund status to staff/customers, add bilingual confirmation/status UI, then run committed combined coverage,independent review and all CI gates before merge.

## Live cancellation status checkpoint

Dedicated staff/customer status endpoints derive financial closure from a consistent database statement. Cancelled service remains financially pending while a bound refund or its transaction is incomplete. Failed returns,pending payments or unbound active refunds require attention. Historical cancellations without new execution evidence report unverified,never closed. Amounts remain exact decimal strings; customer output excludes actor and approval details. Customer reads require the current authorized profile and published contract history.

Validation passes38 cancellation/customer-review HTTP cases plus5 config-cache integration cases,API types,targeted lint and generated OpenAPI consistency. The new HTTP evidence verifies private drafts,cross-profile isolation,anonymous access,live pending-to-closed progression and failed-return status. The bilingual staff/customer interface and final coverage/review/CI remain.

Full main after #327,run35551479937,finished with all317 API test files passing but one uncaught PostgreSQL termination during config-cache fixture teardown. Its forced database drop raced a closing idle connection. The local fixture now waits for PostgreSQL to observe zero clients,uses ordinary DROP,and always closes management. Focused config-cache checks pass; full-CI confirmation remains required. Other four gates passed.

## Bilingual interface built

The current contract view now includes cancellation review and financial outcome. Staff review exact balances,choose full-wallet or explicit per-invoice refunds for non-electricity services,record a reason,and save a decision before irreversible confirmation. Electricity uses mandatory full wallet return. Current permission flags hide cancellation from read-only users and disable discretionary financial decisions without finance authority. The latest saved decision is recoverable after reload; second approval,stale facts and unresolved sources prevent execution. Existing password verification preserves the exact idempotent request. Customers see service cancellation and refund completion separately,with finance/support guidance for unresolved outcomes. Historical versions do not expose cancellation actions.

Validation:22 focused frontend tests,39 cancellation/customer HTTP tests,2 production Chromium flows covering English/Persian,step-up retry identity,reload during approval,final confirmation and financial closure refresh. API/web types,lint,generated OpenAPI and production build pass. Final combined coverage,broader browser evidence,independent exact-head review and CI remain. The batch is not merged or marked complete.

Next: collect actual combined coverage against main,fill meaningful evidence gaps,inspect the rendered interface,then open the full batch PR,review its exact head and merge only after all gates pass.

## Finance follow-up gap closed

Requirement review found that exhausted immutable retry jobs could not be resumed. The batch now provides a finance-only,cursor-paginated queue of unresolved contract returns and a usable manual retry. A fresh step-up-verified finance action persists a one-attempt authorization; the worker verifies it and current finance permission,records its consumption and preserves the exhausted automatic job. The original obligation key still prevents duplicate ledger credit. Failed retries remain visible; successful returns leave the queue. The same bilingual queue records external bank references and invokes separate-user reconciliation. It exposes no dismissal action.

Validation passes52 cancellation/wallet/external HTTP tests,36 refund processing/transaction DB cases and4 production-browser flows for cancellation and queue behavior in English/Persian. API/web/DB types,lint,OpenAPI generation pass. Persian queue rendering was inspected from the production-browser artifact. Combined coverage,remaining evidence gaps,independent review and CI remain.

## Final validation checkpoint

Focused coverage collection passes132 API tests,57 migrated database tests,19 shared approval tests,2 dictionary tests and52 frontend tests. Seventeen production-browser cases pass, including existing contract and approval flows. Added finance queue tests cover permission denial, failed-load recovery, pagination deduplication, missing reconciliation references and stale responses after unmount. Web types pass. Final combined coverage must be collected on the clean committed head before independent review and CI.
