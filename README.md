# Intro

Barghsa is an Iranian, AI-native energy platform for enterprise and individual customers.

Legal entities use Barghsa to purchase electricity and manage related contracts, invoices, payments, agents, and documents. Individual customers use saving services and can request consultation or construction services for solar power stations. Barghsa staff and admins use the same platform to manage customers, operations, contracts, finance, support, products, and system configuration.

Every supported action is available through the regular UI. The in-app AI assistant may answer questions from approved knowledge bases, retrieve authorized data, and perform explicitly permitted backend actions. AI actions use the same authorization, validation, confirmation, idempotency, and audit requirements as direct UI actions; the assistant never bypasses business rules.

## The branding

English title: Barghsa
Persian title: برقسا
Slogan: بازار هوشمند انرژی

## User base

We will have 3 type of users:

- customers. this group are the enterprise owners, looking to buy an affordable electricity. or home users looking for saving solutions. or both, looking to create a solar power plant. the customers can be owner of a legal entity, or an agent of legal entity. or they may just be an individual.
- staff. all categories of Barghsa staff. customer support, finance, legal, operations, etc,
- admins. they Barghsa staff, but with access to system settings.

technically all 3 type of users are same, just with different roles.

staff and admins will get a individual profiles assigned to them by the user who creates them. they can edit their individual profile, but can not add any other profiles. so the staff can only have one profile. the staff profile will be created as "verified" even if verification is not required. address is not required for staff.

any time we say "user" we mainly mention the customer users. but in some cases we might mean other, or all user types.

one staff user may have multiple roles.

### Authorization and data ownership

Authorization follows least privilege. Customers can view and act only on data belonging to their active profile. Staff can create and manage customer records only when one of their assigned roles grants that capability. Admins have all staff capabilities and exclusive access to system settings and role administration.

Customer business data belongs to a profile, not directly to the login user. This includes addresses, wallets, orders, consultation requests, contracts, invoices, payments, documents, and other business records. Authorized agents of a legal entity act on the same legal profile's data according to their entity role. Switching the active profile changes the business scope and must never expose another profile's data.

The initial staff roles are:

- Customer support: tickets, customer-visible comments, and read access needed to guide customers.
- CRM and verification: customer/profile management, verification, corrections, and invitations.
- Finance: invoices, bank receipts, offline payments, wallet top-ups, refunds, and financial reporting.
- Legal and contracts: contract preparation, review, versioning, approval, and signature workflows.
- Operations: service orders, fulfillment, delivery, installation, old-equipment handover, and operational documents.
- Admin: all staff capabilities plus role assignment, catalogs, prices, limits, templates, integrations, security-sensitive credentials, and system settings.

A staff user may hold multiple roles. Sensitive actions require explicit permission and must record the acting user. General staff access alone is insufficient.

## Goals of Barghsa

- Selling electricity to enterprises, company and industry owners.
- Offering saving solutions for home customers. e.g. replacing old AC motors with modern ones to save on energy use.
- Consulting and implementing solar power plants for customers, so they can genrate electricity power for their own use and also selling and creating an income. home customers and enterprise, both can use this sonsulting and service

## Product values

The very important values we want to deliver:

- We want customers to understand the price and expected value of buying from Barghsa. The UI must not make a fixed or unverified savings claim; any future saving estimate must disclose its data source, assumptions, calculation date, and limitations.
- Be fast: customers should complete common purchases with the fewest practical steps.
- Be clear: non-technical users should understand every flow, price, status, required action, and consequence.
- Be safe: financial, contractual, identity, and AI-assisted actions must be secure, auditable, recoverable, and resistant to duplication or misuse.

## Architecture

Technical decisions follow this priority order:

1. Simplicity: one codebase, few deployables, one primary database, clear ownership, and low operational burden.
2. Performance: fast user journeys and efficient database access before adding infrastructure.
3. Reliability and uptime: durable financial workflows, graceful degradation, tested recovery, and measurable service objectives.
4. Server cost: avoid infrastructure whose operational or hosting cost is not justified by measured load.

When priorities conflict, choose the simpler design unless it fails a defined performance or reliability target. Cost optimizations must never weaken financial correctness, backups, security, or recovery.

### Architecture style

- Use a TypeScript pnpm/Turborepo monorepo.
- Start with a NestJS modular monolith. Domain modules have explicit APIs and do not read each other's tables directly except through documented shared infrastructure.
- Use three application process types from the same repository: web, API, and background worker. API and worker should preferably use the same image with different startup commands; web may use its own image. Multiple replicas are deployment choices, not new services.
- PostgreSQL is the source of truth for users, profiles, authorization, orders, contracts, invoices, payments, wallet ledger, idempotency, audit, outbox, and job state.
- Redis is optional infrastructure for cache, distributed rate limiting, and short-lived coordination. Financial correctness, durable jobs, sessions, and authorization must remain correct if Redis is flushed or temporarily unavailable.
- Use S3-compatible object storage for files. Production should prefer a managed object store when available; MinIO is suitable for local development and controlled self-hosting.
- Use REST/JSON with OpenAPI as the external API. Generate or share validated TypeScript contracts from the API schema. Do not duplicate business logic in the frontend or BFF.
- Do not introduce Kubernetes, Kafka, Elasticsearch, a service mesh, CQRS/event sourcing, or microservices in the initial architecture. Adopt one only after measurements show that PostgreSQL, the modular monolith, or the current deployment topology cannot meet a documented SLO.
- Record architectural decisions and their trade-offs as short ADRs under `docs/adr`.

### Domain boundaries

Initial modules are Auth, Users/Profiles, CRM, Products, Orders, Consultations, Contracts, Invoices/Payments, Wallet, Documents/Storage, Notifications, Tickets, Admin/Configuration, Audit, and AI Orchestration.

Each module owns its domain rules and writes. Cross-module workflows use application services plus database transactions when synchronous atomicity is required, or a PostgreSQL outbox when work can happen after commit. Internal domain events are implementation details and do not require an external broker.

Extraction into a separate service is allowed only when a module has an independently measurable scaling, security, availability, or deployment need. Extraction must preserve idempotency, API contracts, ownership, and observability.

### Deployment strategy

The pilot/low-traffic topology is intentionally small:

- One reverse proxy/load balancer.
- One web process.
- One API process.
- One worker process.
- PostgreSQL with automated backups and point-in-time recovery.
- Optional Redis; the application must degrade safely when it is unavailable.
- S3-compatible object storage with versioning and lifecycle policies.

Web, API, and worker may run on one application VM at low traffic. Because reliability has higher priority than server cost, production PostgreSQL and object storage should be managed or hosted separately from that VM when feasible. A fully single-server deployment is supported for constrained environments, but must use encrypted off-server backups and must clearly document its lower availability.

Commercial production processing real customer payments and targeting `99.9%` must remove the application-host single point of failure: run at least two stateless web/API replicas across two failure domains behind a managed load balancer and provide redundant worker capacity. This still uses the same modular monolith and images; it does not require Kubernetes or microservices. PostgreSQL must provide automatic failover or a tested managed recovery path consistent with the RTO.

For capacity, scale vertically first. Horizontal replicas are introduced earlier when required for the commercial HA topology; add further replicas or worker concurrency only when CPU, memory, latency, queue age, or availability measurements justify them. Do not split the database or application into microservices merely to add replicas.

Deploy with Docker images and automated scripts/Ansible. Releases use health checks, graceful shutdown, backward-compatible migrations, and automatic rollback when readiness or smoke tests fail. Single-node deployments use start-new-then-switch where resources permit; multi-node deployments use rolling or blue/green deployment. Routine application releases should not require planned downtime.

### Data and consistency

- Store timestamps as UTC `timestamptz`; store the applicable timezone/calendar rule with business periods. Jalali and Gregorian are presentation/input calendars, not separate stored dates.
- Represent periods as half-open ranges `[start, end)` to avoid last-second and daylight-boundary errors.
- Store IRR amounts as signed 64-bit integers and quantities/rates as fixed-precision decimals; never use floating-point for financial calculations.
- Prefer UUIDv7 identifiers for externally visible entities to avoid enumeration while keeping index locality.
- Enforce invariants with database constraints and unique indexes in addition to application validation.
- Use transactions for wallet/invoice/payment mutations and row locking or optimistic version columns for concurrent state changes.
- Use a PostgreSQL transactional outbox and durable job table. Workers provide at-least-once delivery; handlers must be idempotent.
- Use expand/migrate/contract database changes. A deploy must remain compatible with the previous application version during rollout. Destructive migrations require a verified backup and a separately reviewed cleanup release.

### Service objectives and capacity

Monthly SLOs for core authenticated flows are:

- Pilot/single-application-host availability target: `99.5%`, explicitly without an HA commitment.
- Commercial HA availability target: `99.9%`, excluding announced maintenance and unavoidable upstream outages.
- API latency: p95 below `300 ms` for ordinary reads and below `500 ms` for ordinary writes, excluding third-party processing time.
- Core page experience: p75 LCP below `2.5 s` on a representative mobile connection.
- Durable background commands: 99% begin processing within `60 s`; urgent notifications and refund obligations receive higher-priority queues.
- Recovery point objective: at most `5 minutes` for PostgreSQL in production.
- Recovery time objective: at most `60 minutes` for core ordering, invoice, wallet, and contract access.

These are targets, not reasons to add infrastructure prematurely. Measure first, profile the database/query path, optimize code and indexes, scale vertically, then scale horizontally.

External providers have separate health and latency metrics and do not count as successful simply because Barghsa accepted a request. Provider outages must produce a Pending/Retryable state rather than blocking unrelated product areas.

### Product-wide operating principles

#### No dead ends

Every customer-facing workflow must always show the current state, what happened, the next available action, who is responsible, and how to get help. A customer must never be left on a disabled screen without an explanation or recovery path.

- Multi-step forms save a server-side draft after each completed step and can be resumed safely.
- Validation errors identify the exact field and how to correct it without clearing valid input.
- External-service failures provide Retry and Contact support actions and preserve the draft.
- If an action is waiting for staff, show `Waiting for Barghsa`, submission time, latest update, and the related ticket/comment channel.
- Rejection, cancellation, verification failure, or requested changes always include a customer-visible reason and the next allowed action.
- A failed payment, upload, notification, or background job is retryable and visible to the responsible team in a work queue.
- Terminal states remain readable and include their documents, financial outcome, history, and support access.

#### State machines and audit history

Orders, requests, contracts, invoices, payments, refunds, documents, wallet transactions, invitations, and verification cases use explicit state machines. Each transition defines allowed source states, target state, required permission, prerequisites, side effects, and notification behavior.

Every transition records the entity, previous/new state, actor or system process, timestamp, reason, correlation ID, and relevant metadata. Audit records are append-only and cannot be edited or deleted through application APIs. Invalid, stale, repeated, and out-of-order transitions are rejected safely.

Customer-facing history uses understandable labels rather than internal codes. Internal notes and customer-visible comments are separate; staff must deliberately choose visibility and are warned before posting sensitive information publicly.

#### Atomicity, idempotency, and concurrency

Every command that can create money movement or multiple related records requires an idempotency key. Database transactions protect local state changes; a durable outbox coordinates notifications and background work after commit.

- Order, contract, and initial invoice creation is atomic.
- Wallet debit and invoice settlement is atomic.
- Payment confirmation and wallet credit cannot be applied twice.
- Refund amount can never exceed confirmed paid amount minus completed refunds.
- Concurrent requests use locking or optimistic version checks so balances, capacities, and statuses cannot be overwritten.
- Retrying a timed-out request returns the original result instead of creating duplicates.
- Automated reconciliation compares gateway transactions, bank confirmations, invoices, refunds, and wallet ledger balances and creates finance exceptions for mismatches.

#### Customer transparency

Before any irreversible or financial action, show a review page with profile, service, quantities, dates, unit prices, discounts, VAT, total, payment source, contract implications, and cancellation/refund rules. The backend generates the authoritative values and returns the exact snapshot shown to the customer.

Every price or rule change has an effective date. Existing orders and contracts keep the snapshot that applied when they were submitted unless an explicit, versioned amendment changes them. Admin configuration changes are never silently retroactive.

All monetary values are stored as integer IRR. Percentage calculations use high precision internally and are rounded half-up to the nearest IRR at each final invoice line. Discounts are applied before VAT; VAT is calculated on the net taxable amount. The invoice stores inputs, rounding results, and totals so they can be reproduced later.

#### Secure administration

Staff and admin accounts require multi-factor authentication. Sensitive actions require recent step-up authentication, including role changes, storage/payment credentials, payment confirmation, refunds, contract cancellation, price changes, and session revocation.

Admins configure a dual-approval threshold in IRR. Refunds, manual financial adjustments, or bank-payment confirmations at or above that threshold require approval by a second authorized user who did not initiate the action. Emergency overrides require a reason, elevated permission, immediate alert, and audit review.

Secrets are encrypted, masked, never included in analytics or logs, and accessible only to the integration that needs them. Personal and financial data is encrypted in transit and protected at rest. Logs and support screens mask identifiers unless the role and task require full visibility.

#### Configuration safety

Admin settings are validated before activation and have Draft, Active, and Superseded versions. High-impact settings support preview and an effective time. The system records who changed what and provides rollback by activating a previous safe version, never by deleting history.

Invalid configuration must fail closed with an actionable admin alert. For example, an electricity product required by an ordering rule cannot be sold if it is inactive or has no price; customers see that ordering is temporarily unavailable and can contact support rather than reaching a broken checkout.

#### AI assistant safety

The AI assistant operates only as the authenticated user in the selected profile and receives the minimum data and tools required for the current task. Tool permissions are enforced by backend authorization, never by prompt instructions alone.

Read-only questions may run directly. Any write action first shows a structured preview. Financial transactions, order submission, contract acceptance/signature, refunds, identity changes, agent/role changes, and destructive actions require explicit confirmation in trusted UI and, where required, step-up authentication or staff approval. The assistant cannot confirm its own proposed action.

Tool calls, inputs, authorization decision, confirmation evidence, outcome, and correlation ID are audited. Knowledge answers distinguish source-backed facts from generated guidance. Retrieved documents and user content are treated as untrusted data and cannot override system policy or grant tools. Sensitive values are redacted from prompts, model logs, and analytics.

### UI and frontend

- Mobile first, responsive design.
- Full RTL support for Persian and LTR support for English.
- Meet WCAG 2.2 AA for keyboard navigation, focus visibility, contrast, labels, errors, screen readers, zoom, and reduced motion.
- Modern, slick, professional, enterprise gtade UI.
- Shadcn UI with "BASE UI".
- Full support for both Light and Dark themes across all pages and components.
- Flexible theming. the admin users must be able to set theme options on dashboard.
- Use TanStack Start. Server functions/BFF remain thin transport and rendering adapters; authorization, pricing, state transitions, and business logic live in backend modules.
- Use TanStack Query or the framework's equivalent for server-state caching, request deduplication, cancellation, and targeted invalidation.
- Optimistic UI is allowed only for low-risk, easily reversible actions such as marking a notification read. Payments, wallet changes, order submission, contract acceptance/signature, refunds, role changes, and status transitions show Pending until the authoritative backend response arrives.
- Code-split by route and lazy-load heavy editors, charts, AI UI, video tooling, and admin-only features. Avoid large client bundles on customer purchase paths.
- Use SSR only where it materially improves first load, public discoverability, or authenticated shell rendering. Do not add server-side data duplication or business logic for SSR.
- Use analytics through a provider abstraction. Google Analytics is optional and enabled only with the appropriate consent; operational product events are sent to Barghsa's own backend when correctness requires them.
- react-hook-form and zod everywhere that is needed. all forms must be validated.
- small animations.
- Animations must respect `prefers-reduced-motion` and never be required to understand status or complete an action.
- dates must be localized.
- In Persian, date selection and display use the Jalali calendar; in English they use the Gregorian calendar. Changing language changes representation only, never the underlying date.
- anywhere user has to select a date, there must be an appropriate localized date picker.
- time and date must be displayed in users timezone.
- all list pages must have sort, filter, search, pagination, and limit options. Use server-side filtering/sorting. Prefer cursor/keyset pagination for large or frequently changing datasets; offset pagination is acceptable for small admin tables.
- Public assets use immutable hashed caching and a CDN when available. Authenticated API responses containing profile or financial data are private and are never cached by shared proxies.
- Set frontend performance budgets in CI, including route JavaScript size and Core Web Vitals regression checks for the primary mobile flows.

### Backend

- NestJS modular monolith with PostgreSQL through Drizzle ORM.
- Use a bounded PostgreSQL connection pool and set statement, lock, and idle transaction timeouts. Avoid a connection per request.
- Every production query path has explicit projections, pagination, and appropriate indexes. Prevent N+1 queries. Review slow queries with `EXPLAIN (ANALYZE, BUFFERS)` using safe representative data.
- PostgreSQL full-text/trigram search is the default search engine. Do not operate Elasticsearch until search quality or measured scale requires it.
- Cache only data with a clear invalidation rule and measurable benefit. Prefer short-lived in-process caching for immutable configuration and Redis for shared cache only when multiple replicas require it. Cache failure must fall back to PostgreSQL.
- Rate limits use layered keys (IP, user, profile, action) and stricter policies for auth, OTP, payment, upload, AI, and expensive searches. Distributed enforcement may use Redis; critical abuse controls must fail safely.
- Generate OpenAPI documentation and client contracts in CI. Breaking API changes require a new version or a backward-compatible migration period.
- Return localized safe errors with stable codes and correlation IDs. Never expose stack traces or raw provider/database errors.
- Use cookie-based authorization with `HttpOnly`, `Secure`, appropriate `SameSite`, CSRF protection for state-changing requests, refresh rotation, device/session management, and server-side revocation.
- Apply CSP, verified-production HSTS where appropriate, secure CORS allowlists, upload validation, output escaping, dependency scanning, and secret scanning. Security headers are tested in CI.
- Audit all sensitive writes and authorization denials without logging secrets or unnecessary personal data.
- Third-party calls use strict timeouts, bounded retries with jitter, circuit breakers, and bulkheads. Never hold a database transaction open while waiting for a payment, SMS, storage, bill-data, or AI provider.
- AI calls are isolated from core API capacity with concurrency limits, per-model timeout and budget controls, and circuit breakers. Core ordering/payment remains available when AI is unavailable.
- Use unit tests for domain rules, integration tests against real PostgreSQL for persistence/transactions, contract tests for providers, and a small stable E2E suite for critical customer/staff journeys. Financial invariants, permissions, Jalali boundaries, idempotency, concurrent wallet operations, and recovery paths are mandatory tests.
- Use encrypted backups, point-in-time recovery, object versioning, and documented incident response. Restore PostgreSQL and critical files in an isolated environment at least quarterly and record measured RPO/RTO.

### Security baseline

Barghsa targets OWASP ASVS Level 2 for the whole application, with selected higher-assurance controls for authentication, staff/admin access, authorization, contracts, payments, wallet, refunds, file handling, and AI tools. Security is enforced at the edge, application boundary, domain layer, database constraints, and operational process; no single middleware is treated as sufficient.

#### Authentication and sessions

- Hash passwords with Argon2id using reviewed, benchmarked parameters and a per-password salt. Passwords and OTPs are never encrypted for later recovery.
- OTPs are random, single-use, short-lived, attempt-limited, stored as hashes, and invalidated after success or replacement. Responses do not reveal whether an account exists.
- Customer MFA is risk-based; staff/admin MFA is mandatory. Sensitive operations require recent step-up authentication.
- Use opaque or signed session identifiers in `HttpOnly` cookies. Production cookies use `Secure`, an explicit `SameSite` policy, narrow `Path`, and no broad `Domain` unless required. Local non-TLS development may disable `Secure` through an explicit development-only setting.
- Rotate the session identifier after login, MFA, password change, privilege change, and account recovery to prevent session fixation. Refresh tokens rotate on use; reuse revokes the token family and alerts the user.
- Sessions have absolute and idle expiration. Users can view and revoke devices/sessions. Password reset, staff disablement, ownership transfer, and suspected compromise revoke applicable sessions immediately.
- Never place access tokens, refresh tokens, OTPs, passwords, national identifiers, or financial secrets in `localStorage`, URLs, analytics, or client-visible logs.

#### CSRF, CORS, and browser protections

- Because authentication uses cookies, every state-changing `POST`, `PUT`, `PATCH`, and `DELETE` request requires a server-generated CSRF token bound to the authenticated session and sent in a custom header. Token validation is performed server-side.
- Validate `Origin` against an exact allowlist on state-changing requests and use `Referer` only as a fallback when appropriate. `SameSite` cookies are defense-in-depth and never the only CSRF control.
- Rotate CSRF tokens after authentication/session rotation. CSRF failures return a safe error and correlation ID and are logged as security events without leaking the expected token.
- CORS uses exact production origins. Credentialed CORS never uses `*`; allowed methods and headers are minimal. Preflight responses are cached conservatively.
- Deliver CSP through HTTP headers. Start in Report-Only during rollout, then enforce a nonce/hash-based policy without `unsafe-eval` and without broad `unsafe-inline`. Baseline directives include restrictive `default-src`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, and explicit `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, and `form-action` allowlists.
- Set `X-Content-Type-Options: nosniff`, a restrictive `Referrer-Policy`, appropriate `Permissions-Policy`, and clickjacking protection through CSP `frame-ancestors`. Enable HSTS only after TLS and subdomain impact are verified in production; do not enable preload casually.
- Prevent open redirects by accepting only relative same-origin destinations or explicit allowlisted HTTPS origins. Validate `postMessage` origin and schema. Do not use `eval`, `new Function`, string timers, `document.write`, or unsanitized HTML sinks.

#### Authorization and data isolation

- Authentication and authorization are separate. Every endpoint and worker command performs server-side capability checks plus active-profile/object ownership checks; UI visibility is not authorization.
- Centralize policy decisions so HTTP routes, background workers, AI tools, exports, file URLs, and admin actions use the same authorization rules.
- Prevent BOLA/IDOR by loading resources through both identifier and authorized profile/tenant scope. Public UUIDs reduce enumeration but never replace authorization.
- Staff permissions are deny-by-default and additive by role. High-risk commands require explicit capabilities and, where configured, dual approval.
- Changes to ownership, roles, verification, payout/refund destination, and protected identity fields record before/after values and trigger appropriate alerts.

#### Input, output, and injection safety

- Validate every request boundary with shared Zod/DTO schemas, explicit types, lengths, numeric ranges, enum allowlists, pagination caps, and unknown-field rejection for command payloads.
- Drizzle/query parameters must remain parameterized. Raw SQL requires review and must never interpolate untrusted strings. Dynamic sort/filter fields use allowlisted mappings.
- Render user/provider content as text by default. Rich text uses an allowlist sanitizer and isolated rendering policy. React escaping must not be bypassed with untrusted content.
- Do not pass untrusted input to shell commands. If a subprocess is unavoidable, use a fixed executable and argument array without a shell, with strict allowlists and resource limits.
- Outbound requests never accept arbitrary user-controlled destinations. Provider endpoints and webhooks use allowlisted HTTPS hosts, DNS/IP validation where needed, redirect limits, private/link-local/metadata blocking, timeouts, response-size caps, and network egress restrictions.

#### Rate limiting and abuse prevention

Rate limits are enforced at both edge and application layers. Return `429` with `Retry-After` and a localized recovery message. Limits use IP, account/username, user, profile, device, and action dimensions as appropriate. Critical account counters are durable in PostgreSQL; Redis may accelerate distributed counters but Redis loss must not remove critical protection.

Safe initial defaults are:

- OTP send: one per destination per 60 seconds, five per hour, and ten per day; stricter IP/device aggregate limits also apply.
- OTP verify: five failed attempts per issued challenge, then invalidate it.
- Login: progressive delay after five failed attempts per account-and-IP in 15 minutes; broad IP/device limits detect password spraying. Avoid permanent account lockouts that attackers can use for denial of service.
- Password reset/account recovery: five starts per account or destination per hour, with separate IP limits.
- Order/consultation submission: five per profile per minute plus duplicate/idempotency protection.
- Wallet top-up/payment/refund-sensitive commands: ten attempts per profile per minute, with stricter provider and anomaly controls.
- File upload authorization: twenty starts per profile per minute plus file-size, concurrent-upload, and storage quotas.
- AI: per-user/profile request, concurrency, token, and cost budgets, with stricter limits for tool-enabled actions.

Admins may tune limits within safe minimum/maximum bounds using versioned configuration. Security can apply temporary emergency rules without deployment, with owner, expiry, reason, and audit record.

#### Files, providers, and webhooks

- Use allowlisted extensions plus detected MIME/content validation, size limits, random object keys, malware scanning, private storage, and safe download disposition. Original filenames are metadata only and never become storage paths.
- Potentially active formats are downloaded as attachments unless an explicitly sandboxed preview pipeline renders a safe derivative.
- Payment, SMS, storage, and other callbacks verify provider signatures/secrets, timestamp/replay windows, event identifiers, expected merchant/account context, and server-side transaction status. Browser redirects are never proof of payment.
- Webhook processing is idempotent, stores the raw provider event securely when permitted, and returns quickly before asynchronous business processing.

#### Secrets, dependencies, and infrastructure

- Secrets come from a secret manager or protected deployment environment, not source control or frontend bundles. Support rotation with overlapping active/previous keys where the protocol permits.
- Pin dependencies with the lockfile. Automated software composition analysis, secret scanning, static analysis, and container scanning run in CI; findings are triaged by exploitability and production reachability.
- Production Node.js never exposes the inspector, never enables `insecureHTTPParser`, runs as non-root, uses read-only containers/filesystems where practical, and has explicit request/body/header/time limits at proxy and application layers.
- TLS terminates at a trusted managed edge or reverse proxy using modern protocols/ciphers. Proxy trust is configured to the exact hop topology rather than enabled globally.
- Security events and audit logs are protected from tampering, access-controlled, retained according to policy, and excluded from normal customer support exports.

#### Security verification and response

- Maintain a lightweight threat model for authentication, active-profile isolation, wallet/payment/refund, contracts/signatures, file upload, admin configuration, external providers, and AI tool execution. Update it for material flow changes.
- Critical/high vulnerabilities with a credible production path block release. Accepted risk requires owner, justification, compensating controls, expiry, and approval.
- Run dependency and static scans on every PR, targeted dynamic/API security tests in staging, and an independent penetration test before launch and after major authentication/payment/authorization changes.
- Maintain incident runbooks, key/token revocation procedures, evidence preservation, customer communication templates, and post-incident review. Security incidents must not be hidden inside ordinary error queues.

### Reliability and operations

- API and workers expose separate liveness and readiness checks. Readiness verifies only dependencies required to serve the process; a non-critical provider outage must not remove the whole API from service.
- Processes handle `SIGTERM`, stop accepting new work, finish or safely return in-flight work, release leases, and close connections before shutdown.
- Jobs use leases with expiry, bounded retry with jitter, maximum attempts, priority, and a dead-letter state. A dashboard shows queue age, failures, owner, and Retry/Resolve actions.
- Use a circuit breaker for each external provider. When a provider is unavailable, accept and queue safe asynchronous work or show a recoverable Pending state; never report a false success.
- PostgreSQL outbox rows are written in the same transaction as the business state. Outbox processing is monitored for oldest-unprocessed age and can be replayed safely.
- Keep a runbook for payment mismatch, wallet mismatch, refund backlog, database failover/restore, object-storage outage, notification outage, credential compromise, and bad deployment.
- Define maintenance mode per capability rather than for the whole application. For example, temporarily disable new electricity checkout while customers can still log in, view contracts, download documents, and access refunds/support.
- Run synthetic checks for login, a safe read-only authenticated flow, and public health. Do not create real financial records in uptime checks.

### Observability

Use OpenTelemetry as the instrumentation standard so telemetry backends remain replaceable. The recommended initial stack is:

- OpenTelemetry SDK in web server, API, and worker processes.
- Structured JSON logs shipped to Grafana Loki or a compatible managed log service.
- Prometheus-compatible metrics visualized and alerted through Grafana.
- OpenTelemetry traces stored in Grafana Tempo or Jaeger-compatible storage.
- Sentry, or an equivalent, for high-value frontend/backend exception grouping and release correlation. Do not duplicate all logs in Sentry.
- A managed uptime/synthetic-check provider outside Barghsa infrastructure.

For simplicity and uptime, prefer Grafana Cloud or another managed OpenTelemetry-compatible backend during early production rather than operating a full observability cluster. A low-cost/self-hosted Grafana stack is acceptable when the team can operate and back it up. Application instrumentation and dashboards must not depend on a single vendor.

- Emit structured JSON logs with timestamp, level, service/process, environment, request/correlation ID, actor/profile IDs in pseudonymous form, route/job, duration, and outcome.
- Collect RED metrics for APIs (rate, errors, duration), USE metrics for infrastructure (utilization, saturation, errors), database pool/query metrics, queue age/depth, provider latency/failure, and business safety metrics such as unresolved refunds and reconciliation mismatches.
- Use OpenTelemetry-compatible tracing across HTTP, database, outbox, worker, and external-provider boundaries. Sample ordinary successful traces and retain all errors/slow traces to control cost.
- Alert on user impact or risk, not raw noise. Alerts have severity, owner, runbook, deduplication, and escalation. Critical alerts include payment/refund duplication risk, ledger mismatch, backup failure, outbox backlog, elevated auth failures, and SLO burn.
- Error tracking may use Sentry or an open-source equivalent, with PII scrubbing and environment-specific sampling.

Minimum dashboards are Executive SLO, API health, PostgreSQL/pool, Worker/outbox, External providers, Authentication/security, Payments/wallet/refunds, Storage/uploads, Notifications, and AI usage/cost.

Initial retention defaults balance diagnosis and cost: searchable application logs for 30 days, metrics for 13 months at downsampled resolution, ordinary sampled traces for 7 days, error/slow traces for 30 days, and immutable audit/security/financial evidence according to its longer legal retention policy. Admins may change operational retention without weakening audit requirements.

Production release markers are sent to dashboards and error tracking. Every alert links to its dashboard and runbook. P1 alerts page the on-call owner; P2 creates a time-bounded operational task; P3 is reviewed during working hours. Alert delivery itself is monitored by a dead-man check.

### Performance engineering

- Establish query and route budgets before load testing. Capture p50/p95/p99 latency and throughput with realistic Persian/English payloads and production-like indexes.
- Load-test electricity price preview, order submission, wallet payment, invoice lists, CRM search, file upload authorization, and notification fan-out before launch and after material changes.
- Protect the database with request timeouts, pool limits, query cancellation, pagination caps, and concurrency limits for exports/reports.
- Run exports, document generation, media processing, notifications, reconciliation, and AI work asynchronously. Return a job ID and visible progress instead of holding an HTTP request open.
- Upload/download large files directly between the browser and object storage using short-lived scoped URLs after backend authorization. The API records metadata and controls scan/publication state without proxying large bodies unless required.
- Use CDN/browser caching only for public/static assets. Prefer ETags and conditional requests for safe metadata; avoid caching rapidly changing balances, invoices, permissions, or contract states.

### Cost controls

- Start with the minimum production process count and scale from measured utilization. Prefer vertical scaling before horizontal scaling.
- Do not operate infrastructure that PostgreSQL can adequately replace: use PostgreSQL outbox instead of Kafka, PostgreSQL search instead of Elasticsearch, and a durable job table instead of a separate queue broker initially.
- Redis is optional and small; do not use it as a second source of truth. If one replica and current load do not benefit from Redis caching, use it only where rate limiting/coordination requires it.
- Apply object-storage lifecycle policies for temporary uploads, generated previews, superseded non-regulated files, and incomplete multipart uploads. Never expire records under legal hold.
- Set per-profile and global limits for AI tokens, file size/storage, report generation, bulk exports, notification fan-out, and expensive searches. Limits return actionable messages and staff override paths.
- Track monthly cost by application compute, PostgreSQL, object storage/egress, Redis, notification providers, observability, and AI provider/model. Alert on material variance from budget and expose unit costs such as cost per active profile/order.
- Prefer open standards and replaceable provider adapters, but do not self-host a managed capability solely to save license cost when operational staffing and downtime would cost more.

### Test strategy

Use one primary TypeScript test runner across the monorepo: Vitest. Use React Testing Library for component behavior and Playwright for browser E2E. Backend integration tests boot the real NestJS application against a real PostgreSQL test database. SQLite and in-memory database substitutes are not accepted for persistence tests because they do not reproduce PostgreSQL transactions, constraints, locking, or SQL behavior.

#### Unit tests

Unit tests cover pure domain behavior quickly and deterministically:

- State-machine transitions and guards
- Pricing, VAT, discount, rounding, electricity composition, and date/calendar calculations
- Authorization policy decisions
- Idempotency and refund-amount calculations
- Validation and normalization
- Provider response mapping and error classification

Unit tests do not mock implementation details or assert private methods. Time, UUIDs, randomness, and provider clients are injected or controlled. Financial examples from the product requirements become executable table-driven tests.

#### Component and frontend integration tests

React Testing Library tests user-visible behavior, accessibility roles/names, validation, loading/error/empty states, RTL/LTR, permission-dependent actions, and recovery paths. They avoid snapshot-only testing and do not test third-party component internals.

Frontend API behavior uses typed contract fixtures or MSW-like network interception at the HTTP boundary. At least one test covers every critical form's preservation of valid input after a server validation or provider error.

#### Backend integration tests

Integration tests use real PostgreSQL and verify migrations, constraints, transactions, locking, profile scoping, audit/outbox writes, and idempotent retries. Provider calls are replaced only at the adapter boundary with deterministic fake servers or signed webhook fixtures.

Mandatory concurrency tests include simultaneous wallet payments, duplicate provider callbacks, duplicate bank confirmation, concurrent refund workers, repeated order submission, ownership/role changes during a request, and competing state transitions.

#### E2E tests

Playwright covers a deliberately small set of critical journeys rather than every edge case:

- Registration, verification, login/MFA, recovery, and session revocation
- Individual and Legal onboarding plus profile switching/isolation
- Legal-agent invitation and role permissions
- Simple and advanced electricity order, wallet funding, bank receipt, payment, staff review, contract rejection, and automatic refund
- Saving-plan order, agreement, invoice, progress, documents, comments, and cancellation request
- Consultation pricing and payment
- Solar construction request, document revision, postal progress, and contract creation
- Contract version acceptance/signature and adjustment invoice
- Admin configuration changes with effective versions and rollback

PR E2E runs use Chromium for speed. Scheduled nightly and release-candidate suites run critical flows on Chromium, Firefox, and WebKit, plus representative mobile viewports. Persian/RTL is the primary E2E locale; English/LTR has dedicated smoke and calendar tests.

Tests use isolated accounts/profiles and deterministic seed data. Parallel workers receive isolated database schemas or databases. E2E never calls production payment, SMS, email, storage, bill-data, or AI providers.

#### Non-functional tests

- Accessibility: automated axe-style checks on critical pages plus manual keyboard/screen-reader review for new complex flows.
- Security: static analysis, dependency/secret/container scans on PR; authenticated API/DAST checks in staging; targeted tests for CSRF, CORS, BOLA/IDOR, rate limits, file upload, open redirect, SSRF, webhook replay, and session rotation.
- Performance: route/query benchmarks and production-like load tests for the critical paths defined in Performance engineering.
- Reliability: failure-injection tests for provider timeouts, Redis loss, worker crash/replay, duplicate delivery, and database connection exhaustion in staging or an isolated environment.
- Recovery: scheduled backup restore and object recovery tests; reconciliation tests use deliberately inconsistent fixtures.

Coverage is a guardrail, not the objective. Changed code must maintain at least 80% line and 75% branch coverage. Auth, authorization, payments, wallet, refunds, pricing, contracts, and state-machine domain packages target at least 90% line and 85% branch coverage. An exception requires technical justification and reviewer approval; high coverage never compensates for missing behavioral scenarios.

### Quality gates

#### Pull request gate

Every PR must pass:

- Formatting and linting
- TypeScript type checking with no new suppressed errors
- Unit and component tests for affected packages
- Relevant PostgreSQL integration tests
- Migration validation on a clean database and an upgrade-path database
- OpenAPI generation and client/schema drift check
- Production build and route bundle budget
- Changed-code coverage thresholds
- Secret scan, dependency/SCA scan, SAST, and license-policy check
- No unresolved Critical/High security finding with a credible path in changed production code
- Required review from the owning domain; Finance/Security/Legal review is required when their protected rules change

#### Main/staging gate

After merge and before a release candidate:

- Full unit and PostgreSQL integration suites
- Critical Chromium E2E suite
- Accessibility automation
- Container image build, vulnerability scan, and SBOM generation
- Smoke deployment with readiness/liveness checks
- Migration rehearsal against a production-like schema/data volume
- Provider contract tests using sandbox/fake endpoints
- No P0/P1 defect and no unexplained flaky critical test

#### Production promotion gate

A production release requires:

- Successful release-candidate E2E across required browsers for affected critical flows
- Security/DAST and performance smoke within budgets
- Backward-compatible migration and verified rollback/roll-forward plan
- Recent successful backup and healthy restore-test status
- Feature flag/kill switch for a high-risk rollout where practical
- Release notes, customer/support impact, owner, monitoring dashboard, alert/runbook links, and on-call coverage
- Automated post-deploy smoke tests and SLO/error comparison against the previous release

Use canary or gradual flag rollout for high-risk payment, wallet, authorization, contract, and pricing changes. Automatically halt or roll back on smoke failure, elevated error/SLO burn, reconciliation mismatch, or security alert.

#### Scheduled quality gates

- Nightly: full critical E2E, cross-browser rotation, dependency/security scan, dead-link/schema checks, and flaky-test report.
- Weekly: representative load/performance regression, critical-domain mutation testing where useful, and dependency update review.
- Quarterly: PostgreSQL/object restore exercise, disaster-recovery rehearsal, access review, threat-model review, and incident/runbook exercise.

A flaky test is treated as a defect. See [`docs/flaky-test-quarantine.md`](docs/flaky-test-quarantine.md) for the full quarantine process: owner, issue link, expiry, and equivalent temporary coverage. Quarantined critical tests cannot silently allow production promotion.

### Definition of Done

A product story, bug fix, or technical change is `Done` only when all applicable items below are complete. `Done` means safely deployable; it may remain disabled behind an owned, expiring feature flag. `Released` additionally means enabled in production and verified after deployment.

#### Product and UX

- Acceptance criteria and business rules are implemented and accepted by the product owner.
- Happy path, validation, loading, empty, permission-denied, provider-failure, retry, cancellation, and terminal states are designed and implemented.
- The user always sees current state, next action, responsible party, and support/recovery path.
- Persian and English copy is complete; RTL/LTR, Jalali/Gregorian, timezone, IRR, and responsive behavior are verified where applicable.
- Accessibility requirements are met, including keyboard use, focus, labels, errors, contrast, and reduced motion.

#### Engineering

- Code follows module ownership and contains no unnecessary new infrastructure or duplicated business logic.
- API/schema, database constraints/indexes, idempotency, concurrency control, audit, and outbox side effects are implemented where applicable.
- Migrations are backward-compatible, tested from the currently deployed schema, and include data migration/cleanup and roll-forward guidance.
- No temporary secret, debug endpoint, production inspector, unsafe feature bypass, or unowned TODO remains.
- Code is reviewed by the appropriate domain owner and all review comments are resolved.

#### Tests and quality

- Unit tests cover domain rules and edge cases.
- Integration tests cover persistence, transactions, authorization, audit/outbox, and failure/retry behavior.
- Critical user-flow changes include or update Playwright E2E coverage.
- Relevant accessibility, security, performance, concurrency, and recovery tests pass.
- Coverage and all applicable PR/staging quality gates pass without an unapproved exception.
- Bugs fixed in production include a regression test that fails before the fix and passes after it.

#### Security and privacy

- Threat model and data classification are updated when the trust boundary, sensitive data, provider, permission, or financial flow changes.
- CSRF, CORS, rate limits, object-level authorization, validation, output safety, secrets, logging/redaction, file/provider safety, and session behavior are reviewed as applicable.
- No unresolved Critical/High vulnerability or expired risk acceptance applies to the change.
- Analytics, telemetry, notifications, and audit events contain no prohibited secrets or unnecessary PII.

#### Operations and release

- Structured logs, metrics, traces, business-safety metrics, dashboards, and actionable alerts exist for new critical behavior.
- Timeouts, retries, idempotency, circuit-breaker behavior, queue priority, and dead-letter handling are defined for external/asynchronous work.
- Performance stays within the declared budgets or an approved remediation plan exists before release.
- Configuration defaults, feature flag owner/expiry, support documentation, runbook, and rollback/kill-switch procedure are complete.
- Documentation, OpenAPI, ADR, architecture/product requirements, and customer/support instructions are updated where applicable.
- The change has been deployed to staging, smoke-tested, and has a named production owner and post-release verification plan.

Exceptions to Definition of Done require written scope, risk, compensating control, owner, approver, and expiry. An exception cannot waive financial correctness, authorization, auditability, backup/recovery, or a credible Critical security issue.

## Authentication

### Layout

All auth pages, share same layout.
2 columns. the first column displays brand details (logo, title, slogan, some values we offer).
second column displays the form.

### Register

in the "/register" page, user should be able to enter a username. The username must be a valid email address or mobile number. whith a placeholder saying "Email or Mobile number". if user is entering mobile number, we assume it is an Iranian mobile number, unless they enter it as "E.164" format. we do not want to display 2 fields for the username. just one field, that infers the username type by user's input. The backend only accepts "E.164" mobile number, so frontend must format the number before sending the data to backend.

We will also have a password field. user have to enter a password to register. the field must have a visibility toggle button.
A password strength meter is required here. hidden by default, but when user focuses on password field, the strength field will appear and stay in UI.

we also need a text here, sth like this: "By registering, I accept terms of use and policies" with link to the tos page. the admin users should be able to change the content of TOS page.

also we need links like "back to login" and "forget password?".

when user clicks on register button, we send a request to backend and it will check the correctness of username, and its avalability. and will create and send a secure 6 digit OTP code to user's email or mobile number. in DEV environment, the otp code must be printed to the console of backend process.

user enters the OTP, and if it is correct, will redirect to "/app".

in the OTP step, we should diplay the OTP resend button. the OTP can be requested every 60 seconds.

### Login

the "/login" page must display a username field with exact condition as register page.

also the password field with visibility toggle.

the mobile number will be sent to backend in "E.164" format.

if credentials are correct, server side will decide if otp validation is required or not. the otp is required on new devices. use best security guidelines here.

if server enforces the OTP, then will display OTP input. with possibility to resend, in 60 seconds.

Customer MFA is risk-based and mandatory on a new or suspicious device. Staff and admin MFA is mandatory on every new device and step-up authentication is required again for sensitive actions. Device trust is revocable, time-limited, and visible in device management.

after successfull login, user will redirect to "/app".

user might be forced to change password. in this case, display the new password form, and when user saves the new password, display the login page again. enforced user can not login to the app without changing password.

### Forget password

display a link to go back to login page.
User has to enter their username. an otp validation happens, then user can set new password.
after reseting the passwors, user must see the login page.

Password reset invalidates all existing sessions and refresh tokens for that user. OTP and reset responses must not reveal whether an email or mobile number is registered. OTPs are single-use, expire after a short admin-configurable period, have attempt and resend limits, and are stored only as secure hashes. Account recovery always offers a support path when the user no longer controls the registered destinations; support recovery requires identity verification and full audit history.

### TOS

a simple page, displaying the content of Terms of Service agreement.
admin users can edit content of this page.
the date of last update must be visible.

TOS content is versioned with publish date and language. Registration stores the exact accepted version, timestamp, user, IP/device metadata where legally appropriate, and consent evidence. Publishing a materially changed mandatory version can require re-acceptance at the next safe entry point without blocking access to account recovery, support, or legally required records.

### Onboarding

every customer can have multiple profiles.
a profile has a type: LEGAL or INDIVIDUAL.
if user does not have any profiles, they will be redirected to this page.
they must first select the profile type they want to create. then add some information about the profile.
if user selects INDIVIDUAL, they will have to prvide just the individual profile data. but the legal ones, will have to fill both.

for individual:

- title (Doctor, Mr, etc. user can type in this field)
- first name (required)
- last name (a separate field in UI and DB. do not merge with first name) (required)
- Province (a selectable list of Iranian provinces fetched from API) (required)
- City (a selectable list of cities in selected province fetched from API) (required)
- Full address (required)
- Postal code (required)
- National ID number (required)

for legal:

- Legal name (required)
- National identifier / شناسه ملی (required and unique among active legal profiles)
- Registration number (required)
- Company/entity type (required)
- Registration date (optional initially)
- Economic code (optional initially, required by a service when needed for invoicing or compliance)
- Official phone and email (optional)
- Official province, city, full address, and postal code (required)
- Authorized representative's title and relationship to the entity (required)
- Optional official-gazette or registration document uploads

Fields whose legal requirement may change are configuration-driven, but identity keys and historical snapshots cannot be silently changed after verification. Staff can request corrections through a verification case rather than editing verified identity data without trace.

The user that creates the legal profile, is set as owner of that legal entity. later they can assign some individuals as their agents.

(The address info must be saved in addresses table and linked to the profile. in both individual and legal profiles).

after creating the profile(s), user will be redirected to "/app".

## App

the very first thing in app page, is checking if user has any profiles or not. if not, redirect to "/onboarding".
if user has multiple profiles, they must select one of them as default and that one will be selected in DB as well.
if the currently selected profile is not verified yet, but system settings are enforcing the verification, then we must notify the user about the verification status. display a auto verify button if verification method is set to 'api'.
also possibility to change or create a new profile and use ticketing system.
if verification is required and the active profile is not verified, new commercial orders are blocked. The user can still access profile correction/verification, invitations, notifications, tickets/support, security settings, existing records, and financial/refund information. The blocking screen explains the reason, required documents or action, status, and support path.

#### Dashboard

Overview of everything related to current profile.

If current profile is invited by a legal entity owner to join them, then a info message must be clearly displayed on top of the dashboard. user can see legal entity details and the individual who has invited them, and can accept or reject.

##### Profiles awaiting manual verify

if profile verification is not set to disabled, display a short list of profiles waiting to be verified.
also display a "show all" button to redirect to CRM with filter of not verified customers.

#### Addresses

Customers only. user can manage their addresses and select one as main address.
the address created in onboarding time, will be also displayed here as main address. changing the main address will also change the address assigned to the profile. only one address can be selected as main.
addresses must be filtered only for current selected profile.

#### CRM

A list of all users registered in system.

displaying a column with label "legal" and one as "individual". so user can understand if a user has which profiles available.

only staff and admin can see and manage this section.

user can use sort, filter, search in this page. filter by profile type, verification status, etc.

user can select a profile and open its page. in this page will see all details about a user. profiles list wth their details, last login, last password change time, etc.

user can change the verification state of a profile, mark user as required to chnage password at next login, expire all current sessions, update profile info, create or delete a profile. etc.

Authorized staff/admin users can create a new user. Prefer a time-limited activation link or one-time temporary password delivered through a verified channel. If staff set a temporary password, it is never shown again, expires, and forces password change plus identity verification at first login. Staff cannot retrieve or view any user's password.

#### Agents management

For customers whome active profile is a legal entity, and is owner or has manager role in the legal entity.

the user can see list of users who are invited to join or already joined their legal entity.

can withdraw a pending invite.

can invite a user based on their mobile number or email address.

can invite a user who is not even registered yet. any user who registers with the invited username, will see the invite details.

the user can not see if the inviting user is already registered or not.

when inviting an agent, the user must select a role: manager, finance, legal.

if the inviting user is already registered, a notification must be sent to them.

Legal-entity permissions are:

- Owner: full customer-side control of the legal profile, including agents, orders, contracts, invoices, wallet, addresses, and cancellation requests. Ownership transfer requires step-up authentication, acceptance by the new owner, and audit history.
- Manager: operational customer-side access, including addresses, orders, consultation requests, documents, comments, quantity-increase requests, and inviting/removing non-owner agents. A manager cannot transfer ownership or change protected identity fields.
- Finance: view invoices, wallet, payments, receipts, refunds, and financial documents; charge the wallet and submit bank receipts. Finance cannot accept/sign contracts unless also assigned Legal or Manager.
- Legal: view, accept, sign, reject, and request changes to contracts and legal documents. Legal cannot move wallet funds unless also assigned Finance or Manager.

Owner and Manager can register electricity orders. An order clearly records the submitting agent. Permissions are additive when an agent has multiple roles. Removing an agent immediately revokes new access but preserves their historical authorship. A legal profile must always have exactly one active owner; the last owner cannot remove themselves without completing ownership transfer.

If a user is both Barghsa staff and a customer/agent, staff context and customer profile context are visibly separated. Privileged staff actions cannot be performed while operating in customer context, and customer actions cannot inherit staff permissions.

#### Profile and user settings

user can see their profile details here. some details may not be editable if they are customer already verified. staff can always update their own details.

users can change the mobile number or email they have as username but that requires availability check and otp verify.
if they have registered with email they can add and verify a mobile number.
if they are registered with mobile number, they can add one new email address.

if a user has both mobile and email, they can login with either of them.

user can select notification channels:

- SMS (if mobile number present)
- Email (if present)

user can change their timezone. it is by default set to Iran Standard Time (IRST) is UTC+3:30.

#### Ticketing

all users can access this section.
Standard ticketing system with minimum set of features.

#### Admin features

- Branding configurations
- edit TOS content
- manage list of provinces and cities in each province
- settings for profile verification: "disabled", "manual", "api".
  - disabled: no need to verify the user profiles.
  - manual: Barghsa staff will need to manually verify user profiles.
  - api: the craete profiles will automatically be verified via official APIs.
- Notifications templates edit
- manage staff roles and permissions
- manage consultation, electricity, hardware, and saving-plan catalogs
- configure VAT by charge category or product override
- manage public and profile-restricted gift codes
- configure contract templates and customer electricity-increase limits
- configure secure file storage and upload policies
- configure notification daytime windows and delivery providers
  - configure the active email transport as SMTP or Resend
  - configure SMS.ir credentials, sender/line, and event-to-template mappings
  - test a draft provider configuration before activation and roll back to a previous working version
- configure dual-approval financial thresholds and review queues
- configure service response targets, staff teams, assignment rules, and escalation alerts
- view reconciliation exceptions, failed background jobs, dead-letter notifications, quarantined files, and unresolved refund obligations
- electricity ordering settings:
  - per-transaction online wallet top-up limit in IRR; default `2,000,000,000` IRR
  - simple-order mandatory green-electricity rule, enabled by default
  - advanced-order mandatory green-electricity rule, disabled by default
  - average-power threshold for mandatory green electricity; default `1,000 kW`
  - mandatory green-electricity share; default `4%`
- AI orchestration settings
  - manage AI models (models have some basic data e.g. title, base url, model name, api token, provider type, etc.). models pages will have a test button that checks the connection and displays the response to make sure that is reachable.
  - manage knowledge bases and KB groups.
  - manage policies and policy groups.
  - manage AI agents. admin can create and manage agents here. the agent has a title, reference to an existing model, linked to some knowledge bases, or knowledgebase groups as well as policies and policy groups. a small chat UI will be present here, so user can test the integration of model and KBs and policies.
  - We will have some agent slots by default. Individual chatbot, Legal Entity Chatbot, Staff chatbot, website chatbot, telegram chatbot. the admin will have to choose an agent for each slot. one agent can be used in multiple places.

#### Documents templates

- all staff and admins can access this section.
- user can create a new template and upload some document files into it.
- the documents uploaded here will have some placehlders in them. e.g. "{{date}}".
- the document templates can be updated, and it's files can be deleted or new files can be added. every change in files will create a new version of the template.
- all placeholders inside the document template hould be extracted in upload time and stored in DB.

#### Documents

- accessible by all staff and admins.
- users will see all documents here. docs are usualy generated from a template, or uploaded by users (maybe customers, maybe staff).
- each document is assigned to a contract or an invoice.
- documents use Uploading, Pending scan, Available, Submitted for review, Approved, Rejected, Superseded, Quarantined, and Removed as applicable. Storage/scan state is separate from business review state.
- a document might be linked to an older doc. for example a contract document is created, offerd to customer, customer asked for some changes, new document created or uploaded, offered to customer, customer accepted the offer, customer uploaded the signed version, document signed by staff and final version uploaded. you see we have multiple documents here. each of them have a state, related to a contract, also it is visible that the document is result of some changes on another document.
- staff users will be able to download any document available here.

Download permission still follows least privilege and record ownership; being staff alone does not grant access to every file. Signed and approved contract documents are immutable. Replacement creates a new version linked to the superseded document. A rejection requires a reason and leaves the customer a clear Replace action.

#### Contracts

Contracts may be created for saving services, solar power stations, electricity supply, and other services. A contract belongs to a customer profile and can be linked to its originating request/order, documents, versions, amendments, and invoices.

The minimum contract lifecycle is:

- Draft
- Awaiting staff review
- Changes requested
- Awaiting customer acceptance
- Accepted
- Awaiting signature, when required
- Signed
- Active
- Completed
- Cancelled

Not every service requires every intermediate state, but all transitions must be validated and auditable.

Customers accept the exact current version using an explicit action. When a handwritten signature is required, the customer may print, sign, and upload the document. Authorized staff may upload a signed document received through another approved channel, but the record must identify the uploader and must not imply that staff signed for the customer.

Every material edit creates a new immutable contract version. Previous versions, documents, creator, timestamps, change description, and acceptance state remain available. Unless a service-specific rule below says otherwise, a material edit after acceptance requires renewed acceptance and, when applicable, a new signature.

Customers cannot cancel contracts directly. Only authorized staff can cancel a contract, including an active contract when the business decision requires it. Cancellation requires a reason and an explicit refund decision. Staff may define a partial refund amount; the refund can be credited to the profile wallet or processed externally. The cancellation, selected refund method, amount, actor, and resulting transactions must be auditable.

Activation is flexible by contract type. At minimum, internal approval and customer acceptance are required. A type may additionally require signature confirmation, payment of a specified invoice, or another explicit prerequisite. Unmet activation requirements must be visible.

The standard transition path is `Draft → Awaiting staff review → Awaiting customer acceptance → Accepted → Awaiting signature → Signed → Active → Completed`. `Changes requested` can return to Draft through a new version. `Awaiting signature` is skipped when the contract type does not require a signed document. Cancelled and Completed are terminal; corrections use an audited administrative reversal rather than reopening them silently.

Payment and contract review are separate facts. Paying an invoice does not by itself mean that a contract is approved or active. Each contract details page shows Staff approval, Customer acceptance, Signature, Payment, and Service start as separate prerequisites with their current state.

Customers can submit a cancellation request with a reason and preferred refund destination but cannot cancel directly. Staff must resolve the request as Approved or Rejected with an explanation. Approved cancellation uses the refund workflow; rejected cancellation leaves the contract unchanged and provides a support/comment path.

#### Invoices

An invoice represents one or more products, services, or charges payable by a specific customer profile. It may be linked to a contract, order, consultation, or issued directly by staff without a contract. Staff can create manual invoices with any required number of custom description-and-price lines. Service workflows can generate invoices automatically.

All invoices are denominated in Iranian rials (`IRR`). The current product policy is full upfront settlement: an order creates one initial invoice for its complete amount, and the customer does not receive an installment schedule. A later signed amendment or authorized price adjustment may create a clearly linked adjustment invoice or credit/refund; it is not an installment of the original order. General installment schedules remain a future capability.

Invoices cannot be paid directly through an online gateway. For an online-funded payment, the customer first charges the active profile's wallet and then pays the invoice from that wallet in one full wallet debit. Each online wallet top-up is subject to the admin-configured transaction limit, whose default is `2,000,000,000 IRR` (two hundred million toman). A large invoice can therefore require multiple wallet top-ups before the wallet has sufficient available balance, but the invoice payment itself remains a single full settlement.

Bank payments have no transaction limit. A customer may submit one or more bank payments or receipts toward the same invoice, and authorized finance staff confirm or reject each one. These are funding allocations toward one upfront invoice, not scheduled installments. The invoice becomes Paid only when confirmed bank allocations reach the full amount; until then it remains Unpaid, Payment under review, or Partially funded as applicable.

Payment operations must be idempotent. Processing the same wallet top-up provider transaction, wallet debit, or bank receipt more than once must not credit the wallet or increase the invoice's paid amount twice.

The initial invoice states are Draft, Unpaid, Payment under review, Partially funded, Paid, Overdue, Cancelled, Partially refunded, and Refunded. Passing the due date marks an invoice Overdue but initially causes no automatic penalty, contract cancellation, or service suspension.

Issuing an invoice notifies the customer. Customers see only invoices belonging to their active profile. Authorized finance staff confirm or reject bank receipts with a reason; rejection notifies the customer and does not count toward settlement.

Default payment reminders are sent in-app and through the customer's enabled transactional channel seven, three, and one day before `dueAt`, on the due date, and one and seven days after it while the invoice remains unpaid. Admins can enable/disable individual offsets by service type. Reminders use daytime delivery rules, are idempotent per invoice/offset/channel, and stop immediately when the invoice is Paid, Cancelled, or Refunded. The initial version applies no automatic penalty or service suspension; staff handle exceptional overdue cases manually with an audited customer-visible note.

Admins configure default invoice due periods by service type. Each invoice stores `issuedAt`, `payableFrom`, and `dueAt`; staff may override the due date with permission and a customer-visible reason. An overdue invoice remains payable unless explicitly Cancelled. There are no automatic late fees or service suspension in the initial version.

Bank receipts record amount, payment date, payer/reference data, attachment, and customer note. Staff cannot confirm an amount greater than the invoice's remaining balance. If external evidence indicates an overpayment, finance records the excess as a separate verified profile-wallet credit rather than over-settling the invoice.

Manual invoice corrections never edit issued or paid lines. Before payment, staff cancel and replace the invoice with a linked corrected invoice. After payment, corrections use an adjustment invoice or refund/credit transaction. Customers see the relationship and explanation.

Every refund is linked to original payment allocations. Staff choose full or partial amount and wallet or external destination, subject to permission and dual approval thresholds. Wallet refunds post only through the ledger; external refunds remain Processing until staff records a bank reference and a second reconciliation check confirms completion. Retrying or reopening a refund can never duplicate the returned amount.

#### Power saving

Power-saving ordering is available when the active customer profile is Individual, which is treated as residential. The backend must enforce this rule. Admin-defined saving plans are displayed with title and an optional short one-line description.

The ordering wizard is:

1. Select a saving plan.
2. Select exactly one hardware product assigned to that plan. Show its title, price, and full description, and require explicit confirmation of the selection.
3. Enter the electricity bill identifier.
4. Select an installation address belonging to the active profile or add a new address inside the flow.
5. Read and accept the plan's admin-editable agreement.
6. Review and submit the order.

The order stores snapshots of the installation address, selected prices, and accepted agreement version so later edits cannot change historical details.

Bill-identifier format is validated locally and, when a verification provider is configured, verified through the backend. Provider failure does not erase the draft: the customer can retry or submit for manual staff review. Admins can prevent duplicate active saving orders for the same bill identifier and plan; a detected duplicate links the customer to the existing order or support instead of creating another.

Saving plans and hardware products can be Active or Inactive. Optional inventory/capacity is admin-managed. When stock is not tracked, the UI says availability is subject to staff confirmation. When tracked, submission reserves one unit for an admin-configurable period; payment or staff confirmation completes allocation, while timeout/cancellation releases it safely.

The review shows the saving plan, hardware, bill identifier, address, individual price lines, subtotal, VAT rate and amount, gift-code discount, total payable amount, and wallet balance. VAT defaults to zero but admins can configure rates by charge category or product override. The backend authoritatively recalculates all totals.

The optional gift-code input has a separate verification action and displays validity and discount amount. Eligibility is checked again atomically at submission.

Submitting creates the saving order, a linked draft contract, and a linked unpaid invoice atomically, then redirects to the order details page. Idempotency must prevent duplicate orders, contracts, or invoices.

Customers have an active-profile-scoped order list. Details show all submitted data, invoice, contract, payment status, comments, documents, and progress.

Customers cannot directly cancel the linked contract. They can request cancellation from the order details page or contact Barghsa. Authorized staff review and perform the cancellation, setting the order, contract, and applicable invoice states consistently without deleting records. Staff determine any full or partial refund amount and whether it is credited to the profile wallet or returned externally.

The fulfillment stages are:

1. Request confirmation
2. Product delivery
3. Installation and document upload
4. Handover of replaced equipment (`تحویل داغی`), when used
5. Process completion

`تحویل داغی` means handing over the old, defective, or replaced equipment, such as the previous cooler motor. It is optional by default. If performed, the handed-over item, staff member, and time must be recorded.

Authorized operations staff advance the stages. Every actual customer-visible status change records the actor, previous/new state, timestamp, and explanation and sends a notification. Completed and Cancelled are terminal states.

Before payment, the customer may request a change of hardware or installation address; applying it recalculates the draft invoice and agreement if needed. After payment, only staff can apply changes through an audited amendment and any adjustment invoice/refund. The details page always shows whether action is required from Customer or Barghsa.

Customers can upload documents, PDFs, images, and videos to an order and can exchange chronological comments with authorized staff. Each comment records its author and time. A customer-visible staff comment sends a notification and comments must not be silently overwritten.

#### Products

Barghsa has distinct product types managed separately by admins: consultation, electricity, hardware, and saving plans.

##### Consultation products

The consultation section initially contains:

- Electricity generation station establishment consultation
- Electricity-saving certificate consultation

The certificate consultation is available only when the active profile is a Legal Entity. Barghsa provides consultation about obtaining an energy-saving certificate; Barghsa does not issue the certificate itself.

All consultations have no predefined price. Creating a consultation request does not immediately create an invoice. Staff continue the work manually, determine the consultation fee, and then issue a payable invoice for the customer. The customer is notified when the fee and invoice become available.

Before issuing the invoice, staff enter the fee, scope, deliverables, expected next step, and validity period of the offer. The customer can Accept and pay, Request clarification, or Decline. Declining closes the offer without payment and does not trap the request. A fee change cancels and replaces any unpaid consultation invoice and notifies the customer; a paid consultation requires an adjustment/refund workflow.

Customers can view active-profile-scoped consultation requests and their status history. Every actual status change sends a notification and records previous/new state, responsible staff user, timestamp, and optional explanation. Initial shared states are Submitted, Under review, Awaiting customer information, Completed, Rejected, and Cancelled.

Each open consultation shows the current owner/team and next action. Admins configure a response target; breached targets create staff alerts but do not falsely promise a legal service level to the customer.

Consultation for establishing a power station and an order/request to construct a solar power station are independent products and records. Neither requires the other and the system must not automatically convert or link them unless staff explicitly add a reference.

##### Solar power station construction request

The first screen displays this exact Persian instruction:

`نوع نیروگاه خورشیدی مورد نظر خودتان را انتخاب کنید.`

The customer selects:

- Building and apartment: residential, commercial, and office properties.
- Non-household: agricultural and industrial sites.

For building/apartment projects, collect property form (Apartment or Villa), structural frame (Concrete, Steel, or Other), building completion date used to derive age, and total unit count when Apartment is selected.

For non-household projects, collect Agricultural or Industrial category, installation surface (land, rooftop, or both), approximate usable area in square metres, site address, relationship to the site (owner, tenant, or authorized operator), and an optional site description.

The customer then selects:

- `On-Grid`: generated electricity is delivered to the grid for sale without internal consumption.
- `Off-Grid`: generated electricity is used internally and may remain available during grid outages only subject to the final technical design and installed storage equipment.

The electricity bill identifier is required only for `On-Grid`.

Before submission, show these contract-preparation stages:

1. Contract request
2. Document upload
3. Document verification
4. Postal submission of documents
5. Final approval

The required checkbox displays exactly:

`شرایط ثبت قرارداد را می‌پذیرم.`

The accepted text version and time are retained. Submission creates only a solar request and redirects to its details page; it does not create a contract or invoice. Contract request is then complete and Document upload becomes current.

Admins can edit the customer-facing document guidance text and maintain a display-only list of suggested or requested documents for this workflow. The system does not enforce a predefined minimum document set. Customers upload whichever documents, photos, and videos are relevant and may select `I have uploaded all documents` even when no files have been uploaded.

Staff review each document independently. Rejecting one file rejects only that file, not the entire submitted set. Staff can approve a file, reject it with a reason, or request an additional/replacement file. The customer is notified and may delete or replace files even after submitting the set for review. Replacements must retain a link to the previous file and audit history rather than erasing it. When staff consider the overall set sufficient, approval advances the request to postal submission.

The postal stage distinguishes waiting for customer shipment from confirmed receipt by Barghsa. Exact postal instructions are communicated manually until designed in more detail.

Admins edit the postal guidance, destination address, contact details, and requested original-document list. Customers can record courier, tracking number, send date, and optional receipt image. Staff record Received, Incomplete, or Not received with a reason. An incomplete/lost shipment returns to Waiting for postal submission with clear instructions and does not terminate the request.

After postal receipt and final approval, authorized staff manually create a linked contract using a document template or uploaded document and create related invoices. Final approval, contract availability, and invoice issuance notify the customer. All decisions and transitions are auditable.

Overall construction-request states are Draft, Submitted, Uploading documents, Documents under review, Changes requested, Waiting for postal submission, Postal documents received, Final review, Approved, Rejected, Cancelled, and Contract created. Document-level decisions do not automatically reject the overall request. Rejected and Cancelled require a reason and support path; Approved remains open until staff create/link the contract or explicitly close it as No contract required with elevated permission and a reason.

##### Hardware products

Hardware products are not directly orderable. Admins have full CRUD access. Each contains Title, Price, and an intentionally unstructured Description. No example hardware is seeded by default.

Products referenced by historical orders cannot be hard-deleted; Delete archives them. Price, VAT category, availability, and description changes are versioned with effective dates. Products without a valid positive price are not orderable.

##### Saving plans

Admins can create, edit, and delete saving plans. Each contains Title, optional short description, Price, an admin-editable agreement title/text, and a selection of existing hardware products. Saving plans and hardware products have a many-to-many relationship.

##### Gift codes

Admins manage gift codes in a separate section. A code can be Public, restricted to one profile, or restricted to a selected list of profiles. Eligibility is profile-based.

Discounts can be a fixed IRR amount or a percentage with an optional maximum IRR cap. A code can have optional start and expiration dates and an active state. Backend verification during submission is authoritative; preview verification does not reserve or consume a code.

Initially, one gift code can be applied per order. Codes are normalized case-insensitively and have a unique normalized value. Admins can configure total usage limit, per-profile usage limit, eligible product/service categories, minimum order amount, and whether usage is restored after cancellation. Redemption occurs atomically with order creation. Failed submissions do not consume a code; cancellation before payment restores usage by default, while post-payment handling follows the configured promotion policy and audit history.

VAT configuration has effective dates and supports category defaults plus a product override. Product override wins; otherwise the category rate applies, otherwise zero. The rate is snapshotted on the invoice. Tax is calculated after discount on taxable lines, using the product-wide IRR rounding rule.

##### Default electricity products

The system contains four default electricity products:

1. Thermal electricity (`برق حرارتی`)
2. Green electricity (`برق سبز`)
3. Free-market electricity (`برق آزاد`)
4. Energy-saving electricity (`برق صرفه‌جویی`)

These products must be created automatically and idempotently by the database seed or deployment migration. A fresh deployment must have all four products without requiring manual admin entry, and running the seed repeatedly must not create duplicates. Each has an immutable system type/key and an editable localized title.

The initial price is empty (`null`), and an electricity product without a price is unavailable for ordering. Admins can set/change the price and activate or deactivate a product, but cannot delete a system electricity product, change its system type, or create additional electricity-product types. Existing contracts retain their pricing snapshots when catalog prices change.

Each electricity product has independent minimum and maximum quantities per order, measured in `kWh`. Both values initially default to zero, where zero means no limit. A non-zero minimum applies only when that product is included in the order; an omitted/zero-quantity product does not trigger its minimum. A non-zero maximum limits that product's quantity in the order. These limits are the same for weekly, monthly, complete, and partial periods and are not prorated based on remaining days.

#### Electricity supply

Electricity ordering is available only to customers whose active profile is a legal entity. Barghsa provides two electricity-ordering modes: simple and advanced.

##### Shared calculation rules

Electricity quantities are measured in kilowatt-hours (`kWh`). Average power for applying composition rules is calculated as:

`Average power (kW) = total requested energy (kWh) / exact duration (hours)`

The duration calculation uses the exact number of hours in the selected period. Product minimum and maximum limits remain fixed per order and are not prorated for a partial week or month. Prices, product composition, duration, taxes, and totals must be recalculated and validated by the backend before order creation.

The mandatory green-electricity rule has independent settings for simple and advanced modes:

- Enabled or disabled
- Average-power threshold in `kW`, default `1,000`
- Minimum green share, default `4%`

The rule is enabled by default for simple ordering and disabled by default for advanced ordering. Admins can change the enablement, threshold, and percentage. When enabled and the calculated average power is greater than the configured threshold, at least the configured percentage of the order's total energy must be green electricity.

Threshold must be non-negative and percentage must be between `0` and `100`. Activating a mandatory-green rule is blocked unless green electricity is Active, priced, and compatible with its limits. Existing submitted orders retain the rule snapshot that was shown at confirmation.

##### Simple order

Simple ordering is optimized for completing and paying an order with the fewest practical interactions. The customer first chooses a period type:

- Weekly
- Monthly

For monthly ordering, the customer can select the current Jalali month or the next Jalali month. The current month starts at the current time and ends at the first instant of the following Jalali month. The next month covers the half-open interval from its first instant up to, but not including, the first instant of the following month. The calculation must correctly handle 29-, 30-, and 31-day Jalali months and leap years.

For weekly ordering, the customer can select the current week, the next week, or the week after next; therefore selection is limited to at most two weeks ahead. A week is represented as the half-open interval from Saturday at `00:00` up to the next Saturday at `00:00` in Iran's official timezone. The current-week period starts at the current time in Iran. The customer's configured timezone does not change electricity-order period boundaries.

If Barghsa has authorized access to the customer's electricity bill data, the backend retrieves relevant historical consumption through the configured API. The UI shows the source and period of the estimate—for example, consumption during the previous three months—and pre-fills a suggested energy quantity. The customer can edit it. If bill data is unavailable, inaccessible, or fails to load, the customer enters the required `kWh` manually.

The initial suggestion uses average historical hourly consumption over the available lookback period multiplied by the exact selected period hours. It is labelled `Estimate`, includes data timestamp and coverage, and is never treated as verified demand. Missing or stale data produces a warning but never blocks manual entry.

In simple mode, the customer selects only thermal electricity. Other products cannot be selected manually. If the mandatory green rule applies, the backend automatically composes the order as:

- Thermal electricity: `100% - configured green percentage`
- Green electricity: configured green percentage

For example, for `1,000,000 kWh` over a full seven-day period:

`1,000,000 / (7 × 24) = 5,952.38 kW`

Because this exceeds the default `1,000 kW` threshold, the default composition is `960,000 kWh` thermal and `40,000 kWh` green. The UI must disclose this mandatory composition and the price of each component before submission.

The simple order creates one contract, one initial invoice, and one upfront settlement flow. Later amendments follow the separate adjustment rules.

The customer's entered quantity is the total requested energy. When mandatory green applies, that total is split between thermal and green as shown above; it is not increased. The resulting thermal and green quantities must each satisfy their product's configured per-order limits. If they do not, explain the exact limit and let the customer change the total or contact support.

##### Advanced order

In advanced mode, the customer selects a start date and end date and builds a bundle from the four electricity products. They enter the desired `kWh` for each product; a product with zero quantity is omitted from the bundle. Start cannot be in the past and end must be after start. Admins configure lead time and maximum contract duration; defaults are zero lead days and 24 Jalali months. Changing these settings affects new drafts only.

Before submission, the UI shows each selected product, quantity, unit price, line total, total bundle quantity, exact duration in hours, calculated average power, and final amount.

Advanced ordering always creates one contract and exactly one initial invoice for the complete bundle. It does not support installment or scheduled multiple-invoice generation; later amendments follow the separate adjustment rules.

When the advanced mandatory-green rule is disabled, the customer can freely enter any allowed green-electricity quantity. When the rule is enabled, the customer cannot enter or edit the green quantity; the backend derives it from the thermal-electricity quantity using the configured threshold and percentage:

- `Thermal average power = thermal electricity kWh / exact period hours`
- If thermal average power is greater than the configured threshold, `required green kWh = thermal electricity kWh × configured green percentage`
- Otherwise, required green electricity is zero.

The calculated green quantity is shown as a read-only line before confirmation and must also satisfy the green product's availability and per-order limits. If it falls outside those limits, the UI explains the exact conflict and lets the customer change thermal quantity or contact support; it never silently changes the configured percentage. The backend performs the authoritative calculation. When thermal quantity is zero, calculated mandatory green quantity is zero; while enforcement is enabled, the customer cannot manually add a separate green quantity.

##### Contract, invoice, and payment

Submitting either mode creates a preliminary electricity contract and its single invoice. The invoice is immediately payable; the customer does not need to wait for staff review. Admins configure the contract template used for electricity orders. The contract and invoice preserve a snapshot of the selected period, product quantities, prices, composition rule, and settings applied at submission time.

The invoice can be settled with one full wallet debit or with one or more confirmed bank payments. There is no direct online-gateway action on the invoice; online funds enter through wallet top-ups, each subject to the configured online limit. Bank payments have no configured maximum.

Staff review the preliminary contract and can request corrections or approve it. Every staff decision and customer-visible status change must be recorded and notify the customer. Exact activation and fulfillment rules continue to follow the Contracts and Invoices sections.

The electricity order exposes separate commercial and financial status rather than one ambiguous label. Commercial states are Draft, Submitted / awaiting staff review, Changes requested, Approved, Active, Completed, Rejected, and Cancelled. Financial states are Unpaid, Payment under review, Partially funded by bank payments, Paid, Refund pending, Partially refunded, and Refunded. The customer sees both, plus the exact next action. A Rejected/Cancelled paid order automatically enters Refund pending.

If the electricity contract is not finalized for any reason after the invoice has received money, all confirmed paid funds must be returned to the same profile's wallet. This full return is a required system workflow, not an optional reminder for staff:

- Rejecting or cancelling the preliminary contract creates a durable refund obligation automatically when refundable paid balance is greater than zero.
- The contract/order cannot be marked financially closed until that obligation is Completed. Staff cannot dismiss or manually mark the obligation complete without the linked wallet credit.
- A worker posts an immutable wallet credit linked to the contract, invoice, and original payment allocations.
- A unique idempotency key per refund obligation prevents duplicate wallet credits during retries or repeated staff actions.
- The refundable amount is calculated as confirmed paid amount minus previously completed refunds.
- Failed processing is retried and shown in a finance work queue/alert until resolved; staff do not manually create the required full wallet refund.
- Completion notifies the customer and records the actor/system process, amount, reason, and timestamps.

##### Electricity contract changes

Admins configure the maximum percentage by which a customer can request an increase to the contracted electricity quantity. A customer may submit this request only once per contract, and authorized staff must approve it before it takes effect.

An approved increase applies only to eligible future periods and must not change past periods or Paid, Cancelled, or otherwise finalized invoice allocations. It creates a new amendment document that the customer must sign. After signature, the backend calculates the incremental amount using the applicable amendment price snapshot and creates one linked adjustment invoice. The quantity change becomes effective after that adjustment invoice is fully paid, unless authorized staff explicitly approve a different effective condition with a reason. A negative adjustment creates an approved refund/credit instead of a negative invoice. The system records old/new quantities, percentage, effective period, requester, reviewer, decision, signature, financial adjustment, and timestamps. Each step notifies the customer.

Authorized staff can apply a percentage price increase from a specified effective date to eligible future portions of an electricity contract. Customer acceptance is not required, but the contractual basis, reason, calculation, old/new price, and effective date must be visible before the adjustment is finalized. It never rewrites past or paid invoice lines. The backend creates a linked adjustment invoice for the net increase over affected future quantities; a decrease creates a refund/credit. Non-payment follows the normal Overdue workflow and does not silently change historical service. There is initially no configurable percentage cap, so explicit permission, step-up authentication, auditing, and customer notification are mandatory.

#### Wallet

Each customer profile has its own wallet; it belongs to the Individual or Legal profile, not to the login user. Switching the active profile changes the visible wallet. All amounts are in IRR.

Customers can top up by online payment or by submitting a bank receipt. Each online top-up must not exceed the admin-configured online transaction limit. An offline top-up remains Pending until authorized finance staff confirm it; bank top-ups have no configured maximum and rejected submissions never increase the balance.

The transaction history shows credits and debits with amount, type, status, date, description, and reference. It includes top-ups, invoice payments, refunds, reservations, releases, reversals, and compensating transactions.

Applicable transaction states are Pending, Reserved, Completed, Failed, Rejected, Released, and Reversed. Reserved funds are excluded from available balance until completed or released.

No user, staff member, or admin can directly overwrite a wallet balance. Every balance change requires a ledger transaction. Confirmed entries are immutable; corrections use linked reversal or compensating transactions.

Wallets cannot have a negative available balance. The ledger tracks posted balance and reserved balance separately and derives available balance; no editable balance column is treated as the financial source of truth. All mutations use database locking/version checks. A scheduled reconciliation verifies that ledger totals match cached balances and opens a finance exception on mismatch.

Wallet payment of an invoice is a single full debit. The pay action is enabled only when available wallet balance covers the entire remaining invoice amount. The debit and invoice settlement must be atomic and idempotent; failure leaves both the wallet and invoice unchanged.

Except for the mandatory automatic full wallet return when an electricity contract is not finalized, refund decisions are made by authorized staff. Staff specify full or partial amount and select profile-wallet credit or external bank refund. External refunds do not affect wallet balance. Refund states are Requested, Approved, Processing, Completed, Failed, Rejected, and Cancelled, with full audit history and idempotency protection.

An online top-up is credited only after an authenticated, verified provider callback or server-side verification confirms success. Browser redirects are never sufficient evidence. Pending top-ups expire safely and can be reconciled later using the provider reference. Chargeback or reversed-provider payments create explicit reversal/exception transactions and alert finance; they never silently edit wallet history.

## File storage

File storage uses a provider abstraction. The initial supported provider is S3-compatible object storage, including Amazon S3 and self-hosted MinIO.

Admins configure endpoint, region when applicable, bucket, access key, secret key, path-style behavior, and private/public endpoints. Secrets must be encrypted at rest, masked after entry, excluded from logs, unavailable to the frontend, and editable only by authorized admins. Provide a safe connection test.

Objects are private by default. Access uses short-lived authorized URLs or backend streaming after checking the related profile and business record.

Default allowed categories and limits are:

- Documents: PDF, DOC, DOCX, XLS, XLSX, and common text formats, up to 25 MB.
- Images: JPEG, PNG, and WebP, up to 15 MB.
- Videos: MP4, MOV, and WebM, up to 250 MB.

Admins may configure formats and limits within deployment-safe boundaries. Validate both extension and detected content type. Reject executable, mismatched, or unsafe files.

Uploads remain Pending/Quarantined until validation and malware scanning complete. Every file records provider key, original name, detected type, size, checksum, uploader, profile, business record, upload time, scan state, and visibility.

Files linked to financial, contractual, order, or audit records cannot be permanently deleted through ordinary UI actions. Removal is a soft delete when allowed; controlled retention jobs perform physical deletion and audit it. Contract versions and signed documents are immutable.

Failed or interrupted multipart uploads can be resumed when supported and are cleaned up after an admin-configurable period. A scan failure is different from malware detection: scan failure remains Pending with Retry, while detected malware becomes Quarantined and alerts authorized staff. Customers receive a safe explanation and can upload a replacement.

Retention is configured by record category with legal-team approval. The recommended initial default for contracts, invoices, payments, refunds, and signed documents is ten years after closure; other customer uploads default to the parent record's retention. Legal hold overrides deletion. Provider versioning, backups, restore tests, orphan detection, and disaster-recovery procedures are required before production launch.

## General rules

- every string must be localized by i18n.
- Username can be valid email or mobile number.
- The mobile number will be sent to backend and saved in DB with "E.164" format.
- Login OTP validation is optional and decided by server side security checks.
- The OTP code needs a sensible and secure rate limit.
- All crud operations must display the final status in a toast message, or a permanent message in UI. e.g. login, register, password reset, entities create, update, delete, etc.
- every customer can have multiple Legal and Individual profiles. Staff/admin profile restrictions remain as defined in User base. A customer with no profile is redirected to `/onboarding`.
- if a customer has only one profile, it is the default. If there are multiple, the customer selects a default after login and can switch explicitly.
- users will see only the entites assigned to their current profile.
- a legal profile has an owner, and also can have a list of agents.
- profile switching is possible in dashboard sidebar's top section.
- profile verification may have 3 states, based on admins settings. if is required, then acting profile must be verified.
- A verified profile of customers, can not be edited. (applies to only this fields for individuals: first name, last name and national ID number).
- a legal entity owner or manager can invite other users to join them based on their email or mobile number, even if they are not registered yet.
- APIs return stable machine-readable error codes, localized safe messages, and a correlation ID. Unexpected errors never expose stack traces, secrets, or internal database details.
- Analytics must not contain passwords, OTPs, tokens, full national identifiers, bank receipt data, file contents, or secrets. Consent and environment-specific enablement are required.
- All destructive UI actions use confirmation and explain consequences. Financial and contractual records are archived/versioned rather than hard-deleted.
- Background work exposes operational health, retry counts, and ownership so failed jobs cannot remain invisible.
- Customers can request export or closure of their account/profile through support. Closure is blocked only by explicit legal, financial, security, or active-contract obligations; the UI explains each blocker. Closure revokes access and applies retention/anonymization rules without deleting required audit or financial evidence.

## Notifications

The notification service delivers in-app notifications and, according to verified destinations and preferences, email, SMS, or both. Every notification appears in the in-app notification center with a read state.

Business notifications retain their related profile and record so they open in the correct profile context.

Notifications are classified as:

- Immediate: OTP, authentication/security events, and explicitly urgent time-sensitive messages. These bypass quiet hours.
- Daytime: ordinary status updates, comments, invoice notices, reminders, and contract updates.

The default external-delivery window for daytime messages is 09:00–21:00 in the user's timezone and is admin-configurable. Messages outside the window remain queued; in-app notifications may appear immediately.

Use a durable outbox and queue so committed notifications survive crashes. Each event/channel delivery has an idempotency key. Transient failures use bounded exponential retries, initially around 1 minute, 5 minutes, 30 minutes, and 2 hours, followed by a final operational attempt. Permanent or exhausted failures move to an inspectable dead-letter state.

Record Queued, Scheduled, Sending, Delivered when supported, Failed, or Cancelled status, attempt count, provider reference, last error, and timestamps. Provider callbacks must be authenticated and idempotent. Templates use the user's selected language and scheduling uses their timezone.

In-app delivery is mandatory for all business events. Security/authentication messages, payment/refund results, contract cancellation, and requests requiring customer action are mandatory notifications and cannot be disabled, although external channel choice follows available verified destinations. Marketing messages require separate consent and are never mixed with transactional templates.

Each template is versioned and previewable in Persian and English. Variables are allow-listed and escaped. Admins can send a test without contacting a real customer. Notifications link to safe in-app routes rather than embedding sensitive data in SMS or email.

Dead-letter deliveries are assigned to an operational queue with severity, owner, Retry, and Resolve actions. Failure of SMS/email never hides the in-app message. When a required action approaches its deadline and all external channels fail, staff receive an alert to contact the customer through an approved alternative.

### Delivery-provider administration

Email and SMS are transport adapters behind the notification service; business modules never call a provider directly. Initially, each environment has at most one Active provider per external channel. Provider configurations follow the normal Draft, Active, and Superseded lifecycle. Activation is atomic, preserves the previous working version for rollback, and does not modify the configuration snapshot already attached to an in-flight delivery.

Only admins with the dedicated notification-provider permission may view or change these settings. Creating, editing, testing, activating, disabling, or rolling back a provider requires recent step-up authentication and creates an immutable audit event. Secrets are write-only after entry, encrypted at rest, masked in every response and screen, excluded from exports/logs/telemetry, and may be replaced but never revealed. A credential change creates a new configuration version rather than editing active history.

A Draft cannot become Active until schema validation and a successful connection/test-send check have completed. Testing uses an explicitly entered and verified admin-owned destination and must never select a customer implicitly. A failed draft leaves the current Active provider untouched. The UI shows readiness, last successful test, last error in safe language, activation time, actor, delivery/failure rate, queue age, and provider balance/credit when the provider supports it. Disabling the only usable channel for OTP or account recovery is blocked until another verified recovery path is available; ordinary in-app access and a documented support-recovery path prevent users from becoming stranded during a provider outage.

#### Email provider

The admin chooses exactly one of these transports for an Active email configuration:

- **SMTP:** host, port, security mode (`TLS` or `STARTTLS` in production), username when required, password/secret, connection and command timeouts, default From name/address, and optional Reply-To. Certificate and hostname verification are mandatory in production. Plaintext SMTP is development-only. To reduce SSRF and internal-network scanning risk, localhost, link-local, metadata, and private-network destinations are rejected unless an operator has explicitly allow-listed the exact destination in deployment configuration; this safeguard cannot be disabled in the admin UI.
- **Resend:** API key, default From name/address, optional Reply-To, and sending domain. The API endpoint is application-managed rather than freely editable by an admin. Activation requires a successful test using a sender on a verified domain. Use a sending-only, domain-scoped key where possible. Barghsa renders and versions the email content; Resend is initially a transport, so a second provider-hosted template system is not introduced.

Every email attempt stores the internal delivery ID, configuration version, provider reference when available, accepted/delivered/bounced/complained status when distinguishable, and safe failure category. Resend requests carry the delivery idempotency key. Authenticated, replay-safe callbacks update delivery status; a hard bounce or complaint suppresses further non-essential email to that address and creates an operational/customer-correction path. SMTP acceptance must not be presented as confirmed inbox delivery.

#### SMS.ir provider

SMS.ir is the initial SMS transport. Its Draft settings contain the API key, default sender/line number, request timeout and throughput limits, low-credit alert threshold, and a versioned mapping from each notification event and language to an SMS.ir `TemplateId`. Provider base URL and API version are application-managed to prevent arbitrary outbound requests; a future API change is handled in the adapter and migration, not by asking an admin to enter an unrestricted URL.

Transactional SMS uses approved provider templates. Each mapping defines the internal event key, `TemplateId`, enabled state, and an explicit map from allow-listed Barghsa variables to the provider's parameter names. Activation validates that IDs are well formed and every required variable can be supplied. Admins can preview rendered parameters and send a test to an explicitly entered, verified admin-owned Iranian mobile number. Free-form or bulk marketing SMS is outside the initial scope and cannot be enabled through these settings.

Phone numbers remain normalized as E.164 inside Barghsa; the adapter converts them only at the provider boundary. Each attempt records the internal delivery ID, configuration/template version, provider message reference, accepted/delivered/failed status when supported, and a safe error category. Internal idempotency prevents duplicate messages even when the provider offers no idempotency primitive. Delivery reports or polling are authenticated/validated and replay-safe. Low credit, authentication failure, invalid template mapping, sustained delivery failure, and callback failure create actionable operational alerts.

#### Provider failure behavior and verification

Provider errors are classified as transient (timeout, throttling, temporary provider failure) or permanent (invalid destination, rejected sender/template, invalid credential). Only transient failures receive bounded retry with jitter; invalid credentials or templates pause the affected external channel and page/alert the responsible staff instead of repeatedly consuming provider credit. No retry may create a second logical notification.

Unit tests cover configuration validation, secret masking, event/parameter mapping, number normalization, error classification, and idempotency. Adapter contract tests use deterministic SMTP, Resend, and SMS.ir fakes for success, timeout, throttle, invalid credentials/template, duplicate callback, bounce/delivery report, and provider outage. Critical E2E tests verify Draft → test → Active → rollback, an OTP through each configured channel, failed external delivery with intact in-app notification, and recovery without locking out a user. E2E and CI never contact production provider accounts.

---

## Development (monorepo)

Barghsa is implemented as a TypeScript pnpm + Turborepo monorepo:

| Path | Role |
|------|------|
| `apps/web` | TanStack Start frontend (shadcn/ui + Base UI, RTL, light/dark) |
| `apps/api` | NestJS API gateway / modular monolith |
| `packages/db` | Drizzle ORM schema + seed |
| `packages/shared` | Shared Zod schemas / username helpers |
| `packages/i18n` | FA (default) + EN dictionaries |
| `packages/ui` | Shared shadcn/Base UI components |

### Prerequisites

- Node.js 20+ (via Corepack for automatic pnpm version management:
  ```bash
  corepack enable
  corepack prepare pnpm@10.8.1 --activate
  ```
  )
- pnpm 10+ (managed automatically by Corepack when enabled above)
- Docker (Postgres, Redis, optional MinIO)

### Local setup

```bash
cp .env.example .env
docker compose up -d postgres redis minio
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs

Local development may create a seeded admin using credentials supplied through development-only environment variables. Production deployment must never use a hard-coded default password. The first admin is created through a one-time bootstrap secret or secure operator command, must change password at first login, and must enroll MFA before accessing admin settings.

In development, OTP codes are printed to the API console.

### Build

```bash
pnpm build
```

### Architecture notes

See `docs/architecture.md`. Auth uses HTTP-only cookies, device-bound sessions, OTP on new devices, layered rate limits with durable critical counters, and auditable staff actions. Customer business data is scoped to the active profile.
