# Approval-time refund transactions

Branch: `codex/refund-pending-ledger`, based on merged PR #313 at `b7bc57b456c92c0094b88c17cf354df6b998f112`.

Status: selected; implementation and validation pending.

## Scope

Remaining approval-time pending transaction criterion for `04-invoices-wallet-contracts.md#T-04.4.01.02`. Reuse the existing refund state machine, wallet ledger and durable retry processor. Approval must not post money. Processing, rejection/cancellation and retry must preserve transaction identity and prevent duplicate credits. Check the external-destination representation before claiming the entire lifecycle criterion complete.

## Validation required

Cover approval without balance change, idempotent/concurrent approval, processing one intent exactly once, failed retry, cancellation/rejection, rollback on audit failure, legacy refunds without intent and external refunds without wallet credits. Run related refund/wallet tests and unchanged coverage floors, independent exact-HEAD review and all active GitHub checks before merge.
