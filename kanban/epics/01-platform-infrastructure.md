# Barghsa — Platform & Infrastructure Domain

> **Domain Agent #1 — PLATFORM & INFRASTRUCTURE**
> Covers monorepo foundation, build toolchain, database schema & migrations, Docker/containerization, infrastructure services (PostgreSQL, Redis, S3/MinIO, reverse proxy), deployment topologies (pilot vs commercial HA), CI/CD pipeline with all quality gates, shared contracts/i18n/ui packages, and developer experience tooling.
>
> **Source documents:** `README.md` (1260 lines), `architecture.md` (177 lines)

---

## Overview

This domain owns every piece of platform infrastructure the Barghsa energy platform runs on. It delivers:

1. **Monorepo & Toolchain** — TypeScript pnpm/Turborepo monorepo with `apps/web` (TanStack Start), `apps/api` (NestJS modular monolith), and four shared packages (`db`, `shared`, `i18n`, `ui`). Build orchestration, test runners (Vitest, Playwright), linting, formatting, type checking, and bundle budgets.
2. **Database & Migrations** — Drizzle ORM schema for PostgreSQL, expand/migrate/contract migration pipeline, seed data (4 default electricity products, admin bootstrap), UUIDv7 defaults, `timestamptz`/half-open-range conventions, integer IRR financial types.
3. **Containerization & Deployment** — Dockerfiles for web, API, and worker processes (API and worker share one image with different CMDs). Docker Compose for local dev with PostgreSQL, Redis, and MinIO. Health checks, graceful `SIGTERM` handling, readiness/liveness probes.
4. **Infrastructure Services** — PostgreSQL with automated backups + PITR, Redis (optional, disposable, never source of truth), S3/MinIO object storage with versioning + lifecycle policies, reverse proxy/load balancer with TLS termination.
5. **Deployment Topology** — Pilot/low-traffic single-VM topology, commercial HA two-failure-domain topology with ≥2 stateless replicas, managed load balancer, and PostgreSQL automatic failover. Vertical-first scaling. No Kubernetes/Kafka/Elasticsearch initially.
6. **CI/CD & Quality Gates** — Four-gate pipeline: PR gate (lint/typecheck/tests/migrations/security scans/coverage), staging gate (full integration/E2E/a11y/container scan/migration rehearsal), production promotion gate (release E2E/DAST/backup/rollback/dashboards), scheduled gates (nightly/weekly/quarterly). Deployment automation with health checks, rollback, blue/green or rolling.
7. **Shared Contracts & i18n** — `packages/shared` (Zod schemas, username helpers), `packages/i18n` (Persian + English dictionaries, Jalali/Gregorian date formatting), `packages/ui` (shared shadcn/Base UI components with RTL/dark/light support).
8. **Developer Experience** — Prerequisites (Node.js 20+, pnpm 10+, Docker), `.env.example` setup, seed admin bootstrap, OTP console printing in dev, code quality enforcement (lint-staged, commit hooks, secret/SCA scanning in CI), configuration safety (Draft → Active → Superseded versions, rollback).

---

## Epics

---

### E-01: Monorepo Foundation & Build Toolchain

**Description:** Initialize the TypeScript pnpm/Turborepo monorepo with workspace configuration, TypeScript strict settings, build orchestration, and test infrastructure. Every package and app must be wired together with correct dependencies, shared tsconfig, and a unified build pipeline that enforces route-level bundle budgets and code-splitting.

---

#### S-01.01: Initialize pnpm/Turborepo monorepo workspace

**Description:** As a platform engineer, I want a pnpm workspace with Turborepo task orchestration so that all apps and packages share a single dependency tree, lockfile, and coordinated build/test pipeline.

**Acceptance Criteria:**
- `pnpm-workspace.yaml` defines workspace roots: `apps/*`, `packages/*`
- `pnpm-lock.yaml` is the single source of truth; no conflicting lockfiles
- `turbo.json` configures pipeline with `build`, `test`, `lint`, `typecheck`, `dev` tasks
- Task dependencies: `build` depends on `^build` (upstream build first), `test` depends on `build`, `lint` and `typecheck` are independent
- `package.json` at root defines `packageManager` as `pnpm@10+`
- `.npmrc` sets `shamefully-hoist=false`, `strict-peer-dependencies=true`
- Monorepo uses pnpm 10+; CI and all developers must use the same major version

**Tasks:**

- **T-01.01.01:** Create `pnpm-workspace.yaml` with `packages: ['apps/*', 'packages/*']` and verify `pnpm install` resolves correctly
  - **Notes:** Must exclude root from workspace. Verify with `pnpm ls -r` that all packages are detected.
  - **Dependencies:** None
  - **Complexity:** S

- **T-01.01.02:** Create root `turbo.json` pipeline definition
  - **Notes:** Define outputs (`.next/`, `dist/`, `.turbo`), cache strategy, and dependency graph. Use `dependsOn: ['^build']` for build so upstream packages build first. `persistent: true` for `dev` task. Set `outputLogs: 'new-only'` to reduce noise.
  - **Dependencies:** T-01.01.01
  - **Complexity:** M

- **T-01.01.03:** Create root `.npmrc` with strict peer dependencies and no shameful hoisting
  - **Notes:** Set `save-exact=true` to pin dependency versions. Set `auto-install-peers=false` so peer deps are explicit. Set `resolution-mode=highest` to get latest compatible.
  - **Dependencies:** T-01.01.01
  - **Complexity:** S

- **T-01.01.04:** Create root `package.json` with `packageManager`, scripts, and engines constraint
  - **Notes:** Scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `format:check`, `format:write`. Set `engines.node >=20`, `engines.pnpm >=10`. Add corepack instructions in README.
  - **Dependencies:** T-01.01.01
  - **Complexity:** S

- **T-01.01.05:** Verify monorepo integrity: install deps, run `turbo build` across all packages, confirm no cross-package resolution errors
  - **Notes:** CI must also run `pnpm install --frozen-lockfile` to detect lockfile drift. Validate that `pnpm build` exits 0 and produces correct `dist/` outputs.
  - **Dependencies:** T-01.01.02, T-01.01.03, T-01.01.04
  - **Complexity:** M
  - **UI/UX:** N/A

---

#### S-01.02: Configure TypeScript strict mode across monorepo

**Description:** As a developer, I want TypeScript strict mode enabled in every package with a shared base `tsconfig.json` so that type errors are caught at compile time and code quality is uniform.

**Acceptance Criteria:**
- Root `tsconfig/base.json` sets `strict: true`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes`, `forceConsistentCasingInFileNames`
- Each package extends the base and overrides only `outDir`, `rootDir`, `include`, `paths` as needed
- `tsconfig.json` at root references all packages with `composite: true` and `declaration: true` for project references
- `@tsconfig/node20` or equivalent is used as the foundation
- No `strict: false` or `skipLibCheck` allowed in production packages (test configs may use `skipLibCheck` for node_modules)
- Type checking passes on CI with zero suppressed errors; new suppressed errors are not permitted in PRs

**Tasks:**

- **T-01.02.01:** Create `packages/tsconfig/base.json` with strict shared settings
  - **Notes:** Settings: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `lib: [ES2022]`, `declaration: true`, `declarationMap: true`, `sourceMap: true`, `composite: true`, `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, `exactOptionalPropertyTypes: true`, `forceConsistentCasingInFileNames: true`, `esModuleInterop: true`, `skipLibCheck: false`, `isolatedModules: true`. For test files, a `tsconfig.test.json` variant may relax `strict` minimally with explicit justification.
  - **Dependencies:** S-01.01
  - **Complexity:** M

- **T-01.02.02:** Configure per-package tsconfig with project references in each of: `packages/db`, `packages/shared`, `packages/i18n`, `packages/ui`, `apps/web`, `apps/api`
  - **Notes:** Each extends `../../tsconfig/base.json` (or `../tsconfig/base.json` from packages). Set `rootDir: src`, `outDir: dist`. Add `references` to upstream dependencies. For `apps/web`, extend with JSX config. For `apps/api`, set `emitDecoratorMetadata: true`, `experimentalDecorators: true` for NestJS compatibility.
  - **Dependencies:** T-01.02.01
  - **Complexity:** L

- **T-01.02.03:** Create root-level `tsconfig.json` that references all sub-projects with `files: []` so IDE picks up project references
  - **Notes:** This is a solution-style tsconfig: no files, just `references` to every app/package. Enables "Find All References" and "Go to Definition" across package boundaries in VS Code.
  - **Dependencies:** T-01.02.02
  - **Complexity:** S

- **T-01.02.04:** Wire `turbo.json` `typecheck` task and CI step to run `turbo typecheck`
  - **Notes:** `turbo.json` gets a `typecheck` task that depends on `^build` (upstream compsited builds emit declarations). CI enforces zero new suppressed errors via a custom check. Any `// @ts-expect-error` or `// @ts-ignore` in production source must be approved in PR review.
  - **Dependencies:** T-01.01.02, T-01.02.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-01.03: Build pipeline with production optimization and route budgets

**Description:** As a platform engineer, I want a production build that bundles route-level code splitting, enforces JavaScript size budgets per route, and produces optimized outputs for deployment.

**Acceptance Criteria:**
- `pnpm build` produces production-optimized bundles for `apps/web` and `apps/api`
- Route-level code splitting: heavy editors, charts, AI UI, video tooling, and admin-only features are lazy-loaded; customer purchase paths have minimal bundle size
- Bundle budget check in CI: per-route JS size is measured and compared against a defined budget with CI failure on regression
- Production build outputs immutable hashed filenames for public assets (CDN-ready)
- Environment-specific builds: `.env.production`, `.env.staging` each produce correct output with tree-shaken dev-only code
- Build output is deterministic within the same source + dependency lock

**Tasks:**

- **T-01.03.01:** Configure TanStack Start build pipeline in `apps/web`
  - **Notes:** Use `@tanstack/start` build command. Ensure SSR configuration does not add server-side business logic duplication. Set `build.inlineDynamicImports: false` for route-level CSS/JS splitting. Configure `server.functions` as thin BFF only — authorization, pricing, state transitions stay in backend modules.
  - **Dependencies:** S-01.02, packages/i18n, packages/shared, packages/ui
  - **Complexity:** L

- **T-01.03.02:** Configure NestJS build pipeline in `apps/api`
  - **Notes:** Use `@nestjs/cli` webpack or SWC builder. Set `preserveSymlinks: false` for monorepo compatibility. Output to `dist/`. Ensure decorator metadata emission is preserved. Generate OpenAPI specification at build time via `nest build` + configured swagger plugin.
  - **Dependencies:** S-01.02, packages/db, packages/shared
  - **Complexity:** M

- **T-01.03.03:** Implement route-level code splitting and lazy loading for heavy modules
  - **Notes:** Lazy-load: admin dashboards, AI chat UI, document editors, chart visualizations, video upload viewers. Use dynamic `import()` with React.lazy or TanStack Router's lazy routes. Customer purchase paths (electricity ordering, saving plans, wallet top-up) must NOT be lazy-loaded. Verify that lazy boundaries don't cause layout shift.
  - **Dependencies:** T-01.03.01
  - **Complexity:** M
  - **UI/UX:** Loading states for lazy routes must match the app skeleton and respect `prefers-reduced-motion`. Show a skeleton or minimal spinner, never a blank page.

- **T-01.03.04:** Implement bundle budget checking in CI
  - **Notes:** Use `size-limit` or `@size-limit/preset-app` to set per-route budgets. Initial budgets: login/register pages under 150 KB JS gzip, dashboard under 300 KB JS gzip, electricity ordering under 250 KB JS gzip, admin pages under 500 KB JS gzip. CI compares against a committed `.size-limit.json`. Budget regression fails the PR gate.
  - **Dependencies:** T-01.03.01
  - **Complexity:** M

- **T-01.03.05:** Configure hashed filenames and CDN-ready public asset output
  - **Notes:** TanStack Start config sets `build.assetsDir: 'assets'` with content-hash filenames. Set `build.cssCodeSplit: true`. Output manifest for CDN cache invalidation. Ensure public assets set `Cache-Control: public, immutable, max-age=31536000`. Authenticated API responses set `private, no-cache`.
  - **Dependencies:** T-01.03.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-01.04: Configure test infrastructure (Vitest + Playwright)

**Description:** As a developer, I want a unified test runner (Vitest) across all packages with Playwright for E2E, configured with code coverage thresholds, CI integration, and isolated test databases.

**Acceptance Criteria:**
- `vitest` is the primary TypeScript test runner for unit, integration, and component tests across all packages
- `@vitest/coverage-v8` or `istanbul` provides code coverage with per-package thresholds
- `playwright` is configured for E2E in `apps/web` with Chromium (PR), Firefox/WebKit/mobile (nightly)
- Backend integration tests boot the real NestJS application against a real PostgreSQL test database (SQLite/ in-memory substitutes are NOT accepted)
- Test databases use isolated schemas or databases per parallel worker
- `turbo.json` has a `test` task that runs Vitest across packages with coverage

**Tasks:**

- **T-01.04.01:** Create root `vitest.workspace.ts` that includes all packages and apps
  - **Notes:** Use `@vitest/workspace` with glob `packages/*`, `apps/*`. Each package gets its own `vitest.config.ts` or shares a base config. Set `test.globals: false` (explicit imports). Set `test.typecheck.enabled: false` by default (separate typecheck step).
  - **Dependencies:** S-01.01, S-01.02
  - **Complexity:** M

- **T-01.04.02:** Configure per-package Vitest with coverage thresholds
  - **Notes:** Minimum thresholds: 80% line / 75% branch for changed code. Auth, authorization, payments, wallet, refunds, pricing, contracts, and state-machine domain packages: 90% line / 85% branch. Exceptions require tech lead approval. Coverage checks in `vitest.config.ts` via `coverage.thresholds`.
  - **Dependencies:** T-01.04.01
  - **Complexity:** M

- **T-01.04.03:** Configure backend integration test setup with real PostgreSQL
  - **Notes:** Each parallel worker receives an isolated database schema via `test.globalSetup` or a testcontainers-based PostgreSQL. Never use SQLite or in-memory substitutes — they do not reproduce PostgreSQL transactions, constraints, locking, or SQL behavior. Provider calls are replaced only at the adapter boundary with deterministic fake servers or signed webhook fixtures (nock, MSW, or custom fakes). Mandatory concurrency tests: simultaneous wallet payments, duplicate provider callbacks, duplicate bank confirmation, concurrent refund workers, repeated order submission.
  - **Dependencies:** T-01.04.01, S-02.01
  - **Complexity:** L

- **T-01.04.04:** Configure Playwright for E2E testing
  - **Notes:** Install `@playwright/test`. Configure `playwright.config.ts` with: projects for Chromium (PR), Firefox/WebKit (nightly), mobile viewports (iPhone, Android). Base URL configurable per environment. Record trace on failure (`trace: 'retain-on-failure'`). Use isolated accounts/profiles and deterministic seed data. Never call production payment, SMS, email, storage, bill-data, or AI providers. Critical flows: registration, login/MFA, legal onboarding, electricity ordering + wallet funding, saving-plan order, solar construction, admin config changes.
  - **Dependencies:** T-01.04.01
  - **Complexity:** L

- **T-01.04.05:** Wire `test` and `test:coverage` tasks in `turbo.json`
  - **Notes:** `test` depends on `^build` (upstream packages must compile first). `test:coverage` passes `--coverage` flag. CI runs `turbo test` with `--filter` for affected packages on PR, full suite on main.
  - **Dependencies:** T-01.04.01, T-01.01.02
  - **Complexity:** S

- **T-01.04.06:** Configure flaky-test quarantine process
  - **Notes:** Flaky test is treated as a defect. Quarantine requires owner, issue link, and expiry. Quarantined critical tests must not silently allow production promotion. CI reports flaky count per run.
  - **Dependencies:** T-01.04.04
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-01.05: Global exception handling & correlation ID middleware

**Description:** As a developer, I want a global NestJS exception filter and correlation ID middleware so that every error response returns a stable machine-readable code, localized message, and correlation ID without exposing stack traces or raw database errors.

**Acceptance Criteria:**
- Global `HttpExceptionFilter` catches all unhandled exceptions and maps them to stable error codes from `packages/shared`
- Errors return `{ error: { code, message (localized via i18n), correlationId } }` — never expose stack traces, raw DB errors, or provider internal details
- Middleware generates `X-Correlation-ID` per request, propagates to downstream calls (outbox events, worker jobs), and includes it in all responses and logs
- Integration test verifies filter catches known exception types (validation, auth, not-found, rate-limit, provider, internal) and returns the expected shape

**Tasks:**

- **T-01.05.01:** Implement global NestJS `HttpExceptionFilter` and `CorrelationIdMiddleware`
  - **Notes:** Filter catches `HttpException`, `ZodError` (validation), and unhandled `Error`. Maps to codes from `@barghsa/shared/errors`. Resolves localized messages via i18n service. Logs the error with correlation ID and request metadata at appropriate severity (debug for 4xx, error for 5xx). Middleware generates UUIDv7 correlation ID on every request, stores in `cls-rtracer` or `AsyncLocalStorage`, and sets `X-Correlation-ID` response header. Backend services log correlation ID for traceability.
  - **Dependencies:** T-06.01.04 (error codes), S-06.02 (i18n)
  - **Complexity:** M

---

### E-02: Database Schema, Migrations & Seed (Drizzle/PostgreSQL)

**Description:** Establish Drizzle ORM as the database layer with a structured schema, migration pipeline (expand/migrate/contract), seed data for default entities, and PostgreSQL connection management. Enforce all data rules from the specification: UUIDv7, `timestamptz` with timezone metadata, half-open intervals, integer IRR financials, unique constraints, row-level locking, and transactional outbox.

---

#### S-02.01: Drizzle ORM foundation with PostgreSQL connection management

**Description:** As a platform engineer, I want Drizzle ORM configured with a bounded connection pool, query timeouts, idle transaction guards, and database-level validation so that the database layer is safe, observable, and performant from day one.

**Acceptance Criteria:**
- `packages/db` exports a configured Drizzle instance with connection pooling
- PostgreSQL client uses `pg` driver with `pg-pool` for connection pooling
- Pool has configurable `min`, `max`, `idleTimeoutMillis`, `maxClientWait` — defaults: min=2, max=20, idle=30s, wait=5s
- Statement timeout (`statement_timeout`) set per-query (default 10s for reads, 30s for writes)
- Idle transaction timeout (`idle_in_transaction_session_timeout`) enforced at pool level (60s)
- Lock wait timeout (`lock_timeout`) set per-session (default 5s)
- No connection-per-request anti-pattern — pool is shared across the application
- Query logging in development via Drizzle's `logger: true`; production logging via structured JSON only for slow queries (>200ms)

**Tasks:**

- **T-02.01.01:** Initialize `packages/db` with Drizzle ORM, `pg`, `pg-pool`, and drizzle-kit
  - **Notes:** `package.json` declares `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`. Dependencies: `drizzle-orm` (runtime), `drizzle-kit` (dev, for migrations/generate). Export `* from './src/index'` in package entry.
  - **Dependencies:** S-01.02
  - **Complexity:** M

- **T-02.01.02:** Create PostgreSQL pool factory with configurable pool, statement timeout, lock timeout, and idle transaction guard
  - **Notes:** Factory function `createDbPool(config: DbPoolConfig)` returns the pool. Apply `statement_timeout` via `query` event handler or `pool.on('connect')` with `SET statement_timeout`. Apply `lock_timeout` and `idle_in_transaction_session_timeout` similarly. Use environment variables: `DATABASE_URL`, `DB_POOL_MIN`, `DB_POOL_MAX`. Export typed `drizzle(pool, { schema, logger })` instance.
  - **Dependencies:** T-02.01.01
  - **Complexity:** M

- **T-02.01.03:** Implement query timeout and cancellation via Drizzle configuration
  - **Notes:** For slow query detection, emit structured log warning for queries exceeding 200ms. Use Drizzle's `beforeQuery`/`afterQuery` hooks or a pool middleware. Cancel long-running queries server-side if they exceed statement_timeout.
  - **Dependencies:** T-02.01.02
  - **Complexity:** S

- **T-02.01.04:** Set up database health check endpoint for readiness probes
  - **Notes:** Export a `dbHealth()` function that runs `SELECT 1` with a 5s timeout and returns `{ ok: boolean, latencyMs: number, poolStats: { totalCount, idleCount, waitingCount } }`. This is used by NestJS health controller for liveness/readiness checks.
  - **Dependencies:** T-02.01.02
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-02.02: Core data types and schema conventions

**Description:** As a developer, I want a centrally defined set of PostgreSQL column types and conventions used across all domain schemas so that UUIDv7, timestamptz, half-open dateranges, integer IRR, fixed-precision decimals, and enum fields are consistently implemented.

**Acceptance Criteria:**
- Custom Drizzle types for: UUIDv7 generation, `timestamptz` (UTC), half-open `tstzrange`, `integer` for IRR amounts, `numeric` for rates/quantities
- UUIDv7 columns use `gen_random_uuid()` or a custom function that preserves monotonic ordering — no sequential UUID libraries
- Timestamps stored as `timestamptz` (always UTC); business timezone metadata stored separately per record where needed
- Half-open ranges represented as PostgreSQL `tstzrange` with `[start, end)` semantics enforced at schema level
- IRR amounts stored as `bigint` (64-bit signed integer) — max value 9.22e18, sufficient for large IRR amounts
- Rates/quantities stored as `numeric(20, 6)` for fixed-precision arithmetic
- No `float4`/`float8` used in any financial, contractual, or quantity column
- Enum-like status fields use `varchar` or custom PostgreSQL enums with explicit Drizzle `pgEnum`
- Every table has `createdAt` (`timestamptz`, default `now()`), `updatedAt` (`timestamptz`, auto-updated via trigger), and `id` (UUIDv7, primary key default)

**Tasks:**

- **T-02.02.01:** Create `packages/db/src/types.ts` with custom Drizzle type definitions
  - **Notes:** Define `uuidv7` type using `drizzle-orm/pg-core` custom types. Generate UUIDv7 via a PostgreSQL function `uuid_generate_v7()` (to be created in migration) that combines timestamp + random bits. Define `timestamptz` as `timestamp with time zone`. Define `irrAmount` as `bigint()`. Define `fixedDecimal` as `numeric(20, 6)`. Define `halfOpenRange` as `tstzrange`.
  - **Dependencies:** T-02.01.01
  - **Complexity:** M

- **T-02.02.02:** Create base table factory with `id`, `createdAt`, `updatedAt` columns
  - **Notes:** Export `createTable` function or `baseColumns` object used in every domain schema. `updatedAt` uses a PostgreSQL trigger `modify_updated_at()` for automatic updates on row modification. `createdAt` uses `defaultNow()`.
  - **Dependencies:** T-02.02.01
  - **Complexity:** S

- **T-02.02.03:** Create UUIDv7 generation function migration
  - **Notes:** A SQL migration that creates `uuid_generate_v7()` function using `uuid_extensions` or a custom pl/pgSQL implementation. The function encodes the current Unix timestamp in milliseconds (48 bits) followed by random bits (74 bits) for monotonic ordering and index locality. Must handle concurrent calls safely.
  - **Dependencies:** T-02.02.01, S-02.03
  - **Complexity:** M

- **T-02.02.04:** Document and enforce column conventions in ADR
  - **Notes:** Create `docs/adr/001-data-types-and-conventions.md` detailing: UTC timestamptz + timezone metadata, half-open range semantics, integer IRR, numeric precision, UUIDv7 benefits vs UUIDv4, and prohibition of floating-point in financial contexts.
  - **Dependencies:** T-02.02.01, T-02.02.02
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-02.03: Migration pipeline (expand/migrate/contract)

**Description:** As a platform engineer, I want a safe, versioned migration pipeline using Drizzle Kit that applies changes as expand/migrate/contract phases so that deployments remain backward-compatible during rollout and rollback.

**Acceptance Criteria:**
- `drizzle-kit generate` produces SQL migration files from Drizzle schema changes
- Migrations are executed via `drizzle-kit migrate` or a runtime migrator
- A deploy remains compatible with the previous application version during rollout (expand phase)
- Destructive migrations (DROP, ALTER that lose data) require a verified backup and a separately reviewed cleanup release (contract phase)
- Three-phase pattern: Expand (add columns/tables, nullable or with defaults), Migrate (backfill data, migrate constraints), Contract (remove old columns, DROP, set NOT NULL)
- Migration runs automatically at application startup in dev; in production, migrations are run as a separate deployment step before new code
- Migration history is tracked via `drizzle_migrations` table; failed migration blocks application start with a clear error
- Rollback (roll-forward) plan: each migration is reversible (has a down migration); a failed deployment rolls forward by running the next down migration, not by reverting to old code

**Tasks:**

- **T-02.03.01:** Configure `drizzle.config.ts` in `packages/db`
  - **Notes:** Set `schema: './src/schema/**/*.ts'`, `out: './drizzle'`, `dialect: 'postgresql'`. Configure `introspect: { casing: 'camel' }`. Add `extensions: plv8` if used. Set `dbCredentials: { url: process.env.DATABASE_URL }` for commands.
  - **Dependencies:** T-02.01.01
  - **Complexity:** S

- **T-02.03.02:** Create migration runner script for production deployments
  - **Notes:** Script `packages/db/src/migrate.ts` that uses Drizzle's `migrate` function. It checks pending migrations, applies expand-phase changes first, reports applied migration IDs, and exits with non-zero on failure. Production pipeline runs this before starting new app instances. Include health check that verifies schema version matches expected.
  - **Dependencies:** T-02.03.01
  - **Complexity:** M

- **T-02.03.03:** Create migration validation test (clean + upgrade path)
  - **Notes:** Two Vitest tests: (1) Apply all migrations to a clean database, verify schema matches Drizzle schema definition. (2) Apply migrations sequentially from a known base state (simulating an existing deployment), verify each migration runs without error and produces the final schema. Test runs in CI for every PR.
  - **Dependencies:** T-02.03.01
  - **Complexity:** M

- **T-02.03.04:** Implement expand/migrate/contract documentation and PR checklist
  - **Notes:** Add a PR template guideline: schema changes must explain which phase (expand/migrate/contract) each change belongs to. Destructive changes must reference verified backup proof and have a separate follow-up PR for the contract phase. Archive deleted column data before removal where legally required.
  - **Dependencies:** T-02.03.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-02.04: Seed data — default electricity products and admin bootstrap

**Description:** As a platform engineer, I want a idempotent seed script that creates four default electricity products (thermal, green, free-market, energy-saving) and an admin bootstrap mechanism so that a fresh deployment has required entities without manual admin entry.

**Acceptance Criteria:**
- Four default electricity products are created automatically by seed: Thermal (`برق حرارتی`), Green (`برق سبز`), Free-market (`برق آزاد`), Energy-saving (`برق صرفه‌جویی`)
- Each product has an immutable `systemType` text key — these are not deletable via admin UI
- Running the seed multiple times does not create duplicate products (idempotent via `ON CONFLICT DO NOTHING` on system type)
- Each product's initial price is `null` (price must be set by admin before it becomes orderable)
- Seed creates one admin bootstrap account using credentials from environment variables
- Admin bootstrap only runs when `ADMIN_BOOTSTRAP_SECRET` env var is present; does not run in production with a hardcoded password
- First-time admin must change password at first login and enroll MFA before accessing admin settings
- Seed script is invokable via `pnpm db:seed`

**Tasks:**

- **T-02.04.01:** Create seed script `packages/db/src/seed/index.ts`
  - **Notes:** Import Drizzle instance and schema. Use upsert logic for default products. Log which entities were created vs skipped. Support `--force` flag to re-seed non-immutable data. Running `pnpm db:seed` calls this via a package.json script.
  - **Dependencies:** T-02.01.02, T-02.02.02
  - **Complexity:** M

- **T-02.04.02:** Create four default electricity products in seed
  - **Notes:** `systemType` values: `thermal`, `green`, `free_market`, `energy_saving`. Titles stored in Persian as above. English translations in i18n dictionaries. Each has `price: null`, `isActive: false`, `minKwh: 0`, `maxKwh: 0` (zero = no limit). Use `INSERT ... ON CONFLICT (system_type) DO NOTHING` for idempotency.
  - **Dependencies:** T-02.04.01
  - **Complexity:** M

- **T-02.04.03:** Create admin bootstrap mechanism
  - **Notes:** If `ADMIN_BOOTSTRAP_SECRET` is set and `ADMIN_BOOTSTRAP_KEY` exists, create an admin user with the provided email/phone, a temporary password (hashed with Argon2id). The temporary password is valid for one login; the first login forces password change and MFA enrollment. Bootstrap runs once and does not re-run if admin already exists.
  - **Dependencies:** T-02.04.01
  - **Complexity:** M

- **T-02.04.04:** Wire `pnpm db:seed` script in `packages/db/package.json`
  - **Notes:** Script: `"db:seed": "tsx src/seed/index.ts"`. Document in root README. Seed runs automatically in local dev setup (`pnpm dev` may trigger it). In production, seed is run as part of deployment only once.
  - **Dependencies:** T-02.04.01
  - **Complexity:** S

- **T-02.04.05:** Add seed verification test
  - **Notes:** Integration test that runs seed against a clean database, verifies 4 default products exist with correct systemType and null price, verifies re-running seed does not create duplicates, verifies admin user is created when bootstrap env vars are provided.
  - **Dependencies:** T-02.04.02, T-02.04.03
  - **Complexity:** M

- **T-02.04.06:** Configure database constraint to prevent deletion of system electricity products and creation of additional electricity-product types
  - **Notes:** Add a check constraint or trigger on the products table: for rows where `product_type = 'electricity'` and `system_type IS NOT NULL`, prevent `DELETE` and prevent `INSERT` of additional `product_type = 'electricity'` rows beyond the four defaults. Admins can activate/deactivate and set prices but cannot change `system_type`.
  - **Dependencies:** T-02.04.02
  - **Complexity:** M
  - **UI/UX:** N/A

---

### E-03: Docker Deployment & Containerization

**Description:** Build production Docker images for the three process types (web, API, worker), configure Docker Compose for local development, implement health checks, graceful `SIGTERM` handling, and readiness/liveness probes. API and worker use the same image with different startup commands; web uses its own image.

---

#### S-03.01: Dockerfiles for web, API, and worker processes

**Description:** As a platform engineer, I want optimized, multi-stage Docker builds for the three process types so that images are small, secure, and reproducible.

**Acceptance Criteria:**
- `Dockerfile.web` builds the TanStack Start frontend: dev → build → deploy stage
- `Dockerfile.api` builds the NestJS API with SWC or webpack
- `Dockerfile.worker` uses the same build stage as API but CMD differs (`CMD ["node", "dist/apps/api/main"]` vs `CMD ["node", "dist/apps/api/worker"]`)
- Multi-stage builds with a `dependencies` stage, `build` stage, and `production` stage
- Production stage uses `node:20-alpine` or `node:20-slim` (minimal base image)
- Image runs as non-root user (`node`), with read-only root filesystem where practical
- `HEALTHCHECK` instruction in Dockerfiles
- Node.js runs with `NODE_ENV=production`, inspector disabled, `insecureHTTPParser` not set
- Request/body/header/timeout limits set at the application layer (NestJS `body-parser` config, etc.)
- `.dockerignore` excludes `node_modules`, `.git`, `dist` (already built), test files, dev configs
- Images are tagged with `:latest` and `:git-sha` for traceability

**Tasks:**

- **T-03.01.01:** Create `Dockerfile.web` with multi-stage build
  - **Notes:** Stage 1 (deps): `pnpm install --frozen-lockfile --prod=false`. Stage 2 (build): copy source, `pnpm build --filter @barghsa/web`. Stage 3 (production): `pnpm install --frozen-lockfile --prod`, copy `dist/` from build, set `EXPOSE 3000`, `USER node`, `CMD node apps/web/server/index.js` (or framework output). Include `.npmrc` for strict engine check.
  - **Dependencies:** S-01.03
  - **Complexity:** M

- **T-03.01.02:** Create shared `Dockerfile.base` for API and worker (same build, different CMD)
  - **Notes:** Stages identical to web for deps and build but targeting packages/db, packages/shared, apps/api. Produce shared build output. The final image is the same; orchestrator passes different CMD. Works with both `docker run` argument override and Docker Compose `command` override. Export port 4000.
  - **Dependencies:** S-01.03, S-02.01
  - **Complexity:** M

- **T-03.01.03:** Create `.dockerignore`
  - **Notes:** Exclude: `node_modules/` (any depth), `.git/`, `dist/` (build stage produces it), `coverage/`, `.turbo/`, `.env`, `*.md` (except build-essential), `test/`, `e2e/`, `drizzle/` (migration snapshots not needed in final image), `.husky/`, `.vscode/`.
  - **Dependencies:** T-03.01.01, T-03.01.02
  - **Complexity:** S

- **T-03.01.04:** Add `HEALTHCHECK` instruction to all Dockerfiles
  - **Notes:** Web: `HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD node healthcheck.js` (curl localhost:3000/api/health). API: check `/api/health`. Worker: check via a small script or the readiness endpoint. Interval and start-period must account for NestJS module initialization.
  - **Dependencies:** T-03.01.01, T-03.01.02
  - **Complexity:** S

- **T-03.01.05:** Implement security hardening in Docker images
  - **Notes:** Use `--no-cache` in apk add if Alpine. Set `USER node:node` (non-root). Drop `--cap-drop=ALL` and add only `--cap-add=NET_BIND_SERVICE` if binding <1024 port. Set read-only root filesystem (`--read-only`) in production compose. Set `NODE_ENV=production` and ensure `--enable-source-maps` is removed in prod. No debugger exposed. Set `NODE_OPTIONS="--max-old-space-size=512"` for memory limit.
  - **Dependencies:** T-03.01.01, T-03.01.02
  - **Complexity:** M
  - **UI/UX:** N/A

---

#### S-03.02: Docker Compose for local development

**Description:** As a developer, I want a `docker-compose.yml` that runs PostgreSQL, Redis, and MinIO for local development so that I can start the full stack with one command and have a production-like environment.

**Acceptance Criteria:**
- `docker-compose.yml` defines services: `postgres`, `redis`, `minio`
- `postgres` uses `postgis/postgres:16` image with persistent volume and init script for UUIDv7 extension
- `redis` uses `redis:7-alpine` — optional, no persistent data required
- `minio` uses `minio/minio` with persistent volume, console on port 9001, API on port 9000
- Environment variables default to development-safe values in `.env.example`
- Service dependencies: app processes depend on `postgres` being healthy
- `pnpm dev` runs Turborepo dev mode with hot reload
- Hot reload uses `tsx watch` or SWC for NestJS and TanStack Start dev server for web
- `.env.example` contains all required variables with sensible development defaults; `DATABASE_URL`, `REDIS_URL`, `MINIO_*`, `SESSION_SECRET`, `CSRF_SECRET`, etc.
- OTP codes are printed to API console in dev environment
- SWC or webpack watch mode recompiles on save within ~500ms

**Tasks:**

- **T-03.02.01:** Create `docker-compose.yml` with PostgreSQL, Redis, MinIO
  - **Notes:** PostgreSQL: image `postgis/postgres:16`, port `5432`, volume `pgdata:/var/lib/postgresql/data`, env `POSTGRES_DB=barghsa`, `POSTGRES_USER=barghsa`, `POSTGRES_PASSWORD`. Redis: image `redis:7-alpine`, port `6379`. MinIO: image `minio/minio`, ports `9000:9000` (API), `9001:9001` (console), volume `minio-data:/data`, command `server /data --console-address ":9001"`. Add `healthcheck` to PostgreSQL (`pg_isready`) and MinIO (`curl -f http://localhost:9000/minio/health/live`).
  - **Dependencies:** None (infrastructure only)
  - **Complexity:** S

- **T-03.02.02:** Create `.env.example` with all required development variables
  - **Notes:** Required vars: `DATABASE_URL=postgresql://barghsa:password@localhost:5432/barghsa`, `REDIS_URL=redis://localhost:6379/0`, `MINIO_ENDPOINT=localhost`, `MINIO_PORT=9000`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_USE_SSL=false` (dev), `SESSION_SECRET`, `CSRF_SECRET`, `NODE_ENV=development`. Optional: `ADMIN_BOOTSTRAP_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`. Dev-only: `OTP_CONSOLE=true` to print OTPs to console. Document each variable with a comment.
  - **Dependencies:** T-03.02.01
  - **Complexity:** M

- **T-03.02.03:** Create root `pnpm dev` script for hot-reload local development across all apps
  - **Notes:** `turbo dev` runs `dev` in packages/db (watch mode for schema changes), apps/api (NestJS with `tsx watch src/main.ts` or SWC), apps/web (TanStack Start dev server). For `packages/ui` and `packages/shared`, use a watch mode that recompiles on file change. Dev starts all three processes in parallel.
  - **Dependencies:** T-03.02.02, S-01.01
  - **Complexity:** M

- **T-03.02.04:** Configure file-watch with proper polling for Docker-for-Mac compatibility
  - **Notes:** Turborepo's `daemon` polling, or use `CHOKIDAR_USEPOLLING=true` for file watchers inside Docker bind mounts. Document that macOS users may need polling for reliable hot reload.
  - **Dependencies:** T-03.02.03
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-03.03: Health checks, graceful shutdown, and readiness probes

**Description:** As a platform engineer, I want all application processes to expose separate liveness and readiness HTTP endpoints, handle `SIGTERM` gracefully, and shut down within a bounded window so that the orchestrator can manage the deployment lifecycle safely.

**Acceptance Criteria:**
- `/api/health/live` returns 200 (process is alive, simple check)
- `/api/health/ready` returns 200 only when all required dependencies are available (PostgreSQL, connection pool not exhausted, Redis connection if configured)
- A non-critical provider outage must NOT remove the whole API from service — readiness degrades gracefully
- On `SIGTERM`: stop accepting new HTTP requests (drain connections), finish in-flight work with a configurable deadline (default 30s), release any held leases, close database pool, close Redis, close object storage client, then exit
- Worker: on `SIGTERM`, stop leasing new jobs, finish running job with deadline, release lease, close pool, exit
- Web: on `SIGTERM`, drain HTTP keep-alive connections, flush SSR responses, close
- Processes exit with code 0 on clean shutdown, code 1 on forced kill after deadline
- Health endpoints are excluded from authentication, rate limiting, and audit

**Tasks:**

- **T-03.03.01:** Implement liveness and readiness controllers in NestJS API
  - **Notes:** Two endpoints: `GET /api/health/live` (returns `{ status: 'ok' }` immediately). `GET /api/health/ready` checks: PostgreSQL pool (accepting connections? idle > 0?), database reachable via `SELECT 1`. Redis: if configured and connection fails, warn but mark ready (it's optional). Object storage: check bucket accessible. Return 503 if critical deps fail. Set up Terminus (`@nestjs/terminus`) or custom health indicator.
  - **Dependencies:** T-02.01.04, S-02.01
  - **Complexity:** M

- **T-03.03.02:** Implement graceful `SIGTERM` handler for NestJS API and worker
  - **Notes:** Use NestJS `@nestjs/platform-express` shutdown hooks. `app.enableShutdownHooks()`. Register handler: signal → start grace period (30s). Stop accepting requests (close HTTP server). For worker: stop job leasing, await current job with timeout. Close all connections. Use `httpServer.close()` and await `pool.end()`. If grace period expires, `process.exit(1)`.
  - **Dependencies:** T-03.03.01
  - **Complexity:** M

- **T-03.03.03:** Implement graceful shutdown for web frontend server
  - **Notes:** TanStack Start dev server handles this in dev mode. Production Node.js server handles `SIGTERM`: stop accepting connections, drain existing keep-alive connections up to deadline, flush pending SSR responses, close server. If connections remain, force-close them after deadline.
  - **Dependencies:** S-03.01
  - **Complexity:** M

- **T-03.03.04:** Add readiness check that excludes non-critical dependencies
  - **Notes:** Only PostgreSQL is critical for ready status. If Redis is down, return ready with a warning header (`X-Health-Warning: redis-unavailable`). If object storage is down, return ready but mark degraded. AI provider, notification provider, and bill-data provider outages do NOT make the API non-ready — they show a per-degraded-capability maintenance mode.
  - **Dependencies:** T-03.03.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

### E-04: Infrastructure Services Provisioning

**Description:** Provision and configure the four infrastructure services that underpin all platform capabilities: PostgreSQL (source of truth), Redis (optional cache/coordination), S3/MinIO (object storage), and the reverse proxy/load balancer (TLS termination, rate limiting at edge). Each service has specific configuration, security, and operational requirements derived from the spec.

---

#### S-04.01: PostgreSQL with automated backups and point-in-time recovery

**Description:** As a platform engineer, I want PostgreSQL configured for production with automated backups, point-in-time recovery (PITR), encrypted backups, and tested quarterly restore procedures so that the RPO ≤ 5 minutes and RTO ≤ 60 minutes.

**Acceptance Criteria:**
- PostgreSQL runs version 16+ with `pgvector` and `uuid-ossp` extensions
- Automated daily full backups with continuous WAL archiving to S3-compatible object storage (or a separate volume)
- PITR capability — can restore to any point within the retention window (minimum 7 days)
- Backups are encrypted at rest (GPG or server-side encryption on object storage)
- Restore procedure documented and tested quarterly — measured RPO and RTO from each test
- Connection pooling via PgBouncer or application-level pool (PgBouncer recommended for production multi-replica setups)
- Production PostgreSQL runs on managed/separate infrastructure from the application VM when feasible
- Single-server deployments use encrypted off-server backups and clearly document lower availability
- Monitoring: replication lag, connection count, query duration, disk usage, WAL rate, backup age
- Alerts: backup failure, replica lag > 30s, disk > 80%, connection saturation

**Tasks:**

- **T-04.01.01:** Configure PostgreSQL connection pooling strategy
  - **Notes:** Decision: PgBouncer in transaction mode vs application-level pool. For commercial HA with multiple API replicas, PgBouncer is preferred to prevent connection exhaustion. Document decision in ADR. PgBouncer runs as a sidecar or separate container with configurable pool size. TLS connections between app and PgBouncer, and between PgBouncer and PostgreSQL.
  - **Dependencies:** S-02.01
  - **Complexity:** M

- **T-04.01.02:** Configure automated backups with WAL archiving and PITR
  - **Notes:** Use `pg_basebackup` for full backups or a managed service backup. WAL archiving to S3/MinIO via `archive_command` or `wal-g`. Backup retention: daily full kept for 14 days, WAL kept for 7 days (or until next full + 7 days for PITR). Verify backup integrity with `pg_verifybackup`. Encrypt backups with GPG symmetric key stored in secret manager.
  - **Dependencies:** T-04.01.01
  - **Complexity:** L

- **T-04.01.03:** Document and automate restore procedure
  - **Notes:** Create a runbook for: full restore from latest backup + WAL replay to point-in-time, restore to isolated environment. Script automation via Ansible/Shell: `restore-pg.sh`. Measure RTO per restore. Include instructions for: stop app, restore database, verify data, promote database, point app to restored DB. RTO target: ≤ 60 minutes for core services.
  - **Dependencies:** T-04.01.02
  - **Complexity:** L

- **T-04.01.04:** Implement PostgreSQL performance baseline and monitoring
  - **Notes:** Set `shared_buffers` (25% of RAM), `effective_cache_size` (75% of RAM), `work_mem` (32–64MB), `maintenance_work_mem` (256MB–1GB). Enable `pg_stat_statements`. Export key metrics via OpenTelemetry: connections used, queries per second, cache hit ratio, replication lag, deadlocks, tuple fetches, sequential scans vs index scans. Alert on: replication lag > 30s, long-running queries (>30s), connection pool saturation (>80%).
  - **Dependencies:** T-04.01.01
  - **Complexity:** M

- **T-04.01.05:** Quarterly restore exercise
  - **Notes:** Run a scheduled job (quarterly) that: spins up an isolated environment, restores latest backup + WAL replay to latest possible point, runs a set of verification queries (count users, count orders, count invoices, verify no data loss), records measured RPO and RTO, alerts if RPO > 5 min or RTO > 60 min.
  - **Dependencies:** T-04.01.03
  - **Complexity:** L

- **T-04.01.06:** Hybrid deployment: separate managed PostgreSQL from app VM
  - **Notes:** For production (not single-server), PostgreSQL runs on managed infrastructure (RDS, Cloud SQL, or dedicated VM). Application VM(s) connect over TLS with certificate validation. Firewall rules limit access to app VM IPs only. Single-server deployment documents lower availability and uses encrypted off-server backups.
  - **Dependencies:** T-04.01.02, E-05
  - **Complexity:** L
  - **UI/UX:** N/A

- **T-04.01.07:** Encrypted off-server backup of config, secrets, and critical application files
  - **Notes:** Extend the backup regime from PostgreSQL-only to include: application `.env` files, admin config snapshots (JSON export of all `active` config versions), encryption keys (wrapped copies), Docker Compose / deploy scripts, and TLS certificates. Backups are encrypted (GPG or envelope encryption) and stored off-server (same S3 target as DB backups or separate secure location). Add a quarterly restore test that verifies config rehydration and documents measured RPO/RTO for non-DB assets. Include a section in the restore runbook (T-04.01.03) covering config-and-file rehydration.
  - **Dependencies:** T-04.01.02
  - **Complexity:** M

---

#### S-04.02: Redis for caching and rate limiting

**Description:** As a platform engineer, I want Redis configured as an optional, disposable cache and coordination layer so that performance is improved when Redis is available but financial correctness, authorization, sessions, durable jobs, and state machines remain correct without it.

**Acceptance Criteria:**
- Redis connection is optional — app starts without Redis and degrades gracefully
- Redis caches only data with a clear invalidation rule and measurable benefit: short-lived configuration, session cache, distributed rate-limit counters
- Cache miss falls back to PostgreSQL — no data is exclusively stored in Redis
- Redis loss must NOT: lose durable work, change a balance, grant access, corrupt a state machine, or fail a core API request
- Redis TTLs are set with reasonable max (default 5 minutes for config cache, 1 minute for rate-limit counters)
- Rate limiting uses layered keys (IP, user, profile, action) with Redis acceleration; critical abuse counters (OTP/IP limits) are also durable in PostgreSQL
- Session blacklist/revocation is stored in Redis for speed but also persisted in PostgreSQL
- Connection uses TLS in production; plaintext in dev

**Tasks:**

- **T-04.02.01:** Create Redis connection factory with graceful fallback
  - **Notes:** Factory `createRedisClient(config: RedisConfig)` returns a client or `null` if `REDIS_URL` is not configured. On connection error, log warning and return `null`. All app code checks `if (redis)` before using. Health endpoint reports Redis status but does not mark app non-ready if Redis is unavailable.
  - **Dependencies:** None (standalone)
  - **Complexity:** M

- **T-04.02.02:** Implement distributed rate-limiting with Redis acceleration + PostgreSQL fallback
  - **Notes:** Sliding window or token bucket counters. Redis: `INCR` + `EXPIRE` for high-frequency limits. When Redis is unavailable, fall back to PostgreSQL counters using `INSERT ... ON CONFLICT` with rate-limit rows. OTP counters, password-attempt counters always keep PostgreSQL backing store (they are security-critical). Redis loss must not bypass rate limits — PostgreSQL fallback provides degraded but functional enforcement.
  - **Dependencies:** T-04.02.01, S-02.01
  - **Complexity:** L

- **T-04.02.03:** Implement configuration caching with clear invalidation
  - **Notes:** Admin config settings (VAT rates, product prices, thresholds) are immutable and change infrequently. Cache them in Redis for 5 minutes with a key prefix `config:*`. On admin config version change, publish a Redis invalidation event or bump a version counter. Cache miss → read from PostgreSQL → populate Redis. Never serve stale config for financial calculations.
  - **Dependencies:** T-04.02.01
  - **Complexity:** M

- **T-04.02.04:** Document Redis architecture decision in ADR
  - **Notes:** Create `docs/adr/002-redis-scope.md`: Redis is optional, disposable, never a source of truth. Its role: cache for read-heavy config, distributed rate-limit acceleration, short-lived coordination locks. Financial correctness, durable jobs, sessions, and authorization must remain correct if Redis is flushed or unavailable. Each cache entry has documented TTL and invalidation strategy.
  - **Dependencies:** T-04.02.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-04.03: S3/MinIO object storage setup

**Description:** As a platform engineer, I want S3-compatible object storage configured with versioning, lifecycle policies, encryption, and short-lived presigned URL access so that file uploads, documents, and generated artifacts are securely stored and cost-controlled.

**Acceptance Criteria:**
- Provider abstraction layer supports: Amazon S3, MinIO (local dev), any S3-compatible service
- Admins configure: endpoint, region, bucket, access key, secret key, path-style behavior, private/public endpoints
- Secrets are encrypted at rest, masked after entry, excluded from logs, unavailable to frontend
- Safe connection test in admin UI before activation
- Bucket has versioning enabled (protect against accidental deletion/overwrite)
- Lifecycle policies: temporary uploads expire after 24 hours, generated previews after 7 days, superseded non-regulated files after 90 days, incomplete multipart uploads after 1 day
- Never expire records under legal hold
- Objects are private by default; access via short-lived scoped URLs (presigned) or backend streaming
- Direct upload/download between browser and object storage using presigned URLs after backend authorization (API records metadata without proxying large bodies)
- Files linked to financial, contractual, order, or audit records cannot be permanently deleted through ordinary UI — soft delete only
- Contract versions and signed documents are immutable

**Tasks:**

- **T-04.03.01:** Create S3 storage provider abstraction
  - **Notes:** Interface: `StorageProvider` with methods: `putObject(key, body, contentType, metadata)`, `getObject(key) → stream`, `deleteObject(key)`, `presignedPutUrl(key, expiresIn) → URL`, `presignedGetUrl(key, expiresIn) → URL`, `listObjects(prefix)`. Implementation: `S3StorageProvider` using `@aws-sdk/client-s3`. Factory selects provider based on config.
  - **Dependencies:** None (standalone)
  - **Complexity:** M

- **T-04.03.02:** Implement presigned URL workflow for direct browser upload/download
  - **Notes:** On upload request, API validates: file type (allowlisted extensions + MIME detection), size limits, user/profile permissions, business record association. On success, returns a presigned PUT URL. Frontend uploads directly to S3 from browser. After upload, API verifies the object exists (by checksum or metadata call) and marks it as Pending scan. Never proxy large file bodies through API.
  - **Dependencies:** T-04.03.01
  - **Complexity:** L

- **T-04.03.03:** Configure bucket versioning and lifecycle policies
  - **Notes:** Enable versioning via S3 API (apply in setup script). Lifecycle rules: (a) prefix `tmp/` or `uploads/` — expire after 1 day. (b) prefix `previews/` — expire after 7 days. (c) prefix `superseded/` — expire after 90 days. (d) incomplete multipart uploads — abort after 1 day. Noncurrent version transitions: keep last 5 versions. Legal hold: tag-based exemption.
  - **Dependencies:** T-04.03.01
  - **Complexity:** M

- **T-04.03.04:** Create admin configuration UI for storage
  - **Notes:** Admin page: endpoint, region, bucket, access key, secret key (masked, write-only). Path-style toggle. Private endpoint URL, public endpoint URL. Connection test button. Validate that secrets are encrypted at rest using AES-256 (AWS KMS or envelope encryption with local key). UI never exposes secret key values after entry.
  - **Dependencies:** T-04.03.01, E-04 cross-epic Narration
  - **Complexity:** L
  - **UI/UX:** Settings page with masked fields, "Test Connection" button, success/failure feedback. On save, validate connection before marking config Active.

- **T-04.03.05:** Enforce immutability for signed contracts and critical records
  - **Notes:** When a document is signed/approved/immutable, the storage layer prevents `deleteObject` for those keys via a DB check. Soft delete only: marks the record as `Removed` in PostgreSQL but retains object in storage (version history preserved). S3 versioning keeps previous versions even if overwritten accidentally.
  - **Dependencies:** T-04.03.01
  - **Complexity:** M
  - **UI/UX:** N/A

---

#### S-04.04: Reverse proxy / Load balancer configuration

**Description:** As a platform engineer, I want a reverse proxy / load balancer (NGINX or Caddy) that terminates TLS, routes traffic to web and API processes, applies edge rate limiting, sets security headers, and supports both pilot (single-node) and commercial HA (multi-replica) topologies.

**Acceptance Criteria:**
- TLS termination with modern protocols (TLS 1.3+, no SSL/TLS <1.2)
- HSTS only after production TLS and subdomain impact are verified
- CSP delivered through HTTP headers in Report-Only initially, then enforcement with nonce/hash-based policy
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `frame-ancestors 'none'`
- Rate limiting at edge: per-IP bursts for auth/OTP endpoints, upload endpoints, AI endpoints
- Request size limits: body 10MB default (upload endpoints have higher limits at the application level)
- WebSocket support for AI streaming responses
- Forwarded headers: `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Real-IP` properly configured for backend IP awareness
- Cookie paths restricted: `/api/auth` for auth cookies, `/api` for API cookies
- Static asset caching: immutable hashed assets cached aggressively (max-age 1 year), authenticated responses set `Cache-Control: private, no-cache`
- Proxy trust configured to exact hop topology, not enabled globally

**Tasks:**

- **T-04.04.01:** Create NGINX/Caddy configuration for pilot (single-node) topology
  - **Notes:** Single upstream for web (127.0.0.1:3000) and API (127.0.0.1:4000). Use Caddy for automatic TLS if managed certs are desired, or NGINX with cert files. Configure: `location /api/` → API upstream, `location /` → web upstream. Set `proxy_buffering off` for AI/SSE streaming. Enable gzip/brotli for static assets. Apply `client_max_body_size 10m`.
  - **Dependencies:** S-03.01, E-05 topology
  - **Complexity:** M

- **T-04.04.02:** Configure security headers in reverse proxy
  - **Notes:** Set `X-Content-Type-Options: nosniff` on every response. Set `Referrer-Policy: strict-origin-when-cross-origin`. Set `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Set `frame-ancestors 'none'`. Start CSP in Report-Only mode: `Content-Security-Policy-Report-Only` with restrictive `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `script-src 'strict-dynamic' 'nonce-<random>'` (app generates nonces), `style-src 'self' 'unsafe-inline'` (shadcn requires inline), `img-src 'self' data: blob:`, `font-src 'self'`, `connect-src 'self'`, `form-action 'self'`. Collect reports to a CSP reporting endpoint. Enforce only after all violations are resolved.
  - **Dependencies:** T-04.04.01
  - **Complexity:** L

- **T-04.04.03:** Configure edge rate limiting for auth, upload, and AI endpoints
  - **Notes:** NGINX `limit_req_zone` per IP for: `/api/auth/*` (burst=5, rate=10r/s), `/api/upload/*` (burst=3, rate=5r/s), `/api/ai/*` (burst=2, rate=5r/s). Return `429` with `Retry-After` header and JSON error body. These are defense-in-depth — application rate limits remain the primary control.
  - **Dependencies:** T-04.04.01
  - **Complexity:** M

- **T-04.04.04:** Configure static asset caching and CDN readiness
  - **Notes:** Assets under `/assets/` (hashed filenames) get `Cache-Control: public, immutable, max-age=31536000`. Other static files: `max-age=86400`. For CDN: add `Vary: Accept-Encoding` if not default. Authenticated API responses (`/api/*`) set `Cache-Control: private, no-cache, no-store, must-revalidate` at application level.
  - **Dependencies:** T-04.04.01
  - **Complexity:** S
  - **UI/UX:** N/A

- **T-04.04.05:** Implement ETag support for safe metadata endpoints
  - **Notes:** Add NestJS interceptor or middleware that computes ETags (SHA-256 of response body) for safe read-only metadata endpoints: product lists, province/city data, static reference data. Return `304 Not Modified` when `If-None-Match` matches. Never apply ETag to authenticated profile-scoped, financial, or rapidly changing data. Document that ETags are for bandwidth reduction on safe data, not for cache correctness of stateful resources.
  - **Dependencies:** T-04.04.04
  - **Complexity:** S

---

### E-05: Deployment Topology & CI/CD Pipeline

**Description:** Define and implement the two deployment topologies (pilot/low-traffic and commercial HA) and the full CI/CD pipeline with four quality gates: PR gate, main/staging gate, production promotion gate, and scheduled quality gates. All deployment automation uses Docker images with health checks, graceful shutdown, backward-compatible migrations, and automatic rollback.

---

#### S-05.01: Pilot / low-traffic deployment topology

**Description:** As a platform engineer, I want a minimal, single-server-friendly topology that runs web, API, and worker on one application VM with managed PostgreSQL and object storage, suitable for initial pilot and low-traffic phases.

**Acceptance Criteria:**
- One reverse proxy/load balancer (NGINX/Caddy on the same VM or adjacent)
- One web process (port 3000)
- One API process (port 4000)
- One worker process (internal, no external port)
- All three processes may run on one application VM
- PostgreSQL managed or hosted separately from the application VM when feasible
- Optional Redis (application degrades safely without it)
- S3-compatible object storage with versioning
- Fully single-server deployment (all on one VM) is supported with documented lower availability and encrypted off-server backups
- Deployment automation uses Ansible or shell scripts: pull Docker image, run health checks, switch traffic
- Start-new-then-switch deployment strategy (where resources permit): start new container alongside old, health-check passes, switch proxy, stop old
- Routine application releases should not require planned downtime (single-server may have brief window)

**Tasks:**

- **T-05.01.01:** Create Ansible playbook or deploy script for pilot topology
  - **Notes:** Script: `deploy-pilot.sh`. Steps: pull latest Docker images, run migration (`docker run --rm ... pnpm db:migrate`), start new containers with `docker-compose.prod.yml` (single VM). Health check each container. If readiness passes, update proxy config to point at new instances. Stop old containers. Handle rollback: if health fails, keep old containers running and log failure.
  - **Dependencies:** E-03, E-04
  - **Complexity:** L

- **T-05.01.02:** Create `docker-compose.prod.yml` for pilot single-VM deployment
  - **Notes:** Services: `postgres` (with persistent volume, backups, WAL archiving), `redis` (optional, commented out if not used), `minio` (or external S3 config), `api` (image, port 4000, depends on postgres, healthcheck), `web` (image, port 3000, depends on api), `worker` (image, command, depends on postgres). Environment variables sourced from `.env.production` or secret manager. For full single-server: all on one host.
  - **Dependencies:** E-03, E-04
  - **Complexity:** M

- **T-05.01.03:** Document explicitly that single-server deployment has lower availability
  - **Notes:** Single-server availability target: 99.5% (without HA commitment). Document risks: no redundancy, host failure = full outage. Must use encrypted off-server backups. Must not process real customer payments without at least separate PostgreSQL/storage. Include in runbook.
  - **Dependencies:** T-05.01.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-05.02: Commercial high-availability topology

**Description:** As a platform engineer, I want a production HA topology with at least two stateless replicas across two failure domains behind a managed load balancer, redundant worker capacity, and PostgreSQL automatic failover to target 99.9% availability for real payment processing.

**Acceptance Criteria:**
- At least two stateless web/API replicas across two failure domains (AZs, regions, or physically separate hosts)
- Managed load balancer distributes traffic (ELB/ALB, HAProxy, or cloud LB)
- Redundant worker capacity (≥2 worker processes)
- PostgreSQL with automatic failover or tested managed recovery (RDS Multi-AZ, Patroni, or managed DB with failover)
- Still uses the same modular-monolith images — no Kubernetes or microservices required
- Vertical scaling first; horizontal replicas added earlier where required for HA topology
- Rolling or blue/green deployment: zero-downtime releases (brief connection drain)
- Health checks: LB checks `/api/health/ready` before routing traffic; unhealthy replica is removed from rotation
- Graceful shutdown: drain connections, finish in-flight work, then terminate
- Automated rollback on readiness/smoke failure
- Circuit breaker at application layer per external provider (payment, SMS, storage, bill-data)

**Tasks:**

- **T-05.02.01:** Design and document commercial HA topology
  - **Notes:** Document the architecture: managed LB → two+ API replicas (host A, host B), two+ web replicas, two+ workers. PostgreSQL Multi-AZ or Patroni cluster. Redis optional, cross-replica cache. S3 object storage (already HA). N+1 redundancy for all application processes. PgBouncer for connection pooling across replicas. RTO ≤ 60 min via automatic failover.
  - **Dependencies:** E-04, S-05.01
  - **Complexity:** L

- **T-05.02.02:** Configure rolling/blue-green deployment automation for HA
  - **Notes:** Use Ansible/Terraform + deployment scripts. Pattern: provision new instance(s), run migration, health-check new instances, add to LB, drain old instances, terminate. On health failure: automatically remove new instances and keep old in rotation (rollback). Include smoke test step after migration before routing traffic.
  - **Dependencies:** T-05.02.01
  - **Complexity:** L

- **T-05.02.03:** Implement circuit breaker for external providers
  - **Notes:** Each external provider (payment gateway, SMS.ir, Resend, bill-data API) gets a circuit breaker: configurable failure threshold (default 5 in 60s), half-open timeout (default 30s), and break duration (default 120s). When circuit is open, queue safe async work or show "Service temporarily unavailable" — never report false success. Implement with `opossum` or a custom state machine. Metrics: circuit state, failure rate.
  - **Dependencies:** T-05.02.01
  - **Complexity:** L

- **T-05.02.04:** Configure maintenance mode per capability, not whole-application
  - **Notes:** Each capability (electricity ordering, saving plans, solar, wallet top-up, AI chat) can be individually disabled. Admin toggle with optional reason message shown to customers. When a capability is disabled, affected pages show "This service is temporarily unavailable" with support contact. Other capabilities remain functional. Never disable login, support/ticketing, contracts list, invoices, or refund access.
  - **Dependencies:** T-05.02.01
  - **Complexity:** M
  - **UI/UX:** Banner on affected pages: "[Service name] is temporarily unavailable. [optional reason]. Contact support if you need assistance." Action buttons are disabled/hidden. Navigation to affected sections shows a clear maintenance page. Staff see a management page to toggle capabilities.

---

#### S-05.03: CI/CD — PR quality gate

**Description:** As a developer, I want an automated PR gate that runs formatting, linting, type checking, tests, migration validation, OpenAPI drift check, production build, coverage, and security scans so that every PR meets quality standards before merge.

**Acceptance Criteria:**
The PR gate MUST check all of the following, failing the PR if any fails:

1. Formatting and linting (ESLint + Prettier)
2. TypeScript type checking (no new suppressed errors)
3. Unit and component tests for affected packages (Vitest)
4. Relevant PostgreSQL integration tests for affected packages
5. Migration validation on a clean database AND an upgrade-path database (two scenarios)
6. OpenAPI generation and client/schema drift check (generated spec must match source)
7. Production build and route bundle budget check
8. Changed-code coverage thresholds (80% line / 75% branch; critical domains 90%/85%)
9. Secret scan (detect committed secrets, tokens, keys)
10. Dependency/SCA scan (Software Composition Analysis)
11. SAST (Static Application Security Testing)
12. License policy check (no forbidden licenses)
13. No unresolved Critical/High security finding with a credible path in changed production code
14. Required review from owning domain; Finance/Security/Legal review when their protected rules change

**Tasks:**

- **T-05.03.01:** Create CI workflow definition (GitHub Actions, GitLab CI, or equivalent)
  - **Notes:** Trigger: `pull_request` (opened, synchronize). Run on push to PR branch. Matrix: run tests on affected packages only (use Turborepo filtering). PostgreSQL service container for integration tests. Steps in order: checkout → pnpm install → format/lint → typecheck → build affected → unit tests → migration validation → OpenAPI drift → bundle budget → coverage → secret scan → SCA → SAST → license check → security findings gate → required reviews.
  - **Dependencies:** S-01.01, S-01.03, S-01.04, S-02.03
  - **Complexity:** XL

- **T-05.03.02:** Implement migration validation step (two environments)
  - **Notes:** Step 1 (clean DB): apply all migrations from scratch, verify schema matches Drizzle definitions. Step 2 (upgrade path): start with schema from the previous release's migration point, apply only the new PR's migrations, verify schema matches expected final state. Both steps use a temporary PostgreSQL instance (service container).
  - **Dependencies:** S-02.03
  - **Complexity:** M

- **T-05.03.03:** Implement OpenAPI generation and drift check
  - **Notes:** PR gate generates OpenAPI spec from NestJS decorators (`nestjs/swagger` plugin). Compare generated spec against committed `openapi.json`. If spec differs, fail the check — developer must regenerate and commit the updated spec. Breaking API changes require version negotiation or migration period.
  - **Dependencies:** T-05.03.01
  - **Complexity:** M

- **T-05.03.04:** Configure security scans in PR gate
  - **Notes:** Secret scan: `trufflehog` or `gitleaks` — scan entire repo for secrets/keys. Dependency/SCA: `pnpm audit` or `snyk` (or `npm audit` for root). SAST: `semgrep` or `codeql` — custom rules for SQL injection, XSS, SSRF, hardcoded credentials, open redirects. License: `license-checker` or `fossa` — enforce allowlist (MIT, Apache-2.0, ISC, BSD-2/3). Security findings: block PR on Critical/High with credible production path; accepted risk requires owner, justification, compensating control, expiry.
  - **Dependencies:** T-05.03.01
  - **Complexity:** L

- **T-05.03.05:** Implement coverage threshold enforcement
  - **Notes:** Using `vitest --coverage`, extract per-package line/branch percentages. Compare against thresholds. Fail if changed code in any package falls below threshold. Publish coverage report as CI artifact.
  - **Dependencies:** T-01.04.02
  - **Complexity:** M
  - **UI/UX:** N/A

---

#### S-05.04: Staging gate and production promotion gate

**Description:** As a platform engineer, I want staging and production promotion gates that validate full integration, cross-browser E2E, accessibility, container security, migration rehearsal, and production readiness before and after deployment.

**Acceptance Criteria:**

**Staging gate** (after merge to main, before release candidate):
- Full unit and PostgreSQL integration suites (all packages, not just affected)
- Critical Chromium E2E suite
- Accessibility automation (axe-style checks on critical pages)
- Container image build, vulnerability scan, and SBOM generation
- Smoke deployment with readiness/liveness checks
- Migration rehearsal against a production-like schema/data volume
- Provider contract tests using sandbox/fake endpoints
- No P0/P1 defect and no unexplained flaky critical test

**Production promotion gate** (before production release):
- Successful release-candidate E2E across required browsers for affected critical flows
- Security/DAST and performance smoke within budgets
- Backward-compatible migration and verified rollback/roll-forward plan
- Recent successful backup (<24h) and healthy restore-test status
- Feature flag/kill switch for high-risk rollout where practical
- Release notes, customer/support impact, owner, monitoring dashboard, alert/runbook links, on-call coverage
- Automated post-deploy smoke tests and SLO/error comparison against previous release
- Canary or gradual flag rollout for high-risk changes (payment, wallet, authorization, contract, pricing)
- Automatic halt or rollback on: smoke failure, elevated error/SLO burn, reconciliation mismatch, security alert

**Tasks:**

- **T-05.04.01:** Create staging gate CI workflow
  - **Notes:** Trigger: `push` to `main` or `develop`. Steps in order: checkout → pnpm install → full build → full unit test → full integration test (real PostgreSQL) → critical Chromium E2E → a11y audit (axe) → container build (all Dockerfiles) → container vulnerability scan (Trivy or Grype) → SBOM generation (CycloneDX) → migration rehearsal (production-like schema + data volume) → provider contract tests → staging smoke deploy → readiness/liveness checks → P0/P1/flaky check.
  - **Dependencies:** S-05.03, E-01, E-02, E-03
  - **Complexity:** XL

- **T-05.04.02:** Create production promotion workflow with canary/gradual rollout
  - **Notes:** Trigger: manual approval after staging gate passes. Steps: check backup age (<24h) and restore-test status → run release-candidate E2E across required browsers → run DAST (OWASP ZAP) smoke → performance smoke (compare p95 latency against budget) → verify migration plan → verify rollback/roll-forward plan → verify feature flag/kill-switch exists for high-risk changes → deploy to canary (one replica, no production traffic) → automated smoke test on canary → if canary passes, gradual rollout (10% → 50% → 100%) with SLO/error monitoring → halt/rollback on error spike or reconciliation mismatch.
  - **Dependencies:** T-05.04.01, S-05.02
  - **Complexity:** XL

- **T-05.04.03:** Implement post-deploy smoke tests and SLO comparison
  - **Notes:** After production deployment, run a set of non-destructive automated smoke tests: login as test user, view dashboard, check wallet balance (read-only), verify health endpoint. Compare p95 latency, error rate, and SLO burn rate against pre-deployment baseline. Alert if significant degradation detected. Publish comparison report.
  - **Dependencies:** T-05.04.02
  - **Complexity:** L

- **T-05.04.04:** Create runbooks for rollback scenarios
  - **Notes:** Runbooks: (1) Rollback code: redeploy previous Docker image, run migration rollback (reverse migration), verify. (2) Rollback config: activate previous safe config version. (3) Rollback data: restore PostgreSQL from backup + PITR if migration caused data loss. (4) Rollback feature: disable feature flag. Each runbook has severity, owner, steps, verification criteria.
  - **Dependencies:** T-05.04.02
  - **Complexity:** L
  - **UI/UX:** N/A

---

#### S-05.05: Scheduled quality gates

**Description:** As a platform engineer, I want automated scheduled quality checks (nightly, weekly, quarterly) that catch regressions, flaky tests, dependency drift, performance regressions, and ensure disaster-recovery readiness.

**Acceptance Criteria:**

**Nightly:**
- Full critical E2E on Chromium, Firefox, and WebKit (rotation)
- Critical E2E on mobile viewports
- Dependency/security scan (up-to-date CVE database)
- Dead-link/schema checks
- Flaky-test report (list of quarantined tests, pass/fail rate over past 7 days)

**Weekly:**
- Representative load/performance regression test (the 7 critical paths from Performance engineering)
- Critical-domain mutation testing where useful
- Dependency update review (pnpm outdated triage)

**Quarterly:**
- PostgreSQL/object restore exercise (measure RPO and RTO, document results)
- Disaster-recovery rehearsal (simulate full region/VM loss)
- Access review (staff role assignments, API keys, service accounts)
- Threat-model review (update for material flow changes)
- Incident/runbook exercise (simulate payment mismatch, credential compromise)

**Tasks:**

- **T-05.05.01:** Create nightly CI schedule
  - **Notes:** Cron: daily at 02:00. Run: cross-browser E2E (Chromium + Firefox + WebKit, sequential or parallel on separate runners), mobile viewport E2E, dependency scan (with updated CVE database), dead-link checker (check all navigation links in the app), schema validation (Drizzle generate + verify no drift), flaky-test analysis (query CI results from past 7 days, compile flaky report). Results posted to a dedicated channel/email.
  - **Dependencies:** T-05.04.01, T-01.04.06
  - **Complexity:** L

- **T-05.05.02:** Create weekly load/performance regression test
  - **Notes:** Cron: weekly on Sunday. Use k6 or artillery to run load tests against a staging environment (or isolated). Test paths: electricity price preview, order submission, wallet payment, invoice list, CRM search, file upload authorization, notification fan-out. Compare p50/p95/p99 latency against declared budgets (p95 reads <300ms, writes <500ms). Report regression if any path exceeds budget + 20% tolerance.
  - **Dependencies:** T-05.05.01
  - **Complexity:** L

- **T-05.05.03:** Create quarterly disaster-recovery and restore exercise
  - **Notes:** Cron: quarterly on first Saturday. Steps: (1) Restore PostgreSQL from latest backup in isolated environment, measure RPO and RTO. (2) Restore object storage from backup/versioning. (3) DR simulation: bring up a fresh deployment from backups in a separate environment, verify critical user journey works. (4) Document measured RPO/RTO. Alert if RPO > 5 min or RTO > 60 min for core services.
  - **Dependencies:** T-04.01.05
  - **Complexity:** XL

- **T-05.05.04:** Create quarterly access review and threat-model update
  - **Notes:** Automate: export all staff role assignments, API key metadata (masked keys, creation date, last used), service account list. Manual review required to validate access appropriateness. Update threat model: walk through auth, active-profile isolation, wallet/payment/refund, contracts/signatures, file upload, admin configuration, external providers, AI tool execution. Update for material flow changes since last review.
  - **Dependencies:** T-05.05.03
  - **Complexity:** M
  - **UI/UX:** N/A

---

### E-06: Shared Contracts, Validation & Internationalization

**Description:** Build the three shared packages that enable cross-domain collaboration: `packages/shared` (Zod schemas, username helpers, stable error codes), `packages/i18n` (Persian and English message dictionaries with Jalali/Gregorian date formatting), and `packages/ui` (shared shadcn/Base UI component library with RTL/LTR, light/dark theme, and accessibility).

---

#### S-06.01: Shared Zod schemas and validation helpers (`packages/shared`)

**Description:** As a developer, I want a shared package of Zod schemas, validation helpers, and stable error codes used by both frontend and backend so that validation rules are defined once and enforced everywhere.

**Acceptance Criteria:**
- `packages/shared` exports Zod schemas for: username (email or E.164 mobile), password (with strength requirements), UUIDv7 validation, IRR amount (positive integer), half-open date ranges, enumeration of all domain statuses, pagination parameters (cursor, limit, offset)
- Username helper: detect email vs Iranian mobile number vs E.164 format; convert mobile to E.164 before backend submission
- Password validation: minimum 8 chars, at least one uppercase, lowercase, digit; strength meter levels (weak/fair/strong)
- Stable machine-readable error codes enum: `AUTH_INVALID_CREDENTIALS`, `RATE_LIMIT_EXCEEDED`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `IDEMPOTENCY_CONFLICT`, `PROVIDER_ERROR`, `INTERNAL_ERROR`, each with HTTP status mapping
- Pagination helpers: `cursorPaginationSchema`, `offsetPaginationSchema` with max limit enforcement (default max 100, configurable)
- All entities with `id` field validate UUIDv7 format with optional prefix validation
- Schema is versioned; breaking changes require a new version with backward-compatible migration period
- Frontend and backend both import from `@barghsa/shared` — no duplicated validation logic

**Tasks:**

- **T-06.01.01:** Initialize `packages/shared` with tsconfig and dependencies
  - **Notes:** Package name: `@barghsa/shared`. Dependencies: `zod`. Build: `tsup` or `tsc` for ESM + CJS. Exports map: `"."` for main, `"./errors"` for error codes, `"./pagination"` for pagination schemas, `"./types"` for domain enums.
  - **Dependencies:** S-01.02
  - **Complexity:** S

- **T-06.01.02:** Create username validation and normalization helpers
  - **Notes:** Functions: `parseUsername(input)` returns `{ type: 'email' | 'mobile', value: string }`. If mobile and not in E.164, format: Iranian mobile (starts with 09) → `+98XXXXXXXXX`. `isE164(value)` validates regex `/^\+[1-9]\d{6,14}$/`. `isEmail(value)` validates Zod email. Backend only accepts E.164. Frontend formats before sending. Username uniqueness: case-insensitive for email, normalized E.164 for mobile.
  - **Dependencies:** T-06.01.01
  - **Complexity:** M

- **T-06.01.03:** Create password validation with strength meter logic
  - **Notes:** Zod schema: `passwordSchema` with min 8 chars, at least one of each: uppercase, lowercase, digit. Optional: special character. Strength calculation: `passwordStrength(password)` → `{ score: 0-4, label: 'weak'|'fair'|'strong'|'very strong', feedback: string }`. Use zxcvbn-like algorithm or simple rules-based. Frontend imports for password meter component.
  - **Dependencies:** T-06.01.01
  - **Complexity:** M

- **T-06.01.04:** Create stable error code enum with HTTP status mapping
  - **Notes:** Error codes as `const` object or TypeScript `enum`. Each code maps to: `httpStatus: number`, `title: string` (English), `retryable: boolean`. Backend returns `{ error: { code: string, message: string (localized), correlationId: string } }`. Never expose stack traces or raw provider/database errors.
  - **Dependencies:** T-06.01.01
  - **Complexity:** S

- **T-06.01.05:** Create pagination helper schemas
  - **Notes:** `cursorPaginationSchema`: `{ cursor: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(20) }`. `offsetPaginationSchema`: `{ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) }`. Prefer cursor/keyset pagination for large or frequently changing datasets; offset is acceptable for small admin tables.
  - **Dependencies:** T-06.01.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-06.02: Internationalization foundation (`packages/i18n`)

**Description:** As a user, I want the application fully localized in Persian (default) and English with RTL/LTR layout switching, Jalali/Gregorian calendar support, timezone-aware date/time display, and localized date pickers so that the interface is comfortable in either language.

**Acceptance Criteria:**
- `packages/i18n` exports message dictionaries for `fa` and `en` locales
- Persian (FA) is the default locale; English is the alternate
- Every user-visible string uses i18n — no hardcoded text in components
- All dates/times display in user-configured timezone (default: Iran Standard Time UTC+3:30)
- Changing language between Persian/English changes date representation (Jalali ↔ Gregorian) automatically, never changes underlying stored UTC timestamp
- Localized date picker: Persian users see a Jalali calendar picker, English users see Gregorian
- Calendar arithmetic correctly handles: 29/30/31-day Jalali months, leap years, month-start boundaries
- Half-open period display: "[start, end)" formatted in user's locale
- Theme direction flips: Persian = RTL, English = LTR — layout, text alignment, icons, margins all reverse
- Translation keys follow `domain.section.element.action` convention (e.g., `auth.login.title`, `order.electricity.form.quantity`)
- Missing translation keys fall back to English, not a blank or raw key
- Number/currency formatting: IRR with Persian/Eastern Arabic numerals or Western digits (admin-configurable)

**Tasks:**

- **T-06.02.01:** Initialize `packages/i18n` with message dictionary structure
  - **Notes:** Package name: `@barghsa/i18n`. Export a `createI18n(locale: 'fa' | 'en')` function returning a typed dictionary. Use TypeScript `Record` types for compile-time safety on translation keys. Directory structure: `locales/fa.ts`, `locales/en.ts`. Strings are organized by domain: `auth`, `crm`, `products`, `electricity`, `saving`, `solar`, `contract`, `invoice`, `wallet`, `documents`, `tickets`, `admin`, `notifications`, `errors`, `common`. Fallback strategy: if key missing in `fa`, use `en` key.
  - **Dependencies:** S-01.02
  - **Complexity:** M

- **T-06.02.02:** Create Jalali calendar date utilities
  - **Notes:** Use `date-fns-jalali` or `jalaali-js` for Jalali ↔ Gregorian conversion without a heavy library. Functions: `toJalali(date: Date) → { year, month, day }`, `toGregorian(jy, jm, jd) → Date`, `formatDate(date, locale, format)`, `formatRelative(date, locale)`, `getJalaliMonthDays(year, month)` (handles 29-31 days and leap years). Period display: `formatPeriod(start, end, locale)` → "۱۴۰۲/۰۱/۰۱ to ۱۴۰۲/۰۲/۰۱".
  - **Dependencies:** T-06.02.01
  - **Complexity:** L

- **T-06.02.03:** Create timezone-aware date/time display utilities
  - **Notes:** All timestamps stored as UTC `timestamptz`. When displaying, convert to user's configured timezone (default: `Asia/Tehran`, UTC+3:30). Use `Intl.DateTimeFormat` with `timeZone` option. Functions: `formatInTimezone(utcDate, timezone, locale, format)`, `formatTime(utcDate, timezone)`, `formatDate(utcDate, timezone, locale)`. User can change timezone in profile settings.
  - **Dependencies:** T-06.02.01
  - **Complexity:** M

- **T-06.02.04:** Create logic for RTL/LTR switching based on locale
  - **Notes:** When locale is `fa`, set `<html dir="rtl">`, when `en`, set `ltr`. CSS variables or Tailwind `rtl:`/`ltr:` modifiers handle layout flip. Export a `useDirection()` hook that returns `'rtl' | 'ltr'` based on current locale. Components use this for icon positioning, text alignment, margin/padding mirroring.
  - **Dependencies:** T-06.02.01, S-06.03
  - **Complexity:** M

- **T-06.02.05:** Localize number/currency formatting
  - **Notes:** IRR amounts displayed as `XX,XXX,XXX,XXX ریال` or `IRR XX,XXX`. Admin-configurable: use Persian numerals (۱۲۳٬۴۵۶٬۷۸۹) or Western digits (123,456,789). Use `Intl.NumberFormat` with `currency: 'IRR'` and locale `fa` or `en`. For Persian: set `useGrouping: true`. Percentages and decimals follow locale conventions.
  - **Dependencies:** T-06.02.01
  - **Complexity:** M
  - **UI/UX:** All monetary values show the currency symbol/tail (ریال or IRR). Date picker switches between Jalali and Gregorian based on locale. Direction flips seamlessly without visual glitches.

---

#### S-06.03: Shared UI component library (`packages/ui`)

**Description:** As a developer, I want a shared UI component library based on shadcn/ui with Base UI, configured for RTL/LTR, light/dark themes, full accessibility (WCAG 2.2 AA), and responsive design so that every page uses consistent, accessible, themed components.

**Acceptance Criteria:**
- Package exports reusable components: Button, Input, Select, Table, Dialog, Toast, Card, Badge, Tabs, Form fields, DatePicker (localized), Pagination, Loader/Skeleton, EmptyState, ErrorBoundary
- All components support both RTL and LTR directions via CSS logical properties
- All components support light and dark themes via CSS variables
- Components meet WCAG 2.2 AA: keyboard navigation, focus visibility (focus ring), contrast ratio (4.5:1), ARIA labels, role attributes, screen-reader accessible
- Animations respect `prefers-reduced-motion` and are never required to understand status or complete an action
- Theme variables are customizable at the admin level (flexible theming from admin dashboard)
- Component compositions use shadcn/ui CLI's pattern (Radix primitives + Tailwind CSS)
- Base UI (from `@base-ui-components/react`) provides unstyled primitives; shadcn/ui provides styled components
- Components tree-shaken — unused components are removed from production bundle
- All components have TypeScript prop types with JSDoc comments

**Tasks:**

- **T-06.03.01:** Initialize `packages/ui` with shadcn/ui and Base UI
  - **Notes:** Package name: `@barghsa/ui`. Install Radix UI primitives or Base UI for: Dialog, Popover, DropdownMenu, Select, Tabs, Toast, Tooltip. Use `tailwindcss` with `tailwindcss-animate` for animations. Configure `tailwind.config.ts` with CSS variable-based theme tokens. Use `class-variance-authority` for variant management. Add `clsx`/`tailwind-merge` for class merging. Build with `tsup` for ESM + CJS.
  - **Dependencies:** S-01.02
  - **Complexity:** L

- **T-06.03.02:** Create themed component set with RTL support
  - **Notes:** Each component uses CSS logical properties (`padding-inline-start` instead of `padding-left`, `margin-inline-end` instead of `margin-right`, `border-inline-start` instead of `border-left`). Use Tailwind `rtl:`/`ltr:` modifiers for any property that can't use logical properties. Theme tokens in CSS variables: `--color-primary`, `--color-background`, `--color-text`, `--border-radius`, `--spacing-*`. Both light and dark variants defined.
  - **Dependencies:** T-06.03.01
  - **Complexity:** L

- **T-06.03.03:** Implement WCAG 2.2 AA accessibility in all shared components
  - **Notes:** Every interactive element has visible focus indicator (2px solid offset ring, not just outline). Color contrast: minimum 4.5:1 for text, 3:1 for large text (18px+). ARIA: `role`, `aria-label`, `aria-describedby`, `aria-errormessage` on form fields. Keyboard: Tab order follows visual order, Escape closes dialogs/dropdowns, Enter toggles selects/checkboxes. Screen reader: live regions for dynamic content (toast, loading state). Reduced motion: `@media (prefers-reduced-motion: reduce)` disables CSS animations and transitions. Components span loading, empty, error, and disabled states.
  - **Dependencies:** T-06.03.01
  - **Complexity:** XL

- **T-06.03.04:** Create localized DatePicker component
  - **Notes:** Single and range date selection. When locale is `fa`, uses Jalali calendar; when `en`, uses Gregorian. Keyboard accessible: arrow keys navigate days, Enter selects, Escape closes. Props: `value`, `onChange`, `minDate`, `maxDate`, `locale`, `timezone`. Displays currently selected date in full format. For range/period selection, uses half-open `[start, end)` semantics in UI. Uses `datepicker-*` accessible patterns (dialog role, grid for days).
  - **Dependencies:** T-06.02.02, T-06.03.02
  - **Complexity:** L
  - **UI/UX:** DatePicker switches calendar system when language changes. Displays Hijri month names in Persian, Western month names in English. Shows current Jalali year alongside Gregorian year in Persian mode. Responsive: full calendar on desktop, simplified month selector on mobile.

- **T-06.03.05:** Implement theme system with admin overrides
  - **Notes:** CSS variables for all theme tokens. Admin can customize: primary color, background color, font family, border radius, spacing scale. Theme overrides stored in admin config (Draft → Active → Superseded). Apply via CSS custom properties on `<html>` element. Light/dark mode toggle per user. Admin-set theme defaults applied to all users when no per-user override exists. Animations respect `prefers-reduced-motion` — disable all non-essential motion.
  - **Dependencies:** T-06.03.02
  - **Complexity:** L
  - **UI/UX:** Theme settings in admin dashboard with color pickers, preview area showing live component examples, save as draft vs activate immediately.

- **T-06.03.06:** Create loading/empty/error state components
  - **Notes:** `<Skeleton>` for content placeholders (matching card/table/input shapes with shimmer animation, disabled when reduced-motion). `<EmptyState icon title description action? />` for zero-data pages. `<ErrorBoundary>` catches rendering errors, displays "Something went wrong" with retry button and support contact. `<PageLoading>` full-page spinner/skeleton for route transitions.
  - **Dependencies:** T-06.03.02
  - **Complexity:** M
  - **UI/UX:** Skeleton components match the exact dimensions of the content they replace. Loading never shows raw text "Loading..." except as ARIA label. Empty states are informative, not blank.

---

#### S-06.04: Privacy-safe analytics abstraction (`packages/shared/analytics`)

**Description:** As a platform engineer, I want a provider-abstraction analytics layer with a typed event interface, PII redaction, and a consent gate so that product analytics respect user consent and never leak passwords, OTPs, tokens, national identifiers, bank data, or file contents.

**Acceptance Criteria:**
- Typed analytics event interface shared by the frontend so events are consistent across providers
- Provider adapters for Google Analytics and Barghsa's own backend; Google Analytics is enabled only with the appropriate consent
- PII/secret redaction applied before an event leaves the client; secrets never placed in analytics
- Consent gate blocks analytics until the user has opted in
- Operational product events that correctness requires are sent to Barghsa's own backend regardless of third-party analytics consent

**Tasks:**

- **T-06.04.01:** Create privacy-safe analytics abstraction with consent gate and redaction
  - **Notes:** Add `packages/shared/analytics` with a typed `AnalyticsEvent` interface, `track(event)` API, provider adapters (Google Analytics gtag, self-hosted backend endpoint), a `useAnalyticsConsent()` gate, and a redaction utility that strips credentials, OTPs, tokens, national IDs, bank data, file contents, and raw free-text before forwarding. Consent state persists per user. Operational product events required for correctness are sent to Barghsa's backend independent of third-party consent. Never include the values listed in the source's prohibited-data filter in any analytics payload.
  - **Dependencies:** T-06.01.01 (shared package)
  - **Complexity:** M
  - **UI/UX:** Analytics is invisible to users apart from a consent prompt on first visit; no user-visible component.

---

### E-07: Developer Experience, Configuration & Environment

**Description:** Establish a smooth local development experience, secure configuration management (environment variables, secrets, admin config lifecycle), code quality tooling (lint-staged, commit hooks, editor config), and operational documentation (runbooks, deployment guides, incident response). Configuration safety ensures every setting has Draft, Active, and Superseded versions with rollback capability.

---

#### S-07.01: Local development environment and scripts

**Description:** As a developer, I want a documented, one-command local development setup with Docker services, database push, seed, and hot-reload dev servers so that I can start contributing within minutes.

**Acceptance Criteria:**
- `cp .env.example .env` followed by `docker compose up -d` starts PostgreSQL, Redis, MinIO
- `pnpm install` installs all dependencies
- `pnpm db:push` pushes Drizzle schema to local PostgreSQL (no migration step needed for dev)
- `pnpm db:seed` seeds default data
- `pnpm dev` starts web (port 3000), API (port 4000 with Swagger), and worker (background) with hot reload
- OTP codes printed to API console in dev (`OTP_CONSOLE=true`)
- First-time developer setup script: `pnpm setup:dev` that copies .env.example if .env not present, starts Docker services, runs install, push, seed
- Dev OTP bypass for testing: in development, a special endpoint or fixed OTP code "000000" is available when `OTP_CONSOLE=true`
- Environment indicators: API returns `X-Environment: development` header; UI shows subtle "Development" badge
- Local development may create a seeded admin using credentials from env vars; production never uses a hardcoded default password

**Tasks:**

- **T-07.01.01:** Create `pnpm setup:dev` convenience script
  - **Notes:** Shell script or pnpm script: check if `.env` exists, if not, copy `.env.example`. Run `docker compose up -d`. Wait for PostgreSQL health. Run `pnpm install`. Run `pnpm db:push`. Run `pnpm db:seed`. Print success message with URLs. Document in README.
  - **Dependencies:** T-03.02.02, T-03.02.03, S-02.01, S-02.04
  - **Complexity:** S

- **T-07.01.02:** Configure dev-mode OTP bypass and console printing
  - **Notes:** When `OTP_CONSOLE=true` and `NODE_ENV=development`, (a) any OTP verification accepts `000000` as a valid code (dev bypass), (b) real OTPs are printed to `console.log` with clear formatting: `[OTP] Your verification code is: 123456`. A test button triggers OTP sending without real SMS/email. Staff can use bypass for onboarding new test accounts. Bypass is never enabled in staging or production.
  - **Dependencies:** T-03.02.03
  - **Complexity:** S

- **T-07.01.03:** Create `pnpm db:push` script for dev schema synchronization
  - **Notes:** Uses `drizzle-kit push:pg` to sync Drizzle schema to PostgreSQL without creating migration files. This is for development only. Document that push is not a substitute for proper migrations in production. The script warns: "This is a development operation. Use db:migrate for production deployments."
  - **Dependencies:** S-02.01
  - **Complexity:** S

- **T-07.01.04:** Add environment indicator middleware
  - **Notes:** NestJS middleware adds `X-Environment` header to every response: `development`, `staging`, `production`. Frontend reads this (or checks a cookie/global) to show/hide the environment badge. Development badge: a small colored pill in the bottom-right corner showing "Dev" with non-intrusive styling. Never visible in production.
  - **Dependencies:** T-03.02.03
  - **Complexity:** S
  - **UI/UX:** Subtle development badge only in lower environments — no impact on user flow.

---

#### S-07.02: Configuration management and secrets handling

**Description:** As an admin, I want a versioned configuration system where settings have Draft, Active, and Superseded states with validation before activation, rollback to previous safe versions, and secrets that are encrypted, masked, and never exposed so that configuration changes are safe and auditable.

**Acceptance Criteria:**
- Admin configuration settings are validated before activation
- Every setting has Draft (in-progress), Active (current), and Superseded (replaced) lifecycle states
- High-impact settings support preview with effective time scheduling
- The system records who changed what (actor, timestamp, before/after values)
- Rollback is supported: activate a previous safe version, never by deleting history
- Invalid configuration fails closed with an actionable admin alert
- Secrets (API keys, passwords, tokens) are: encrypted at rest, masked after entry, excluded from logs/exports/telemetry/analytics, unavailable to frontend, editable only by authorized admins
- Secret rotation supports overlapping active/previous keys where protocol permits
- Provider configurations follow Draft → test → Active → Superseded lifecycle
- When a Draft cannot become Active (validation failure), the current Active provider remains untouched
- Disabling the only usable channel for OTP or account recovery is blocked until another verified recovery path is available

**Tasks:**

- **T-07.02.01:** Create versioned configuration store in PostgreSQL
  - **Notes:** Table `admin_config`: `id` (UUIDv7), `key` (unique, namespaced like `notifications.sms.provider`), `value` (JSONB), `version` (integer, auto-incrementing per key), `state` (enum: 'draft', 'active', 'superseded'), `created_by` (FK to staff user), `activated_at` (timestamptz, nullable), `superseded_at` (timestamptz, nullable), `effective_from` (timestamptz, nullable for scheduled changes), `prev_version_id` (FK to previous version), `validation_result` (JSONB, store last validation). Every key has a `draft`, at most one `active`, any number of `superseded`.
  - **Dependencies:** S-02.02
  - **Complexity:** M

- **T-07.02.02:** Create configuration validation framework
  - **Notes:** Each config key has a registered Zod schema or validator function. Before activating a draft: validate value against schema, run connection test where applicable (provider configs). On failure: store validation error in `validation_result`, show error in admin UI, keep draft state, keep current active untouched. On success: set state to 'active', update `activated_at`, deactivate previous active (mark superseded).
  - **Dependencies:** T-07.02.01
  - **Complexity:** M

- **T-07.02.03:** Implement configuration rollback
  - **Notes:** Select any previous `active` or `superseded` version. Validate it (it was already active before, so only re-validate if time-sensitive). If valid, create a new draft pre-populated with that version's values, which admin can then activate. Admin never directly sets state to active from old version — always goes through draft → validate → activate. Rollback is audited like any config change.
  - **Dependencies:** T-07.02.02
  - **Complexity:** M

- **T-07.02.04:** Create secrets encryption and masking service
  - **Notes:** Secrets stored in admin_config with `sensitive: true` flag. On write: encrypt value with AES-256-GCM using a master key from environment variable (`CONFIG_ENCRYPTION_KEY`, 32 bytes, never logged). Store nonce + ciphertext + tag in `value`. On read in admin UI: always return `••••••••` (masked) with last 4 chars visible for identification. On read in backend: decrypt only in the service that needs it. No other service or log has access to cleartext. Export: `encryptSecret(plaintext)`, `decryptSecret(ciphertext)`, `maskSecret(ciphertext)`. Master key rotation supported via `active_key_id` and `previous_key_id` fields in a separate secrets table.
  - **Dependencies:** T-07.02.01
  - **Complexity:** L

- **T-07.02.05:** Implement provider configuration lifecycle with test-send
  - **Notes:** Provider configs (email, SMS, storage) follow: create draft → configure → test connection (backend runs a test send to admin-entered destination, not a real customer) → if test passes, admin can activate → active state → on deactivation, previous version is preserved for rollback. Test button validates: credentials work, templates render, endpoints reachable. Test uses an explicitly entered, verified admin-owned destination — must never implicitly select a customer.
  - **Dependencies:** T-07.02.01, T-04.03.04
  - **Complexity:** L
  - **UI/UX:** Provider configuration page: form fields (masked secrets), version history with timestamps, "Test Connection" button, "Activate" (only after test passes), "Rollback to v{number}" button, readiness indicator showing "Active since {date}" or "Draft (not active)".

---

#### S-07.03: Code quality tooling (lint, format, commit hooks, editor config)

**Description:** As a developer, I want automated code quality enforcement through ESLint, Prettier, lint-staged, commit hooks, and shared editor configuration so that code style is consistent, commits follow conventions, and no malformed code reaches CI.

**Acceptance Criteria:**
- ESLint configured across all packages with shared `@barghsa/eslint-config` (or `@repo/eslint-config`)
  - TypeScript rules: `@typescript-eslint/strict-type-checked` for production code, `@typescript-eslint/stylistic-type-checked`
  - React rules: `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` for web
  - NestJS rules: `eslint-plugin-nestjs` or custom rules for dependency injection patterns
  - Tailwind CSS rules: `eslint-plugin-tailwindcss` for class ordering
  - Ban: `any` (with exceptions for third-party types), `ts-ignore` (with comments), `console.log` (allow `console.warn`/`console.error` in production)
- Prettier configured consistently: single quotes, trailing commas (es5), print width 100, tab width 2
- lint-staged: on commit, run `prettier --write` + `eslint --fix` on staged files
- Commit message convention: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `style:`) enforced via commitlint
- `.husky/pre-commit`: runs lint-staged, typecheck for affected packages
- `.husky/commit-msg`: runs commitlint
- `.editorconfig` for consistent indentation, charset, line endings across editors
- `.vscode/extensions.json` and `.vscode/settings.json` for recommended extensions: ESLint, Prettier, Tailwind CSS IntelliSense, Docker, PostCSS, SQL (for Drizzle schema)

**Tasks:**

- **T-07.03.01:** Create shared ESLint configuration
  - **Notes:** Package `packages/eslint-config` with base config extending `typescript-eslint`, Prettier, with per-package variants (react, node, nestjs). Root `.eslintrc.js` references the shared config with overrides per project. CI runs `turbo lint` which fails on any rule violation.
  - **Dependencies:** S-01.02
  - **Complexity:** M

- **T-07.03.02:** Configure Prettier with consistent formatting
  - **Notes:** Root `.prettierrc` with `singleQuote: true`, `trailingComma: 'es5'`, `printWidth: 100`, `tabWidth: 2`, `semi: true`, `arrowParens: 'always'`, `endOfLine: 'lf'`. `.prettierignore` excludes `dist/`, `node_modules/`, `.turbo/`, `pnpm-lock.yaml`, `coverage/`. CI runs `pnpm format:check`.
  - **Dependencies:** S-01.01
  - **Complexity:** S

- **T-07.03.03:** Set up Husky, lint-staged, and commitlint
  - **Notes:** Install `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`. Configure `commitlint.config.js` with conventional commit rules (allow `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style` only). lint-staged: `*.{ts,tsx}` → `eslint --fix && prettier --write`, `*.{json,md,yaml}` → `prettier --write`. Any commit that fails hook is rejected with clear error message.
  - **Dependencies:** T-07.03.01, T-07.03.02
  - **Complexity:** M

- **T-07.03.04:** Create `.editorconfig` and `.vscode` workspace settings
  - **Notes:** `.editorconfig`: `root = true`, `[*] indent_style = space`, `indent_size = 2`, `end_of_line = lf`, `charset = utf-8`, `trim_trailing_whitespace = true`, `insert_final_newline = true`. `.vscode/settings.json`: `typescript.preferences.importModuleSpecifier = 'shortest'`, `editor.formatOnSave = true`, `editor.codeActionsOnSave = { "source.fixAll.eslint": true }`, `tailwindCSS.experimental.configFile = 'packages/ui/tailwind.config.ts'`. `.vscode/extensions.json`: recommend `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `bradlc.vscode-tailwindcss`, `ms-azuretools.vscode-docker`, `csstools.postcss`.
  - **Dependencies:** S-01.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

#### S-07.04: Operational documentation (runbooks, ADRs, deployment guides)

**Description:** As an on-call engineer, I want comprehensive operational documentation including runbooks for every critical incident scenario, ADRs for architectural decisions, deployment guides, and incident response procedures so that the team can operate and recover the platform safely.

**Acceptance Criteria:**
- Runbooks exist for: payment/wallet mismatch, refund backlog, database failover/restore, object-storage outage, notification provider outage, credential compromise, bad deployment, Redis loss, AI provider outage
- Each runbook has: severity, owner, symptoms, step-by-step recovery, verification criteria, and escalation path
- ADRs exist for every material architectural decision, stored in `docs/adr/`
- Each ADR states: context, decision, alternatives considered, consequences (positive/negative), owner, review trigger date
- Complexity-increasing decisions include the measurement or SLO that requires them
- Deployment guide documents: pilot topology, commercial HA topology, upgrade procedure, rollback procedure, configuration reference
- Incident response defines: severity levels (P0/P1/P2/P3), notification channels, on-call rotation, post-incident review process
- Security incidents have separate procedures: evidence preservation, customer communication templates, key/token revocation
- Alert delivery is monitored by a dead-man check

**Tasks:**

- **T-07.04.01:** Create incident runbooks directory (`docs/runbooks/`)
  - **Notes:** One `.md` file per runbook. Each has: Title, Severity (P0-P2), Symptoms, Impact, Owner/Team, Step-by-step recovery (numbered, commands included), Verification (how to confirm recovery), Escalation (who to call if steps fail), Post-incident actions. Create runbooks for: `payment-wallet-mismatch`, `refund-backlog`, `database-failover`, `database-restore`, `storage-outage`, `notification-outage`, `credential-compromise`, `bad-deployment`, `redis-loss`, `ai-provider-outage`.
  - **Dependencies:** S-04.01, S-04.02, S-04.03, S-05.02
  - **Complexity:** L

- **T-07.04.02:** Create initial ADRs
  - **Notes:** `docs/adr/001-data-types-and-conventions.md` — UUIDv7, timestamptz, integer IRR, half-open ranges. `docs/adr/002-redis-scope.md` — optional, disposable, never source of truth. `docs/adr/003-modular-monolith-rationale.md` — why not microservices, extraction criteria. `docs/adr/004-deployment-topology.md` — pilot vs HA, vertical-first scaling. `docs/adr/005-test-database-policy.md` — real PostgreSQL only, no SQLite substitutes. `docs/adr/006-outbox-pattern.md` — transactional outbox instead of Kafka. Each ADR follows the template: Context, Decision, Alternatives, Consequences, Owner, Review trigger.
  - **Dependencies:** None (documentation)
  - **Complexity:** M

- **T-07.04.03:** Create deployment guide
  - **Notes:** `docs/deployment.md`: Prerequisites, Environment variables reference (all vars with descriptions), Pilot topology deployment (step-by-step), Commercial HA deployment, Upgrade procedure (migration, rollout, health check), Rollback procedure (code and data), Configuration reference (reverse proxy settings, PostgreSQL tuning, Redis config, MinIO config), Monitoring setup (Grafana dashboards, alerts).
  - **Dependencies:** T-05.01.01, T-05.02.01
  - **Complexity:** M

- **T-07.04.04:** Create incident response plan
  - **Notes:** Document severity levels: P0 (critical — service down, payment issue, security breach) — page on-call, response <15 min. P1 (major — feature unavailable, degraded) — page owner, response <1 hour. P2 (minor — cosmetic, non-critical bug) — next working day. P3 (cosmetic) — backlog. On-call rotation: primary + secondary. Notification channels: Slack/Telegram for alerts, phone call for P0. Post-incident review: within 5 working days, create Jira issue, document timeline, root cause, action items.
  - **Dependencies:** T-07.04.01
  - **Complexity:** M
  - **UI/UX:** N/A

---

## Dependency Map

```
E-01 (Monorepo) ────────────────────────────────────────────────► E-06 (Shared)
      │                                                               │
      ├──► E-02 (Database) ──► E-04 (Infrastructure) ──► E-05 (Deploy/CI/CD)
      │                                                               │
      └──► E-03 (Docker) ──────────────────────────────► E-05 (Deploy)
                                                                      │
E-07 (DevExp) ◄──────────────────────────────────────────────────────┘
```

- **E-01 (Monorepo)** is the foundation — all epics depend on it
- **E-02 (Database)** depends on E-01; providers infra for all domain data
- **E-03 (Docker)** depends on E-01 + E-02 for building runnable images
- **E-04 (Infrastructure)** depends on E-01 for configuration code
- **E-05 (CI/CD/Deploy)** depends on E-03 + E-04 for actual deployment
- **E-06 (Shared)** depends on E-01 for compile/package infrastructure
- **E-07 (DevExp)** supports all epics with tooling and documentation

---

## Cross-Epic Dependencies

| Dependency | From | To | Reason |
|---|---|---|---|
| Migration seed creates default products | S-02.04 | Domain Epic 02 (Auth/Users/CRM) | Admin user creation needed before CRM |
| Shared schemas for auth | S-06.01 | Domain Epic 02 | Username/password validation shared across frontend and backend |
| i18n dictionaries for auth flows | S-06.02 | Domain Epic 02 | Login, register, OTP, onboarding all need Persian/English |
| UI components for auth pages | S-06.03 | Domain Epic 02 | Login, register forms, OTP input, password meter use shared components |
| Infrastructure for notification providers | E-04 | Domain Epic 05 | SMTP, SMS.ir, Resend provider config in admin |
| CI/CD deployment pipeline | E-05 | All Domain Epics | Every epic's code goes through the deployment pipeline |
| Wallet/invoice database tables | S-02.02 | Domain Epic 04 | Schema for invoices, payments, wallet must exist before domain code |
| Infrastructure health monitoring | S-04.01, S-04.04 | Domain Epic 06 | Observability dashboards consume Postgres + proxy metrics |

---

## Legend

| Mark | Meaning |
|---|---|
| **E-NN** | Epic — large feature area spanning multiple sprints |
| **S-NN.MM** | Story — user/tech story within an epic |
| **T-NN.MM.OO** | Task — concrete implementation unit |
| **S** | Complexity Small — hours, single developer |
| **M** | Complexity Medium — days, single developer or pair |
| **L** | Complexity Large — ~week, may need multiple devs |
| **XL** | Complexity Extra Large — multi-week, team effort, split recommended |

---

## Execution Notes

1. **E-01 (Monorepo)** must be completed first — all other epics depend on workspace structure, TypeScript config, and build pipeline.
2. **E-02 (Database)** and **E-06 (Shared)** can start in parallel once E-01 is stable.
3. **E-07 (DevExp)** is ongoing throughout — code quality hooks should be set up in the first sprint.
4. **E-03 (Docker)** and **E-04 (Infrastructure)** can proceed concurrently once E-01 and E-02 provide buildable artifacts.
5. **E-05 (CI/CD)** depends on E-03 and E-04 for deployment targets — start with PR gate (S-05.03) earlier, as it only needs code, not deployed infra.
7. Commercial HA topology (S-05.02) can be deferred until the platform is ready for real payment processing.
8. Most stories in this domain have no direct UI/UX impact — they are invisible infrastructure that enables the product epics. Where UI/UX is relevant (DatePicker, theme, config pages, maintenance mode), it is noted in the task.

---

---

#### S-07.05: Architecture guardrails and generated API clients

**Description:** Enforce the architecture rules that keep the modular monolith safe and the external API contract consumable without duplicating business logic.

**Acceptance Criteria:**
- CI rejects external/provider calls made while a database transaction is open
- OpenAPI generates a checked TypeScript client package and enforces the documented compatibility policy
- Health endpoints are explicitly public and excluded from rate-limit and audit noise, with integration tests
- Module extraction requires measured justification and preserves API, ownership, idempotency, audit, and observability contracts

**Tasks:**

- **T-07.05.01:** Enforce “no external call inside a database transaction”
  - **Notes:** Add a Semgrep/custom static-analysis rule for Drizzle transaction callbacks and provider/network calls. Add representative positive/negative fixtures, run it in the PR gate, and document the persist-intent → commit → call asynchronously → apply idempotent result pattern.
  - **Dependencies:** T-05.03.04
  - **Complexity:** M

- **T-07.05.02:** Generate and verify TypeScript API client contracts from OpenAPI
  - **Notes:** Generate `packages/api-client` from the committed OpenAPI document, fail CI on generated drift, and document that removals/type changes require a new API version or backward-compatible migration window.
  - **Dependencies:** T-05.03.03
  - **Complexity:** M

- **T-07.05.03:** Verify health-endpoint middleware exclusions
  - **Notes:** Integration tests prove `/api/health/live` and `/api/health/ready` require no session, bypass application rate limits, and do not create ordinary audit entries while still emitting operational metrics.
  - **Dependencies:** T-03.03.01
  - **Complexity:** S

- **T-07.05.04:** Document and gate module extraction criteria
  - **Notes:** Create an ADR covering measured scaling/security/availability/deployment triggers, alternatives, consequences, owner, review trigger, and preservation of API, ownership, idempotency, audit, and observability. Add the extraction checklist to the PR template.
  - **Dependencies:** T-07.04.02
  - **Complexity:** S
