# Contract cancellation and refund obligations

Canonical tasks `04-invoices-wallet-contracts.md#T-04.5.01.05`, `04-invoices-wallet-contracts.md#T-04.4.02.01` through `.05`, and the cancellation consumer of `04-invoices-wallet-contracts.md#T-04.CC.07.01`.

This batch is in progress on verified editor PR #327 merge `cac42489bf39a7b08443d1acb547480cf8572cee`. The cancellation command and automatic wallet fulfillment are locally implemented and tested; payment-race guards, external fulfillment integration, closure and UI remain unfinished.

## Built foundation

The staff cancellation-preview endpoint reads the exact contract version and associated invoice/refund facts in one SQL statement. It distinguishes the outstanding paid balance from the portion already reserved by pending refunds, preserves bigint precision, returns a fingerprint for later commit-time comparison, and exposes archived/terminal/payment/refund blockers. Ambiguous order invoice associations and inconsistent cross-profile links block a decision without exposing another profile's amounts. The endpoint requires contract write permission and makes no state or financial changes.

The storage foundation adds immutable cancellation intents, execution evidence and refund obligations. It binds financial approvals to exact decisions and prevents dismissal of linked mandatory refunds. Migration0145 extends the approval action constraint and preserves historical data. Commit-time completeness and wallet processing are implemented below. Payment-race guards, external fulfillment integration, closure and UI remain unfinished; the batch is not ready for publication.

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
