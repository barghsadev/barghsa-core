# ADR 006 PostgreSQL transactional outbox

## Context

An order, payment or identity change can commit while a provider is slow or
unavailable. Each intended downstream effect needs a durable record and a
recoverable outcome. [System architecture](../../architecture.md).

## Decision

Persist the intent in PostgreSQL with the business transaction. Commit the
claim before making an external call. Apply the result idempotently using
the original occurrence and provider receipt. Workers handle retry and
dead-letter states, and reconcile unknown sends before any further attempt.
[Notification delivery recovery](../operations/notification-delivery-recovery.md).

The shared static check rejects direct network and known provider calls in
inline transaction callbacks. For raw `BEGIN` and `COMMIT` blocks or named
wrappers, review where the intent commits, where provider I/O occurs, and how
the transaction reapplies the verified result. [Static check](../../scripts/check-sast.py).

## Alternatives

Sending synchronously within the business transaction holds locks while an
external system responds. Publishing directly to a broker creates a separate
write that must be reconciled if only one system commits. A broker can be
reviewed when measured delivery needs exceed the PostgreSQL design.

## Consequences

Delivery is at least once at the worker boundary, so handlers need durable
idempotency and result reconciliation. Operators monitor backlog age,
delivery failures and dead-letter counts. [Notification monitoring](../operations/notification-monitoring.md).

## Owner and review trigger

Platform Engineering and notification maintainers own this decision. Review
it when queue age, throughput, isolation or availability fails its documented
objective after tuning the existing worker and database path.
