# Epic 05: Notifications, Documents & AI Orchestration

**Domain:** Notifications · Documents & File Storage · AI Orchestration
**Status:** ✅ Audited — source gaps resolved as executable tasks
**Owner:** Domain Agent #5
**Target Release:** v1.0
**Complexity:** XL

---

## 1. Epic Overview

This epic covers three interrelated domains that provide cross-cutting platform capabilities:

- **Notifications** — deliver secure, reliable multi-channel (in-app, email, SMS) communication with durable queuing, template management, provider lifecycle, and administrative controls.
- **Documents & File Storage** — manage customer and business files in S3-compatible object storage with lifecycle tracking, scanning, template generation, retention policies, and immutable audit trails.
- **AI Orchestration** — manage AI models, knowledge bases, policies, and agents; configure agent slots for chatbots throughout the platform; provide a test chat UI and enforce AI assistant safety controls.

### Dependencies

| Depends On | Relationship |
|---|---|
| Epic 01 — Auth & Profiles | Notification delivery targets (email, SMS) depend on verified profile destinations. Document access is profile-scoped. AI agent permission uses session auth. |
| Epic 02 — CRM, Products & Orders | Business events from orders/consultations trigger notifications. Documents are linked to orders/contracts. AI KBs may reference product data. |
| Epic 03 — Contracts, Invoices & Payments | Contract state changes and invoice statuses generate notifications. Financial documents require immutable storage. |
| Epic 04 — Wallet & Admin | Wallet events (top-up, payment, refund) trigger notifications. Admin configuration governs providers, templates, and retention. |
| Infrastructure — PostgreSQL | Durable outbox, job queues, dead-letter storage, retention metadata. |
| Infrastructure — S3-compatible storage | Object storage for files and documents. |
| Infrastructure — Redis (optional) | Rate-limit counters, delivery-window coordination. |

| Total stories: 24 | Total tasks: 92 | Total new work items added in this document: 0 |

---

## 2. Stories & Tasks

---

### Story T-05.01: Notification Transport Interface & Core Infrastructure

**Description:** Define and implement the notification module's transport abstraction, durable outbox, job queue, and status tracking. Every business event that must reach a user flows through this pipeline.

**Acceptance Criteria:**
- Transport interface with pluggable adapters (in-app, SMTP, Resend, SMS.ir)
- PostgreSQL durable outbox written atomically with business state
- Worker processes outbox rows asynchronously with bounded retry + jitter
- Each event/channel delivery has a unique idempotency key
- Status tracking: Queued → Scheduled → Sending → Delivered → Failed → Cancelled
- Dead-letter state for exhausted retries with severity, Retry/Resolve actions
- In-app delivery is mandatory for all business events (cannot be disabled)
- Queue age, depth, failures observable via metrics

| Task | Complexity | Priority |
|---|---|---|
| **T-05.01.01 — Notification module scaffold** | M | P0 |
| Create NestJS Notifications module. Define transport interface (`INotificationTransport`) with `send(payload)` returning `{providerRef, status}`. Define outbox table, job table schemas Drizzle ORM entities, and base worker structure. | | |
| **T-05.01.02 — Durable outbox table & write pipeline** | L | P0 |
| Design `notification_outbox` table: `id` (UUIDv7), `event_key`, `profile_id`, `payload` (JSONB), `channels` (text[]), `status`, `idempotency_key` (UNIQUE), `created_at`, `locked_until`, `attempts`, `max_attempts`, `last_error`, `provider_ref`, `scheduled_for`. Write outbox rows in same PG transaction as business event. Outbox reader worker picks unlocked rows, claims lease, dispatches. | | |
| **T-05.01.03 — Job queue with retry schedule** | L | P0 |
| Implement retry schedule in worker: 1min → 5min → 30min → 2hr → final. Exponential backoff with jitter (±20%). Configurable `max_attempts` per notification type. Worker marks `Failed` after max attempts exhausted; moves to dead-letter. Add queue priority for urgent (Immediate) vs daytime. | | |
| **T-05.01.04 — Idempotency for delivery** | M | P0 |
| Idempotency key = `sha256(event_key + channel + profile_id)`. Ensure at-most-once logical delivery even with worker retries or duplicate outbox rows. Unique constraint on `notification_outbox.idempotency_key`. ON CONFLICT DO NOTHING on inserts. Provider-level idempotency for Resend and SMS.ir. | | |
| **T-05.01.05 — Status tracking & delivery logs** | M | P1 |
| `notification_delivery_log` table: `id`, `notification_id` (FK), `channel`, `status`, `attempt_number`, `provider_ref`, `latency_ms`, `error_category`, `error_detail` (safe), `created_at`. Queryable in admin panel. Each delivery attempt creates a log row. | | |
| **T-05.01.06 — Dead-letter queue & admin UI** | M | P1 |
| Dead-letter table inherits failed delivery data. Admin panel shows dead-letter deliveries with severity (error/critical), cause, attempt history. Actions: **Retry** (re-queues with same idempotency key), **Resolve** (marks final, no retry), **Dismiss**. Operational alerts for dead-letter accumulation. | | |
| **T-05.01.07 — Metrics & observability** | S | P1 |
| Prometheus metrics: `notifications_outbox_age_seconds`, `notifications_delivery_attempts_total{channel,status}`, `notifications_queue_depth`, `notifications_dead_letter_count`. Grafana dashboard panel. | | |

---

### Story T-05.02: In-App Notification Center

**Description:** Build the in-app notification UI where users see all their notifications with read/unread state, filtering, and navigation to related records.

**Acceptance Criteria:**
- Notification center accessible from app shell (header/menu)
- Each notification shows: icon/type, title, body, timestamp (user timezone), read/unread indicator, and action link
- Read / Mark all as read actions
- Filter by type (all, unread only)
- Cursor-based pagination (newer, older)
- Business notifications open the correct profile-scoped record
- Real-time or polling for new notification count badge
- Performance: p95 load under 200ms for 50-notification page

| Task | Complexity | Priority |
|---|---|---|
| **T-05.02.01 — Notification entity & in-app transport** | M | P0 |
| `in_app_notifications` table: `id`, `profile_id`, `type`, `title_i18n_key`, `body_i18n_key`, `params` (JSONB — interpolation vars), `link_route`, `link_params`, `is_read`, `read_at`, `created_at`. Index on `(profile_id, created_at DESC)`. In-app transport adapter writes to this table synchronously (same transaction). | | |
| **T-05.02.02 — Notification center API** | M | P0 |
| `GET /api/v1/notifications?cursor=&limit=&filter=unread` returns cursor-keyed list. `PATCH /api/v1/notifications/:id/read` marks single read. `PATCH /api/v1/notifications/read-all` marks all profile notifications read. Returns `{ data, next_cursor, unread_count }`. | | |
| **T-05.02.03 — Notification center UI** | L | P0 |
| Bell icon in app header with unread count badge. Dropdown shows last 10 notifications with quick action. "View all" opens full notification center page. List items: icon per type (security, payment, contract, order, system), title, body, relative time. Click navigates to linked record. "Mark all read" in header. Empty state, loading skeleton. RTL support. | | |
| **T-05.02.04 — New-notification polling / SSE** | M | P1 |
| Short-poll every 30s or SSE stream for real-time badge count. Optimistic mark-read (low-risk). Unread count in document title when tab is backgrounded. | | |

---

### Story T-05.03: Notification Classification & Delivery Window

**Description:** Implement immediate vs daytime classification with admin-configurable quiet-hour window. Daytime messages queue outside the window.

**Acceptance Criteria:**
- Classification: immediate (bypass quiet hours) vs daytime (09:00–21:00 default)
- Window is admin-configurable per timezone
- Messages outside window remain queued; in-app appears immediately regardless
- User timezone applied for scheduling
- OTP, auth/security events must be immediate and cannot be reclassified

| Task | Complexity | Priority |
|---|---|---|
| **T-05.03.01 — Notification type registry & classification** | M | P0 |
| Each business event type registered with `classification: 'immediate' | 'daytime'`. Security, OTP, authentication, payment, refund, contract-cancellation → immediate. All others → daytime. Registry is code-defined, not admin-editable for security types. Add `scheduled_for` column to outbox; worker checks delivery window. | | |
| **T-05.03.02 — Delivery window logic** | S | P1 |
| Worker resolves user timezone from profile. If `classification=daytime` and current time outside `[window_start, window_end]`, set `scheduled_for` to next window open and status→Scheduled. Re-check on wakeup. Window stored as `(timezone, start_hour, end_hour)` in admin config table. | | |
| **T-05.03.03 — Admin delivery-window configuration UI** | S | P1 |
| Admin panel section under Notifications settings: start time selector, end time selector. Validated: start < end, range ≥ 4 hours (minimum sensible window). Changes take effect for new schedules; previously scheduled messages keep original timing. | | |

---

### Story T-05.04: Template Management (Persian & English)

**Description:** Versioned notification templates in Persian and English with variable interpolation, preview, and test-send capability.

**Acceptance Criteria:**
- Templates stored per event type, per language (fa, en)
- Each template versioned (immutable once active)
- Variables: allow-listed, escaped, documented per template
- Admins can preview rendered template with sample data
- Admins can send test notification to an explicitly entered verified destination
- Templates exist for all business events (see Appendix)

| Task | Complexity | Priority |
|---|---|---|
| **T-05.04.01 — Template entity & CRUD API** | L | P0 |
| `notification_templates` table: `id`, `event_key`, `language` (fa/en), `channel` (email/sms/in-app), `version` (auto-increment), `subject` (email subject or SMS title), `body` (content template), `variables` (JSONB of allowed variable names + descriptions), `is_active` (boolean), `created_by`, `supersedes_version`, `created_at`. Unique on `(event_key, language, channel, version)`. CRUD API with permission: admin only. | | |
| **T-05.04.02 — Variable interpolation & escaping** | M | P0 |
| Template engine: `{{variable_name}}` syntax. Allow-list per template. Escape HTML for email/SMS output. Safe rendering that never exposes internal state or secrets. Unit tests for each template's variable contract. | | |
| **T-05.04.03 — Template preview** | S | P1 |
| Admin UI: select event key, language, channel, version → see rendered subject and body with sample/last-known data. Show available variables and their descriptions. Highlight missing required variables. | | |
| **T-05.04.04 — Test-send** | M | P1 |
| Admin enters an explicitly owned and verified destination (their own email/phone). Validate destination belongs to the admin or is an allow-listed test address (dev-only). Send through active provider. Log as test (no customer data). Record last_test_sent_at and last_test_status on template version. | | |
| **T-05.04.05 — Template seeding** | S | P1 |
| Seed all initial templates (fa + en) for every business event defined in the Appendix. Migration script creates initial versions with `version=1, is_active=true`. | | |

---

### Story T-05.05: Mandatory Notifications & Marketing Consent

**Description:** Separate transactional (mandatory) from marketing notifications. Enforce opt-in consent for marketing. Ensure security-critical notifications cannot be disabled.

**Acceptance Criteria:**
- Transactional notifications: always sent, external channel follows verified destinations
- Marketing notifications: require explicit opt-in consent, separate from transactional
- Mandatory list: OTP, auth/security, payment/refund result, contract cancellation, customer-action-required
- User can toggle marketing consent in profile settings
- Consent history recorded with timestamp and IP
- Marketing never mixed with transactional templates

| Task | Complexity | Priority |
|---|---|---|
| **T-05.05.01 — Notification category model** | M | P0 |
| `notification_categories` table/enum: `mandatory_transactional`, `marketing`. `user_notification_preferences` table: `profile_id`, `channel` (email/sms/in-app), `marketing_opted_in` (boolean), `consent_granted_at`, `consent_revoked_at`, `updated_at`. Default: marketing off. | | |
| **T-05.05.02 — Channel availability rules** | M | P1 |
| Worker checks: if category=mandatory → always deliver in-app. External channel sent only if profile has verified destination (email or phone). If category=marketing → check opt-in. If no opt-in, skip external entirely (in-app optionally delivered based on event configuration). | | |
| **T-05.05.03 — Consent UI in profile settings** | S | P1 |
| User profile: Notification Preferences section. Toggle for "Receive marketing notifications via email/SMS". Show current opt-in state, last change date. Log consent changes in audit. | | |

---

### Story T-05.06: Email Provider Administration

**Description:** Admin interface for configuring email delivery: SMTP or Resend. Draft → Test → Active → Rollback lifecycle with secrets management.

**Acceptance Criteria:**
- Two transport options: SMTP (TLS/STARTTLS) and Resend
- Draft → Test → Active → Superseded lifecycle per provider configuration
- Secrets: encrypted at rest, masked in UI/responses, write-only after entry
- Test send to admin-owned destination before activation
- Connection check on SMTP before activation
- Rollback preserves previous Active version
- Circuit breaker: transient failure threshold → pause channel, alert
- At most one Active provider per channel per environment
- Disabling the only OTP channel blocked unless alternative recovery path exists

| Task | Complexity | Priority |
|---|---|---|
| **T-05.06.01 — Provider config entity & lifecycle** | L | P0 |
| `email_provider_configs` table: `id`, `transport` (smtp/resend), `label`, `status` (draft/active/superseded/disabled), `config` (encrypted JSONB), `created_by`, `activated_at`, `last_test_at`, `last_test_status`, `last_test_error`, `supersedes_id`, `created_at`. Status machine: Draft (only editable) → after test-pass → Active (one per env). Active → Superseded (when new config activated). Active → Disabled (admin action). Disabling the only active config for OTP-required channel is blocked. | | |
| **T-05.06.02 — SMTP configuration** | M | P0 |
| Config fields: `host`, `port` (default 587), `security` (TLS | STARTTLS), `username`, `password` (encrypted), `connection_timeout` (default 10s), `command_timeout` (default 15s), `from_name`, `from_email`, `reply_to`. Connection-test: attempt SMTP handshake with configured credentials; report success or specific error. Block private/internal network destinations unless deployment-level allow-list set. | | |
| **T-05.06.03 — Resend configuration** | M | P0 |
| Config fields: `api_key` (encrypted), `from_name`, `from_email`, `reply_to`, `sending_domain`. Test: send through Resend API with admin's email. Validate domain verification. | | |
| **T-05.06.04 — Provider admin UI** | L | P0 |
| Admin page: list of email providers with status badges. Create new → select transport → fill fields (secrets masked as `••••••••` after save). Draft state shows "Test Connection" button. Test result displayed. "Activate" button enabled only after test passes. Active provider shown with "Disable" and metadata (activated_at, activated_by, last_test, delivery rate if available). Superseded configs viewable but not editable — show "Rollback to this version" to create new Active from old version. Warning banner when only one provider exists and user tries to disable. | | |
| **T-05.06.05 — Secrets encryption & masking** | M | P0 |
| Use NestJS built-in encryption or a KMS-integrated service. Encrypt at field level before storing in DB. Decrypt only in the outbox worker when sending. Mask in API responses: show last 4 characters only, replace rest with `*`. Never log secrets, never include in analytics, never return to frontend. | | |
| **T-05.06.06 — Circuit breaker for email** | M | P1 |
| Track consecutive failures per provider. Threshold: 5 consecutive transient failures in 5 minutes. When tripped: mark provider as Degraded, stop sending through it, alert ops. Recovery: after 60s cooldown → allow one test send; if succeeds → reset breaker, else keep open. Health metric: `provider_email_health{provider_id}` 1=healthy 0=tripped. | | |
| **T-05.06.07 — Email delivery callback handling** | S | P1 |
| Webhook endpoints for Resend delivery/click/bounce/complaint events. Verify webhook signature. Update delivery log status. Hard bounce → suppress future non-essential email to that address. Complaint → suppress, create customer-correction operational task. Authenticated, replay-safe with idempotency key. | | |

---

### Story T-05.07: SMS.ir Provider Administration

**Description:** Configure SMS.ir as the SMS transport. Handle template mapping, API integration, credit monitoring, and delivery feedback.

**Acceptance Criteria:**
- SMS.ir configuration: API key, sender line, timeout, throughput, low-credit threshold
- Event-to-template mapping: map internal event key + language → SMS.ir TemplateId
- Template variable mapping from Barghsa → SMS.ir parameters
- Activation validates template IDs are well-formed, required variables supplied
- Test send to admin-owned Iranian mobile number
- Delivery status: accepted/delivered/failed when provider feedback available
- Low credit alert: configurable threshold, alerts ops when below
- Circuit breaker: transient failure threshold → pause SMS channel

| Task | Complexity | Priority |
|---|---|---|
| **T-05.07.01 — SMS.ir config entity** | M | P0 |
| `sms_provider_configs` table: `id`, `status` (draft/active/superseded/disabled), `api_key` (encrypted), `default_sender` (line number), `request_timeout` (default 10s), `throughput_rps` (default 10), `low_credit_threshold`, `low_credit_balance` (last observed), `last_test_at`, `last_test_status`, `created_by`, `created_at`. Same lifecycle as email provider (T-05.06.01). | | |
| **T-05.07.02 — Template mapping** | M | P0 |
| `sms_ir_template_mappings` table: `id`, `config_id` (FK), `event_key`, `language`, `template_id` (SMS.ir TemplateId), `enabled`, `variable_mapping` (JSONB: map of Barghsa variable → SMS.ir parameter name), `created_at`. At most one active mapping per (config, event_key, language). | | |
| **T-05.07.03 — SMS.ir adapter** | L | P0 |
| Implement transport adapter. Normalize E.164 → SMS.ir format at provider boundary. Call SMS.ir send API with template ID and variables. Handle response: success → log provider_ref; failure → classify as transient (timeout, throttle, 5xx) or permanent (invalid template, invalid credentials, invalid destination). Bounded retry only for transient. | | |
| **T-05.07.04 — Credit monitoring** | M | P1 |
| After each send, parse response for remaining credit. If below `low_credit_threshold`, create operational alert and set `low_credit_balance`. Scheduled check (every 6 hours) polls SMS.ir credit endpoint. Low credit creates P2 operational alert. | | |
| **T-05.07.05 — SMS.ir admin UI** | L | P0 |
| Admin page: list SMS provider configs. Create → enter API key (masked after save), sender line, timeouts, thresholds. Template mapping tab: select event key + language → enter TemplateId → map variables with dropdowns. Validate and save. Test tab: enter Iranian mobile, select event key → preview rendered template → "Send Test". Activation, rollback, disable same pattern as email provider. | | |

---

### Story T-05.08: Provider Failure & Circuit Breaker

**Description:** Unified classification, circuit breaker, and alerting across all notification providers (email + SMS).

**Acceptance Criteria:**
- Error classification: transient vs permanent
- Transient: timeout, throttling, 5xx → bounded retry with jitter
- Permanent: invalid destination, rejected sender/template, invalid credential → no retry, pause channel, page/alert
- Circuit breaker per provider: tripped after N consecutive transient failures, recovery via test send after cooldown
- Alerts on trip, recovery, permanent failures, low credit
- Provider health dashboard: status, latency p50/p95/p99, failure rate, queue age
- Provider runbook documents each provider's error signatures, throttling limits, timeouts, and escalation path
- Deterministic fakes for each provider transport to support integration tests without real credentials

| Task | Complexity | Priority |
|---|---|---|
| **T-05.08.01 — Error classification utility** | S | P1 |
| Classify provider errors: `isTransient(error)`. Rules: timeout → transient, 429/5xx → transient, 4xx auth/credential → permanent, invalid destination → permanent, invalid template → permanent. Return classification + safe error message + category. | | |
| **T-05.08.02 — Circuit breaker implementation** | M | P1 |
| Reusable `CircuitBreaker` decorator/service: state (closed/open/half-open), failure count, threshold (configurable), cooldown (configurable). On open: reject immediately with `ProviderUnavailableError`. On half-open: allow probe; success → reset; fail → reopen. Integrate into both email and SMS transport adapters. Reused by AI model layer (see T-05.16.04). | | |
| **T-05.08.03 — Provider health dashboard** | M | P1 |
| Admin panel panel: table of providers (email/SMS), status (healthy/degraded/down), circuit breaker state, last failure, last successful test, failure rate last hour, avg latency, queue depth. Alert history per provider. | | |
| **T-05.08.04 — Provider runbook documentation** | S | P2 |
| For each provider type (SMTP, Resend, SMS.ir), document: expected timeouts, throttling limits, specific transient/permanent error signatures, escalation path when provider is down, rate-limit recovery procedures, and retry strategy. Store as operational runbooks referenced from the health dashboard. | | |
| **T-05.08.05 — Provider test fakes & contract tests** | M | P2 |
| Create deterministic fake implementations for each transport adapter: `FakeSmtpTransport`, `FakeResendTransport`, `FakeSmsIrTransport`. Fakes simulate success, transient failure, and permanent failure scenarios. Build contract tests that validate each adapter behaves according to `INotificationTransport` contract. Run in CI without external dependencies. | | |

---

### Story T-05.09: S3-Compatible Object Storage Provider

**Description:** Implement the file storage provider abstraction with S3-compatible storage (Amazon S3, MinIO). Configurable endpoint, credentials, bucket, and connection test.

**Acceptance Criteria:**
- Provider abstraction: `IFileStorageProvider` interface
- S3 adapter using official AWS SDK v3
- Admins configure: endpoint, region, bucket, access key, secret key, path-style, private/public endpoints
- Secrets encrypted at rest, masked after entry, excluded from logs
- Safe connection test
- Upload object, download object, generate short-lived URL, delete object, list objects, copy object
- Presigned URLs for direct browser upload
- Preview derivative generation (image thumbnail, PDF-to-image) backed by source object, never user-writable
- Preview cache with TTL, invalidated on source change

| Task | Complexity | Priority |
|---|---|---|
| **T-05.09.01 — File storage abstraction interface** | M | P0 |
| `IFileStorageProvider`: `upload(stream, key, mime, size)` → `{key, etag}`, `download(key)` → `Readable`, `getSignedUrl(key, operation, expiresIn)` → `{url, method, headers}`, `delete(key)`, `copy(sourceKey, destKey)`, `deleteObjects(keys)`, `objectExists(key)`. | | |
| **T-05.09.02 — S3 adapter** | L | P0 |
| Integrate `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Config: `endpoint`, `region`, `bucket`, `credentials.accessKeyId`, `credentials.secretAccessKey`, `forcePathStyle`, `publicEndpoint` (for presigned URLs). `upload`: use `PutObjectCommand` with `ContentType` and `ContentLength`. `getSignedUrl`: `GetObjectCommand` with expiry (default 15min, max 1hr for security). Multipart: `CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`. | | |
| **T-05.09.03 — Storage config entity & admin UI** | M | P1 |
| `storage_provider_configs` table: same lifecycle as notification providers (draft/active/superseded). Config fields: `endpoint`, `region`, `bucket`, `access_key_id`, `secret_access_key` (encrypted), `force_path_style`, `public_endpoint`. Test button: upload a small test object, generate URL, download and verify content. Secrets: encrypted, masked, write-only. | | |
| **T-05.09.04 — Preview derivative generation** | M | P2 |
| For documents that require inline preview (PDF thumbnails, image previews): generate derived objects (e.g. first-page PNG, resized JPEG) stored under a `_previews/` prefix in S3. Create endpoint that returns the preview URL. Preview is never user-writable, never modifies source. Cache preview derivatives with TTL; invalidate when source document is replaced or removed. | | |

---

### Story T-05.10: Document Templates

**Description:** Allow staff/admins to create document templates with uploaded files containing placeholders. Template versioning and placeholder extraction.

**Acceptance Criteria:**
- Staff/admin can create document template with title and description
- Upload one or more template files (PDF, DOCX)
- Placeholders (`{{placeholder}}`) auto-extracted at upload time and stored
- Template can be updated: files added, replaced, or deleted
- Every file change creates a new template version
- Previous template versions remain available
- Placeholder list shown on template detail page
- When files are added/replaced in a template version update, placeholders are re-extracted and merged across all files in the version
- Placeholder conflicts (same name used in different files with different contexts) are detected and surfaced to the admin

| Task | Complexity | Priority |
|---|---|---|
| **T-05.10.01 — Document template entity** | M | P0 |
| `document_templates` table: `id`, `title`, `description`, `category`, `created_by`, `created_at`, `updated_at`. `document_template_versions` table: `id`, `template_id` (FK), `version` (integer, auto-increment), `change_summary`, `placeholders` (JSONB array of extracted placeholder names), `created_by`, `created_at`. | | |
| **T-05.10.02 — Template file upload & placeholder extraction** | L | P0 |
| When uploading a file to a template: store in S3, parse file for `{{...}}` patterns. For DOCX: unzip and regex-search XML content. For PDF: extract text and regex-search. Store detected placeholders in `document_template_versions.placeholders`. Link each file via `document_template_files` table: `id`, `version_id` (FK), `storage_key`, `original_name`, `mime_type`, `size`, `checksum`, `created_at`. | | |
| **T-05.10.03 — Template admin UI** | M | P1 |
| Admin page: list templates with search/filter. Create: title, description, category. Upload files (drag-drop, multi-file select). Show extracted placeholders after upload. Version history tab: each version with files, placeholders, changes summary. "Create new version" button → upload new/modified files → auto-extract placeholders. | | |
| **T-05.10.04 — Placeholder re-extraction on file changes** | M | P2 |
| On template version update (new file added, existing file replaced): re-run placeholder extraction across all files in the new version. Merge the placeholder set from every file into a single deduplicated list. Store merged list in `document_template_versions.placeholders`. Remove placeholders no longer present in any file. | | |
| **T-05.10.05 — Placeholder conflict detection & validation** | S | P2 |
| Detect when the same placeholder name appears in different files within the same template version but with different surrounding context (suggesting different intended values). Surface conflicts in the admin UI with file names and surrounding context excerpts. Validate that required system placeholders (`{{date}}`, `{{customerName}}`, `{{contractNumber}}`) are present in every template version; alert admin if missing. | | |

---

### Story T-05.11: Document Lifecycle Management

**Description:** End-to-end document lifecycle from upload through scanning, availability, review, approval, rejection, and archival. Supports both customer-uploaded and staff-generated documents.

**Acceptance Criteria:**
- Document states: Uploading → Pending scan → Available → Submitted for review → Approved → Rejected → Superseded → Quarantined → Removed
- Business review state separate from storage/scan state
- Documents linkable to contracts, invoices, orders, or standalone
- Replacement creates link to superseded document (immutable chain)
- Rejection requires reason; leaves Replace action for customer
- Soft delete for financial/contractual records
- Immutable for signed contracts: cannot be replaced or removed

| Task | Complexity | Priority |
|---|---|---|
| **T-05.11.01 — Document state machine** | L | P0 |
| `documents` table: `id` (UUIDv7), `profile_id`, `business_record_type` (contract/invoice/order/solar_request/standalone), `business_record_id`, `category`, `state` (enum), `storage_key`, `original_name`, `detected_mime`, `size_bytes`, `checksum` (SHA-256), `uploaded_by`, `uploaded_by_type` (customer/staff/system), `supersedes_document_id`, `rejection_reason`, `created_at`, `updated_at`. State machine: `Uploading → Pending scan → Available → Submitted for review → Approved | Rejected`. From Approved: `→ Superseded` (when replaced). From any: `→ Quarantined` (malware). From Superseded/Quarantined: `→ Removed` (soft delete). State transitions in code with guards. | | |
| **T-05.11.02 — Upload pipeline** | M | P0 |
| 1. Client requests upload URL → API validates permissions, file category, size → returns presigned S3 upload URL + document_id in `Uploading` state. 2. Client uploads directly to S3. 3. Client confirms upload → API transitions to `Pending scan`. 4. If no malware scanner configured → directly `Available`. 5. Worker sets `Available` after scan passes. | | |
| **T-05.11.03 — Document scanning integration** | M | P0 |
| Malware scanning abstraction: synchronous (ClamAV local) or async webhook. On `Pending scan`: call scanner. Pass → `Available`. Fail (scanner unavailable) → remain `Pending scan`, retry with backoff, alert ops. Detected malware → `Quarantined`, alert security staff, customer sees safe "file not accepted" message. | | |
| **T-05.11.04 — Document review workflow** | L | P1 |
| Customer submits documents for review → `Submitted for review`. Staff review page: list of documents awaiting review, zoom/preview, approve or reject (with reason). Approve → `Approved`. Reject → `Rejected` + reason. Document remains for customer to Replace (new upload → supersedes rejected). Staff can return to "changes requested" (reset to `Available` with comment). | | |
| **T-05.11.05 — Document supersession & immutability** | M | P1 |
| When a document is replaced: old document → `Superseded`, new document → `Available` with `supersedes_document_id` pointing to old. Chain preserved for audit. Signed contracts: if `business_record_type=contract` and contract is signed → document is immutable. Immutable documents cannot transition to Superseded or Removed. | | |
| **T-05.11.06 — Soft delete & hard delete** | L | P1 |
| Soft delete (`Removed` state): record retained in DB, storage key retained, but not listed in normal queries. Hard delete (physical removal from S3): only for non-financial, non-contractual records, and only after configurable retention period (default 10 years for financial). `Removed` documents remain for audit queries and legal hold. | | |
| **T-05.11.07 — Document admin/staff UI** | L | P1 |
| Admin document list: searchable, filterable by state, category, business record, profile. Detail view: state history timeline, all versions (supersession chain), download button, metadata. "Upload document" button for staff. Preview inline for images/PDFs. | | |

---

### Story T-05.12: File Upload Validation & Categories

**Description:** Enforce file type validation (extension + MIME detection), size limits, and category-based file type restrictions.

**Acceptance Criteria:**
- Three categories with default limits: Documents 25MB, Images 15MB, Video 250MB
- Validation: extension allow-list + detected MIME (must match)
- Reject executables, mismatched extension/MIME, unsafe types
- Admin configurable formats and limits within deployment-safe boundaries
- Checksum (SHA-256) recorded on every upload
- File category required for every upload

| Task | Complexity | Priority |
|---|---|---|
| **T-05.12.01 — File validation service** | M | P0 |
| Validation logic: 1. Check extension against allow-list per category. 2. Detect MIME from file header (magic bytes) using `file-type` or `mime` library. 3. Reject if extension doesn't match detected MIME. 4. Reject executables (`application/x-msdownload`, `application/x-elf`, etc.). 5. Check size against category limit. 6. Compute SHA-256 checksum. Return validation result (pass/fail + reason). | | |
| **T-05.12.02 — Category & limit configuration** | M | P1 |
| `file_categories` DB seed: documents (`pdf`, `doc`, `docx`, `xls`, `xlsx`, `txt`, `csv`, `rtf`), images (`jpg`, `jpeg`, `png`, `webp`), video (`mp4`, `mov`, `webm`). `file_limits` table: `category`, `max_size_mb`, `allowed_extensions` (JSONB). Admin editable within hard-coded safety cap (500MB max for video). | | |
| **T-05.12.03 — Rejection handling** | S | P1 |
| Validation failure → reject upload before presigned URL is issued (saves bandwidth). Return specific, safe error: "PDF files up to 25MB are accepted" or "File type .exe is not supported". If client uploads a different file than authorized → presigned URL's upload validation rejects. | | |

---

### Story T-05.13: Authorized Access URLs & Security

**Description:** Short-lived authorized URLs for file access. Enforce profile/business-record ownership on every access.

**Acceptance Criteria:**
- All objects private by default; no public bucket
- Access via short-lived signed URLs (default 15 min, max 1 hr)
- Backend verifies user has access to the related business record before issuing URL
- Download permission follows least privilege
- Staff access: requires permission + record ownership scope
- Signed contract documents: read-only, no deletion/modification
- CDN-safe caching headers for public/immutable derived files (previews)

| Task | Complexity | Priority |
|---|---|---|
| **T-05.13.01 — Signed URL generation API** | M | P0 |
| `POST /api/v1/files/:id/download-url` → backend checks: does user have access to the business record this document is linked to? Is document in a state that allows download (Available, Approved, Superseded)? Is document under legal hold or retention? → issue presigned URL (GET, 15min TTL). Audit the access in document_access_log. | | |
| **T-05.13.02 — Access control middleware** | M | P0 |
| Permission model: document access scoped by business record ownership. For documents linked to contract → only profile that owns contract (and assigned staff with contract-read permission) can download. For standalone documents → only uploader's profile and staff with document-read permission. Middleware resolves business_record_type + business_record_id → runs appropriate policy check. | | |
| **T-05.13.03 — Download access logging** | M | P1 |
| `document_access_log` table: `id`, `document_id`, `accessed_by`, `accessed_by_type`, `action` (download/view), `ip_address`, `user_agent`, `created_at`. Append-only. | | |
| **T-05.13.04 — Safe preview derivative endpoint** | M | P2 |
| Create `GET /api/v1/files/:id/preview` endpoint that returns a generated preview (PDF page-to-image thumbnail, image resized variant) via signed URL. Preview is always read-only, derived from the source document, and never user-writable. Backend generates derivatives using T-05.09.04 infrastructure. Cache preview URLs with CDN-safe headers for immutability. | | |

---

### Story T-05.14: Retention Policies & Legal Hold

**Description:** Configure and enforce document retention schedules. Support legal hold overrides for litigation or compliance.

**Acceptance Criteria:**
- Retention configured by record category (contract, invoice, payment, etc.)
- Default: 10 years after record closure for contracts, invoices, payments, refunds, signed docs
- Other customer uploads: parent record's retention or 5 years
- Legal hold overrides deletion
- Destruction job: physically deletes expired objects from S3, hard-deletes record
- Destruction requires approval, runs on schedule, fully audited

| Task | Complexity | Priority |
|---|---|---|
| **T-05.14.01 — Retention policy configuration** | M | P1 |
| `retention_policies` table: `business_record_type`, `retention_years`, `legal_hold` (boolean, override), `created_by`, `effective_date`. Seed defaults as per AC. Admin-editable with legal-team approval note. | | |
| **T-05.14.02 — Legal hold** | M | P1 |
| `legal_holds` table: `id`, `document_id` or `profile_id` (global hold), `reason`, `initiated_by`, `initiated_at`, `expires_at` (or null = indefinite), `released_by`, `released_at`. If any active legal hold covers a document → retention job cannot delete. Admin UI: manage legal holds (create, view, release). | | |
| **T-05.14.03 — Destruction job** | L | P1 |
| Scheduled worker (cron: nightly). Query documents where `state = 'Removed'` and retention period elapsed and no active legal hold. For each: 1. Generate destruction manifest (audit). 2. Delete from S3. 3. Hard-delete DB record or anonymize (keep minimal audit trail). 4. Log destruction event. Run in batches with progress reporting. | | |

---

### Story T-05.15: Multipart Upload & Orphan Cleanup

**Description:** Support large file uploads via multipart with resume capability. Detect and clean up incomplete/abandoned multipart uploads.

**Acceptance Criteria:**
- Multipart upload for files > 5MB
- Resume: client can list uploaded parts and resume from last completed part
- Orphan detection: scheduled listing of incomplete multipart uploads
- Cleanup: abort orphaned uploads older than admin-configurable period (default 24h)
- Lifecycle policies on S3 bucket for automatic abort

| Task | Complexity | Priority |
|---|---|---|
| **T-05.15.01 — Multipart upload API** | M | P0 |
| `POST /api/v1/files/upload/start` → validate, return `upload_id`. `PUT /api/v1/files/upload/{uploadId}/part?partNumber=N` → presigned URL for each part. `POST /api/v1/files/upload/{uploadId}/complete` → list etags, complete. `GET /api/v1/files/upload/{uploadId}/parts` → list uploaded parts (for resume). `POST /api/v1/files/upload/{uploadId}/abort`. | | |
| **T-05.15.02 — Orphan detection & cleanup** | M | P1 |
| Scheduled job: list incomplete multipart uploads from S3. If created > N hours ago (configurable, default 24): abort. Record in `upload_cleanup_log`. Also: S3 bucket lifecycle rule as safety net (abort incomplete multipart uploads after 7 days). | | |

---

### Story T-05.16: AI Model Management

**Description:** Admin interface for managing AI model configurations — title, base URL, model name, API token, provider type, and connection testing.

**Acceptance Criteria:**
- CRUD for AI model records
- Fields: title (admin-friendly label), base URL, model name, API token (encrypted), provider type, enabled/disabled
- Test button: sends a simple prompt to the model, displays response
- Each model tested before it can be used by agents
- Secrets encrypted at rest, masked, write-only
- Circuit breaker per model endpoint (reuses circuit breaker from T-05.08.02)

| Task | Complexity | Priority |
|---|---|---|
| **T-05.16.01 — AI model entity & CRUD** | M | P0 |
| `ai_models` table: `id` (UUIDv7), `title`, `base_url`, `model_name`, `provider_type` (openai-compatible, anthropic, etc.), `api_token` (encrypted), `config` (JSONB: max_tokens, temperature defaults), `is_enabled`, `last_test_at`, `last_test_status`, `created_by`, `created_at`, `updated_at`. CRUD API: admin only. | | |
| **T-05.16.02 — AI model test** | M | P1 |
| Test endpoint: send "Reply with exactly: OK. Model=<model_name>" (or similar safe probe). Measure latency, capture response. Update `last_test_at`, `last_test_status`, `last_test_latency_ms`. Display in admin UI. Test uses the stored API token; never echo it back. | | |
| **T-05.16.03 — Model admin UI** | M | P1 |
| Admin page: list models (title, provider, status, last test, enable toggle). Create/edit: fields with API token masked. Test button with spinner and response display. Delete: disallow if model is referenced by any agent (show which agents). | | |
| **T-05.16.04 — AI model circuit breaker integration** | M | P1 |
| Integrate the reusable `CircuitBreaker` service (from T-05.08.02) into the AI model HTTP client. Each model endpoint has its own circuit breaker instance. On open: return a platform-level error (not a provider error), log the trip event, alert ops. On automatic recovery probe: send the same test prompt as T-05.16.02. Display circuit breaker state on the model admin UI. Health metric: `ai_model_health{model_id}` 1=healthy 0=tripped. | | |

---

### Story T-05.17: Knowledge Bases & KB Groups

**Description:** Manage knowledge bases that AI agents use to answer questions. Organize KBs into groups for logical bundling.

**Acceptance Criteria:**
- KB entity: title, description, source type (uploaded document, web crawl, API), content, enabled/disabled
- KB CRUD with file upload or web source
- KB Groups: title, description, member KBs list
- Search across KBs: vector or text-based retrieval
- Test query against KB to verify relevance
- KB groups can be assigned to AI agents

| Task | Complexity | Priority |
|---|---|---|
| **T-05.17.01 — Knowledge base entity & CRUD** | M | P0 |
| `knowledge_bases` table: `id`, `title`, `description`, `source_type`, `source_config` (JSONB: file keys, URLs, API config), `content_state` (empty/processing/ready/error), `chunking_strategy` (configurable), `vector_embedding_model`, `is_enabled`, `created_by`, `created_at`, `updated_at`. `kb_chunks` table: `id`, `kb_id` (FK), `chunk_index`, `content`, `embedding` (vector), `metadata` (JSONB). | | |
| **T-05.17.02 — KB processing pipeline** | M | P0 |
| On file upload or URL add: extract text/chunk (configurable chunk size, overlap). Generate embeddings using configured embedding model (or use model's built-in). Store in `kb_chunks`. On ready: set `content_state=ready`. On error: set `content_state=error` with message. Vector index on `embedding` for similarity search. | | |
| **T-05.17.03 — KB Groups** | M | P0 |
| `kb_groups` table: `id`, `title`, `description`, `created_by`, `created_at`. `kb_group_members` table: `group_id`, `kb_id`, `created_at`. CRUD API + UI. | | |
| **T-05.17.04 — KB test query** | S | P1 |
| Admin UI: select KB or KB group, enter query, see top N results with relevance scores and content excerpts. | | |

---

### Story T-05.18: Policies & Policy Groups

**Description:** Define policies (rules and constraints) for AI agent behavior. Group policies for assignment to agents.

**Acceptance Criteria:**
- Policy entity: title, description, policy type, rules (structured JSON), enabled/disabled
- Policy types: content filter, data access scope, action permission, output format, rate limit
- Policy Groups: title, member policies
- Policy evaluation at inference time
- Policies override or compose (explicit priority)

| Task | Complexity | Priority |
|---|---|---|
| **T-05.18.01 — Policy entity & CRUD** | M | P0 |
| `ai_policies` table: `id`, `title`, `description`, `policy_type`, `rules` (JSONB: structured policy definition), `priority` (integer, lower = higher priority), `is_enabled`, `created_by`, `created_at`, `updated_at`. | | |
| **T-05.18.02 — Policy Groups** | S | P1 |
| `ai_policy_groups` table: `id`, `title`, `description`. `policy_group_members` table: `group_id`, `policy_id`, `priority_override`. CRUD + UI. | | |
| **T-05.18.03 — Policy evaluation engine** | L | P1 |
| At inference time: resolve all policies assigned to the agent (direct + via groups). Merge rules by priority. Apply content filters to input/output. Check data access scope. Enforce output format constraints. Apply rate limits. Return `passed` or `{blocked, reason, policy_ref}`. | | |

---

### Story T-05.19: AI Agent Management

**Description:** Create and manage AI agents — each agent references a model, linked KBs/KB groups, and policies/policy groups.

**Acceptance Criteria:**
- Agent entity: title, description, model reference, linked KBs and/or KB groups, linked policies and/or policy groups
- Agent system prompt: admin-editable
- Agent temperature, max_tokens override
- Agent can be enabled/disabled
- Agent cannot be deleted if assigned to a slot
- Test chat UI for agent configuration

| Task | Complexity | Priority |
|---|---|---|
| **T-05.19.01 — Agent entity & CRUD** | M | P0 |
| `ai_agents` table: `id`, `title`, `description`, `model_id` (FK), `system_prompt` (text), `temperature` (nullable float, overrides model default), `max_tokens` (nullable int), `link_mode` (any_kb | all_kbs), `is_enabled`, `created_by`, `created_at`, `updated_at`. Many-to-many junction tables: `agent_kbs`, `agent_kb_groups`, `agent_policies`, `agent_policy_groups`. | | |
| **T-05.19.02 — Agent CRUD API** | S | P0 |
| Standard CRUD endpoints. On create: validate model exists and is enabled, validate KBs/policies exist. On delete: check if agent is assigned to any slot; if yes, block with error listing assignments. | | |
| **T-05.19.03 — Agent admin UI** | L | P1 |
| Admin agent management page: list agents with status, model, linked KB/policy count. Create/edit: select model from dropdown, multi-select KBs/KB groups, multi-select policies/policy groups, edit system prompt (textarea with syntax highlighting), configure temperature/max_tokens overrides. Validation feedback. | | |

---

### Story T-05.20: Agent Slots

**Description:** Predefined agent slots across the platform. Admins assign an agent to each slot.

**Acceptance Criteria:**
- Default slots: Individual Chatbot, Legal Entity Chatbot, Staff Chatbot, Website Chatbot, Telegram Chatbot
- Each slot can be assigned one agent (or none → disabled)
- One agent can be used in multiple slots
- Slot assignment changes take effect immediately (no restart)
- Slot assignment recorded in audit

| Task | Complexity | Priority |
|---|---|---|
| **T-05.20.01 — Agent slot entity & configuration** | M | P0 |
| `agent_slots` table: `id`, `slug` (unique, e.g. `individual-chatbot`), `title` (i18n key), `description`, `current_agent_id` (nullable FK), `updated_by`, `updated_at`. Seeded with 5 default slots. | | |
| **T-05.20.02 — Slot assignment admin UI** | S | P1 |
| Admin AI Orchestration page → "Agent Slots" tab. Table: slot name, currently assigned agent, last changed. Dropdown to select agent (or "None — disabled"). Save updates audit entry. | | |

---

### Story T-05.21: Agent Test Chat UI

**Description:** A small chat UI in the admin panel where admins can test an agent configuration before deploying it to a slot.

**Acceptance Criteria:**
- Select agent from dropdown
- Chat input: type a message, see AI response
- Response shows: answer, which KBs/policies were hit, token usage, latency
- Clear conversation button
- Test chat is isolated (no impact on production conversations)
- Rate-limited (10 requests/min per admin)

| Task | Complexity | Priority |
|---|---|---|
| **T-05.21.01 — Test chat API** | M | P0 |
| `POST /api/v1/admin/ai/test-chat` → `{agent_id, message, conversation_id? (for thread continuity)}`. Backend resolves agent config, invokes model with KB context and policy evaluation, returns `{reply, sources: [{kb_id, title, excerpt}], policy_results, token_usage, latency_ms}`. Idempotency: per session. | | |
| **T-05.21.02 — Test chat UI** | M | P1 |
| Chat interface in admin: agent selector dropdown, message list (user + AI bubbles), input field + send button. Response metadata panel: source KBs (expandable with excerpts), policy filters applied, token count, latency. "New conversation" button to clear. | | |
| **T-05.21.03 — Rate limiting for test** | S | P1 |
| Per-admin rate limit: 10 requests/min. Show remaining quota in UI. Return 429 with retry-after. | | |

---

### Story T-05.22: AI Assistant Safety

**Description:** Enforce safety controls for the AI assistant: backend authorization, trusted-UI confirmation, audit logging, and data isolation.

**Acceptance Criteria:**
- AI operates only as authenticated user in selected profile
- Tool permissions enforced by backend authorization, never prompt instructions
- Read-only queries may run directly
- Write actions: structured preview required before execution
- Financial transactions, order submission, contract acceptance/signature, refunds, identity/role changes, destructive actions: require explicit confirmation in trusted UI
- AI cannot confirm its own proposed action
- Every tool call, auth decision, input, outcome, correlation ID audited
- Knowledge answers distinguish source-backed facts from generated guidance
- Sensitive values redacted from prompts, logs, analytics
- Data isolation: each chatbot slot has its own context window based on profile type

| Task | Complexity | Priority |
|---|---|---|
| **T-05.22.01 — AuthZ for AI actions** | L | P0 |
| Every AI tool call goes through same authorization policy as direct UI action. Backend middleware: resolve tool → required permission → check active user role + profile access. Deny if not authorized. Safe error: "You don't have permission to perform this action." Audit the denial. | | |
| **T-05.22.02 — Trusted-UI confirmation for writes** | L | P0 |
| For write actions: AI presents preview card in trusted UI (not in chat). Card shows: action type, parameters, consequences. User confirms or rejects in trusted UI (not via typing). AI cannot programmatically confirm. Audit: preview shown, user decision, decision timestamp. | | |
| **T-05.22.03 — AI audit logging** | M | P0 |
| `ai_audit_log` table: `id`, `session_id`, `user_id`, `profile_id`, `agent_slot`, `tool_name`, `input` (redacted), `output` (redacted), `authorization_result`, `confirmation_required` (bool), `confirmation_result`, `correlation_id`, `token_usage`, `latency_ms`, `created_at`. Append-only, immutable. | | |
| **T-05.22.04 — Data isolation per slot** | M | P1 |
| Individual Chatbot: sees only the individual profile's data. Legal Entity Chatbot: sees only the active legal profile's data. Staff Chatbot: sees data the staff member's roles authorize. Website Chatbot: anonymous, limited to public KBs. Telegram Chatbot: profile-bound via linked Telegram account. Data scope enforced in KB retrieval and tool execution. | | |
| **T-05.22.05 — Sensitive value redaction** | M | P1 |
| Before sending to AI model: redact sensitive values (passwords, tokens, national IDs, bank details, API keys) from context. Use pattern-based detection + allow-list. Never send raw secrets in prompts. Redacted logs: replace with `[REDACTED]` and keep category. | | |
| **T-05.22.06 — Source attribution in answers** | L | P1 |
| AI agent response format: separate answer text from source list. For KB-sourced information: show KB name, document title, excerpt. For generated guidance: label as "Based on general knowledge — verify with Barghsa staff." Configurable via policy. | | |

---

### Story T-05.23: AI Capacity Isolation & Bulkhead

**Description:** Ensure core API capacity is protected from AI workload saturation. Dedicated AI worker process with concurrency limits, per-model budget controls, and independent health reporting.

**Acceptance Criteria:**
- AI inference runs in a dedicated worker process or concurrency-limited handler, separate from core API workers
- Per-model monthly token/cost budget (admin-configurable, resets monthly)
- AI request queue with max concurrency (e.g. 10 concurrent requests across all models)
- When AI is saturated, `/api/health/ready` stays healthy for core services
- AI queue depth and rejection metrics observable
- Permanent rejection (budget exhausted, queue full) returns clear error, never blocks core API

| Task | Complexity | Priority |
|---|---|---|
| **T-05.23.01 — AI worker process isolation** | L | P0 |
| Create a dedicated NestJS worker process (or sidecar) for AI inference that runs independently from core API workers. The AI process shares the database but has its own HTTP server on a separate port for internal routing. Core API proxies AI requests to this process via internal HTTP or message queue. Deploy separately so AI process restart does not affect core API availability. | | |
| **T-05.23.02 — Per-model token/cost budget** | M | P1 |
| `ai_model_budgets` table: `model_id` (FK), `budget_type` (tokens/month | cost/month), `budget_limit`, `current_usage`, `reset_at`. On each inference: increment usage counter. If budget exceeded: reject with `BudgetExhaustedError`. Admin-configurable per model. Alert ops when usage reaches 80% of budget. Monthly reset cron job. | | |
| **T-05.23.03 — AI request queue & concurrency limit** | M | P1 |
| Implement an in-process or Redis-backed queue for AI inference requests. Global max concurrency (configurable, default 10). When concurrency limit reached: queue requests with FIFO ordering. Queue timeout (default 30s): if request not processed within timeout, reject with `AIBusyError`. Expose queue depth metric. Queue does not consume core API worker threads. | | |
| **T-05.23.04 — Health endpoint isolation** | M | P1 |
| `/api/health/ready` endpoint reports core services healthy independently of AI availability. AI component has its own `/api/ai/health` endpoint showing: queue depth, saturation state, per-model circuit breaker status. Core health endpoint never depends on AI health check. | | |

---

### Story T-05.24: Async Job Framework

**Description:** Provide a generic async job framework for long-running operations (document generation, exports, media processing). Any operation exceeding 5s must use this pattern.

**Acceptance Criteria:**
- Job entity with type, status, progress percentage, result URL, error message
- `JobService.submit(type, payload)` returns a unique job ID immediately
- `GET /api/jobs/:id/status` endpoint returns current state and progress
- `GET /api/jobs/:id/result` returns completed output or redirects to result URL
- Browser `<JobProgress>` component polls for status and shows progress bar
- Pattern documented: any backend operation taking > 5s returns a job ID instead of blocking the HTTP request

| Task | Complexity | Priority |
|---|---|---|
| **T-05.24.01 — Jobs table & entity** | M | P0 |
| `async_jobs` table: `id` (UUIDv7), `type` (string, e.g. `document-generation`, `export-csv`), `status` (queued/processing/completed/failed), `progress_pct` (integer 0–100), `payload` (JSONB), `result_url` (nullable), `error_message` (nullable), `created_by`, `created_at`, `started_at`, `completed_at`. Index on `(status, created_at)`. | | |
| **T-05.24.02 — JobService submit & process** | M | P0 |
| `JobService.submit(type, payload)` → inserts job with status=queued, returns job ID. Worker picks queued jobs, transitions to processing, executes the handler, sets completed/failed with result. Handlers registered by type via `JobHandlerRegistry`. Error handling: failed jobs record error message, can be retried. | | |
| **T-05.24.03 — Job status & result API** | S | P0 |
| `GET /api/jobs/:id` → `{id, type, status, progress_pct, created_at, result_url, error_message}`. `GET /api/jobs/:id/result` → if completed and has result_url, redirect (302). If still processing, return 202 with current status. | | |
| **T-05.24.04 — JobProgress UI component** | S | P1 |
| Shared React component: accepts a job ID, polls `/api/jobs/:id` every 2s, renders progress bar with percentage, status text, and estimated time remaining. On completion: shows download/open link if result_url present. On failure: shows error with retry button. Used by document generation, export, and media processing UIs. | | |

---

## 3. Appendix: Business Notification Events

Every event in this table generates a notification. Events marked **mandatory** cannot be disabled by the user. Events marked **immediate** bypass the daytime delivery window.

| Event Key | Category | Classification | Channels | Description |
|---|---|---|---|---|
| `auth.otp_sent` | mandatory | immediate | in-app, email, SMS | OTP code for login/verification |
| `auth.password_changed` | mandatory | immediate | in-app, email | Password changed confirmation |
| `auth.session_revoked` | mandatory | immediate | in-app, email | Session revoked (security) |
| `auth.new_device_login` | mandatory | immediate | in-app, email | Login from new device alert |
| `payment.wallet_topup_completed` | mandatory | immediate | in-app, email | Wallet top-up successful |
| `payment.wallet_topup_failed` | mandatory | immediate | in-app, email | Wallet top-up failed |
| `payment.invoice_paid` | mandatory | immediate | in-app, email | Invoice paid confirmation |
| `payment.invoice_overdue` | mandatory | daytime | in-app, email | Invoice overdue reminder |
| `payment.refund_completed` | mandatory | immediate | in-app, email | Refund processed |
| `payment.refund_failed` | mandatory | immediate | in-app | Refund failed (internal) |
| `contract.created` | mandatory | daytime | in-app, email | New contract created |
| `contract.awaiting_acceptance` | mandatory | immediate | in-app, email | Contract requires customer action |
| `contract.accepted` | mandatory | daytime | in-app, email | Contract accepted |
| `contract.signed` | mandatory | daytime | in-app, email | Contract signed |
| `contract.active` | mandatory | daytime | in-app, email | Contract activated |
| `contract.cancelled` | mandatory | immediate | in-app, email | Contract cancelled |
| `contract.changes_requested` | mandatory | immediate | in-app, email | Contract changes requested |
| `order.submitted` | mandatory | daytime | in-app, email | Order submitted confirmation |
| `order.status_changed` | mandatory | daytime | in-app, email | Order status update |
| `order.awaiting_staff` | mandatory | daytime | in-app | Order waiting for Barghsa review |
| `order.cancellation_requested` | mandatory | daytime | in-app, email | Cancellation request submitted |
| `ticket.new_reply` | mandatory | daytime | in-app, email | New reply on ticket |
| `ticket.assigned` | mandatory | daytime | in-app | Ticket assigned to staff |
| `document.uploaded` | mandatory | daytime | in-app | Document uploaded |
| `document.scan_failed` | mandatory | immediate | in-app | Document scan failed (internal) |
| `document.quarantined` | mandatory | immediate | in-app | Document quarantined (internal alert) |
| `document.review_completed` | mandatory | daytime | in-app, email | Document reviewed (approved/rejected) |
| `profile.verification_status` | mandatory | daytime | in-app, email | Profile verification status change |
| `profile.invitation_received` | mandatory | immediate | in-app, email | Invited to join legal entity |
| `profile.agent_role_changed` | mandatory | daytime | in-app, email | Agent role changed |
| `wallet.low_balance` | mandatory | immediate | in-app, email | Wallet below threshold |
| `wallet.credit_received` | mandatory | immediate | in-app, email | Wallet credited (refund/reversal) |
| `system.service_outage` | mandatory | immediate | in-app, email | Service outage notification (admin) |
| `marketing.promotion` | marketing | daytime | in-app, email | Marketing/promotional message |
| `system.notification_test` | — | immediate | any | Test notification (admin-only) |

---

## 4. Technical Decisions & ADR Triggers

Consider writing an ADR for each of these decisions:

| Decision | Trigger | Suggested By |
|---|---|---|
| Notification template engine (simple string interpolation vs mustache/handlebars) | T-05.04.02 — template rendering | Domain Agent #5 |
| Vector embedding strategy for KBs (pgvector vs separate vector DB) | T-05.17.02 — KB processing | Domain Agent #5 |
| Chunking strategy for KB documents | T-05.17.02 — KB processing | Domain Agent #5 |
| AI model provider abstraction (single OpenAI-compatible vs multi-provider) | T-05.16.01 — model management | Domain Agent #5 |
| Malware scanning service (ClamAV sidecar vs managed API) | T-05.11.03 — scanning | Domain Agent #5 |
| SSE vs polling for in-app notification badge | T-05.02.04 — notification polling | Domain Agent #5 |
| AI capacity isolation strategy (dedicated process vs sidecar vs concurrency-limited handler) | T-05.23.01 — AI worker isolation | Domain Agent #5 |
| Async job queue backend (in-process vs Redis Bull vs PG queue) | T-05.24.02 — JobService | Domain Agent #5 |

---

## 5. Security & Compliance

| Concern | Mitigation | Stories |
|---|---|---|
| Provider secrets exposure | Encrypt at rest, mask in UI, exclude from logs/analytics, write-only after entry | T-05.06.05, T-05.09.03, T-05.16.01 |
| Unauthorized file access | Signed URL with backend authorization, least-privilege download, profile-scoped | T-05.13.01, T-05.13.02 |
| Malware in uploaded files | Validate MIME + extension, malware scan, quarantine state | T-05.11.03, T-05.12.01 |
| AI prompt injection | Data isolation per slot, backend authZ for tools, trusted-UI confirmation for writes | T-05.22.01–T-05.22.06 |
| AI data leak across profiles | Each chatbot slot has profile-scoped context | T-05.22.04 |
| Sensitive data in AI context | Redact secrets before prompt construction | T-05.22.05 |
| Notification spam / abuse | Rate limits per profile, dead-letter controls, marketing consent required | T-05.05.01, T-05.05.02 |
| Immutable financial documents | Signed contracts cannot be replaced or deleted | T-05.11.05 |
| Provider SSRF via SMTP config | Block private/internal network SMTP targets unless explicit deployment allow-list | T-05.06.02 |
| SMS / email delivery failure | In-app mandatory delivery always succeeds; external failure does not hide in-app | T-05.01.06 |
| AI capacity exhaust core API | Dedicated AI worker process with separate health reporting prevents AI saturation from affecting core services | T-05.23.01–T-05.23.04 |
| AI cost overrun | Per-model token/cost budget with alert at 80% usage prevents unbounded cost | T-05.23.02 |

---

## 6. Cross-Cutting Concerns

### Observability
- Notification delivery rates, failure rates, queue depths, dead-letter counts (Prometheus metrics + Grafana dashboard)
- File upload throughput, storage usage by category, deletion rate, scan failure rate
- AI model latency, token usage, error rate, circuit breaker state per model
- AI capacity: queue depth, saturation state, budget usage
- All dashboards with SLO burn alerts

### Performance
- Notification outbox reader: batch size 50, poll interval 1s, PG-optimized with SKIP LOCKED
- Presigned URL generation: sub-10ms, no DB write (audit logged async)
- KB vector search: pgvector HNSW index, target p95 < 100ms
- AI inference concurrency: per-model concurrency limit via T-05.23.03, queue for excess
- Async job polling: 2s interval on JobProgress UI, cached status responses

### Testing
- Unit: transport interface, error classification, template interpolation, state machines, permission checks
- Integration: outbox + worker against real PostgreSQL, S3 fakes (MinIO test container), Resend/SMS.ir adapter contract tests with deterministic fakes (T-05.08.05)
- E2E: full notification flow (event → outbox → worker → in-app + email), document upload → scan → review → approve, AI agent test chat
- AI capacity: saturation test verifies core API health remains green when AI handler is maxed out

### Localization
- All templates available in fa (default) and en
- Notification center UI: RTL layout, Persian date formatting (Jalali)
- Admin UIs for providers, templates, and AI configuration: bilingual
- LLM responses respect user's language preference

---

## 7. Open Questions & Risks

| Risk | Impact | Mitigation |
|---|---|---|
| SMS.ir API stability or deprecation | SMS notifications could fail | Adapter pattern allows swapping provider; application-managed base URL |
| AI model cost escalation | Unpredictable operating cost | Per-model token/cost budget (T-05.23.02), admin-configurable concurrency limits (T-05.23.03), user quotas |
| Malware scanning latency | Upload flow slowed | Async scan with fallback to pending state; user notified to check back |
| Document storage cost for signed contracts | Long-term immutable storage growth | Lifecycle policies, tiered storage (S3 Glacier for aged contracts) — owned by Epic 01 infrastructure |
| Notification delivery to invalid email/SMS | Provider reputation damage | Hard bounce suppression for email (T-05.06.07), configurable retry limits, alert on sustained failures |
| AI capacity contention with core API | Core API degradation under AI load | Dedicated AI worker process (T-05.23.01), separate health endpoint, queue-based concurrency limiting |

---

*Document generated by Domain Agent #5 — Epic 05: Notifications, Documents & AI Orchestration*