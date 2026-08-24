# ADR-002: Redis Scope & Architectural Guarantees

| Field         | Value                                   |
|---------------|-----------------------------------------|
| **Status**    | Accepted                                |
| **Date**      | 2026-08-24                              |
| **Deciders**  | Platform Engineering                    |
| **Driver**    | T-04.02.04                              |

---

## Context

The application uses Redis for three operational purposes:

1. **Read-heavy config caching** — Admin settings (VAT rates, product prices, thresholds) are immutable and change infrequently. `ConfigCache` in `packages/shared/src/config-cache/` stores entries under `config:entry:*` with a 5-minute TTL and version-gated staleness detection (`config:global:version`). See `01-platform-infrastructure.md#T-04.02.03`.

2. **Distributed rate-limit acceleration** — The `CompositeRateLimiterStore` in `packages/shared/src/rate-limit/` attempts Redis-backed rate counting first and falls back to PostgreSQL when Redis is unavailable. See `01-platform-infrastructure.md#T-04.02.02`.

3. **Short-lived coordination locks** — Planned for future use (mutex-style locks for distributed job scheduling, cache stampede prevention, etc.) with sub-second to 30-second TTLs.

Redis is deployed as a managed service alongside PostgreSQL. However, its availability cannot be assumed — network partitions, maintenance windows, and resource contention make it a best-effort infrastructure component.

---

## Decision

**Redis is optional, disposable, and never a source of truth.**

Every Redis key has a defined TTL, an invalidation strategy, and a fallback path to PostgreSQL (or equivalent authoritative storage). The application must remain correct — financially, operationally, and functionally — if Redis is flushed, restarted, or entirely absent.

### Concrete guarantees

| Area | Redis Role | Fallback | TTL | Invalidation |
|------|-----------|----------|-----|--------------|
| Config caching | Accelerate reads, avoid PG round-trip for every request | Direct PostgreSQL read | 300 s (5 min) | Per-key eviction + global version bump on update. See `ConfigCache.invalidate()` |
| Rate limiting | Low-latency atomic counters | PostgreSQL upsert (`INSERT ... ON CONFLICT DO UPDATE`) + periodic row cleanup | Window duration (configurable per namespace) | Redis keys auto-expire after the window; PG cleanup is periodic |
| Coordination locks | Distributed mutual exclusion | PG advisory locks or skip-operation | 1–30 s (depending on use case) | Automatic expiry (NX + PEXPIRE); never block on a stale lock |

### What Redis is NOT used for

- **Persistent sessions** — session state is stored in an HTTP-only, signed, encrypted cookie. Redis is not consulted for auth or session validity.
- **Durable job queues** — background jobs are stored in PostgreSQL with their full payload and retry state. Redis is used solely for coordination (rate gates, locking).
- **Financial calculations** — all VAT, pricing, and ledger computations read from PostgreSQL. Redis cached config is validated by the version-gate before use; a cache miss or stale entry triggers a fresh PG read.
- **Authorization decisions** — RBAC rules are resolved from PostgreSQL directly; Redis may cache lookups but an empty cache produces correct (slower) results.

---

## Consequences

### Positive

- **Operational simplicity:** Redis can be reconfigured, migrated, or replaced without application downtime or data loss.
- **Fail-safe by default:** All Redis clients are created with `lazyConnect: true`, `maxRetriesPerRequest: null`, and a 10-second connect timeout. Connection failures log a warning and return `null`.
- **Horizontal scalability:** Rate-limit counters can share a single Redis instance across N API replicas, providing consistent enforcement without PG advisory-lock contention.

### Negative

- **Latency tail on fallback:** When Redis is degraded, every config read and rate-limit check incurs a PostgreSQL round-trip. This is acceptable for low-traffic periods but may require capacity planning under load.
- **Monitoring gap:** Degraded Redis does not raise an alert by default — the app silently falls back. Operators should monitor Redis connection health and page when Redis becomes unavailable for extended periods.

### Migration

No migration needed — this ADR describes existing architecture. Future introductions of Redis-based storage must be reviewed against the guarantees above and approved through the ADR process.

---

## Compliance Checklist

- [x] Every Redis call is guarded with `if (redis)` (or equivalent null-check) — verified in `redis-factory.ts`, `config-cache.ts`, and `composite-rate-limiter.ts`.
- [x] No Redis key is relied upon for correctness after restart — proven for config caching and rate limiting; coordination locks (planned) designed with same property.
- [x] Every existing Redis key has a documented TTL — config caching (300s), rate limiting (window duration). Coordination locks (planned) will follow the 1–30 s TTL convention.
- [x] Every Redis key has a documented invalidation strategy.
- [x] Financial, session, auth, and durable job logic have zero dependence on Redis availability.
- [x] `createRedisClient()` returns `null` on connection failure — never throws or blocks startup.
- [x] Config cache uses version-gated staleness — TTL alone is insufficient for financial correctness.

---

## Related

- **ADR-001:** (planned) Database conventions & migration strategy.
- **T-04.02.01:** Redis connection factory with graceful fallback — `packages/shared/src/redis/`.
- **T-04.02.02:** Distributed rate-limiting with Redis + PostgreSQL fallback — `packages/shared/src/rate-limit/`.
- **T-04.02.03:** Configuration caching with version-gated invalidation — `packages/shared/src/config-cache/`.