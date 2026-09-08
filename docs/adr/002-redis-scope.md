# ADR-002: Redis Scope & Architectural Guarantees

| Field        | Value                |
| ------------ | -------------------- |
| **Status**   | Accepted             |
| **Date**     | 2026-08-24           |
| **Deciders** | Platform Engineering |
| **Driver**   | T-04.02.04           |

---

## Context

The application uses Redis for three operational purposes:

1. **Read-heavy config caching** — Admin settings (VAT rates, product prices, thresholds) are immutable and change infrequently. `ConfigCache` in `packages/shared/src/config-cache/` stores entries under `config:entry:*` with a 5-minute TTL and version-gated staleness detection (`config:global:version`). See `01-platform-infrastructure.md#T-04.02.03`.

2. **Additional distributed rate counters** — The `CompositeRateLimiterStore` in `packages/shared/src/rate-limit/` records every general request in PostgreSQL before checking the additional Redis counter. Either store may deny a request; Redis failure returns the already-persisted PostgreSQL result. Security failure-history reads use PostgreSQL directly. See `01-platform-infrastructure.md#T-04.02.02`.

3. **Short-lived coordination locks** — Planned for future use (mutex-style locks for distributed job scheduling, cache stampede prevention, etc.) with sub-second to 30-second TTLs.

Redis is deployed as a managed service alongside PostgreSQL. However, its availability cannot be assumed — network partitions, maintenance windows, and resource contention make it a best-effort infrastructure component.

---

## Decision

**Redis is optional, disposable, and never a source of truth.**

Every Redis key has a defined TTL, an invalidation strategy, and a fallback path to PostgreSQL (or equivalent authoritative storage). The application must remain correct — financially, operationally, and functionally — if Redis is flushed, restarted, or entirely absent.

### Concrete guarantees

| Area               | Redis Role                                        | Fallback                                                                                     | TTL                                          | Invalidation                                                      |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Config caching     | Cache values; verify freshness against PostgreSQL | Direct PostgreSQL read                                                                       | 300 s (5 min)                                | Transactional PostgreSQL version bump; best-effort Redis eviction |
| Rate limiting      | Additional atomic counters                        | Authoritative PostgreSQL rolling history with per-key transaction locks and periodic cleanup | Window duration (configurable per namespace) | Redis keys auto-expire after the window; PG cleanup is periodic   |
| Coordination locks | Distributed mutual exclusion                      | PG advisory locks or skip-operation                                                          | 1–30 s (depending on use case)               | Automatic expiry (NX + PEXPIRE); never block on a stale lock      |

### What Redis is NOT used for

- **Persistent sessions** — session state and revocation are stored in PostgreSQL; an HTTP-only cookie identifies the session. Redis is not authoritative for session validity.
- **Durable job queues** — background jobs are stored in PostgreSQL with their full payload and retry state. Redis is used solely for coordination (rate gates, locking).
- **Financial calculations** — all VAT, pricing, and ledger computations read from PostgreSQL. Redis cached config is validated by the version-gate before use; a cache miss or stale entry triggers a fresh PG read.
- **Authorization decisions** — RBAC rules are resolved from PostgreSQL directly; Redis may cache lookups but an empty cache produces correct (slower) results.

---

## Consequences

### Positive

- **Operational simplicity:** Redis can be reconfigured, migrated, or replaced without application downtime or data loss.
- **Fail-safe by default:** All Redis clients are created with `lazyConnect: true`, offline queuing disabled, one reconnect attempt per command and a one-second command deadline by default. Initial connection timeout defaults to ten seconds. Construction and connection failures log a warning and return `null`.
- **Horizontal scalability:** API replicas share PostgreSQL rolling histories serialized by a transaction advisory lock for each qualified key. Redis can further restrict general admissions; flushing it cannot restore PostgreSQL quota.

### Negative

- **Latency tail on fallback:** Every rate-limit check incurs a PostgreSQL write, including when Redis is healthy. Config-cache hits also validate the PostgreSQL version. This is acceptable for low-traffic periods but may require capacity planning under load.
- **Monitoring gap:** Degraded Redis does not raise an alert by default — the app silently falls back. Operators should monitor Redis connection health and page when Redis becomes unavailable for extended periods.

### Migration

Configuration entries now use `config:entry:v2:`. Old entries expire under their existing TTL and are never read by the repaired cache. A cache hit requires an equal, positive PostgreSQL version; population checks that version before and after reading the value. Missing version metadata forces a database value read without caching. Each hit adds a PostgreSQL metadata read.

General and security counters use migration `0120_rolling_rate_limits.sql`, which adds bounded rolling histories and their admission/reset functions. Database time controls expiry. All windows of a qualified key share the reset lock; window lengths retain independent histories. PostgreSQL failure refuses admission even when Redis is healthy. Redis increments retain their original expiry and can further restrict general requests.

Drain old API and worker counter writers before applying 0120 and switching consumers. Legacy PostgreSQL buckets have no individual attempt timestamps. Their first rolling read imports them at the latest possible timestamp, including recorded clock skew, instead of resetting protection. Truncated history is retained conservatively when a quota increases. Traffic recorded only in Redis before durable enforcement cannot be reconstructed after its loss. Local migration/concurrency tests do not establish that deployed writers were drained or historical traffic reconciled.

The configuration-cache namespace change itself requires no database migration. Future introductions of Redis-based storage must be reviewed against these guarantees and approved through the ADR process.

---

## Compliance Checklist

- [x] Every Redis call is guarded with `if (redis)` (or equivalent null-check) — verified in `redis-factory.ts`, `config-cache.ts`, and `composite-rate-limiter.ts`.
- [x] No Redis key is relied upon for correctness after restart — proven for config caching and rate limiting; coordination locks (planned) designed with same property.
- [x] Every existing Redis key has a documented TTL — config caching (300s), rate limiting (window duration). Coordination locks (planned) will follow the 1–30 s TTL convention.
- [x] Every Redis key has a documented invalidation strategy.
- [x] Financial, session, auth, and durable job logic have zero dependence on Redis availability.
- [x] `createRedisClient()` returns `null` on connection failure for construction and initial connection errors; connection attempts remain bounded.
- [x] Config cache uses version-gated staleness — TTL alone is insufficient for financial correctness.

---

## Related

- **ADR-001:** [Database conventions and migration strategy](001-data-types-and-conventions.md).
- **T-04.02.01:** Redis connection factory with graceful fallback — `packages/shared/src/redis/`.
- **T-04.02.02:** Distributed rate-limiting with Redis + PostgreSQL fallback — `packages/shared/src/rate-limit/`.
- **T-04.02.03:** Configuration caching with version-gated invalidation — `packages/shared/src/config-cache/`.
