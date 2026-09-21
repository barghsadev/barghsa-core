# Customer cancellation requests

Task `04-invoices-wallet-contracts.md#T-04.5.01.06`. Base is verified PR #328 merge `9960e956e105f0d8067cfbe8b6e52f67da4da41e`. Status: selected; implementation not yet complete.

Reuse cancellation intents/execution rather than inventing another refund path. A customer with contracts:sign and step-up can submit a reason and preferred destination for a published, current nonterminal contract. Request creates durable staff-review state and notifications only; no contract/refund mutation. Use current session/profile checks and idempotency, one unresolved request per contract, immutable customer request evidence.

Staff rejects with required explanation and customer support notification, leaving contract unchanged. Approval requires a concrete staff refund decision and reuses cancellation preparation/dual approval/execution. Do not mark request fulfilled before cancellation execution commits. Capture request ID binding in the immutable intent; execute can resolve the bound request in the same transaction. If independently cancelled/completed, show truthful terminal outcome and prevent stale review actions. Destination is preference, not permission to override mandatory electricity wallet rules.

Customer sees request pending/declined/fulfilled and explanation. Staff queue shows unresolved requests, reason and preference; approval opens existing cancellation decision with request context. Existing contract cancellations remain independently usable. Bilingual/RTL, required reason and exact retry identity.

Tests: real HTTP profile isolation, current permission/session, duplicate submit, stale version, approval/rejection concurrency, reason validation, rollback when audit/notification fails, customer cannot cancel directly, failed or awaiting second approval cannot resolve request, successful refund obligation creation resolves request atomically. Migrated DB guards and production browser request-review flow. Preserve bounded task scope.
