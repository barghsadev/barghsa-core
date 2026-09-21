# Contract cancellation and refund obligations

Canonical tasks `04-invoices-wallet-contracts.md#T-04.5.01.05`, `04-invoices-wallet-contracts.md#T-04.4.02.01` through `.05`, and the cancellation consumer of `04-invoices-wallet-contracts.md#T-04.CC.07.01`.

This batch is in progress. It is stacked locally on the context editor and must be rebased onto that batch's verified merge before its PR. No cancellation command or automatic refund is complete yet.

## Built foundation

The staff cancellation-preview endpoint reads the exact contract version and associated invoice/refund facts in one SQL statement. It distinguishes the outstanding paid balance from the portion already reserved by pending refunds, preserves bigint precision, returns a fingerprint for later commit-time comparison, and exposes archived/terminal/payment/refund blockers. Ambiguous order invoice associations and inconsistent cross-profile links block a decision without exposing another profile's amounts. The endpoint requires contract write permission and makes no state or financial changes.

Focused validation passes 40 unit/HTTP cases, API typechecking, targeted lint and generated OpenAPI comparison. Review, coverage and CI are not yet claimed.

## Required before the batch is ready

- Staff cancellation must bind an exact current version, reason, explicit refund decision and fresh financial snapshot. Recheck current authority and step-up in the transaction. Enforce applicable dual approval before the irreversible command.
- Serialize against invoice payments, refund reservations, activation/completion and concurrent cancellation. Existing in-flight refunds must never cause a second return of the same funds. Resolve ambiguous invoice ownership before committing a decision.
- A paid electricity cancellation must create a durable full wallet-return obligation atomically. Include partially funded balances, original payment references and existing completed refunds. Do not replace this with an optional staff refund or bypass financial approval rules.
- Process through the immutable wallet ledger with obligation-bound idempotency. Retries and exhaustion remain visible to finance; a mandatory obligation cannot be dismissed. Notify the customer of completion and unresolved failure with a support path.
- Separate service cancellation from financial closure. Do not report the contract/order financially closed until every required return completes. Keep cancelled/completed history immutable and preserve legacy rows without invented evidence.
- Provide the staff review/confirmation flow and customer-visible outcome in both languages, with focused migrated database, real HTTP/worker, concurrency, upgrade and production-browser evidence.

The customer cancellation-request workflow, amendments and template PDF generation remain separate tasks. This foundation is not evidence that cancellation or automatic refund acceptance criteria have been completed.
