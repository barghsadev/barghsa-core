# Skipped-work handoff

This handoff preserves the 58 historical skips. Completed or partial implementations remain in the acceptance ledger. These items are not permission to rebuild existing code. The consolidated repair sprint does not deploy services or invent owner policy.

## Order of work

1. Resolve the owner decisions already recorded in `progress.json`: recovery policy, callback/telemetry boundaries and explicit platform requirement discrepancies.
2. Complete shared/local prerequisites below only where their exact criteria remain unmet. Reuse existing implementations and current tests.
3. Configure a staging environment, provider/storage credentials and delivery destinations; verify the current deployment and migration tools there.
4. Validate pilot rollout, monitoring, backup/restore and rollback before production promotion. HA and load/RPO/RTO evidence require provisioned infrastructure.
5. Schedule recurrent security/access/restore exercises only after owner assignment and deployment approval.

## Every remaining skipped claim

Each entry retains its canonical requirement and dependencies. “Partial” means implementation exists but the complete criterion is not certified; “deferred” means new build or external execution outside this repair sprint remains. Global checks do not substitute for a deployed acceptance test.

### 01-platform-infrastructure.md#T-05.01.01

- **T-05.01.01:** Create Ansible playbook or deploy script for pilot topology
  - **Notes:** Script: `deploy-pilot.sh`. Steps: pull latest Docker images, run migration (`docker run --rm ... pnpm db:migrate`), start new containers with `docker-compose.prod.yml` (single VM). Health check each container. If readiness passes, update proxy config to point at new instances. Stop old containers. Handle rollback: if health fails, keep old containers running and log failure.
  - **Dependencies:** E-03, E-04
  - **Complexity:** L

Existing evidence: deploy/pilot. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.01.02

- **T-05.01.02:** Create `docker-compose.prod.yml` for pilot single-VM deployment
  - **Notes:** Services: `postgres` (with persistent volume, backups, WAL archiving), `redis` (optional, commented out if not used), `minio` (or external S3 config), `api` (image, port 4000, depends on postgres, healthcheck), `web` (image, port 3000, depends on api), `worker` (image, command, depends on postgres). Environment variables sourced from `.env.production` or secret manager. For full single-server: all on one host.
  - **Dependencies:** E-03, E-04
  - **Complexity:** M

Existing evidence: docker-compose.prod.yml. Historical assessment: partial.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.01.03

- **T-05.01.03:** Document explicitly that single-server deployment has lower availability
  - **Notes:** Single-server availability target: 99.5% (without HA commitment). Document risks: no redundancy, host failure = full outage. Must use encrypted off-server backups. Must not process real customer payments without at least separate PostgreSQL/storage. Include in runbook.
  - **Dependencies:** T-05.01.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

Existing evidence: architecture.md. Historical assessment: needs_document_review.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.02.01

- **T-05.02.01:** Design and document commercial HA topology
  - **Notes:** Document the architecture: managed LB → two+ API replicas (host A, host B), two+ web replicas, two+ workers. PostgreSQL Multi-AZ or Patroni cluster. Redis optional, cross-replica cache. S3 object storage (already HA). N+1 redundancy for all application processes. PgBouncer for connection pooling across replicas. RTO ≤ 60 min via automatic failover.
  - **Dependencies:** E-04, S-05.01
  - **Complexity:** L

Existing evidence: architecture.md. Historical assessment: needs_document_review.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.02.02

- **T-05.02.02:** Configure rolling/blue-green deployment automation for HA
  - **Notes:** Use Ansible/Terraform + deployment scripts. Pattern: provision new instance(s), run migration, health-check new instances, add to LB, drain old instances, terminate. On health failure: automatically remove new instances and keep old in rotation (rollback). Include smoke test step after migration before routing traffic.
  - **Dependencies:** T-05.02.01
  - **Complexity:** L

Existing evidence: .github/workflows. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.02.03

- **T-05.02.03:** Implement circuit breaker for external providers
  - **Notes:** Each external provider (payment gateway, SMS.ir, Resend, bill-data API) gets a circuit breaker: configurable failure threshold (default 5 in 60s), half-open timeout (default 30s), and break duration (default 120s). When circuit is open, queue safe async work or show "Service temporarily unavailable" — never report false success. Implement with `opossum` or a custom state machine. Metrics: circuit state, failure rate.
  - **Dependencies:** T-05.02.01
  - **Complexity:** L

Existing evidence: apps/api/src/provider-config. Historical assessment: partial.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.02.04

- **T-05.02.04:** Configure maintenance mode per capability, not whole-application
  - **Notes:** Each capability (electricity ordering, saving plans, solar, wallet top-up, AI chat) can be individually disabled. Admin toggle with optional reason message shown to customers. When a capability is disabled, affected pages show "This service is temporarily unavailable" with support contact. Other capabilities remain functional. Never disable login, support/ticketing, contracts list, invoices, or refund access.
  - **Dependencies:** T-05.02.01
  - **Complexity:** M
  - **UI/UX:** Banner on affected pages: "[Service name] is temporarily unavailable. [optional reason]. Contact support if you need assistance." Action buttons are disabled/hidden. Navigation to affected sections shows a clear maintenance page. Staff see a management page to toggle capabilities.

---

Existing evidence: apps/api/src. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.03.01

- **T-05.03.01:** Create CI workflow definition (GitHub Actions, GitLab CI, or equivalent)
  - **Notes:** Trigger: `pull_request` (opened, synchronize). Run on push to PR branch. Matrix: run tests on affected packages only (use Turborepo filtering). PostgreSQL service container for integration tests. Steps in order: checkout → pnpm install → format/lint → typecheck → build affected → unit tests → migration validation → OpenAPI drift → bundle budget → coverage → secret scan → SCA → SAST → license check → security findings gate → required reviews.
  - **Dependencies:** S-01.01, S-01.03, S-01.04, S-02.03
  - **Complexity:** XL

Existing evidence: .github/workflows/ci.yml. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-05.03.02

- **T-05.03.02:** Implement migration validation step (two environments)
  - **Notes:** Step 1 (clean DB): apply all migrations from scratch, verify schema matches Drizzle definitions. Step 2 (upgrade path): start with schema from the previous release's migration point, apply only the new PR's migrations, verify schema matches expected final state. Both steps use a temporary PostgreSQL instance (service container).
  - **Dependencies:** S-02.03
  - **Complexity:** M

Existing evidence: packages/db/src/test. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-05.03.03

- **T-05.03.03:** Implement OpenAPI generation and drift check
  - **Notes:** PR gate generates OpenAPI spec from NestJS decorators (`nestjs/swagger` plugin). Compare generated spec against committed `openapi.json`. If spec differs, fail the check — developer must regenerate and commit the updated spec. Breaking API changes require version negotiation or migration period.
  - **Dependencies:** T-05.03.01
  - **Complexity:** M

Existing evidence: apps/api/package.json. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-05.03.04

- **T-05.03.04:** Configure security scans in PR gate
  - **Notes:** Secret scan: `trufflehog` or `gitleaks` — scan entire repo for secrets/keys. Dependency/SCA: `pnpm audit` or `snyk` (or `npm audit` for root). SAST: `semgrep` or `codeql` — custom rules for SQL injection, XSS, SSRF, hardcoded credentials, open redirects. License: `license-checker` or `fossa` — enforce allowlist (MIT, Apache-2.0, ISC, BSD-2/3). Security findings: block PR on Critical/High with credible production path; accepted risk requires owner, justification, compensating control, expiry.
  - **Dependencies:** T-05.03.01
  - **Complexity:** L

Existing evidence: .github/workflows/ci.yml. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-05.03.05

- **T-05.03.05:** Implement coverage threshold enforcement
  - **Notes:** Using `vitest --coverage`, extract per-package line/branch percentages. Compare against thresholds. Fail if changed code in any package falls below threshold. Publish coverage report as CI artifact.
  - **Dependencies:** T-01.04.02
  - **Complexity:** M
  - **UI/UX:** N/A

---

Existing evidence: apps/api/vitest.config.ts. Historical assessment: later_merged_needs_fix.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-05.04.01

- **T-05.04.01:** Create staging gate CI workflow
  - **Notes:** Trigger: `push` to `main` or `develop`. Steps in order: checkout → pnpm install → full build → full unit test → full integration test (real PostgreSQL) → critical Chromium E2E → a11y audit (axe) → container build (all Dockerfiles) → container vulnerability scan (Trivy or Grype) → SBOM generation (CycloneDX) → migration rehearsal (production-like schema + data volume) → provider contract tests → staging smoke deploy → readiness/liveness checks → P0/P1/flaky check.
  - **Dependencies:** S-05.03, E-01, E-02, E-03
  - **Complexity:** XL

Existing evidence: .github/workflows. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.04.02

- **T-05.04.02:** Create production promotion workflow with canary/gradual rollout
  - **Notes:** Trigger: manual approval after staging gate passes. Steps: check backup age (<24h) and restore-test status → run release-candidate E2E across required browsers → run DAST (OWASP ZAP) smoke → performance smoke (compare p95 latency against budget) → verify migration plan → verify rollback/roll-forward plan → verify feature flag/kill-switch exists for high-risk changes → deploy to canary (one replica, no production traffic) → automated smoke test on canary → if canary passes, gradual rollout (10% → 50% → 100%) with SLO/error monitoring → halt/rollback on error spike or reconciliation mismatch.
  - **Dependencies:** T-05.04.01, S-05.02
  - **Complexity:** XL

Existing evidence: .github/workflows. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.04.03

- **T-05.04.03:** Implement post-deploy smoke tests and SLO comparison
  - **Notes:** After production deployment, run a set of non-destructive automated smoke tests: login as test user, view dashboard, check wallet balance (read-only), verify health endpoint. Compare p95 latency, error rate, and SLO burn rate against pre-deployment baseline. Alert if significant degradation detected. Publish comparison report.
  - **Dependencies:** T-05.04.02
  - **Complexity:** L

Existing evidence: .github/workflows. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.04.04

- **T-05.04.04:** Create runbooks for rollback scenarios
  - **Notes:** Runbooks: (1) Rollback code: redeploy previous Docker image, run migration rollback (reverse migration), verify. (2) Rollback config: activate previous safe config version. (3) Rollback data: restore PostgreSQL from backup + PITR if migration caused data loss. (4) Rollback feature: disable feature flag. Each runbook has severity, owner, steps, verification criteria.
  - **Dependencies:** T-05.04.02
  - **Complexity:** L
  - **UI/UX:** N/A

---

Existing evidence: docs/operations/backup/config-restore-runbook.md. Historical assessment: partial.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.05.01

- **T-05.05.01:** Create nightly CI schedule
  - **Notes:** Cron: daily at 02:00. Run: cross-browser E2E (Chromium + Firefox + WebKit, sequential or parallel on separate runners), mobile viewport E2E, dependency scan (with updated CVE database), dead-link checker (check all navigation links in the app), schema validation (Drizzle generate + verify no drift), flaky-test analysis (query CI results from past 7 days, compile flaky report). Results posted to a dedicated channel/email.
  - **Dependencies:** T-05.04.01, T-01.04.06
  - **Complexity:** L

Existing evidence: .github/workflows/ci.yml. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.05.02

- **T-05.05.02:** Create weekly load/performance regression test
  - **Notes:** Cron: weekly on Sunday. Use k6 or artillery to run load tests against a staging environment (or isolated). Test paths: electricity price preview, order submission, wallet payment, invoice list, CRM search, file upload authorization, notification fan-out. Compare p50/p95/p99 latency against declared budgets (p95 reads <300ms, writes <500ms). Report regression if any path exceeds budget + 20% tolerance.
  - **Dependencies:** T-05.05.01
  - **Complexity:** L

Existing evidence: .github/workflows. Historical assessment: no_matching_artifact_found.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.05.03

- **T-05.05.03:** Create quarterly disaster-recovery and restore exercise
  - **Notes:** Cron: quarterly on first Saturday. Steps: (1) Restore PostgreSQL from latest backup in isolated environment, measure RPO and RTO. (2) Restore object storage from backup/versioning. (3) DR simulation: bring up a fresh deployment from backups in a separate environment, verify critical user journey works. (4) Document measured RPO/RTO. Alert if RPO > 5 min or RTO > 60 min for core services.
  - **Dependencies:** T-04.01.05
  - **Complexity:** XL

Existing evidence: docs/operations/backup/config-restore-runbook.md. Historical assessment: operational_evidence_required.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-05.05.04

- **T-05.05.04:** Create quarterly access review and threat-model update
  - **Notes:** Automate: export all staff role assignments, API key metadata (masked keys, creation date, last used), service account list. Manual review required to validate access appropriateness. Update threat model: walk through auth, active-profile isolation, wallet/payment/refund, contracts/signatures, file upload, admin configuration, external providers, AI tool execution. Update for material flow changes since last review.
  - **Dependencies:** T-05.05.03
  - **Complexity:** M
  - **UI/UX:** N/A

---

Existing evidence: docs. Historical assessment: operational_evidence_required.

Next owner: Operations/release owner; provision the target environment and retain execution results.

### 01-platform-infrastructure.md#T-06.01.01

- **T-06.01.01:** Initialize `packages/shared` with tsconfig and dependencies
  - **Notes:** Package name: `@barghsa/shared`. Dependencies: `zod`. Build: `tsup` or `tsc` for ESM + CJS. Exports map: `"."` for main, `"./errors"` for error codes, `"./pagination"` for pagination schemas, `"./types"` for domain enums.
  - **Dependencies:** S-01.02
  - **Complexity:** S

Existing evidence: packages/shared/package.json. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-06.01.02

- **T-06.01.02:** Create username validation and normalization helpers
  - **Notes:** Functions: `parseUsername(input)` returns `{ type: 'email' | 'mobile', value: string }`. If mobile and not in E.164, format: Iranian mobile (starts with 09) → `+98XXXXXXXXX`. `isE164(value)` validates regex `/^\+[1-9]\d{6,14}$/`. `isEmail(value)` validates Zod email. Backend only accepts E.164. Frontend formats before sending. Username uniqueness: case-insensitive for email, normalized E.164 for mobile.
  - **Dependencies:** T-06.01.01
  - **Complexity:** M

Existing evidence: packages/shared/src/validation/normalize-username.ts. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-06.01.03

- **T-06.01.03:** Create password validation with strength meter logic
  - **Notes:** Zod schema: `passwordSchema` with min 8 chars, at least one of each: uppercase, lowercase, digit. Optional: special character. Strength calculation: `passwordStrength(password)` → `{ score: 0-4, label: 'weak'|'fair'|'strong'|'very strong', feedback: string }`. Use zxcvbn-like algorithm or simple rules-based. Frontend imports for password meter component.
  - **Dependencies:** T-06.01.01
  - **Complexity:** M

Existing evidence: apps/web/src/components/PasswordField.tsx. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-06.01.05

- **T-06.01.05:** Create pagination helper schemas
  - **Notes:** `cursorPaginationSchema`: `{ cursor: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(20) }`. `offsetPaginationSchema`: `{ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) }`. Prefer cursor/keyset pagination for large or frequently changing datasets; offset is acceptable for small admin tables.
  - **Dependencies:** T-06.01.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

Existing evidence: packages/shared/src. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-06.02.01

- **T-06.02.01:** Initialize `packages/i18n` with message dictionary structure
  - **Notes:** Package name: `@barghsa/i18n`. Export a `createI18n(locale: 'fa' | 'en')` function returning a typed dictionary. Use TypeScript `Record` types for compile-time safety on translation keys. Directory structure: `locales/fa.ts`, `locales/en.ts`. Strings are organized by domain: `auth`, `crm`, `products`, `electricity`, `saving`, `solar`, `contract`, `invoice`, `wallet`, `documents`, `tickets`, `admin`, `notifications`, `errors`, `common`. Fallback strategy: if key missing in `fa`, use `en` key.
  - **Dependencies:** S-01.02
  - **Complexity:** M

Existing evidence: packages/i18n/src/index.ts. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-06.02.02

- **T-06.02.02:** Create Jalali calendar date utilities
  - **Notes:** Use `date-fns-jalali` or `jalaali-js` for Jalali ↔ Gregorian conversion without a heavy library. Functions: `toJalali(date: Date) → { year, month, day }`, `toGregorian(jy, jm, jd) → Date`, `formatDate(date, locale, format)`, `formatRelative(date, locale)`, `getJalaliMonthDays(year, month)` (handles 29-31 days and leap years). Period display: `formatPeriod(start, end, locale)` → "۱۴۰۲/۰۱/۰۱ to ۱۴۰۲/۰۲/۰۱".
  - **Dependencies:** T-06.02.01
  - **Complexity:** L

Existing evidence: packages/ui/src/components/base-ui/date-picker.tsx. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-06.03.01

- **T-06.03.01:** Initialize `packages/ui` with shadcn/ui and Base UI
  - **Notes:** Package name: `@barghsa/ui`. Install Radix UI primitives or Base UI for: Dialog, Popover, DropdownMenu, Select, Tabs, Toast, Tooltip. Use `tailwindcss` with `tailwindcss-animate` for animations. Configure `tailwind.config.ts` with CSS variable-based theme tokens. Use `class-variance-authority` for variant management. Add `clsx`/`tailwind-merge` for class merging. Build with `tsup` for ESM + CJS.
  - **Dependencies:** S-01.02
  - **Complexity:** L

Existing evidence: packages/ui/package.json. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-06.04.01

- **T-06.04.01:** Create privacy-safe analytics abstraction with consent gate and redaction
  - **Notes:** Add `packages/shared/analytics` with a typed `AnalyticsEvent` interface, `track(event)` API, provider adapters (Google Analytics gtag, self-hosted backend endpoint), a `useAnalyticsConsent()` gate, and a redaction utility that strips credentials, OTPs, tokens, national IDs, bank data, file contents, and raw free-text before forwarding. Consent state persists per user. Operational product events required for correctness are sent to Barghsa's backend independent of third-party consent. Never include the values listed in the source's prohibited-data filter in any analytics payload.
  - **Dependencies:** T-06.01.01 (shared package)
  - **Complexity:** M
  - **UI/UX:** Analytics is invisible to users apart from a consent prompt on first visit; no user-visible component.

---

Existing evidence: apps/web/src. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.01.01

- **T-07.01.01:** Create `pnpm setup:dev` convenience script
  - **Notes:** Shell script or pnpm script: check if `.env` exists, if not, copy `.env.example`. Run `docker compose up -d`. Wait for PostgreSQL health. Run `pnpm install`. Run `pnpm db:push`. Run `pnpm db:seed`. Print success message with URLs. Document in README.
  - **Dependencies:** T-03.02.02, T-03.02.03, S-02.01, S-02.04
  - **Complexity:** S

Existing evidence: package.json. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.01.02

- **T-07.01.02:** Configure dev-mode OTP bypass and console printing
  - **Notes:** When `OTP_CONSOLE=true` and `NODE_ENV=development`, (a) any OTP verification accepts `000000` as a valid code (dev bypass), (b) real OTPs are printed to `console.log` with clear formatting: `[OTP] Your verification code is: 123456`. A test button triggers OTP sending without real SMS/email. Staff can use bypass for onboarding new test accounts. Bypass is never enabled in staging or production.
  - **Dependencies:** T-03.02.03
  - **Complexity:** S

Existing evidence: apps/api/src/auth/otp.service.ts. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.01.03

- **T-07.01.03:** Create `pnpm db:push` script for dev schema synchronization
  - **Notes:** Uses `drizzle-kit push:pg` to sync Drizzle schema to PostgreSQL without creating migration files. This is for development only. Document that push is not a substitute for proper migrations in production. The script warns: "This is a development operation. Use db:migrate for production deployments."
  - **Dependencies:** S-02.01
  - **Complexity:** S

Existing evidence: packages/db/package.json. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.01.04

- **T-07.01.04:** Add environment indicator middleware
  - **Notes:** NestJS middleware adds `X-Environment` header to every response: `development`, `staging`, `production`. Frontend reads this (or checks a cookie/global) to show/hide the environment badge. Development badge: a small colored pill in the bottom-right corner showing "Dev" with non-intrusive styling. Never visible in production.
  - **Dependencies:** T-03.02.03
  - **Complexity:** S
  - **UI/UX:** Subtle development badge only in lower environments — no impact on user flow.

---

Existing evidence: apps/api/src/app.module.ts. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.02.01

- **T-07.02.01:** Create versioned configuration store in PostgreSQL
  - **Notes:** Table `admin_config`: `id` (UUIDv7), `key` (unique, namespaced like `notifications.sms.provider`), `value` (JSONB), `version` (integer, auto-incrementing per key), `state` (enum: 'draft', 'active', 'superseded'), `created_by` (FK to staff user), `activated_at` (timestamptz, nullable), `superseded_at` (timestamptz, nullable), `effective_from` (timestamptz, nullable for scheduled changes), `prev_version_id` (FK to previous version), `validation_result` (JSONB, store last validation). Every key has a `draft`, at most one `active`, any number of `superseded`.
  - **Dependencies:** S-02.02
  - **Complexity:** M

Existing evidence: packages/shared/src/config-cache/config-cache.ts. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.02.02

- **T-07.02.02:** Create configuration validation framework
  - **Notes:** Each config key has a registered Zod schema or validator function. Before activating a draft: validate value against schema, run connection test where applicable (provider configs). On failure: store validation error in `validation_result`, show error in admin UI, keep draft state, keep current active untouched. On success: set state to 'active', update `activated_at`, deactivate previous active (mark superseded).
  - **Dependencies:** T-07.02.01
  - **Complexity:** M

Existing evidence: packages/shared/src/admin. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.02.03

- **T-07.02.03:** Implement configuration rollback
  - **Notes:** Select any previous `active` or `superseded` version. Validate it (it was already active before, so only re-validate if time-sensitive). If valid, create a new draft pre-populated with that version's values, which admin can then activate. Admin never directly sets state to active from old version — always goes through draft → validate → activate. Rollback is audited like any config change.
  - **Dependencies:** T-07.02.02
  - **Complexity:** M

Existing evidence: apps/api/src/provider-config. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.02.04

- **T-07.02.04:** Create secrets encryption and masking service
  - **Notes:** Secrets stored in admin_config with `sensitive: true` flag. On write: encrypt value with AES-256-GCM using a master key from environment variable (`CONFIG_ENCRYPTION_KEY`, 32 bytes, never logged). Store nonce + ciphertext + tag in `value`. On read in admin UI: always return `••••••••` (masked) with last 4 chars visible for identification. On read in backend: decrypt only in the service that needs it. No other service or log has access to cleartext. Export: `encryptSecret(plaintext)`, `decryptSecret(ciphertext)`, `maskSecret(ciphertext)`. Master key rotation supported via `active_key_id` and `previous_key_id` fields in a separate secrets table.
  - **Dependencies:** T-07.02.01
  - **Complexity:** L

Existing evidence: apps/api/src/provider-config/provider-secrets.service.ts. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.02.05

- **T-07.02.05:** Implement provider configuration lifecycle with test-send
  - **Notes:** Provider configs (email, SMS, storage) follow: create draft → configure → test connection (backend runs a test send to admin-entered destination, not a real customer) → if test passes, admin can activate → active state → on deactivation, previous version is preserved for rollback. Test button validates: credentials work, templates render, endpoints reachable. Test uses an explicitly entered, verified admin-owned destination — must never implicitly select a customer.
  - **Dependencies:** T-07.02.01, T-04.03.04
  - **Complexity:** L
  - **UI/UX:** Provider configuration page: form fields (masked secrets), version history with timestamps, "Test Connection" button, "Activate" (only after test passes), "Rollback to v{number}" button, readiness indicator showing "Active since {date}" or "Draft (not active)".

---

Existing evidence: apps/api/src/provider-config. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.03.01

- **T-07.03.01:** Create shared ESLint configuration
  - **Notes:** Package `packages/eslint-config` with base config extending `typescript-eslint`, Prettier, with per-package variants (react, node, nestjs). Root `.eslintrc.js` references the shared config with overrides per project. CI runs `turbo lint` which fails on any rule violation.
  - **Dependencies:** S-01.02
  - **Complexity:** M

Existing evidence: package.json. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.03.02

- **T-07.03.02:** Configure Prettier with consistent formatting
  - **Notes:** Root `.prettierrc` with `singleQuote: true`, `trailingComma: 'es5'`, `printWidth: 100`, `tabWidth: 2`, `semi: true`, `arrowParens: 'always'`, `endOfLine: 'lf'`. `.prettierignore` excludes `dist/`, `node_modules/`, `.turbo/`, `pnpm-lock.yaml`, `coverage/`. CI runs `pnpm format:check`.
  - **Dependencies:** S-01.01
  - **Complexity:** S

Existing evidence: package.json. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.03.03

- **T-07.03.03:** Set up Husky, lint-staged, and commitlint
  - **Notes:** Install `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`. Configure `commitlint.config.js` with conventional commit rules (allow `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style` only). lint-staged: `*.{ts,tsx}` → `eslint --fix && prettier --write`, `*.{json,md,yaml}` → `prettier --write`. Any commit that fails hook is rejected with clear error message.
  - **Dependencies:** T-07.03.01, T-07.03.02
  - **Complexity:** M

Existing evidence: package.json. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.03.04

- **T-07.03.04:** Create `.editorconfig` and `.vscode` workspace settings
  - **Notes:** `.editorconfig`: `root = true`, `[*] indent_style = space`, `indent_size = 2`, `end_of_line = lf`, `charset = utf-8`, `trim_trailing_whitespace = true`, `insert_final_newline = true`. `.vscode/settings.json`: `typescript.preferences.importModuleSpecifier = 'shortest'`, `editor.formatOnSave = true`, `editor.codeActionsOnSave = { "source.fixAll.eslint": true }`, `tailwindCSS.experimental.configFile = 'packages/ui/tailwind.config.ts'`. `.vscode/extensions.json`: recommend `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `bradlc.vscode-tailwindcss`, `ms-azuretools.vscode-docker`, `csstools.postcss`.
  - **Dependencies:** S-01.01
  - **Complexity:** S
  - **UI/UX:** N/A

---

Existing evidence: README.md. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.04.01

- **T-07.04.01:** Create incident runbooks directory (`docs/runbooks/`)
  - **Notes:** One `.md` file per runbook. Each has: Title, Severity (P0-P2), Symptoms, Impact, Owner/Team, Step-by-step recovery (numbered, commands included), Verification (how to confirm recovery), Escalation (who to call if steps fail), Post-incident actions. Create runbooks for: `payment-wallet-mismatch`, `refund-backlog`, `database-failover`, `database-restore`, `storage-outage`, `notification-outage`, `credential-compromise`, `bad-deployment`, `redis-loss`, `ai-provider-outage`.
  - **Dependencies:** S-04.01, S-04.02, S-04.03, S-05.02
  - **Complexity:** L

Existing evidence: docs/operations/backup/config-restore-runbook.md. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.04.02

- **T-07.04.02:** Create initial ADRs
  - **Notes:** `docs/adr/001-data-types-and-conventions.md` — UUIDv7, timestamptz, integer IRR, half-open ranges. `docs/adr/002-redis-scope.md` — optional, disposable, never source of truth. `docs/adr/003-modular-monolith-rationale.md` — why not microservices, extraction criteria. `docs/adr/004-deployment-topology.md` — pilot vs HA, vertical-first scaling. `docs/adr/005-test-database-policy.md` — real PostgreSQL only, no SQLite substitutes. `docs/adr/006-outbox-pattern.md` — transactional outbox instead of Kafka. Each ADR follows the template: Context, Decision, Alternatives, Consequences, Owner, Review trigger.
  - **Dependencies:** None (documentation)
  - **Complexity:** M

Existing evidence: docs/adr. Historical assessment: existing_implementation_revalidate.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.04.03

- **T-07.04.03:** Create deployment guide
  - **Notes:** `docs/deployment.md`: Prerequisites, Environment variables reference (all vars with descriptions), Pilot topology deployment (step-by-step), Commercial HA deployment, Upgrade procedure (migration, rollout, health check), Rollback procedure (code and data), Configuration reference (reverse proxy settings, PostgreSQL tuning, Redis config, MinIO config), Monitoring setup (Grafana dashboards, alerts).
  - **Dependencies:** T-05.01.01, T-05.02.01
  - **Complexity:** M

Existing evidence: README.md. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.04.04

- **T-07.04.04:** Create incident response plan
  - **Notes:** Document severity levels: P0 (critical — service down, payment issue, security breach) — page on-call, response <15 min. P1 (major — feature unavailable, degraded) — page owner, response <1 hour. P2 (minor — cosmetic, non-critical bug) — next working day. P3 (cosmetic) — backlog. On-call rotation: primary + secondary. Notification channels: Slack/Telegram for alerts, phone call for P0. Post-incident review: within 5 working days, create Jira issue, document timeline, root cause, action items.
  - **Dependencies:** T-07.04.01
  - **Complexity:** M
  - **UI/UX:** N/A

---

Existing evidence: docs. Historical assessment: no_matching_artifact_found.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.05.01

- **T-07.05.01:** Enforce “no external call inside a database transaction”
  - **Notes:** Add a Semgrep/custom static-analysis rule for Drizzle transaction callbacks and provider/network calls. Add representative positive/negative fixtures, run it in the PR gate, and document the persist-intent → commit → call asynchronously → apply idempotent result pattern.
  - **Dependencies:** T-05.03.04
  - **Complexity:** M

Existing evidence: apps/api/src. Historical assessment: acceptance_gap.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.05.02

- **T-07.05.02:** Generate and verify TypeScript API client contracts from OpenAPI
  - **Notes:** Generate `packages/api-client` from the committed OpenAPI document, fail CI on generated drift, and document that removals/type changes require a new API version or backward-compatible migration window.
  - **Dependencies:** T-05.03.03
  - **Complexity:** M

Existing evidence: apps/api/package.json. Historical assessment: partial.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.05.03

- **T-07.05.03:** Verify health-endpoint middleware exclusions
  - **Notes:** Integration tests prove `/api/health/live` and `/api/health/ready` require no session, bypass application rate limits, and do not create ordinary audit entries while still emitting operational metrics.
  - **Dependencies:** T-03.03.01
  - **Complexity:** S

Existing evidence: apps/api/src/app.module.ts. Historical assessment: acceptance_gap.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.

### 01-platform-infrastructure.md#T-07.05.04

- **T-07.05.04:** Document and gate module extraction criteria
  - **Notes:** Create an ADR covering measured scaling/security/availability/deployment triggers, alternatives, consequences, owner, review trigger, and preservation of API, ownership, idempotency, audit, and observability. Add the extraction checklist to the PR template.
  - **Dependencies:** T-07.04.02
  - **Complexity:** S

Existing evidence: architecture.md. Historical assessment: needs_document_review.

Next owner: Implementation owner; compare the current artifact and focused checks with these exact criteria before adding code.
