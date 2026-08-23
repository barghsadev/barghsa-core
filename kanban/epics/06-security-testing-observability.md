# Epic 06 — Security, Testing, Observability & Operations

> **Domain:** Security, Testing, Observability & Operations  
> **Epic ID:** E-06  
> **Status:** ⏳ Being drafted  
> **Dependencies:** E-01 (Platform & Infrastructure), E-02 (Auth, Users, CRM & Admin), E-04 (Invoices, Wallet, Payments & Contracts)  
> **Description:** Implement the full OWASP ASVS Level 2+ security baseline, comprehensive testing strategy across all layers, quality gates for every pipeline stage, and complete observability/operations stack with dashboards, alerts, runbooks, and SLO monitoring.

---

## Legend

| Marker | Meaning |
|--------|---------|
| **S** | Small — hours to ~1 day |
| **M** | Medium — ~2–4 days |
| **L** | Large — ~1 week |
| **XL** | Extra large — multi-week, consider splitting |

---

## E-06.01 — Security Baseline: Authentication & Sessions

**Goal:** Implement OWASP ASVS Level 2+ authentication controls — Argon2id password hashing, secure OTP handling, risk-based MFA, and comprehensive session management.

### Stories

#### S-06.01.01 — Argon2id password hashing with benchmarked parameters

**Description:** Implement password hashing using Argon2id with per-password salt. Parameters must be benchmarked and configurable. Passwords must never be stored in recoverable form (no encryption, only hashing).  

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.01.01.01 | Implement `PasswordService` with Argon2id via Node.js crypto bindings (e.g. `argon2` npm package) | S |
| T-06.01.01.02 | Create benchmark script to determine optimal cost/time/memory/parallelism parameters for target hardware | S |
| T-06.01.01.03 | Store benchmarked parameters in configuration (env vars / admin settings); allow overriding per env | S |
| T-06.01.01.04 | Ensure passwords are hashed with a per-password cryptographically random salt (16+ bytes) | S |
| T-06.01.01.05 | Add migration for existing plain/hash migration if any; ensure seamless upgrade | M |
| T-06.01.01.06 | Write unit tests: hash verification, salt uniqueness, cost parameter changes, timing-safe comparison | S |
| T-06.01.01.07 | Security review: confirm no plaintext password leaks via error paths, logs, analytics, or serialization | S |

#### S-06.01.02 — Secure OTP system

**Description:** OTPs must be random, single-use, short-lived (admin-configurable TTL), attempt-limited (5 attempts per challenge → invalidate), stored only as hashes (never plaintext), and invalidated after success or replacement. Response must not reveal whether an account exists (use generic messages). OTP resend interval: 60 seconds minimum.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.01.02.01 | Implement `OtpService` with cryptographically random OTP generation (6-digit numeric) | S |
| T-06.01.02.02 | Store OTPs as SHA-256/Argonid hashes; never store plaintext | S |
| T-06.01.02.03 | Implement attempt counter (max 5 per challenge → auto-invalidate) | S |
| T-06.01.02.04 | Implement TTL expiry (configurable: default 5 min) with cleanup job | S |
| T-06.01.02.05 | Implement rate limiting: 1 OTP per destination per 60s, 5/hour, 10/day; IP + device aggregates | M |
| T-06.01.02.06 | Ensure all OTP responses are generic ("If valid, an OTP was sent") — never reveal account existence | S |
| T-06.01.02.07 | Invalidate OTP after: successful verification, replacement request, expiry, or account compromise | S |
| T-06.01.02.08 | Print OTP to console in DEV environment only; never in production logs | S |
| T-06.01.02.09 | Write integration tests: OTP create, verify, consume, expire, exceed attempts, rate limit | M |

#### S-06.01.03 — Multi-factor authentication (MFA)

**Description:** Customer MFA is risk-based (new device, suspicious login); staff/admin MFA is mandatory on every new device. Sensitive operations require recent step-up authentication (re-auth within last N minutes or re-OTP). Device trust is revocable, time-limited, and visible in device management.

**Complexity:** XL  
**Dependencies:** S-06.01.02, E-02 (Auth module)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.01.03.01 | Design MFA enforcement engine: risk rules for customers, mandatory for staff/admins | M |
| T-06.01.03.02 | Implement step-up authentication gate for sensitive actions (payment confirmation, refunds, role changes, credential changes, session revocation) | M |
| T-06.01.03.03 | Implement device fingerprinting and trust scoring (cookie-based device ID, user-agent, IP geo, known device list) | L |
| T-06.01.03.04 | Build "trust this device for N days" flow with visible trust management UI | L |
| T-06.01.03.05 | Build device management UI: list active devices, trust status, last seen, revoke individual device or all devices | M |
| T-06.01.03.06 | Ensure OTP is re-requested when step-up is triggered | S |
| T-06.01.03.07 | Write integration tests: customer MFA only on new device, staff MFA always, step-up for sensitive ops, device trust expiry | M |

#### S-06.01.04 — Session management

**Description:** Opaque/signed session identifiers in HttpOnly cookies. Production: Secure flag, explicit SameSite policy, narrow Path. Rotate session after login, MFA, password change, privilege change, recovery. Refresh tokens rotate on use; reuse revokes family and alerts user. Absolute + idle expiry. Users can view/revoke devices/sessions. Password reset, staff disablement, ownership transfer, and suspected compromise revoke applicable sessions immediately.

**Complexity:** XL  
**Dependencies:** E-02 (Auth module)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.01.04.01 | Implement opaque session token generation and cookie management (HttpOnly, Secure in prod, SameSite=Lax, Path) | M |
| T-06.01.04.02 | Implement session store in PostgreSQL (not Redis; Redis is optional, auth must work without it) | M |
| T-06.01.04.03 | Implement session rotation: login, MFA step-up, password change, privilege change, account recovery | M |
| T-06.01.04.04 | Implement refresh token rotation with reuse detection (stealing detection + user alert + revoke token family) | L |
| T-06.01.04.05 | Implement absolute session expiry (configurable, e.g. 7 days) + idle expiry (configurable, e.g. 30 min) | M |
| T-06.01.04.06 | Build session/device management UI: list active sessions, device info, last activity, revoke action | M |
| T-06.01.04.07 | Implement session revocation triggers: password reset, staff disablement, ownership transfer, compromise detection | M |
| T-06.01.04.08 | Ensure tokens, refresh tokens, OTPs, passwords, national IDs never in localStorage, URLs, analytics, or client logs | S |
| T-06.01.04.09 | Write concurrency tests: session fixation prevention, refresh token reuse, simultaneous session mutations | M |
| T-06.01.04.10 | Security review: verify no cookie leakage, no fixation vectors, proper SameSite/Path/Domain/HostOnly | S |

---

## E-06.02 — Security Baseline: CSRF, CORS & Browser Protections

**Goal:** Implement defense-in-depth browser security controls — CSRF tokens, CSP, HSTS, security headers, and exact-origin CORS.

### Stories

#### S-06.02.01 — CSRF protection

**Description:** Every state-changing request (POST/PUT/PATCH/DELETE) using cookie auth requires a server-generated CSRF token bound to session, sent in a custom header. Origin validation against exact allowlist; Referer as fallback. SameSite is defense-in-depth, never the only control. Rotate CSRF tokens after authentication/session rotation. CSRF failures return safe error + correlation ID, logged as security events.

**Complexity:** L  
**Dependencies:** S-06.01.04  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.02.01.01 | Implement CSRF token service: generate per-session token, store in session store, validate custom header | M |
| T-06.02.01.02 | Implement NestJS CSRF guard/ interceptor for state-changing routes | M |
| T-06.02.01.03 | Implement Origin validation against allowlist (configurable via admin settings or env) | S |
| T-06.02.01.04 | Implement SameSite cookie policy: Lax for session, None only when TLS + explicit cross-origin need | S |
| T-06.02.01.05 | Rotate CSRF token on session rotation (login, MFA, password change, privilege change) | S |
| T-06.02.01.06 | Ensure CSRF failures return safe error + correlation ID; log as security event | S |
| T-06.02.01.07 | Write integration tests: valid CSRF token, missing token, expired token, rotated token, origin mismatch, same-site bypass | M |
| T-06.02.01.08 | DAST security test: automated CSRF injection attempts | S |

#### S-06.02.02 — Content Security Policy (CSP)

**Description:** Deliver CSP via HTTP headers. Start in Report-Only during rollout, then enforce nonce/hash-based policy. No `unsafe-eval`, no broad `unsafe-inline`. Baseline: restrictive `default-src`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, explicit `script-src`/`style-src`/`img-src`/`font-src`/`connect-src`/`form-action` allowlists.

**Complexity:** L  
**Dependencies:** S-06.02.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.02.02.01 | Design CSP directive set for web app (nonce-based scripts, hashed styles where needed) | M |
| T-06.02.02.02 | Implement CSP middleware in web process; support Report-Only mode toggle via config | M |
| T-06.02.02.03 | Configure CSP reporting endpoint (e.g. `csp-reports` route or external `report-uri`) | S |
| T-06.02.02.04 | Ensure nonce generation and propagation for inline scripts/styles across SSR and client | L |
| T-06.02.02.05 | Add CI test that verifies CSP headers in production build | S |
| T-06.02.02.06 | Roll out: 1 week Report-Only monitoring → analyze violations → switch to Enforce | S |
| T-06.02.02.07 | Verify no `unsafe-eval` usage across codebase (replace `eval`, `new Function`, string setTimeout) | S |

#### S-06.02.03 — HSTS and security headers

**Description:** Set `X-Content-Type-Options: nosniff`, restrictive `Referrer-Policy` (`strict-origin-when-cross-origin`), appropriate `Permissions-Policy`, clickjacking protection via CSP `frame-ancestors`. Enable HSTS only after verifying TLS and subdomain impact in production. Enable preload only deliberately (not casually).

**Complexity:** M  
**Dependencies:** E-01 (Platform & Infrastructure — reverse proxy/TLS)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.02.03.01 | Implement security headers middleware: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` | S |
| T-06.02.03.02 | Implement `Strict-Transport-Security` header configurable by env; enable HSTS only in production with verified TLS | S |
| T-06.02.03.03 | Ensure `frame-ancestors 'none'` in CSP prevents clickjacking | S |
| T-06.02.03.04 | Write integration tests: verify all security headers present and correct on responses | S |
| T-06.02.03.05 | Add CI check that fails if required security headers are missing or misconfigured | S |

#### S-06.02.04 — CORS configuration

**Description:** CORS uses exact production origins only. Credentialed CORS never uses wildcard `*`. Allowed methods and headers are minimal. Preflight response cached conservatively (e.g. 1 hour).

**Complexity:** S  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.02.04.01 | Implement CORS middleware with exact origin allowlist (env config, not wildcard) | S |
| T-06.02.04.02 | Ensure credentialed CORS (credentials: include) never accepts wildcard origin | S |
| T-06.02.04.03 | Restrict allowed methods to required subset; restrict allowed headers | S |
| T-06.02.04.04 | Cache preflight response (e.g. `Access-Control-Max-Age: 3600`) | S |
| T-06.02.04.05 | Write CORS integration tests: valid origin, invalid origin, credentialed request, preflight | S |

---

## E-06.03 — Security Baseline: Authorization & Data Isolation

**Goal:** Implement centralized, deny-by-default authorization with strict data isolation per profile/tenant.

### Stories

#### S-06.03.01 — Centralized authorization policy engine

**Description:** Every endpoint and worker command performs server-side capability checks + active-profile/object ownership checks. UI visibility is not authorization. Centralize policy decisions so HTTP routes, workers, AI tools, exports, and admin actions use same rules.

**Complexity:** XL  
**Dependencies:** E-02 (Auth, Users, CRM & Admin — role management)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.03.01.01 | Design authorization policy engine: roles, capabilities/permissions, resource types, scopes (profile, system) | L |
| T-06.03.01.02 | Implement `AuthorizationService` with deny-by-default policy resolution | M |
| T-06.03.01.03 | Implement NestJS guard/decorator for endpoint-level permission checks | M |
| T-06.03.01.04 | Implement profile-scoped data access: load resources by both `id` and `activeProfileId`; reject cross-profile access | M |
| T-06.03.01.05 | Extend authorization to background workers, AI tool calls, file access URLs, exports, and admin actions | L |
| T-06.03.01.06 | Implement staff role permissions: deny-by-default, additive by role (CS, CRM, Finance, Legal, Ops, Admin) | M |
| T-06.03.01.07 | Ensure all staff permissions are explicit capabilities; high-risk commands require dedicated capability + step-up auth | M |
| T-06.03.01.08 | Write integration tests: each role's permitted/denied actions, profile isolation, cross-tenant BOLA attempts | L |

#### S-06.03.02 — BOLA/IDOR prevention

**Description:** Prevent Broken Object Level Authorization and Insecure Direct Object References by loading resources through both identifier and authorized profile/tenant scope. Public UUIDs reduce enumeration but never replace authorization.

**Complexity:** M  
**Dependencies:** S-06.03.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.03.02.01 | Audit all existing resource-loading endpoints for BOLA gaps (load by ID without profile scope check) | M |
| T-06.03.02.02 | Implement reusable query scope filter: `where({ id, profileId: activeProfileId })` for customer resources | M |
| T-06.03.02.03 | Ensure staff/staff-admin routes verify explicit permission, not just "is staff" | S |
| T-06.03.02.04 | Write BOLA/IDOR penetration tests: attempt cross-profile access via UUID enumeration, direct ID manipulation | M |
| T-06.03.02.05 | Add DAST/security E2E: attempt access to another profile's invoices, orders, contracts, wallet | S |

#### S-06.03.03 — Sensitive change audit and protection

**Description:** Changes to ownership, roles, verification, payout/refund destination, and protected identity fields record before/after values and trigger appropriate alerts. Dual-approval threshold configurable for high-value financial actions.

**Complexity:** M  
**Dependencies:** S-06.03.01, E-04 (Wallet / Payments)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.03.03.01 | Implement audit-logging interceptor for ownership/role/identity changes: before/after values, actor, timestamp | M |
| T-06.03.03.02 | Implement dual-approval engine: configurable IRR threshold, second authorized user approval needed | M |
| T-06.03.03.03 | Implement emergency override: reason, elevated permission, immediate alert, audit review | M |
| T-06.03.03.04 | Write integration tests: dual-approval flow, override flow, denial flow, alert triggers | M |

---

## E-06.04 — Security Baseline: Input, Output & Injection Safety

**Goal:** Validate every input boundary, execute only parameterized queries, escape all output, prevent SSRF, and sanitize rich content.

### Stories

#### S-06.04.01 — Input validation with Zod/DTO schemas

**Description:** Validate every request boundary with shared Zod/DTO schemas: explicit types, lengths, numeric ranges, enum allowlists, pagination caps, unknown-field rejection for command payloads.

**Complexity:** M  
**Dependencies:** None (shared Zod schemas exist in `packages/shared`)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.04.01.01 | Audit existing Zod schemas for completeness: types, lengths, ranges, enums, pagination caps | M |
| T-06.04.01.02 | Add `z.strictObject()` or `stripUnknown: false` to all command DTOs to reject unknown fields | M |
| T-06.04.01.03 | Implement reusable pagination validation: max limit, cursor/offset constraints | S |
| T-06.04.01.04 | Add Zod refinement for business-rule validation (e.g. date ranges, amount limits) | S |
| T-06.04.01.05 | Write unit tests: valid request, invalid type, out of range, extra field, pagination abuse | M |

#### S-06.04.02 — Parameterized queries and SQL injection prevention

**Description:** All database queries use Drizzle ORM / parameterized queries. Raw SQL requires explicit review and must never interpolate untrusted strings. Dynamic sort/filter fields use allowlisted mappings.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.04.02.01 | Audit all database access for raw SQL; flag any untrusted interpolation | M |
| T-06.04.02.02 | Implement allowlist-based field mapping for dynamic `ORDER BY` / `WHERE` fields | S |
| T-06.04.02.03 | Add lint rule: forbid raw SQL interpolation of non-literal strings | S |
| T-06.04.02.04 | Write SAST scan configuration targeting SQL injection patterns | S |

#### S-06.04.03 — Output safety and XSS prevention

**Description:** Render user/provider content as text by default. Rich text uses allowlist sanitizer with isolated rendering policy. React escaping not bypassable with untrusted content. No `eval()`, `new Function()`, string `setTimeout`, `document.write()`, or unsanitized HTML sinks.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.04.03.01 | Implement or integrate DOM purify / allowlist HTML sanitizer for rich text content | M |
| T-06.04.03.02 | Audit all `dangerouslySetInnerHTML` usage; replace with sanitizer or remove | S |
| T-06.04.03.03 | Add lint rule: ban `eval`, `new Function`, string `setTimeout`/`setInterval`, `document.write` | S |
| T-06.04.03.04 | Ensure all user-provided data in React is rendered as text (not HTML) by default | S |
| T-06.04.03.05 | Write unit tests: XSS vectors through sanitizer, URL params, user display names, rich text fields | M |

#### S-06.04.04 — SSRF prevention

**Description:** Outbound requests never accept arbitrary user-controlled destinations. Provider endpoints and webhooks use allowlisted HTTPS hosts. DNS/IP validation, redirect limits, private/link-local/metadata blocking, timeouts, response-size caps, network egress restrictions.

**Complexity:** L  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.04.04.01 | Implement SSRF guard middleware: intercept all outbound HTTP requests from the application | L |
| T-06.04.04.02 | Build allowlist-based URL validator: permit only configured HTTPS hosts, reject IP literals when hostname expected | M |
| T-06.04.04.03 | Block private/link-local/metadata IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fd00::/8) | M |
| T-06.04.04.04 | Enforce redirect limits (e.g. max 5 redirects) and verify each redirect destination | M |
| T-06.04.04.05 | Set strict timeouts, response-size caps (e.g. 10MB) per outbound call | S |
| T-06.04.04.06 | Write SSRF injection tests: internal IPs, metadata endpoints (169.254.169.254), redirect to private, DNS rebinding | M |

---

## E-06.05 — Security Baseline: Rate Limiting & Abuse Prevention

**Goal:** Implement layered rate limiting at edge and application layers, with durable critical counters in PostgreSQL.

### Stories

#### S-06.05.01 — Layered rate limiting infrastructure

**Description:** Rate limits enforced at both edge (reverse proxy) and application layers. Return `429` with `Retry-After` and localized recovery message. Dimensions: IP, account/user, profile, device, action. Durable counters in PostgreSQL for critical abuse protection; Redis may accelerate but must not be required.

**Complexity:** L  
**Dependencies:** E-01 (reverse proxy)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.05.01.01 | Design rate-limiting dimensions: IP, user, profile, device, action. Define limit configuration schema | L |
| T-06.05.01.02 | Implement PostgreSQL-backed rate-limit counters (durable, required for critical paths) | M |
| T-06.05.01.03 | Implement Redis-accelerated rate-limit counters (optional, fallback to PG) | M |
| T-06.05.01.04 | Implement NestJS rate-limit guard/decorator with configurable dimensions and limits | M |
| T-06.05.01.05 | Implement edge-layer rate limiting (nginx/openresty/Caddy config or WAF) | S |
| T-06.05.01.06 | Ensure `429` response includes `Retry-After` header and localized safe message | S |
| T-06.05.01.07 | Write integration tests: IP limit, user limit, profile limit, action limit; verify Redis loss doesn't weaken critical limits | M |

#### S-06.05.02 — Action-specific rate limit configuration

**Description:** Implement defaults for OTP send, OTP verify, login, password reset, order submission, wallet top-up, file upload, AI calls. Tuneable by admins within safe bounds. Emergency rules deployable without deployment.

**Complexity:** M  
**Dependencies:** S-06.05.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.05.02.01 | Configure OTP send limits: 1/dest/60s, 5/hour, 10/day; IP+device aggregates | S |
| T-06.05.02.02 | Configure OTP verify limits: 5 failed attempts per challenge → invalidate | S |
| T-06.05.02.03 | Configure login limits: progressive delay after 5 failures per account+IP in 15min; IP/device spray detection | S |
| T-06.05.02.04 | Configure password reset: 5 starts per account or dest/hour; separate IP limits | S |
| T-06.05.02.05 | Configure order/consultation limits: 5 per profile/minute; idempotency key as secondary protect | S |
| T-06.05.02.06 | Configure wallet/payment/refund limits: 10 per profile/minute; stricter provider+anomaly controls | S |
| T-06.05.02.07 | Configure file upload limits: 20 per profile/minute; concurrent upload, size, storage quotas | S |
| T-06.05.02.08 | Configure AI limits: per-user requests, concurrency, token, cost budgets; stricter for tool-enabled actions | S |
| T-06.05.02.09 | Admin UI: view/edit limits within safe min/max bounds; versioned configuration | M |
| T-06.05.02.10 | Emergency rule engine: security can set temporary rules with owner, expiry, reason, audit record | M |
| T-06.05.02.11 | Write tests: each action limit enforced correctly, admin tuning, emergency override | M |

---

## E-06.06 — Security Baseline: Files, Providers & Webhooks

**Goal:** Secure file upload handling, provider callback verification, and webhook idempotency.

### Stories

#### S-06.06.01 — File upload safety

**Description:** Allowlisted extensions + detected MIME/content validation, size limits, random object keys, malware scanning (ClamAV or API), private storage, safe download disposition. Original filenames metadata-only, never storage paths.

**Complexity:** L  
**Dependencies:** E-01 (S3/MinIO storage)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.06.01.01 | Implement upload validation pipeline: extension allowlist → MIME detection → size check → malware scan → store | L |
| T-06.06.01.02 | Build extension+MIME allowlist configurable by category (docs, images, video) with admin limits | M |
| T-06.06.01.03 | Generate random object keys (UUID); never use original filenames in storage path | S |
| T-06.06.01.04 | Implement malware scanning integration (ClamAV socket or cloud API) with Quarantine state on detection | M |
| T-06.06.01.05 | Implement download disposition: potentially active formats → `Content-Disposition: attachment`; safe formats → inline only after sandbox preview | S |
| T-06.06.01.06 | Ensure uploads are private by default; access via short-lived authorized URLs or backend streaming after auth check | M |
| T-06.06.01.07 | Write tests: valid upload, invalid extension, mismatched MIME, oversized, malware detected, quarantine alert | M |
| T-06.06.01.08 | Security review: file path traversal, double extension, magic byte manipulation, zip bombs | S |

#### S-06.06.02 — Webhook/callback security

**Description:** Payment, SMS, storage, and other callbacks verify provider signatures/secrets, timestamp/replay windows, event IDs, expected merchant/account context, and server-side transaction status. Browser redirects never proof of payment. Webhook processing idempotent, stores raw event securely, returns quickly before async processing.

**Complexity:** L  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.06.02.01 | Implement generic webhook verification service: signature/HMAC verification, replay window (e.g. ±5 min), event ID dedup | L |
| T-06.06.02.02 | Build payment provider callback adapter: verify provider signature, merchant context, server-side status check; browser redirect ignored | M |
| T-06.06.02.03 | Build SMS provider callback adapter: verify authenticity, replay-safe delivery status | M |
| T-06.06.02.04 | Build storage provider callback: verify signature, replay-safe, idempotent status update | M |
| T-06.06.02.05 | Implement webhook idempotency: store webhook event hash + processed flag; reject duplicates | M |
| T-06.06.02.06 | Ensure raw provider events stored securely (encrypted or access-controlled) when permitted by policy | S |
| T-06.06.02.07 | Write tests: valid callback, expired timestamp, replayed event, wrong signature, missing signature, duplicate delivery | M |

---

## E-06.07 — Security Baseline: Secrets, Dependencies & Infrastructure

**Goal:** Manage secrets securely, scan dependencies, harden containers, and enforce supply-chain security.

### Stories

#### S-06.07.01 — Secrets management

**Description:** Secrets from secret manager or protected deployment env, not source control or frontend bundles. Rotation support with overlapping active/previous keys. Secrets encrypted at rest, masked after entry, excluded from logs/analytics/support exports.

**Complexity:** M  
**Dependencies:** E-01 (Platform & Infrastructure)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.07.01.01 | Implement secrets resolution abstraction: env vars, AWS Secrets Manager / HashiCorp Vault / encrypted config file | M |
| T-06.07.01.02 | Ensure secrets are encrypted at rest and masked in every API response and admin UI display | S |
| T-06.07.01.03 | Exclude secrets from logs, analytics, error tracking, telemetry, and support exports | S |
| T-06.07.01.04 | Implement rotation support: overlapping active/previous key period; key versioning | M |
| T-06.07.01.05 | Audit codebase for hardcoded secrets, .env committed, frontend-bundled secrets | S |
| T-06.07.01.06 | Add CI secret scan (e.g. truffleHog, gitLeaks) to block commits with secrets | S |

#### S-06.07.02 — Dependency and supply-chain security

**Description:** Pin dependencies with lockfile (pnpm-lock.yaml). Automated SCA, SAST, secret scanning, container scanning in CI. Findings triaged by exploitability and production reachability. Block critical/high with credible path.

**Complexity:** M  
**Dependencies:** E-01 (CI/CD pipeline)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.07.02.01 | Configure SCA tool (e.g. Snyk, npm audit, OWASP Dependency-Check) in CI | M |
| T-06.07.02.02 | Configure SAST tool (e.g. CodeQL, Semgrep) with custom rules for NestJS/Drizzle security patterns | M |
| T-06.07.02.03 | Configure container vulnerability scanning (e.g. Trivy, Grype) on Docker images | M |
| T-06.07.02.04 | Configure secret scanning on every PR (e.g. gitLeaks, truffleHog) | S |
| T-06.07.02.05 | Define triage policy: critical/high with credible production path → block release | S |
| T-06.07.02.06 | Set up license compliance check (e.g. license-checker) for dependency licenses | S |
| T-06.07.02.07 | Generate SBOM (Software Bill of Materials) for each production build | M |
| T-06.07.02.08 | Create CI gate config: SCA/SAST/secret/container scans on every PR, full scan on main | M |

#### S-06.07.03 — Container and runtime hardening

**Description:** Production Node.js never exposes inspector, never enables `insecureHTTPParser`, runs as non-root, uses read-only container/filesystem where practical, explicit request/body/header/time limits at proxy and app layers. TLS with modern protocols/ciphers.

**Complexity:** M  
**Dependencies:** E-01 (Docker/deployment)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.07.03.01 | Harden Dockerfile: non-root user, read-only rootfs where practical, no inspector, `NODE_OPTIONS=--no-deprecation` | S |
| T-06.07.03.02 | Disable `insecureHTTPParser`; set explicit request/body/header/time limits at proxy and application level | S |
| T-06.07.03.03 | Configure TLS at reverse proxy: modern protocols (TLS 1.2+), secure ciphers, HSTS | S |
| T-06.07.03.04 | Ensure proxy trust configured to exact hop topology (not `trust proxy` globally) | S |
| T-06.07.03.05 | Add container security scanning to CI (Trivy, etc.) | S |
| T-06.07.03.06 | Write container smoke test: non-root user, inspector not available, no unsafe parser | S |

---

## E-06.08 — Security Baseline: Verification & Response

**Goal:** Establish threat modeling, penetration testing, and incident response processes.

### Stories

#### S-06.08.01 — Threat modeling

**Description:** Maintain lightweight threat model covering: authentication, active-profile isolation, wallet/payment/refund, contracts/signatures, file upload, admin configuration, external providers, AI tool execution. Update for material flow changes.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.08.01.01 | Create initial threat model document (`docs/threat-model.md`) covering all critical flows | M |
| T-06.08.01.02 | Map trust boundaries, data flows, assets, threat actors (customer, staff, admin, external attacker, provider) | M |
| T-06.08.01.03 | Apply STRIDE or similar framework to each domain (auth, isolation, wallet, contracts, files, config, providers, AI) | L |
| T-06.08.01.04 | Document accepted risks with owner, justification, compensating controls, expiry, approval | M |
| T-06.08.01.05 | Define review cadence: quarterly full review + review on material flow changes | S |
| T-06.08.01.06 | Create PR checklist item: threat model update required when trust boundary, sensitive data, provider, permission, or financial flow changes | S |

#### S-06.08.02 — Penetration testing and security verification

**Description:** DAST/API security tests in staging. Independent penetration test before launch and after major auth/payment/authorization changes. Critical/high vulnerabilities with credible production path block release.

**Complexity:** M  
**Dependencies:** S-06.08.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.08.02.01 | Define pen test scope: auth, session, MFA, CSRF, CSP, BOLA/IDOR, rate limits, SSRF, file upload, webhooks, wallet/payment, AI tools | M |
| T-06.08.02.02 | Schedule pre-launch independent penetration test; budget and vendor selection | M |
| T-06.08.02.03 | Define criteria: critical/high with credible production path → fix before release; accepted risk requires owner+expiry | S |
| T-06.08.02.04 | Implement automated authenticated DAST in staging (e.g. OWASP ZAP API scan) | M |
| T-06.08.02.05 | Write custom security E2E suite for targeted API test cases CSRF, CORS, session rotation, rate limits, BOLA, SSRF, open redirect | L |

#### S-06.08.03 — Incident response

**Description:** Maintain incident runbooks, key/token revocation procedures, evidence preservation, customer communication templates, post-incident review. Security incidents not hidden inside ordinary error queues.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.08.03.01 | Create incident response runbook (`docs/runbooks/security-incident.md`): detection, containment, eradication, recovery, post-mortem | M |
| T-06.08.03.02 | Create key/token revocation procedure: API keys, provider secrets, session mass-revocation, certificate rotation | M |
| T-06.08.03.03 | Create customer communication templates: breach notification, service disruption, credential rotation | S |
| T-06.08.03.44 | Set up security event channel separate from ordinary error queues (e.g. dedicated Slack/alert channel) | S |
| T-06.08.03.05 | Define post-incident review process: timeline, root cause, corrective actions, documentation update | S |

---

## E-06.09 — Testing Strategy: Unit & Component Tests

**Goal:** Comprehensive unit and component test coverage across all domains.

### Stories

#### S-06.09.01 — Unit test infrastructure

**Description:** Vitest as primary TypeScript test runner. Time, UUIDs, randomness, and provider clients are injected or controlled. Financial examples from product requirements become executable table-driven tests.

**Complexity:** M  
**Dependencies:** None (monorepo structure exists)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.09.01.01 | Configure Vitest across all packages with shared config, coverage thresholds, and reporter | M |
| T-06.09.01.02 | Implement test utilities: controllable clock, fixed UUIDs, deterministic random, fake provider factories | M |
| T-06.09.01.03 | Implement table-driven test helper for financial examples (inputs → expected outputs) | S |
| T-06.09.01.04 | Add `vitest --related` for affected-only test runs in CI | S |

#### S-06.09.02 — Domain unit tests

**Description:** Unit tests cover state-machine transitions/guards, pricing/VAT/discount/rounding/date calculations, authorization policy decisions, idempotency/refund calculations, validation/normalization, provider response mapping and error classification.

**Complexity:** XL  
**Dependencies:** S-06.09.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.09.02.01 | Author unit tests for all state machines: Orders, Contracts, Invoices, Payments, Refunds, Documents, Wallet transactions, Invitations, Verification cases | L |
| T-06.09.02.02 | Author unit tests for pricing engine: VAT calculation, discounts, rounding (half-up to IRR), electricity composition rules, Jalali period calculations | L |
| T-06.09.02.03 | Author unit tests for authorization policy: role permissions, capability checks, profile-scoped access, BOLA denial | M |
| T-06.09.02.04 | Author unit tests for idempotency: idempotency key verification, duplicate detection, refund-amount calculations | M |
| T-06.09.02.05 | Author unit tests for input validation: Zod schema edge cases, normalization, locale-specific formatting | M |
| T-06.09.02.06 | Author unit tests for provider adapter responses: success, timeout, throttle, error classification, mapping | M |
| T-06.09.02.07 | Author unit tests for Jalali calendar: month lengths, leap years, period boundaries, Gregorian conversion | M |

#### S-06.09.03 — Component and frontend integration tests

**Description:** React Testing Library tests user-visible behavior, accessibility roles/names, validation, loading/error/empty states, RTL/LTR, permission-dependent actions, recovery paths. Avoid snapshot-only testing.

**Complexity:** L  
**Dependencies:** E-02 (UI components)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.09.03.01 | Configure RTL with custom render helpers, providers (auth, i18n, theme), and MSW/api contract fixtures | M |
| T-06.09.03.02 | Write RTL tests for registration form: validation, OTP flow, error states, RTL layout | M |
| T-06.09.03.03 | Write RTL tests for login form: validation, error states, MFA step-up, RTL/LTR | M |
| T-06.09.03.04 | Write RTL tests for onboarding/profile forms: INDIVIDUAL and LEGAL flows, field validation, address selection | M |
| T-06.09.03.05 | Write RTL tests for dashboard: profile display, verification warning, agent invitation | M |
| T-06.09.03.06 | Write RTL tests for electricity order wizards: simple order, advanced order, green rule disclosure, price review | L |
| T-06.09.03.07 | Write RTL tests for wallet/invoice/payment pages: balance display, top-up, invoice payment, refund view | L |
| T-06.09.03.08 | Write RTL tests for admin pages: configuration, role management, product/settings CRUD | L |
| T-06.09.03.09 | Ensure every critical form preserves valid input after server validation/provider error | S |
| T-06.09.03.10 | Write RTL tests for permission-dependent UI: elements hidden/disabled per role | M |

---

## E-06.10 — Testing Strategy: Backend Integration & E2E

**Goal:** Backend integration tests against real PostgreSQL; comprehensive E2E covering critical journeys.

### Stories

#### S-06.10.01 — Backend integration test infrastructure

**Description:** Boot real NestJS application against real PostgreSQL test database. SQLite/in-memory substitutes not accepted. Provider calls replaced only at adapter boundary with deterministic fake servers or signed webhook fixtures.

**Complexity:** L  
**Dependencies:** E-01 (Docker Compose for test PG), S-06.09.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.10.01.01 | Set up test PostgreSQL instance in CI and local dev (Docker Compose service) | S |
| T-06.10.01.02 | Configure NestJS testing module: bootstrap real app with test DB, apply migrations before each suite | M |
| T-06.10.01.03 | Implement test DB lifecycle: per-worker isolated schema or database for parallel runs | M |
| T-06.10.01.04 | Build fake adapter servers: SMTP fake, SMS.ir fake, payment gateway fake, document storage fake | L |
| T-06.10.01.05 | Implement deterministic signed webhook fixture builder | S |
| T-06.10.01.06 | Write helper utilities: create user, create profile, authenticate, create order, create invoice, add wallet funds | L |

#### S-06.10.02 — Backend integration tests

**Description:** Real PostgreSQL tests for migrations, constraints, transactions, locking, profile scoping, audit/outbox writes, idempotent retries. Mandatory concurrency tests for wallet, callbacks, refunds, orders, ownership.

**Complexity:** XL  
**Dependencies:** S-06.10.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.10.02.01 | Write migration integration tests: clean database apply, upgrade-path apply, rollback, data preservation | M |
| T-06.10.02.02 | Write constraint tests: unique indexes, foreign keys, NOT NULL, CHECK constraints, exclusion constraints | M |
| T-06.10.02.03 | Write transaction tests: atomic wallet debit + invoice settlement, atomic order+contract+invoice creation | M |
| T-06.10.02.04 | Write locking tests: row-level lock for wallet mutations, optimistic version for concurrent state changes | M |
| T-06.10.02.05 | Write profile-scoped data isolation tests: customer A cannot access customer B's data | M |
| T-06.10.02.06 | Write audit log tests: every state transition recorded, append-only, no edit/delete via API | M |
| T-06.10.02.07 | Write outbox tests: transactional outbox write + commit, worker read + idempotent processing + dead letter | L |
| T-06.10.02.08 | Write idempotency tests: duplicate request returns original result, same idempotency key different payload rejected | M |
| T-06.10.02.09 | **Mandatory concurrency tests:** simultaneous wallet payments, duplicate provider callbacks, duplicate bank confirmation, concurrent refund workers, repeated order submission, ownership/role changes during requests, competing state transitions | XL |
| T-06.10.02.10 | Write provider adapter integration tests: fake SMTP, fake SMS.ir, fake payment gateway with all error modes | M |

#### S-06.10.03 — E2E test suite

**Description:** Playwright covering critical journeys. PR runs use Chromium for speed; scheduled nightly + release runs Chromium + Firefox + WebKit + mobile viewports. Tests use isolated accounts/profiles and deterministic seed data.

**Complexity:** XL  
**Dependencies:** E-02, E-03, E-04 (core business modules must be functional)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.10.03.01 | Configure Playwright: project structure, environment, auth helpers, seed data, parallel workers with isolated DB schemas | L |
| T-06.10.03.02 | Write E2E: registration → OTP verify → onboarding INDIVIDUAL → dashboard | M |
| T-06.10.03.03 | Write E2E: registration → OTP verify → onboarding LEGAL → profile verification flow | M |
| T-06.10.03.04 | Write E2E: login → OTP (new device) → MFA → session revocation | M |
| T-06.10.03.05 | Write E2E: legal-agent invitation → accept → role-permission verification | M |
| T-06.10.03.06 | Write E2E: simple electricity order → wallet top-up → invoice payment → contract review → approval | L |
| T-06.10.03.07 | Write E2E: advanced electricity order with mandatory green rule → bank receipt → staff confirm → refund on rejection | L |
| T-06.10.03.08 | Write E2E: saving-plan order → agreement → invoice → payment → fulfillment stages | L |
| T-06.10.03.09 | Write E2E: consultation pricing → fee offer → accept → pay | L |
| T-06.10.03.10 | Write E2E: solar construction request → document upload → staff review → postal → contract creation | L |
| T-06.10.03.11 | Write E2E: contract version acceptance/signature → adjustment invoice | M |
| T-06.10.03.12 | Write E2E: admin configuration change → effective version → rollback | M |
| T-06.10.03.13 | Write E2E: profile switching → data isolation verification | M |
| T-06.10.03.14 | Configure CI E2E: PR → Chromium only; nightly → Chromium + Firefox + WebKit; release → + mobile viewports | M |
| T-06.10.03.15 | Ensure E2E never calls production payment, SMS, email, storage, bill-data, or AI providers | S |

---

## E-06.11 — Non-Functional Testing

**Goal:** Automated accessibility, security (DAST/SAST), performance, reliability, and recovery tests.

### Stories

#### S-06.11.01 — Accessibility testing

**Description:** Automated axe-style checks on critical pages plus manual keyboard/screen-reader review for new complex flows.

**Complexity:** M  
**Dependencies:** E-02 (UI framework)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.11.01.01 | Integrate `@axe-core/playwright` into E2E pipeline; run on all critical pages | M |
| T-06.11.01.02 | Create accessibility test suite covering: keyboard navigation, focus visibility, contrast, labels, ARIA roles, error announcements, reduced motion | M |
| T-06.11.01.03 | Add CI gate: axe violations block PR; track severity | S |
| T-06.11.01.04 | Document manual testing checklist for screen readers (NVDA/JAWS, VoiceOver) and keyboard-only | S |

#### S-06.11.02 — Security (DAST/SAST)

**Description:** Static analysis, dependency/secret/container scans on every PR. Authenticated API/DAST checks in staging. Targeted tests for CSRF, CORS, BOLA/IDOR, rate limits, file upload, open redirect, SSRF, webhook replay, session rotation.

**Complexity:** L  
**Dependencies:** S-06.08.02  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.11.02.01 | Integrate OWASP ZAP for authenticated API scanning in staging environment | L |
| T-06.11.02.02 | Write targeted security test scenarios: CSRF, CORS misconfiguration, BOLA/IDOR, rate limit bypass, upload abuse, open redirect, SSRF, webhook replay, session rotation corner cases | L |
| T-06.11.02.03 | Configure Semgrep/CodeQL with security-focused rules for NestJS/Drizzle patterns | M |
| T-06.11.02.04 | Add CI gate: critical/high SAST findings block merge; medium triaged within sprint | S |

#### S-06.11.03 — Performance testing

**Description:** Route/query benchmarks with realistic data. Load test critical paths before launch and after material changes. Protect database with timeouts, pool limits, query cancellation, pagination caps, concurrency limits.

**Complexity:** L  
**Dependencies:** E-01, E-02, E-03, E-04 (systems functional with representative data)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.11.03.01 | Establish query and route latency budgets (p50/p95/p99) before load testing | M |
| T-06.11.03.02 | Write performance test scenarios: electricity price preview, order submission, wallet payment, invoice lists, CRM search, file upload auth, notification fan-out | L |
| T-06.11.03.03 | Run load test with realistic Persian/English payloads and production-like indexes | L |
| T-06.11.03.04 | Configure database protection: request/statement/lock/idle-transaction timeouts, pool limits, pagination caps, export/report concurrency limits | M |
| T-06.11.03.05 | Set up CI performance budget: route JS size, Core Web Vitals regression check for primary mobile flows | M |
| T-06.11.03.06 | Schedule weekly performance regression run in staging | S |

#### S-06.11.04 — Reliability and recovery testing

**Description:** Failure-injection tests for provider timeouts, Redis loss, worker crash/replay, duplicate delivery, DB connection exhaustion. Scheduled backup restore and object recovery tests.

**Complexity:** L  
**Dependencies:** E-01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.11.04.01 | Write failure-injection tests: provider timeout → circuit breaker → queue; Redis unavailable → fallback to PG | M |
| T-06.11.04.02 | Write worker reliability tests: crash during job → reprocess or dead-letter; duplicate delivery → idempotency | M |
| T-06.11.04.03 | Write DB connection exhaustion test: pool full → queue/backpressure → graceful degradation | M |
| T-06.11.04.04 | Schedule quarterly PostgreSQL restore test: measure RPO/RTO, document in runbook | M |
| T-06.11.04.05 | Schedule quarterly object storage recovery test: version retrieval, policy enforcement, orphan detection | M |
| T-06.11.04.06 | Write reconciliation tests: deliberately inconsistent fixtures → mismatch alert → finance exception | M |

---

## E-06.12 — Coverage Thresholds & Quality Gates

**Goal:** Enforce coverage thresholds and implement all pipeline quality gates.

### Stories

#### S-06.12.01 — Coverage thresholds enforcement

**Description:** Changed code must maintain 80% line / 75% branch coverage overall. Critical domains (auth, authorization, payments, wallet, refunds, pricing, contracts, state machines) target 90% line / 85% branch. Exceptions require technical justification + reviewer approval.

**Complexity:** M  
**Dependencies:** S-06.09.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.12.01.01 | Configure Vitest coverage thresholds per package with different target levels for critical vs non-critical | M |
| T-06.12.01.02 | Define critical domain packages: auth, authorization, payments, wallet, refunds, pricing, contracts, state-machine | S |
| T-06.12.01.03 | Implement CI coverage check: changed-file coverage gateway with exception mechanism | M |
| T-06.12.01.04 | Write coverage exception template: requires technical justification + domain owner approval | S |

#### S-06.12.02 — Pull request quality gate

**Description:** Every PR must pass 12 checks: formatting+linting, TypeScript type checking, unit+component tests for affected, relevant PG integration tests, migration validation, OpenAPI drift, production build + route budget, changed-code coverage, secret+SCA+SAST+license scans, no critical/high security finding with credible path, domain review.

**Complexity:** L  
**Dependencies:** All test infrastructure  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.12.02.01 | Implement CI workflow with all 12 PR gate checks in parallel where possible | L |
| T-06.12.02.02 | Configure step dependencies: lint → typecheck → unit → integration → migration → OpenAPI → build → coverage → security scans → review | M |
| T-06.12.02.03 | Implement migration validation: apply on clean DB + upgrade from previous schema | M |
| T-06.12.02.04 | Implement OpenAPI drift detection: generated schema vs committed spec | S |
| T-06.12.02.05 | Configure required reviewers: domain owner; Finance/Security/Legal when protected rules change | S |
| T-06.12.02.06 | Add status check reporting: pass/fail per check, summary comment on PR | S |

#### S-06.12.03 — Main/staging quality gate

**Description:** After merge and before release candidate: full unit + PG integration suites, critical Chromium E2E, accessibility automation, container image build + vuln scan + SBOM, smoke deployment + readiness/liveness checks, migration rehearsal against production-like schema, provider contract tests, no P0/P1 defect, no unexplained flaky critical test.

**Complexity:** L  
**Dependencies:** S-06.12.02  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.12.03.01 | Implement main-branch CI workflow: full test suites, E2E, accessibility, container build+scan, SBOM | L |
| T-06.12.03.02 | Build staging smoke deployment: readiness/liveness verification, migration rehearsal | M |
| T-06.12.03.03 | Implement automatic gate: block RC if P0/P1 defect or unexplained flaky critical test | M |
| T-06.12.03.04 | Provider contract tests in CI: SMTP fake, SMS.ir fake, payment fake, storage fake | M |

#### S-06.12.04 — Production promotion quality gate

**Description:** Production release requires: successful RC E2E across required browsers, security/DAST + performance smoke within budgets, backward-compatible migration + rollback plan, recent backup + restore-test status, feature flag for high-risk rollout, release notes + monitoring links + on-call coverage, post-deploy smoke tests + SLO/error comparison.

**Complexity:** L  
**Dependencies:** E-01 (deployment pipeline)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.12.04.01 | Define production release checklist and automated gate runner | M |
| T-06.12.04.02 | Implement automatic canary/gradual rollout for high-risk changes (payment, wallet, auth, contract, pricing) | L |
| T-06.12.04.03 | Implement auto-halt/rollback on: smoke failure, elevated error rate, SLO burn, reconciliation mismatch, security alert | L |
| T-06.12.04.04 | Create production release notes template: changes, customer/support impact, owner, dashboard links, alert/runbook links, on-call | S |
| T-06.12.04.05 | Implement post-deploy smoke tests and SLO/error comparison against previous release | M |

#### S-06.12.05 — Scheduled quality gates

**Description:** Nightly: full critical E2E, cross-browser rotation, dependency/security scan, dead-link/schema checks, flaky-test report. Weekly: load/performance regression, mutation testing, dependency update review. Quarterly: PostgreSQL/object restore, DR rehearsal, access review, threat-model review, incident exercise.

**Complexity:** M  
**Dependencies:** S-06.12.02, S-06.12.03  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.12.05.01 | Configure nightly CI: cross-browser E2E, full dep + security scan, dead-link check, flaky test report | M |
| T-06.12.05.02 | Configure weekly CI: load/performance regression, critical-domain mutation testing, dependency update PR | M |
| T-06.12.05.03 | Configure quarterly manual trigger: PG restore, DR rehearsal, access review, threat-model review, incident runbook exercise | M |
| T-06.12.05.04 | Flaky test management: quarantine system with owner, issue, expiry, equivalent temporary coverage | S |
| T-06.12.05.05 | Flaky test report dashboard: list, trend, owner, days in quarantine | S |

---

## E-06.13 — Observability: OpenTelemetry & Logging

**Goal:** Instrument all processes with OpenTelemetry; emit structured JSON logs to Loki.

### Stories

#### S-06.13.01 — OpenTelemetry SDK instrumentation

**Description:** OpenTelemetry SDK in web server, API, and worker processes. Span context propagation across HTTP, database, outbox, worker, and external-provider boundaries. Sample ordinary successful traces; retain all errors/slow traces.

**Complexity:** XL  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.13.01.01 | Install OpenTelemetry JS SDK + instrumentations (HTTP, NestJS, Express, PostgreSQL, Redis, gRPC) | M |
| T-06.13.01.02 | Configure OTel SDK auto-instrumentation for all process types (web, API, worker) | M |
| T-06.13.01.03 | Implement custom NestJS decorator/interceptor for span creation in domain services | M |
| T-06.13.01.04 | Propagate trace context across HTTP headers (W3C TraceContext) | S |
| T-06.13.01.05 | Propagate trace context through PostgreSQL outbox → worker processing | M |
| T-06.13.01.06 | Implement trace sampling: sample rate for successful traces (e.g. 10%), always sample errors and slow traces (>500ms) | M |
| T-06.13.01.07 | Configure OTel exporter: OTLP to Grafana Tempo / Jaeger-compatible backend | S |
| T-06.13.01.08 | Ensure trace context logged in all structured log entries | S |
| T-06.13.01.09 | Write integration test: verify trace context propagation across HTTP → service → DB → outbox → worker | M |

#### S-06.13.02 — Structured JSON logging

**Description:** Structured JSON logs with timestamp, level, service/process, environment, request/correlation ID, actor/profile IDs (pseudonymous), route/job, duration, outcome. Shipped to Grafana Loki or compatible managed log service.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.13.02.01 | Implement structured JSON logger (pino or winston) with consistent schema across all processes | M |
| T-06.13.02.02 | Add correlation ID to every log entry (from request header or generate) | S |
| T-06.13.02.03 | Add pseudonymous actor/profile IDs to logs (never raw national IDs, secrets, tokens) | S |
| T-06.13.02.04 | Implement environment-aware log level: debug in dev, info in staging, warn+ in production | S |
| T-06.13.02.05 | Configure Loki log shipping agent (Promtail / Grafana Alloy) | M |
| T-06.13.02.06 | Ensure secrets, PII, payment details, and tokens are redacted from all log output | M |
| T-06.13.02.07 | Write integration test: log format compliance, redaction, correlation ID presence | S |

---

## E-06.14 — Observability: Metrics & Dashboards

**Goal:** Expose Prometheus-compatible metrics for RED, USE, business safety; build Grafana dashboards.

### Stories

#### S-06.14.01 — Metrics instrumentation

**Description:** Collect RED metrics for APIs (rate, errors, duration), USE for infrastructure (utilization, saturation, errors), database pool/query metrics, queue age/depth, provider latency/failure, business safety (unresolved refunds, reconciliation mismatches).

**Complexity:** L  
**Dependencies:** S-06.13.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.14.01.01 | Implement Prometheus metrics endpoint in API and worker processes | M |
| T-06.14.01.02 | Instrument RED metrics: request rate, error count (by status/route), latency (p50/p95/p99) | M |
| T-06.14.01.03 | Instrument database metrics: pool size, active/idle/waiting connections, query duration, slow queries | M |
| T-06.14.01.04 | Instrument queue metrics: queue depth, oldest-unprocessed age, processing time, failure rate, dead-letter count | M |
| T-06.14.01.05 | Instrument external provider metrics: call latency, success/error count, circuit-breaker state | M |
| T-06.14.01.06 | Instrument business safety metrics: unresolved refund count, reconciliation mismatch count, outbox backlog age | M |
| T-06.14.01.07 | Instrument worker metrics: job processing rate, lease expiry, retry count, dead-letter count | M |
| T-06.14.01.08 | Instrument AI metrics: request count, token usage, latency, cost per model, concurrency | M |

#### S-06.14.02 — Grafana dashboards

**Description:** Minimum 10 dashboards covering Executive SLO, API health, PostgreSQL/pool, Worker/outbox, External providers, Authentication/security, Payments/wallet/refunds, Storage/uploads, Notifications, AI usage/cost.

**Complexity:** L  
**Dependencies:** S-06.14.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.14.02.01 | Create Executive SLO dashboard: availability, latency (p95/p99), error budget, burn rate | M |
| T-06.14.02.02 | Create API Health dashboard: RED metrics, top slow routes, error breakdown by status, correlation with deploys | M |
| T-06.14.02.03 | Create PostgreSQL/Pool dashboard: connection pool, query throughput, slow queries, replication lag, cache hit ratio | M |
| T-06.14.02.04 | Create Worker/Outbox dashboard: queue depth, oldest age, processing rate, retries, dead-letter count | M |
| T-06.14.02.05 | Create External Providers dashboard: latency, error rate, circuit-breaker state, quota usage | M |
| T-06.14.02.06 | Create Authentication/Security dashboard: login rate, MFA pass/fail, OTP send/verify rate, rate-limit hits, audit events | M |
| T-06.14.02.07 | Create Payments/Wallet/Refunds dashboard: transaction volume, success rate, refund count/value, mismatch alerts | M |
| T-06.14.02.08 | Create Storage/Uploads dashboard: upload count, size distribution, scan state, malware count | S |
| T-06.14.02.09 | Create Notifications dashboard: delivery rate by channel, queue age, failure breakdown, bounce rate | S |
| T-06.14.02.10 | Create AI Usage/Cost dashboard: request volume, token usage, cost per model per day, error rate | S |
| T-06.14.02.11 | Add production release markers to all dashboards (annotation per deploy) | S |

---

## E-06.15 — Observability: Alerting & SLO

**Goal:** Configure alerts with severity, owner, runbook, deduplication, escalation. SLO burn alerts, business safety monitoring.

### Stories

#### S-06.15.01 — Alert configuration

**Description:** Alerts on user impact or risk, not raw noise. Severity P1/P2/P3 with owner, runbook, dedup, escalation. P1 pages on-call; P2 is time-bounded operational task; P3 working-hours review. Alert delivery monitored by dead-man check.

**Complexity:** L  
**Dependencies:** S-06.14.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.15.01.01 | Define alert severity taxonomy: P1 (user-facing outage, payment/refund risk), P2 (degradation, backlog), P3 (warning, info) | M |
| T-06.15.01.02 | Configure P1 alerts: payment/refund duplication risk, ledger mismatch, backup failure, outbox backlog > threshold, elevated auth failures, SLO burn rate | M |
| T-06.15.01.03 | Configure P2 alerts: provider circuit-breaker open, queue age > target, database connection pool saturation, elevated error rate on critical routes | M |
| T-06.15.01.04 | Configure P3 alerts: certificate expiry, storage lifecycle warning, reconciliation mismatch, low SMS credit | M |
| T-06.15.01.05 | Configure alert routing: P1 → on-call pager/phone, P2 → team channel + task, P3 → review board | S |
| T-06.15.01.06 | Configure deduplication and alert grouping to prevent noise storms | S |
| T-06.15.01.07 | Set up dead-man check / watchdog for alert delivery pipeline | S |
| T-06.15.01.08 | Every alert links to its dashboard and runbook | S |

#### S-06.15.02 — SLO burn alerts

**Description:** Monthly SLOs for core authenticated flows. Burn-rate alerts trigger before error budget is exhausted. Aligned to SLO targets: 99.5% pilot, 99.9% commercial HA.

**Complexity:** M  
**Dependencies:** S-06.14.02 (SLO dashboard)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.15.02.01 | Define SLOs with SLIs: availability, API latency (p95), core page LCP (p75), job start time (p99), RPO, RTO | M |
| T-06.15.02.02 | Implement SLO burn-rate alerting: fast burn (5% budget/hour) → P1, slow burn (2% budget/day) → P2 | M |
| T-06.15.02.03 | Implement error budget tracking dashboard with consumption rate and burn-down | M |
| T-06.15.02.04 | Configure multi-window, multi-burn-rate alert (MWMBR) for accurate detection | M |
| T-06.15.02.05 | Ensure outbox backlog, refund mismatch, and provider health alerts have SLO-linked burn budgets | S |

#### S-06.15.03 — Business safety alerts

**Description:** Monitor unresolved refunds, reconciliation mismatches, outbox backlog, wallet ledger vs cached balance drift, duplicate payment risk.

**Complexity:** M  
**Dependencies:** E-04 (Wallet, Payments, Refunds)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.15.03.01 | Configure unresolved refund obligation alert: count > 0 for > 1 hour → P2 | S |
| T-06.15.03.02 | Configure reconciliation mismatch alert: wallet/cached balance drift > threshold → P1 | S |
| T-06.15.03.03 | Configure outbox backlog age alert: oldest-unprocessed > 5 min → P2, > 15 min → P1 | S |
| T-06.15.03.04 | Configure duplicate payment detection: same idempotency key with different payload → P1 | S |
| T-06.15.03.05 | Configure provider callback anomaly alert: unexpected signature, replay, stale timestamp → P1 | S |

---

## E-06.16 — Observability: Tracing & Error Tracking

**Goal:** Distributed tracing via Tempo/Jaeger; error tracking via Sentry.

### Stories

#### S-06.16.01 — Distributed tracing

**Description:** OpenTelemetry-compatible tracing across HTTP, database, outbox, worker, and external-provider boundaries. Success sample 10%; errors/slow always sampled. Traces stored 7 days (ordinary) / 30 days (errors/slow). Backend: Grafana Tempo or Jaeger-compatible.

**Complexity:** M  
**Dependencies:** S-06.13.01  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.16.01.01 | Configure OTel trace exporter to Tempo/Jaeger via OTLP | S |
| T-06.16.01.02 | Ensure trace context propagation across async boundaries: outbox → worker, queue → handler | M |
| T-06.16.01.03 | Configure retention: sampled traces 7 days, error/slow 30 days | S |
| T-06.16.01.04 | Create Grafana Explore / Tempo search UI integration for trace discovery | S |
| T-06.16.01.05 | Write trace verification test: single request produces complete trace across service → DB → outbox → worker | M |

#### S-06.16.02 — Error tracking (Sentry)

**Description:** Sentry or open-source equivalent for frontend/backend exception grouping and release correlation. PII scrubbing, environment-specific sampling. Do not duplicate all logs in Sentry.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.16.02.01 | Integrate Sentry SDK (or open-source alternative) into API, worker, and web processes | M |
| T-06.16.02.02 | Configure PII scrubbing: strip secrets, national IDs, financial details, tokens from error reports | M |
| T-06.16.02.03 | Configure environment-specific sampling: 100% in dev/staging, sample rate in production | S |
| T-06.16.02.04 | Implement release correlation: send release marker to Sentry on each production deploy | S |
| T-06.16.02.05 | Configure performance monitoring integration (tracing) with Sentry | M |
| T-06.16.02.06 | Write integration test: error reported to Sentry, PII scrubbed, release tag present | S |

---

## E-06.17 — Operations: Runbooks, Maintenance & Synthetic Checks

**Goal:** Document runbooks for all critical failure modes, implement maintenance mode per capability, deploy synthetic health checks.

### Stories

#### S-06.17.01 — Runbooks

**Description:** Runbooks for payment/wallet mismatch, refund backlog, database failover/restore, object-storage outage, notification outage, credential compromise, bad deployment. Each with severity, owner, step-by-step procedure, escalation, and verification.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.17.01.01 | Write Payment/Wallet Mismatch runbook: detection, freeze, reconciliation, correction, verification | S |
| T-06.17.01.02 | Write Refund Backlog runbook: identify stuck refunds, manual intervention, idempotent replay | S |
| T-06.17.01.03 | Write Database Failover/Restore runbook: promote replica, PITR restore, verify RPO/RTO, application reconnect | M |
| T-06.17.01.04 | Write Object-Storage Outage runbook: fallback to local/read-only, switch region, restore from versioning | S |
| T-06.17.01.05 | Write Notification Outage runbook: switch provider, verify OTP delivery, in-app fallback | S |
| T-06.17.01.06 | Write Credential Compromise runbook: revoke sessions, rotate keys, notify users, audit trail | S |
| T-06.17.01.07 | Write Bad Deployment runbook: rollback, smoke test, incident report, blameless post-mortem | S |
| T-06.17.01.08 | Store runbooks in `docs/runbooks/` with alert links; review quarterly | S |

#### S-06.17.02 — Maintenance mode per capability

**Description:** Define maintenance mode per capability (not whole application). Temporarily disable new electricity checkout while login, contracts, documents, refunds/support remain available. Staff dashboard shows active maintenance flags.

**Complexity:** M  
**Dependencies:** E-02 (Admin module)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.17.02.01 | Design capability-based maintenance mode: granular toggles per module/capability with admin UI | M |
| T-06.17.02.02 | Implement maintenance mode middleware: check capability toggle before processing; return `503` with safe message and support link | M |
| T-06.17.02.03 | Build admin UI: view active maintenance modes, activate/deactivate with reason + estimated duration + owner | M |
| T-06.17.02.04 | Ensure in-app and synthetic health checks respect maintenance mode (don't alert on expected unavailability) | S |
| T-06.17.02.05 | Write integration tests: maintenance-prevented action returns correct status; non-maintained capabilities unaffected | M |

#### S-06.17.03 — Synthetic health checks

**Description:** Run synthetic checks for login, safe read-only authenticated flow, and public health. Never create real financial records in uptime checks. External monitoring provider (e.g. Checkly, Grafana Synthetic Monitoring).

**Complexity:** S  
**Dependencies:** E-02 (Auth built)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.17.03.01 | Define synthetic check endpoints: `/health` (public), authenticated read-only query, login flow | S |
| T-06.17.03.02 | Implement synthetic monitoring configuration (Checkly / Grafana Synthetics / independent provider) | S |
| T-06.17.03.03 | Ensure synthetic checks use isolated test accounts and never create real orders/payments | S |
| T-06.17.03.04 | Configure alert on synthetic check failure → on-call | S |

---

## E-06.18 — Operations: Retention & Release Markers

**Goal:** Configure data retention policies, deploy release markers across observability stack.

### Stories

#### S-06.18.01 — Retention policies

**Description:** Searchable application logs 30 days, metrics 13 months (downsampled), ordinary traces 7 days, error/slow traces 30 days, immutable audit/security/financial evidence according to legal retention (10 years). Admins may change operational retention without weakening audit requirements.

**Complexity:** M  
**Dependencies:** E-06.13, E-06.14, E-06.16  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.18.01.01 | Configure Loki log retention: 30 days searchable, longer-term archive to cold storage | S |
| T-06.18.01.02 | Configure Prometheus metric retention: 13 months at downsampled resolution | S |
| T-06.18.01.03 | Configure Tempo trace retention: 7 days ordinary, 30 days error/slow | S |
| T-06.18.01.04 | Ensure audit/security/financial evidence follows legal retention (10 years default) and cannot be shortened via operational settings | M |
| T-06.18.01.05 | Admin UI: view and change operational retention (with warning about audit retention) | M |

#### S-06.18.02 — Production release markers

**Description:** Every production deployment sends release markers to dashboards (annotation) and error tracking. Release notes linked. Post-deploy verification via dashboards.

**Complexity:** S  
**Dependencies:** E-01 (deployment pipeline)  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.18.02.01 | Implement CI step: send release annotation to Grafana (deploy time, version, change summary, owner) | S |
| T-06.18.02.02 | Configure Sentry release tracking: associate commits, tag errors with release version | S |
| T-06.18.02.03 | Include release marker in structured logs for correlation | S |
| T-06.18.02.04 | Post-deploy dashboard comparison: error rate, latency, SLO burn before/after deployment | S |

---

## E-06.19 — Definition of Done Enforcement

**Goal:** Create and enforce the exhaustive Definition of Done checklist across all product/tech backlog items.

### Stories

#### S-06.19.01 — DoD checklist automation

**Description:** Every story/change must meet the full Definition of Done: product/UX states, engineering completeness, tests & quality, security & privacy, operations & release. Automated checklist in PR template and ticket system.

**Complexity:** M  
**Dependencies:** None  

| Task | Description | Complexity |
|------|-------------|-----------|
| T-06.19.01.01 | Create DoD PR checklist template (5 categories, 25+ items) with checkboxes | S |
| T-06.19.01.02 | Integrate DoD checklist into ticket system (Linear / GitHub Issues) as issue template | S |
| T-06.19.01.03 | Add CI check: PR description must contain completed DoD checklist or link to exception record | S |
| T-06.19.01.04 | Create exception template: written scope, risk, compensating control, owner, approver, expiry | S |
| T-06.19.01.05 | Automate exception expiry: reopen after expiry if not renewed | S |
| T-06.19.01.06 | DoD items cannot waive: financial correctness, authorization, auditability, backup/recovery, or Credential Critical security issue | S |

---

## Dependency Graph

```
E-06.01 (Auth/Sessions)
  ├── S-06.01.01 (Argon2id) → S-06.01.02 (OTP), S-06.01.03 (MFA)
  ├── S-06.01.02 (OTP) → S-06.01.03 (MFA), S-06.05.02 (OTP rate limits)
  ├── S-06.01.03 (MFA) → S-06.01.04 (Sessions)
  └── S-06.01.04 (Sessions) → S-06.02.01 (CSRF)

E-06.02 (Browser protections)
  ├── S-06.02.01 (CSRF) → S-06.02.02 (CSP)
  ├── S-06.02.02 (CSP) → S-06.02.03 (HSTS/headers)
  └── S-06.02.04 (CORS) — independent

E-06.03 (Authorization)
  ├── S-06.03.01 (Policy engine) → S-06.03.02 (BOLA), S-06.03.03 (Sensitive changes)
  ├── S-06.03.02 (BOLA) → E-06.11.02 (DAST tests)
  └── S-06.03.03 (Dual approval) → E-04 (Wallet)

E-06.04 (Input safety)
  ├── S-06.04.01 (Zod) → S-06.04.02 (SQLi), S-06.04.03 (XSS)
  ├── S-06.04.02 (Parameterized) — independent
  ├── S-06.04.03 (Output safety) — independent
  └── S-06.04.04 (SSRF) — independent

E-06.05 (Rate limiting)
  ├── S-06.05.01 (Infrastructure) → S-06.05.02 (Action limits)
  └── S-06.05.02 (Defaults) → E-01 (Edge proxy)

E-06.06 (Files/Webhooks)
  ├── S-06.06.01 (Files) → E-01 (Storage)
  └── S-06.06.02 (Webhooks) → E-04 (Payments)

E-06.07 (Secrets/Infra)
  ├── S-06.07.01 (Secrets) → E-01
  ├── S-06.07.02 (SCA/SAST) → E-01 (CI/CD)
  └── S-06.07.03 (Container hardening) → E-01

E-06.08 (Verification/Response)
  ├── S-06.08.01 (Threat model) → S-06.08.02 (Pen test)
  └── S-06.08.03 (Incident response) — independent

E-06.09 (Unit/Component tests)
  ├── S-06.09.01 (Infrastructure) → S-06.09.02 (Domain tests), S-06.09.03 (RTL tests)
  ├── S-06.09.02 (Domain unit) → E-02, E-03, E-04
  └── S-06.09.03 (RTL) → E-02 (UI)

E-06.10 (Integration/E2E)
  ├── S-06.10.01 (Infrastructure) → S-06.10.02 (Integration tests), S-06.10.03 (E2E)
  ├── S-06.10.02 (Integration) → E-02, E-03, E-04
  └── S-06.10.03 (E2E) → E-02, E-03, E-04 (functional)

E-06.11 (Non-functional)
  ├── S-06.11.01 (A11y) → E-02
  ├── S-06.11.02 (DAST/SAST) → S-06.08.02
  ├── S-06.11.03 (Perf) → E-01, E-02, E-03, E-04
  └── S-06.11.04 (Reliability) → E-01

E-06.12 (Quality gates)
  ├── S-06.12.01 (Coverage) → S-06.12.02 (PR gate)
  ├── S-06.12.02 (PR gate) → S-06.12.03 (Main gate)
  ├── S-06.12.03 (Main gate) → S-06.12.04 (Prod gate)
  ├── S-06.12.04 (Prod gate) → E-01
  └── S-06.12.05 (Scheduled) → everything

E-06.13 (OTel/Logging)
  ├── S-06.13.01 (OTel SDK) → S-06.13.02 (Logging), E-06.14 (Metrics), E-06.16 (Tracing)
  └── S-06.13.02 (Logging) → E-01 (Loki)

E-06.14 (Metrics/Dashboards)
  ├── S-06.14.01 (Metrics) → S-06.14.02 (Dashboards), E-06.15.01 (Alerts)
  └── S-06.14.02 (Dashboards) → E-06.15 (SLO/Alerts)

E-06.15 (Alerting/SLO)
  ├── S-06.15.01 (Alerts) → S-06.15.02 (SLO burn), S-06.15.03 (Business safety)
  ├── S-06.15.02 (SLO burns) → E-06.14.02
  └── S-06.15.03 (Business safety) → E-04

E-06.16 (Tracing/Sentry)
  ├── S-06.16.01 (Tracing) → S-06.13.01 (OTel)
  └── S-06.16.02 (Sentry) — independent

E-06.17 (Runbooks/Maintenance)
  ├── S-06.17.01 (Runbooks) — independent
  ├── S-06.17.02 (Maintenance mode) → E-02 (Admin module)
  └── S-06.17.03 (Synthetic checks) → E-02

E-06.18 (Retention/Release)
  ├── S-06.18.01 (Retention) → E-06.13, E-06.14, E-06.16
  └── S-06.18.02 (Release markers) → E-01

E-06.19 (DoD) → everything
```

---

## Execution Order (Recommended)

| Phase | Epics | Focus |
|-------|-------|-------|
| **Phase 1: Foundation** | E-06.04 (Input safety), E-06.05 (Rate limit infra), E-06.07 (Secrets/SCA), E-06.13.01 (OTel SDK), E-06.09.01 (Test infra) | Build the foundational security and test infrastructure that everything else depends on |
| **Phase 2: Core Security** | E-06.01 (Auth/Sessions), E-06.02 (CSRF/CSP/CORS), E-06.03 (Authorization) | Implement the core security controls for authentication, session, browser protection, and authorization |
| **Phase 3: Testing & Quality** | E-06.09.02 (Domain tests), E-06.09.03 (RTL), E-06.10 (Integration/E2E), E-06.11 (Non-functional), E-06.12 (Quality gates) | Build comprehensive test coverage and automated quality gates |
| **Phase 4: Observability** | E-06.13.02 (Logging), E-06.14 (Metrics/Dashboards), E-06.15 (Alerting), E-06.16 (Tracing/Sentry) | Deploy full observability stack with dashboards and alerting |
| **Phase 5: Security Enrichment** | E-06.06 (Files/Webhooks), E-06.08 (Threat model/Response), E-06.05.02 (Tuned limits) | Complete security baseline with files, webhooks, threat model, incident response |
| **Phase 6: Operations** | E-06.17 (Runbooks/Maintenance/Synthetics), E-06.18 (Retention/Release), E-06.19 (DoD) | Operationalize everything with runbooks, maintenance, synthetic checks, retention, and DoD enforcement |

---

## Complexity Summary

| Area | S | M | L | XL |
|------|---|---|---|----|
| E-06.01 Auth/Sessions | 8 | 6 | 2 | 2 |
| E-06.02 Browser protections | 8 | 2 | 2 | 0 |
| E-06.03 Authorization | 0 | 6 | 3 | 1 |
| E-06.04 Input safety | 5 | 5 | 2 | 0 |
| E-06.05 Rate limiting | 5 | 2 | 2 | 0 |
| E-06.06 Files/Webhooks | 2 | 5 | 2 | 0 |
| E-06.07 Secrets/Infra | 10 | 1 | 0 | 0 |
| E-06.08 Verification | 5 | 3 | 0 | 0 |
| E-06.09 Unit/Component | 1 | 5 | 5 | 1 |
| E-06.10 Integration/E2E | 3 | 3 | 7 | 2 |
| E-06.11 Non-functional | 4 | 3 | 3 | 0 |
| E-06.12 Quality gates | 3 | 6 | 4 | 0 |
| E-06.13 OTel/Logging | 4 | 2 | 1 | 1 |
| E-06.14 Metrics/Dashboards | 4 | 6 | 1 | 0 |
| E-06.15 Alerting/SLO | 6 | 3 | 0 | 0 |
| E-06.16 Tracing/Sentry | 4 | 3 | 0 | 0 |
| E-06.17 Operations | 3 | 4 | 0 | 0 |
| E-06.18 Retention/Release | 4 | 2 | 0 | 0 |
| E-06.19 DoD | 5 | 1 | 0 | 0 |
| **Total** | **84** | **68** | **34** | **7** |

| **Epics: 19** | **Stories: 57** | **Tasks: ~193** | **Total Complexity: S=84, M=68, L=34, XL=7** |

---

## Gap Remediation

The following gaps were identified during the cross-audit of this epic against `README.md` (1260 lines) and `architecture.md` (177 lines).

### G-06.01 — Synthetic uptime monitoring/checks
- **Source:** README.md §Reliability and operations (lines 337–338)
- **Gap:** No task covers running synthetic checks (login, safe authenticated read-only flow, public health endpoint) from an external monitoring provider. The requirement specifies not creating real financial records in uptime checks.
- **Suggested Task:** Add story `S-06.17.04` — "Synthetic Uptime Checks": configure external uptime provider (e.g., Better Uptime, Checkly, or Grafana Synthetic Monitoring). Design synthetic test user that runs login + safe read-only dashboard view + health endpoint check. Ensure synthetic checks use isolated test data, not production records. Add alert if synthetic check fails for >2 consecutive cycles.

### G-06.02 — Cost monitoring and cost-per-unit dashboards
- **Source:** README.md §Cost controls (lines 374–381)
- **Gap:** Epic 06 covers metrics and dashboards extensively but has no task for tracking monthly cost by compute/DB/storage/egress/Redis/observability/notifications/AI, or for exposing unit costs (cost per active profile, cost per order). No alert on material variance from budget.
- **Suggested Task:** Add story to E-06.14: "Cost Monitoring Dashboard". Track: compute cost (per environment), PostgreSQL cost, object storage/egress, Redis, notification provider costs, observability costs, AI provider/model costs. Expose cost per active profile and cost per order. Alert on >20% monthly variance from budget.

### G-06.03 — Audit logging of authorization DENIALS
- **Source:** README.md §Backend (line 243), architecture.md §Security (lines 132–133)
- **Gap:** S-06.03.03 covers audit for sensitive changes, and C-04.CC.04 covers audit for financial transitions, but there is no explicit task ensuring authorization DENIALS (not just successful mutations) are recorded as security events.
- **Suggested Task:** Add task to S-06.03.01: ensure `AuthorizationService` logs every authorization denial as a structured audit event with actor, resource, action, reason, timestamp. Add to audit dashboard. Add integration test verifying denials are logged.

### G-06.04 — Bot detection / CAPTCHA for abuse prevention
- **Source:** README.md §Rate limiting and abuse prevention (lines 289–291)
- **Gap:** The README mentions "stricter IP/device aggregate limits" and "detect password spraying" but there is no task for CAPTCHA/reCAPTCHA integration, bot detection, or behavioral abuse detection for registration/login/OTP flows.
- **Suggested Task:** Add story to E-06.05: Add reCAPTCHA v3 (or equivalent) to registration, login, and password reset forms with a server-side verification endpoint. Add rate-limit-based abuse score that triggers CAPTCHA challenge after N failed attempts. Add bot detection middleware that analyzes request patterns (header order, JS execution, mouse movement) for sensitive flows.

### G-06.05 — Persian/RTL as primary E2E locale
- **Source:** README.md §E2E tests (line 426)
- **Gap:** E2E test tasks in T-06.10.03 do not specify locale requirements. No task states that Persian/RTL is the primary test locale, or that English/LTR has dedicated smoke and calendar tests.
- **Suggested Task:** Add to T-06.10.03 tasks: ensure every E2E test runs with Persian (fa) locale as the default, verifying RTL layout and Jalali calendar. Add dedicated English/LTR smoke tests and Gregorian calendar boundary tests. Document this in the E2E test strategy.

### G-06.06 — Outbox replay capability and oldest-unprocessed-age monitoring
- **Source:** architecture.md §Data rules (line 68), README.md §Reliability and operations (line 334)
- **Gap:** T-06.14.01.04 covers queue metrics but there is no specific task for: (a) outbox replay capability (safely re-processing old outbox rows without duplication), (b) monitoring the oldest-unprocessed outbox row age as a distinct metric, (c) alerting when outbox backlog exceeds SLO thresholds.
- **Suggested Task:** Add story to E-06.15: "Outbox Health Monitoring". Implement outbox replay endpoint that re-queues outbox rows within a date range (with idempotency protection). Add `outbox_oldest_unprocessed_age_seconds` metric with alert when > 5 min (P2) or > 15 min (P1). Write integration test for outbox replay safety.