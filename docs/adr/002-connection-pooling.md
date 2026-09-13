# ADR-002: PostgreSQL Connection Pooling Strategy

**Status:** Accepted  
**Date:** 2026-08-24  
**Deciders:** Platform Engineering Team  
**Dependencies:** T-04.01.01, S-02.01

## Context

The Barghsa platform connects to PostgreSQL from multiple application components: the NestJS API server, the background worker, and ad-hoc migration/seed scripts. Each component uses a Node.js application-level pool (`pg.Pool` from the `pg` package) to manage database connections.

As the platform scales to multiple API replicas behind a load balancer, connection exhaustion becomes a risk. PostgreSQL has a finite number of connections (`max_connections`, default 100), and each replica may hold a pool of 10–20 connections. With 5+ replicas, the total can exceed the database limit, causing connection failures.

The platform needs to decide between:

1. **Application-level pooling only** — each service manages its own `pg.Pool` with a small per-replica max.
2. **PgBouncer (transaction-mode connection pooling)** — a lightweight, dedicated pooler that sits between the application and PostgreSQL, multiplexing many client connections onto a smaller number of actual database connections.

## Decision

**Use PgBouncer in transaction mode** for all production deployments with multiple API replicas. For single-server and local development, bypass PgBouncer and connect directly to PostgreSQL (the application-level pool is sufficient).

### Rationale

- **Connection efficiency:** PgBouncer in transaction mode can multiplex hundreds of client connections onto a small pool of backend connections (e.g., 20–30 for a cluster of 5 replicas). This avoids hitting `max_connections` on PostgreSQL.
- **Low overhead:** PgBouncer is a single-threaded, event-loop-driven daemon with minimal memory footprint (~2KB per client connection). It adds microseconds of latency per query.
- **Proven in production:** PgBouncer is the de facto standard for PostgreSQL connection pooling in containerised and high-availability deployments.
- **Graceful degradation:** If PgBouncer is unavailable, the application can connect directly to PostgreSQL (via the `PGDIRECT_URL` environment variable), though this bypasses pooling and should only be used for recovery.

### Transaction mode vs. Session mode

- **Transaction mode** (selected): A client connection is returned to the pool after each transaction completes. This is the most efficient mode for HTTP APIs, where each request typically executes one or a few transactions. Session settings do not follow a client between transactions. The application applies its timeout settings with SET LOCAL inside the transaction. Standalone statements run in short transactions; explicit BEGIN/COMMIT/ROLLBACK and savepoints remain caller-owned. Query settings and SQL stay on the same pooled backend.
- **Session mode** (rejected): A client connection is held for the entire session. This is necessary for `LISTEN/NOTIFY`, cursors, and advisory locks — the platform now uses session advisory locks for bootstrap and other owned operations. Those callers must keep a direct connection.

### TLS

- **App → PgBouncer:** TLS is optional in development (localhost) and required in production (internal network). The application uses `DATABASE_SSL_ENABLED=true` and `DATABASE_CA_PATH` with certificate validation. The pooler requires `PGBOUNCER_CLIENT_TLS_SSLMODE=require`, its certificate and key mounted through `PGBOUNCER_CLIENT_TLS_CERT_FILE` and `PGBOUNCER_CLIENT_TLS_KEY_FILE`.
- **PgBouncer → PostgreSQL:** TLS is required in production. Set `PGBOUNCER_SERVER_TLS_SSLMODE=verify-full` and mount the server CA through `PGBOUNCER_SERVER_TLS_CA_FILE`. The backend hostname must match its certificate. The development Compose profile does not supply production certificates.

### Pool sizing

For a target of 5 API replicas, each with 20 application-level connections, PgBouncer is configured with:

- `default_pool_size = 30` — comfortably below PostgreSQL's `max_connections` (default 100), leaving headroom for admin connections, migrations, and monitoring.
- `reserve_pool_size = 10` — additional connections that are opened when the default pool is exhausted, providing a buffer against traffic spikes.
- `reserve_pool_timeout = 3` — seconds before a queued client is assigned a reserved connection.
- `max_client_conn = 200` — maximum client connections PgBouncer will accept (5 replicas × 20 connections = 100, with headroom).

## Consequences

- **Positive:** Connection exhaustion is prevented at scale. PostgreSQL `max_connections` can remain at its default (100) rather than being raised to 300+.
- **Positive:** PgBouncer provides built-in statistics (`SHOW STATS`, `SHOW POOLS`) that can be exported for monitoring.
- **Negative:** Transaction pooling does not preserve session advisory locks, `LISTEN/NOTIFY` or temporary tables across transactions. Use the direct session pool for those operations.
- **Negative:** An additional infrastructure component to deploy, monitor, and configure. PgBouncer must be included in the deployment stack (Docker Compose for single-VM, sidecar or separate container for pilot).
- **Negative:** Pooling and transaction-local settings add round trips. Measure the actual workload before sizing production replicas.

## Alternatives considered

### Application-level pool only (rejected)

Increase `pg.Pool` max to 20 per replica and rely on PostgreSQL's `max_connections` being set high enough. This works for small deployments (1–2 replicas) but does not scale. Setting `max_connections` to 500+ on PostgreSQL consumes significant RAM (each connection ~10MB) and is not recommended for managed PostgreSQL services.

### PgBouncer in session mode (rejected)

Session mode would hold connections for the duration of the application session, providing no pooling benefit for HTTP APIs. It would effectively behave like a direct connection with an extra hop.

### pgbouncer-rr (rejected)

A fork of PgBouncer with read/write splitting. The platform does not yet need read replicas, and the mainline PgBouncer is more actively maintained and better documented.

## Configuration

### Docker Compose (development)

```yaml
pgbouncer:
  image: bitnamilegacy/pgbouncer:1.23.1
  container_name: barghsa-pgbouncer
  ports:
    - '6432:6432'
  environment:
    PGBOUNCER_DATABASE: barghsa
    PGBOUNCER_PORT: '6432'
    PGBOUNCER_POOL_MODE: transaction
    POSTGRESQL_HOST: postgres
    POSTGRESQL_PORT: '5432'
    POSTGRESQL_DATABASE: barghsa
    POSTGRESQL_USERNAME: barghsa
    POSTGRESQL_PASSWORD: ${POSTGRES_PASSWORD:-barghsa-dev-password}
    PGBOUNCER_MAX_CLIENT_CONN: '200'
    PGBOUNCER_DEFAULT_POOL_SIZE: '30'
    PGBOUNCER_RESERVE_POOL_SIZE: '10'
    PGBOUNCER_RESERVE_POOL_TIMEOUT: '3'
  depends_on:
    postgres:
      condition: service_healthy
```

### Application connection

The optional container profile uses the image's supported backend variables, transaction mode and an authenticated SQL health check. The application does not send unsupported startup timeout options. Explicit URL `options` are rejected rather than ignored. See [PgBouncer parameter tracking](https://www.pgbouncer.org/config#track_extra_parameters) for the startup/session restrictions.

Reads retain their10-second default and writes/transaction completion retain30seconds. Explicit uniform timeout overrides remain supported. Settings reset at transaction end; queued queries can expire before execution. Backend acquisition and cleanup are bounded, and commit uses its write deadline. Send transaction-control commands separately from other SQL; mixed transaction batches are rejected before execution.

Session advisory locks must use `getDbPool({ session: true })`. With PgBouncer configured this selects a direct pool, bounded to five connections, using `PGDIRECT_URL` or `DATABASE_URL`. Missing direct configuration fails the session operation. Without PgBouncer it reuses the ordinary application pool. Finance receipt/payment/chargeback callers use this path because their locks span multiple transactions. API shutdown closes both shared pools. The direct endpoint must reach PostgreSQL, not a transaction pooler.

Local tests exercise real PostgreSQL16 and PgBouncer1.23.1 with one backend, including timeout isolation, rollback, slow commit, queued side effects, direct session locks and cleanup. Production TLS certificates, firewall restrictions, sizing and rollout still require operational verification.

The application connects to PgBouncer via `PGBOUNCER_URL` (e.g., `postgres://barghsa:password@pgbouncer:6432/barghsa`). When `PGBOUNCER_URL` is not set, the application falls back to `DATABASE_URL` (direct PostgreSQL connection).

Env vars:

- `DATABASE_URL` — direct PostgreSQL connection (used when PgBouncer is not configured)
- `PGBOUNCER_URL` — PgBouncer connection (used when available; overrides `DATABASE_URL`)
- `PGDIRECT_URL` — direct PostgreSQL connection for admin/migration operations (bypasses PgBouncer)

## Review

This ADR should be reviewed when:

- The platform adds read replicas or sharding
- Session-level features (LISTEN/NOTIFY, prepared statements) are needed
- The number of API replicas exceeds 10
- A managed PostgreSQL service with built-in pooling (e.g., RDS Proxy) is adopted
