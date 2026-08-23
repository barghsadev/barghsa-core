# Barghsa technical architecture

## Decision priorities

Technical trade-offs are evaluated in this order:

1. Simplicity
2. Performance
3. Reliability and uptime
4. Server cost

Choose the simplest architecture that satisfies measured performance and reliability objectives. Cost reduction must not compromise financial correctness, security, backups, or recovery.

## System shape

Barghsa is a TypeScript pnpm/Turborepo monorepo:

- `apps/web`: TanStack Start frontend
- `apps/api`: NestJS modular monolith
- `packages/db`: Drizzle/PostgreSQL schema and migrations
- `packages/shared`: validated shared contracts and helpers
- `packages/i18n`: Persian and English messages
- `packages/ui`: shared UI components

Production has three application process types: web, API, and worker. API and worker should use the same application image with different startup commands where practical. They may share one VM at low traffic or run as multiple stateless replicas without changing domain boundaries.

Do not introduce microservices, Kubernetes, Kafka, Elasticsearch, CQRS/event sourcing, or a service mesh until measured load or an explicit security/availability boundary justifies the operational cost.

## Domain modules

The modular monolith contains:

- Auth
- Users and Profiles
- CRM and Verification
- Products
- Orders and Consultations
- Contracts
- Invoices and Payments
- Wallet
- Documents and Storage
- Notifications
- Tickets
- Admin and Configuration
- Audit
- AI Orchestration

Each module owns its writes and domain rules. Cross-module atomic workflows run through application services in one PostgreSQL transaction. Work that can happen after commit uses a transactional outbox and durable PostgreSQL job table.

Separate a module into a service only when it has a proven independent scaling, deployment, security, or availability requirement. Preserve its API, idempotency, audit, and ownership contracts during extraction.

## Sources of truth

PostgreSQL is authoritative for business state, financial state, authorization, sessions/revocation, idempotency, audit, outbox, and jobs.

Redis is optional and disposable. It may provide cache, distributed rate limiting, or short-lived coordination. Redis loss must not lose durable work, change a balance, grant access, or corrupt a state machine. Cache misses fall back to PostgreSQL.

S3-compatible object storage holds private files. Metadata, access control, scan state, and business relationships remain in PostgreSQL. Production should prefer managed object storage; MinIO is supported for development and controlled self-hosting.

## Data rules

- UTC `timestamptz` for instants; store business timezone/calendar metadata where required.
- Half-open ranges `[start, end)` for service periods.
- Integer IRR and fixed-precision decimal quantities/rates; no floating-point financial arithmetic.
- UUIDv7 for externally visible IDs.
- Database constraints and unique indexes enforce invariants.
- Transactions plus row locks/version checks protect wallet, payment, refund, and state transitions.
- PostgreSQL outbox provides at-least-once delivery; every handler is idempotent.
- Expand/migrate/contract schema changes keep rolling deployments backward-compatible.

## API and frontend

REST/JSON with generated OpenAPI documentation is the public application contract. The frontend or BFF contains presentation and transport logic only. Backend modules own authorization, calculations, pricing, and state transitions.

Use server-state request deduplication and targeted cache invalidation. Optimistic success is prohibited for financial, contractual, identity, permission, order-submission, or status-transition commands.

Use cursor pagination for large/changing lists, route-level code splitting, private caching rules for authenticated data, and immutable caching/CDN for public assets.

## Background processing

Workers handle notifications, document generation, file scanning orchestration, reconciliation, refunds, exports, provider callbacks, and AI tasks.

Jobs have priority, lease/expiry, attempts, bounded exponential backoff with jitter, idempotency key, and dead-letter state. Queue age and failures are monitored. A failed process can safely replay jobs.

Never keep a database transaction open across an external call. Persist intent, commit, call asynchronously, and apply the verified result through an idempotent command.

### Notification transports

The Notifications module owns a small transport interface implemented initially by SMTP, Resend, and SMS.ir adapters. Domain modules emit provider-neutral notification events to the transactional outbox. A worker resolves the versioned template and provider-configuration snapshot, then sends outside the business transaction. This keeps provider SDKs, retries, rate limits, and failure semantics out of product modules and permits a provider change without changing order, payment, or identity flows.

Provider secrets are encrypted and resolved only inside the sending worker. Resend and SMS.ir use application-controlled API origins; configurable SMTP destinations are validated and subject to deployment-level egress allow-lists. Provider callbacks pass signature/authenticity and replay checks before an idempotent status command is applied. Delivery IDs and unique constraints prevent duplicate logical sends.

Provider health is observable through queue age, attempts, latency, success/failure by provider and template, callback lag, bounce/complaint rate, and SMS credit when exposed. Alerts distinguish customer-data errors from configuration failure and provider outage. Provider configuration activation, rollback, test-send evidence, and outage/recovery procedures are included in the notification runbook and release readiness checks.

## Deployment

Pilot/low-traffic topology:

- Reverse proxy/load balancer
- One web process
- One API process
- One worker process
- PostgreSQL with automated backups and point-in-time recovery
- Optional Redis
- S3-compatible object storage with versioning

Web/API/worker may share one application VM. For production reliability, PostgreSQL and object storage should be managed or separated from the application VM when feasible. A one-server installation requires encrypted off-server backups and has a documented lower availability expectation.

Commercial production processing real payments and targeting 99.9% runs at least two stateless web/API replicas across two failure domains behind a managed load balancer, with redundant worker capacity. It still uses the same modular-monolith images and does not require Kubernetes or microservices. PostgreSQL uses automatic failover or a tested managed recovery path compatible with the RTO.

For capacity, scale vertically first. The commercial HA baseline may require two replicas before saturation; add further replicas and worker concurrency only after measured saturation or queue/SLO evidence. Do not split the application or database merely to scale HTTP processes.

Docker images are deployed through automated scripts/Ansible. Use readiness/liveness checks, graceful shutdown, smoke tests, backward-compatible migrations, and rollback. Routine releases should not require planned downtime.

## Reliability targets

- Pilot/single-host monthly availability target: 99.5%, without an HA commitment
- Commercial HA monthly availability SLO: 99.9%
- Ordinary API read p95: under 300 ms
- Ordinary API write p95: under 500 ms, excluding provider latency
- Mobile p75 LCP: under 2.5 s
- 99% of durable jobs start within 60 seconds; urgent/refund queues have priority
- PostgreSQL RPO: at most 5 minutes
- Core service RTO: at most 60 minutes

Provider failures create Pending/Retryable states and do not take unrelated modules offline. Use provider-specific timeouts, bounded retries, circuit breakers, bulkheads, and health metrics.

## Security

- Cookie sessions use `HttpOnly`, `Secure`, appropriate `SameSite`, CSRF protection, refresh rotation, device management, and server-side revocation.
- Customer access is scoped to `activeProfileId`; staff capabilities are explicit and sensitive commands require step-up authentication.
- Audit sensitive writes and denials without logging secrets or unnecessary PII.
- Use CSP, HSTS only after production TLS/subdomain verification, strict CORS allowlists, upload/content validation, dependency scanning, secret scanning, and encrypted secrets.
- AI tools use backend authorization and trusted-UI confirmation; model prompts never grant capabilities.

Cookie-authenticated state changes require a session-bound CSRF token in a custom header plus exact Origin validation. SameSite is defense-in-depth. CORS never combines credentials with wildcard origins.

Rate limits are layered by IP, account, user, profile, device, and action. Durable account/OTP abuse counters remain effective without Redis. Security-sensitive provider callbacks verify signatures, replay windows, merchant context, and server-side status and are processed idempotently.

The complete baseline—including authentication/session rules, CSP/browser headers, injection/SSRF/upload protection, initial rate-limit values, supply-chain checks, and verification requirements—is defined in README `Security baseline`.

## Observability and operations

Use structured logs, RED/USE metrics, OpenTelemetry-compatible traces, SLO burn alerts, provider metrics, PostgreSQL/pool metrics, queue age, unresolved refund count, and reconciliation mismatch count. Sample successful traces to control cost; retain errors and slow traces.

Maintain runbooks for payment/wallet mismatch, refund backlog, database recovery, storage outage, notification outage, credential compromise, and bad deployment. Test PostgreSQL and critical-file restoration at least quarterly.

OpenTelemetry is the vendor-neutral instrumentation standard. The preferred initial backend is a managed Grafana-compatible stack: Loki for logs, Prometheus-compatible metrics, Tempo/Jaeger-compatible traces, Grafana dashboards/alerts, optional Sentry for exception grouping, and an external synthetic-uptime provider. Self-host only when the team can operate it more reliably and economically.

## Testing and quality

- Vitest is the primary TypeScript unit/integration runner.
- React Testing Library covers component behavior and accessibility.
- Backend integration tests use the real NestJS app and real PostgreSQL.
- Playwright covers a small critical E2E suite; Chromium runs on PR/main and cross-browser coverage runs nightly/release.
- Provider behavior is replaced only at adapter boundaries with deterministic fake servers/signed fixtures.
- Critical financial, authorization, state-machine, Jalali, idempotency, and concurrency paths require executable tests.

PR gates include format/lint/typecheck, affected tests, PostgreSQL integration, migration validation, OpenAPI drift, production build, coverage, secret/SCA/SAST/license scans, and required domain reviews. Staging adds full integration, critical E2E, accessibility, container/SBOM, migration rehearsal, and provider contracts. Production promotion adds release E2E, DAST/performance smoke, backup/recovery health, rollout/rollback controls, dashboards/runbooks, and post-deploy verification.

The authoritative Definition of Done is in README `Definition of Done`. A change is not Done without applicable product/UX states, tests, security/privacy review, observability, migration/rollback safety, documentation, and staging verification.

## Cost policy

- Minimum process count and vertical scaling first
- PostgreSQL outbox instead of Kafka
- PostgreSQL search instead of Elasticsearch
- Redis only when it delivers measured value or required coordination
- Direct-to-object-storage file transfer with lifecycle policies
- Budgets/limits for AI, storage, exports, notifications, and expensive queries
- Monthly cost reporting by compute, database, storage/egress, Redis, observability, messaging, and AI

Prefer managed services when their operational simplicity and availability outweigh raw server savings. Do not self-host solely for a lower invoice when staffing and downtime risk are higher.

## Architecture decisions

Material decisions are documented as ADRs in `docs/adr`. An ADR states context, decision, alternatives, consequences, owner, and review trigger. Complexity-increasing decisions must include the measurement or SLO that requires them.
