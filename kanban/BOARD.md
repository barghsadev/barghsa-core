# Current task board

<!-- Generated from board.json. Edit the JSON, then run board.py render. -->

Snapshot: 2026-10-09T00:04:00.324081+00:00. First production launch: electricity, saving, solar and consultation.

Last confirmed staging release: **v0.1.29**. Next milestone: **v0.2.0**.

Counts describe evidence and task acceptance, not the percentage of product built.

| State | Tasks | Meaning |
| --- | ---: | --- |
| done | 554 | Accepted with unchanged source bindings. |
| verify | 730 | Existing work may be complete; inspect evidence before building. |
| partial | 78 | An earlier review found unmet criteria; reconcile later fixes. |
| todo | 7 | New, concrete work or release checks. |
| in_progress | 0 | Existing work to finish. |
| blocked | 1 | Named owner or external prerequisite. |
| superseded | 2 | Explicit approved scope disposition. |

The earlier audit accepted 219 tasks, found 54 partial claims and deferred 49. Changed source bindings require renewal. All original 1,355 tasks are retained. No evidence means unknown, not unbuilt.

Start with [release plan](RELEASES.md) and [working process](WORKFLOW.md). Use `python3 kanban/scripts/board.py show <qualified-key>` for complete criteria and evidence.

## Existing product work

These are recorded implementations, not blanket certification of each domain. Fixture-backed journeys and live production evidence are distinct.

| Area | Recorded implementation | Acceptance still needed |
| --- | --- | --- |
| Authentication and profiles | Registration, OTP login, trusted devices for customer/staff/admin, profile and account management. | Renew complete identity/profile criteria for v0.2.0. |
| Electricity | Simple/advanced ordering, invoice/payment handoff, contract acceptance and activation, order status, revisions and staff queues. | Existing fixture-backed journeys and separate API checks; renew full current and live-provider acceptance. |
| Energy saving | Customer ordering, staff review and first fulfillment handoff, progress, invoices/contracts and change/cancellation work. | Recorded journey reaches first fulfillment handoff; verify complete fulfillment and financial closure. |
| Solar | Draft/submission, document-byte upload, customer/staff review, postal tracking and staff receipt, plus final-decision/contract work. | Renew full lifecycle and actual storage/provider boundaries; fixture evidence is not production proof. |
| Consultation | Product selection, submission, staff fee offer, customer acceptance, invoice handoff, payment return and completion. | Complete journey has recorded passes; finish uncommitted history patch and renew milestone acceptance. |
| Finance and dashboard | Wallet, invoices, receipt history, contracts, refunds and finance dashboard queues with permissions. | Verify current money/ownership/concurrency and all-service financial closure; do not rebuild accepted engines. |
| Staff administration | Product catalogues, staff directory, geography, teams/assignments, providers and operational forms/tables. | Renew route-level permissions, usability and complete original acceptance. |
| Documents, notifications and AI | Document/template workflows, delivery providers/inbox, model management, knowledge processing, policies and inference work. | Inspect actual consumers and live adapters; management or connection probes do not prove a complete assistant. |

## Next batch

Continue remaining customer/staff/financial and AI display read owners, then mutation owners with eligible low-risk optimism. AI model/agent catalogues, policy/knowledge confirmation and prior CRM/service readers are accepted. Whole UI/operational milestone gates remain separate. Preserve unfinished consultation work, exact money, permission/profile isolation, captured commands and validated receipts.

- `07-ui-ux-design.md#T-07.01.04.02`: Define shared query key factory conventions: `queryKeys.profiles.all`, `queryKeys.orders.list(filters)`, `queryKeys.orders.detail(id)`, `queryKeys.invoices.list(filters)`, `queryKeys.wallet.balance`, etc. All list and detail queries use the factory pattern for consistent invalidation. Document in `packages/ui` README.
- `07-ui-ux-design.md#T-07.01.04.03`: Create `useServerListQuery` hook: wraps `useQuery` with cursor/offset pagination params, filter/sort/search serialization, and `keepPreviousData: true` to prevent layout shift during pagination. Shared by all list pages. Create `useServerDetailQuery(id)` for single-entity fetches.
- `07-ui-ux-design.md#T-07.01.04.04`: Create `useServerMutation` hook: wraps `useMutation` with automatic toast on success/error, `onSettled` invalidation via query key factory, and optimistic updates only for low-risk actions (mark notification read, toggle boolean preference). Never optimistic for payments, wallet, orders, contracts.
- `07-ui-ux-design.md#T-07.01.04.05`: Set up query cancellation: abort in-flight queries on unmount (via `AbortController`). Ensure financial/wallet queries have `refetchInterval: false` or long intervals — never auto-refresh balance without user action.

## v0.2.0: Complete customer journeys

All four services have a safe browse → intake → review → payment where applicable → status path, with correct account/profile ownership and clear next actions.

| Qualified task | State | Build evidence | Required work |
| --- | --- | --- | --- |
| `release-readiness#R-01.01` | done | Recorded batch work | Renew identity and all-four-service journey acceptance |
| `release-readiness#R-01.02` | done | Recorded batch work | Inspect and repair customer wallet history ownership |
| `release-readiness#R-01.03` | done | Recorded batch work | Finish the already validated consultation history changes |
| `release-readiness#R-01.04` | done | Recorded batch work | Verify four complete customer and staff intake journeys |
| `release-readiness#R-01.05` | done | Inventory needed | Group release notes and screenshots into at most two Telegram posts |
| `02-auth-users-admin.md#T-01.01.01` | done | Earlier acceptance_verified | Register route and shared auth layout |
| `02-auth-users-admin.md#T-01.01.02` | done | Earlier acceptance_verified | Unified username field (email or mobile) |
| `02-auth-users-admin.md#T-01.01.03` | done | Earlier acceptance_verified | Password field with visibility toggle and strength meter |
| `02-auth-users-admin.md#T-01.01.04` | done | Earlier acceptance_verified | TOS acceptance checkbox |
| `02-auth-users-admin.md#T-01.01.05` | done | Earlier acceptance_verified | "Back to login" and "Forgot password?" links |
| `02-auth-users-admin.md#T-01.01.06` | done | Earlier acceptance_verified | Registration form submission and error handling |
| `02-auth-users-admin.md#T-01.02.01` | done | Earlier acceptance_verified | OTP backend generation and sending |
| `02-auth-users-admin.md#T-01.02.02` | done | Earlier acceptance_verified | OTP input UI with resend |
| `02-auth-users-admin.md#T-01.02.03` | done | Earlier acceptance_verified | OTP verification and user creation |
| `02-auth-users-admin.md#T-02.01.01` | done | Earlier acceptance_verified | Login page UI |
| `02-auth-users-admin.md#T-02.01.02` | done | Earlier acceptance_verified | Login authentication flow |
| `02-auth-users-admin.md#T-02.01.03` | done | Earlier acceptance_verified | Login OTP verification |
| `02-auth-users-admin.md#T-02.01.04` | done | Earlier acceptance_verified | Password change enforcement on login |
| `02-auth-users-admin.md#T-02.02.01` | done | Earlier acceptance_verified | Session creation and cookie management |
| `02-auth-users-admin.md#T-02.02.02` | done | Earlier acceptance_verified | Session revocation |
| `02-auth-users-admin.md#T-02.02.03` | partial | Earlier partial | CSRF protection |
| `02-auth-users-admin.md#T-02.02.04` | done | Earlier partial | Step-up authentication for sensitive actions |
| `02-auth-users-admin.md#T-02.03.01` | done | Earlier acceptance_verified | Forgot password request UI |
| `02-auth-users-admin.md#T-02.03.02` | done | Earlier acceptance_verified | OTP verification and password reset |
| `02-auth-users-admin.md#T-02.03.03` | partial | Earlier partial | Account recovery support path |
| `02-auth-users-admin.md#T-02.04.01` | done | Earlier acceptance_verified | Auth rate limit enforcement |
| `02-auth-users-admin.md#T-03.01.01` | done | Earlier acceptance_verified | App-level profile check middleware |
| `02-auth-users-admin.md#T-03.01.02` | done | Earlier acceptance_verified | Profile verification check after login |
| `02-auth-users-admin.md#T-03.02.01` | done | Earlier acceptance_verified | Profile type selection (Individual vs Legal) |
| `02-auth-users-admin.md#T-03.02.02` | done | Earlier acceptance_verified | Individual profile form |
| `02-auth-users-admin.md#T-03.02.03` | done | Earlier acceptance_verified | Legal profile form |
| `02-auth-users-admin.md#T-03.02.04` | done | Earlier acceptance_verified | Onboarding completion and redirect |
| `02-auth-users-admin.md#T-03.03.01` | done | Earlier acceptance_verified | Profile switcher in sidebar |
| `02-auth-users-admin.md#T-03.03.02` | done | Earlier acceptance_verified | Default profile selection |
| `02-auth-users-admin.md#T-03.03.03` | done | Earlier acceptance_verified | Profile settings page |
| `02-auth-users-admin.md#T-03.03.04` | done | Earlier acceptance_verified | Username/contact changes |
| `02-auth-users-admin.md#T-03.03.05` | done | Earlier acceptance_verified | Notification channel preferences |
| `02-auth-users-admin.md#T-03.03.06` | done | Earlier acceptance_verified | Timezone settings |
| `02-auth-users-admin.md#T-03.04.01` | done | Earlier acceptance_verified | Address CRUD for current profile |
| `02-auth-users-admin.md#T-03.04.02` | done | Earlier partial | Address in order flow |
| `02-auth-users-admin.md#T-04.01.01` | done | Earlier acceptance_verified | Public TOS page |
| `02-auth-users-admin.md#T-04.01.02` | done | Earlier acceptance_verified | TOS acceptance storage |
| `02-auth-users-admin.md#T-04.01.03` | done | Earlier acceptance_verified | TOS re-acceptance flow |
| `02-auth-users-admin.md#T-07.01.02` | superseded | Earlier partial | API-based auto-verification integration |
| `02-auth-users-admin.md#T-08.01.01` | done | Earlier partial | Dashboard page layout |
| `02-auth-users-admin.md#T-08.01.02` | done | Earlier acceptance_verified | Wallet balance card |
| `02-auth-users-admin.md#T-08.01.03` | done | Earlier partial | Quick status cards |
| `02-auth-users-admin.md#T-11.01.01` | done | Recorded batch work | Account/profile closure request and blocker evaluation |
| `02-auth-users-admin.md#T-11.01.02` | done | Recorded batch work | Portable customer data export |
| `02-auth-users-admin.md#T-11.01.03` | done | Recorded batch work | Closure execution, revocation, retention and anonymization |
| `02-auth-users-admin.md#T-11.02.01` | done | Recorded batch work | Explicit operating context in session and authorization policy |
| `02-auth-users-admin.md#T-11.02.02` | done | Recorded batch work | Context-isolation integration and E2E tests |
| `02-auth-users-admin.md#T-11.03.01` | done | Recorded batch work | Atomic staff user/profile creation without customer onboarding |
| `03-core-business.md#T-03.01.01.01` | done | Earlier acceptance_verified | Create `products` table with columns: `id` (UUIDv7 PK), `type` (enum: `consultation`, `electricity`, `hardware`, `saving_plan`), `system_key` (nullable unique — used for immutable system products like electricity types), `title` (localized JSONB), `description` (localized JSONB, nullable), `price` (bigint nullable, in IRR), `status` (enum: `active`, `inactive`, `archived`), `created_at`, `updated_at` |
| `03-core-business.md#T-03.01.01.02` | done | Earlier acceptance_verified | Create `product_price_versions` table for versioned pricing: `id`, `product_id` (FK), `price` (bigint), `vat_category_override` (FK nullable), `effective_from` (timestamptz), `effective_until` (timestamptz nullable), `created_by` (FK to users) |
| `03-core-business.md#T-03.01.01.03` | done | Earlier acceptance_verified | Create `product_categories` table: `id`, `product_id` (FK), `category` (enum: `electricity_generation_station_consultation`, `electricity_saving_certificate_consultation`, `thermal_electricity`, `green_electricity`, `free_market_electricity`, `energy_saving_electricity`). Only for electricity and consultation types. |
| `03-core-business.md#T-03.01.01.04` | done | Earlier acceptance_verified | Create `electricity_product_limits` table: `id`, `product_id` (FK to electricity products only), `min_kwh` (bigint, default 0 = no limit), `max_kwh` (bigint, default 0 = no limit) |
| `03-core-business.md#T-03.01.01.05` | done | Recorded batch work | Create saving-plan rows in the unified `products` table (`type=saving_plan`), linked many-to-many to hardware products: UUIDv7 `id`, localized `title`/nullable `description`, bigint `price` (nullable while unconfigured), `status`, timestamps. Store admin-editable agreement title/body separately in `saving_plan_agreement_versions`. Ordering requires a valid positive effective price and an active agreement |
| `03-core-business.md#T-03.01.01.06` | done | Recorded batch work | Create `saving_plan_hardware` junction table: `plan_id` (FK to products where type=saving_plan), `hardware_id` (FK to products where type=hardware), unique constraint on pair |
| `03-core-business.md#T-03.01.01.07` | done | Recorded batch work | Add database constraints: non-negative price enforcement at DB level for products and saving plans, unique `(type, system_key)` for system products, FK with ON DELETE RESTRICT for referenced products |
| `03-core-business.md#T-03.01.02.01` | done | Recorded batch work | Create idempotent seed migration that upserts four default electricity products by `system_key`: |
| `03-core-business.md#T-03.01.02.02` | done | Recorded batch work | Each default product gets: type=`electricity`, `system_key` set to the immutable key, `price`=null (unavailable until admin sets price), `status`=`inactive` by default |
| `03-core-business.md#T-03.01.02.03` | done | Recorded batch work | Verify `pnpm db:seed` is idempotent — running it multiple times does not create duplicate system products (use ON CONFLICT on `system_key` with unique index) |
| `03-core-business.md#T-03.01.02.04` | done | Recorded batch work | Admin cannot delete a system electricity product, cannot change its `system_key` or `type`, cannot create additional electricity-product types. Validate at both API and DB level. |
| `03-core-business.md#T-03.01.03.01` | done | Recorded batch work | Admin API: `POST /admin/catalogue/products` with `type=hardware` — create hardware product (title, description, price). Validate price > 0. |
| `03-core-business.md#T-03.01.03.02` | done | Recorded batch work | Admin API: `GET /admin/catalogue/products?type=hardware` — list with search, filter by status, sort, pagination |
| `03-core-business.md#T-03.01.03.03` | done | Recorded batch work | Admin API: `GET /admin/catalogue/products/:id` — detail view |
| `03-core-business.md#T-03.01.03.04` | done | Recorded batch work | Admin API: `PUT /admin/catalogue/products/:id` — update metadata. `POST /admin/catalogue/products/:id/prices` records an effective-dated price change with a new versioned price record. |
| `03-core-business.md#T-03.01.03.05` | done | Recorded batch work | Admin API: `DELETE /admin/catalogue/products/:id` — archive only (soft delete). Reject if referenced by historical saving-plan associations. |
| `03-core-business.md#T-03.01.03.06` | done | Recorded batch work | Hardware products are not directly orderable by customers. No customer-facing order flow creates hardware-only orders. |
| `03-core-business.md#T-03.01.03.07` | done | Recorded batch work | Product without a valid positive price is not orderable in any context (saving plan, etc.) |
| `03-core-business.md#T-03.01.04.01` | done | Recorded batch work | Admin API: `POST /admin/catalogue/products` with `type=saving_plan` — create. Validate at least one hardware product selected (many-to-many). |
| `03-core-business.md#T-03.01.04.02` | done | Recorded batch work | Admin API: `PUT /admin/catalogue/products/:id` — update title, description and hardware associations. Change price through `POST /admin/catalogue/products/:id/prices`; edit agreement as a draft through `POST /admin/catalogue/saving-plans/:id/agreements/draft`, then explicitly activate the selected version |
| `03-core-business.md#T-03.01.04.03` | done | Recorded batch work | Admin API: `DELETE /admin/catalogue/products/:id` — archive. Reject if referenced by active/paid orders. |
| `03-core-business.md#T-03.01.04.04` | done | Recorded batch work | Saving plan agreement is admin-editable. Changes must be versioned. Orders snapshot the accepted agreement version at time of submission. |
| `03-core-business.md#T-03.01.04.05` | done | Recorded batch work | Create `saving_plan_agreement_versions` table: `id`, `plan_id` (FK to products where type=saving_plan), `title` (text), `body` (text), `status` (enum: `draft`, `active`, `superseded`), `effective_from` (timestamptz), `created_by` (FK to users). Enforce at most one active version per plan at any time. |
| `03-core-business.md#T-03.01.04.06` | done | Recorded batch work | Implement Draft → Active → Superseded lifecycle for saving plan agreement versions. Agreement editing uses `POST /admin/catalogue/saving-plans/:id/agreements/draft` to create/update the current draft; admin explicitly activates that exact version with `POST /admin/catalogue/saving-plans/:id/agreements/:versionId/activate`. |
| `03-core-business.md#T-03.01.04.07` | done | Recorded batch work | On order submission (T-03.09.03.04), snapshot the full rendered agreement text (title + body) into the `agreement_snapshot` field, not just a version ID. The snapshot must be the exact verbatim text the customer accepted. |
| `03-core-business.md#T-03.01.04.08` | done | Recorded batch work | Customer order detail page displays the accepted agreement snapshot verbatim. Show notice if agreement has been updated since acceptance. |
| `03-core-business.md#T-03.01.05.01` | done | Recorded batch work | Seed two consultation products via migration: |
| `03-core-business.md#T-03.01.05.02` | done | Recorded batch work | Consultation products have no predefined price. Price field in products table is null. Creating a consultation request does not immediately create an invoice. |
| `03-core-business.md#T-03.01.05.03` | done | Recorded batch work | Certificate consultation is available only when active profile is Legal Entity. Frontend must hide/disable and backend must reject for Individual profiles. |
| `03-core-business.md#T-03.01.05.04` | done | Recorded batch work | Consultation for establishing a power station and construction request for a solar power station are independent products/records. System must not automatically convert or link them unless staff explicitly adds a reference. |
| `03-core-business.md#T-03.02.01.01` | done | Recorded batch work | Create `gift_codes` table: `id` (UUIDv7), `code` (VARCHAR, unique, normalized case-insensitively), `discount_type` (enum: `fixed_irr`, `percentage`), `discount_value` (bigint for fixed IRR or percentage basis points), `max_cap_irr` (bigint nullable — required positive cap for percentage), `eligibility` (enum: `public`, `profile`), `valid_from` (timestamptz, default current time), `valid_until` (timestamptz nullable), `status` (active/inactive), `total_limit` (int nullable), `per_profile_limit` (int nullable), `min_order_amount` (bigint, default zero), `categories` (text[], empty means all; accepts legacy service scopes and six product category keys), `restore_on_cancel` (boolean, default true), `restore_after_payment` (boolean, default false), `created_by`, `created_at`, `updated_at`. Retain the existing representations under the owner-approved promotions decision. |
| `03-core-business.md#T-03.02.01.02` | done | Recorded batch work | Create `gift_code_profiles` junction table for profile-restricted codes: `gift_code_id`, `profile_id` (FK), unique constraint |
| `03-core-business.md#T-03.02.01.03` | done | Recorded batch work | Create `gift_code_redemptions` table: `id`, `gift_code_id` (FK), `profile_id` (FK), `order_id` (non-null FK to the parent orders row, restrict deletion), `discount_amount` (bigint — actual discount applied in IRR), `created_at` (redemption time), `status` (`consumed`/`released`), `restored_at` (nullable — set when usage is returned after cancellation) |
| `03-core-business.md#T-03.02.02.01` | done | Recorded batch work | Admin API: `POST /admin/promotions/gift-codes` — create with all fields. Normalize code to uppercase (store as-is but query normalized). |
| `03-core-business.md#T-03.02.02.02` | done | Recorded batch work | Admin API: `GET /admin/promotions/gift-codes` — list with search by code, filter by status/eligibility/expiry, pagination |
| `03-core-business.md#T-03.02.02.03` | done | Recorded batch work | Admin API: `PATCH /admin/promotions/gift-codes/:id` — update. Usage counts cannot be reset manually. |
| `03-core-business.md#T-03.02.02.04` | done | Recorded batch work | Admin API: `DELETE /admin/promotions/gift-codes/:id` — soft-delete / deactivate. Cannot delete codes with active redemptions. |
| `03-core-business.md#T-03.02.02.05` | done | Recorded batch work | Admin UI: separate gift code management section with full grid, create/edit form with validation, usage statistics per code |
| `03-core-business.md#T-03.02.03.01` | done | Recorded batch work | Public API: `POST /gift-codes/validate` — accept code string, validate: exists, active, not expired, within usage limits, within per-profile limit, eligible for order categories, meets full-order min order amount. Product-category codes discount matching lines only; service scopes retain whole-order behavior. Mixed-cart preview accepts line category/subtotal inputs; preview is advisory and submission uses authoritative backend lines. Return discount amount if valid. |
| `03-core-business.md#T-03.02.03.02` | done | Recorded batch work | Preview validation (`POST /gift-codes/validate`) does not reserve or consume a code. It is a stateless check. |
| `03-core-business.md#T-03.02.03.03` | done | Recorded batch work | Atomic redemption at order creation: within the order-creation transaction, insert a consumed redemption and derive total/per-profile usage counts from the ledger under the gift-code row lock. Fail if limits would be exceeded. Redemption is atomically coupled to order creation. |
| `03-core-business.md#T-03.02.03.04` | done | Recorded batch work | Failed order submission does not consume a gift code — rollback the redemption as part of the transaction rollback. |
| `03-core-business.md#T-03.02.03.05` | done | Recorded batch work | Once gift code applied, the discount must be recalculated authoritatively by backend at submission time (never trust frontend-computed discount). |
| `03-core-business.md#T-03.02.03.06` | done | Recorded batch work | Discount applied before VAT: `discount` is subtracted from taxable subtotal, then VAT calculated on net amount. |
| `03-core-business.md#T-03.02.04.01` | done | Recorded batch work | On order/request cancellation before payment, restore gift code usage atomically: change consumed redemption to released, reducing derived total/per-profile counts, and set `restored_at` timestamp on the redemption record. If `restore_on_cancel` is false, do not restore. |
| `03-core-business.md#T-03.02.04.02` | done | Recorded batch work | Post-payment cancellation: gift code is not restored unless the promotion policy explicitly allows it. Follow admin setting. |
| `03-core-business.md#T-03.02.04.03` | done | Recorded batch work | Restoration is idempotent: running the cancellation workflow twice must not double-restore usage. Cancellation commands use idempotency keys; restoration uses a consumed-only conditional update and preserves the original restoration timestamp. |
| `03-core-business.md#T-03.02.05.01` | done | Recorded batch work | Create `vat_configurations` table: `id`, `category` (VARCHAR — charge category key), `rate` (integer — basis points, e.g. 900 = 9%), `effective_from` (timestamptz), `effective_until` (timestamptz nullable), `created_by` |
| `03-core-business.md#T-03.02.05.02` | done | Recorded batch work | Create `product_vat_overrides` table: `product_id` (FK), `vat_config_id` (FK), `effective_from`, `effective_until` |
| `03-core-business.md#T-03.02.05.03` | done | Recorded batch work | VAT resolution logic: if product has an active override, use it; else if the charge category has an active rate, use it; else zero. Snapshot the resolved rate on the invoice line at creation time. |
| `03-core-business.md#T-03.02.05.04` | done | Recorded batch work | Admin API: CRUD for VAT configurations and product overrides with effective dating |
| `03-core-business.md#T-03.02.05.05` | done | Recorded batch work | VAT calculation: tax = net taxable amount × rate, rounded half-up to nearest IRR. Discount applied before VAT. Stored inputs, rounding steps, and totals must be reproducible. |
| `03-core-business.md#T-03.03.01.01` | done | Recorded batch work | Create `consultation_requests` table: `id` (UUIDv7), `profile_id` (FK), `product_id` (FK — consultation product), `status` (enum: `submitted`, `under_review`, `awaiting_customer_info`, `offer_pending`, `offer_accepted`, `offer_declined`, `completed`, `rejected`, `cancelled`), `staff_owner_id` (FK nullable), `staff_team` (VARCHAR nullable), `fee` (bigint nullable), `scope` (text nullable), `deliverables` (text nullable), `expected_next_step` (text nullable), `offer_valid_until` (timestamptz nullable), `invoice_id` (FK nullable — to invoices), `submitted_at`, `created_at`, `updated_at` |
| `03-core-business.md#T-03.03.01.02` | done | Recorded batch work | State machine for consultation requests with full transition rules: |
| `03-core-business.md#T-03.03.01.03` | done | Recorded batch work | Consultation access control: customer sees only own profile's requests. Staff sees assigned or unassigned based on roles. |
| `03-core-business.md#T-03.03.01.04` | done | Recorded batch work | Consultation for electricity-saving certificate is available only when active profile is Legal Entity. Backend must reject Individual profiles at submission. |
| `03-core-business.md#T-03.03.02.01` | done | Recorded batch work | Customer UI: "Consultation" section — list of available consultation products with descriptions, each with a "Request" button |
| `03-core-business.md#T-03.03.02.02` | done | Recorded batch work | Consultation request submission form: profile selection verification, product detail display, submit button with confirmation |
| `03-core-business.md#T-03.03.02.03` | done | Recorded batch work | Consultation request detail page: status, assigned staff, fee (when set), scope, deliverables, validity period. Accept/Decline buttons when `offer_pending`. |
| `03-core-business.md#T-03.03.02.04` | done | Recorded batch work | Customer's consultation list: all profile-scoped requests with status, submission date, staff owner, next action indicator |
| `03-core-business.md#T-03.03.02.05` | done | Recorded batch work | Every status change sends a notification. The detail page shows full status history with actor, timestamp, and reason. |
| `03-core-business.md#T-03.03.03.01` | done | Recorded batch work | Staff UI: consultation work queue — list of unassigned and assigned requests with filtering by status, priority, age |
| `03-core-business.md#T-03.03.03.02` | done | Recorded batch work | Staff UI: consultation detail — full history, customer info, fee entry form, scope and deliverables fields, invoice creation trigger |
| `03-core-business.md#T-03.03.03.03` | done | Recorded batch work | Staff API: `POST /staff/consultations/:id/fee` — set fee, scope, deliverables, validity period. Creates associated invoice. If a previous unpaid invoice exists, cancel and replace it. Notify customer. |
| `03-core-business.md#T-03.03.03.04` | done | Recorded batch work | Staff API: `POST /staff/consultations/:id/assign` — assign self or team |
| `03-core-business.md#T-03.03.03.05` | done | Recorded batch work | Staff API: `POST /staff/consultations/:id/reject` — with reason |
| `03-core-business.md#T-03.03.03.06` | done | Recorded batch work | Staff API: `POST /staff/consultations/:id/cancel` — with reason |
| `03-core-business.md#T-03.03.03.07` | done | Recorded batch work | Fee changes after customer has already paid creates an adjustment/refund workflow — do not silently change or replace the paid invoice. |
| `03-core-business.md#T-03.04.01.01` | done | Recorded batch work | Implement `ElectricityCalculationService` with pure functions: |
| `03-core-business.md#T-03.04.01.02` | done | Recorded batch work | Mandatory green rule engine: |
| `03-core-business.md#T-03.04.01.03` | done | Recorded batch work | Product limit validation: |
| `03-core-business.md#T-03.04.01.04` | done | Recorded batch work | Zero-quantity products do not trigger their min_kwh validation. A product omitted from the order has no limit check. |
| `03-core-business.md#T-03.04.01.05` | done | Recorded batch work | Prices snapshot at submission time: capture unit prices, VAT rates, gift code discount rate. Store in order/contract snapshot JSON. |
| `03-core-business.md#T-03.04.02.01` | done | Recorded batch work | Retain versioned `app_config` settings: `electricity.green_mandatory_rules` stores independent simple/advanced enabled flags (defaults true/false), thresholds (1000 kW), and percentages (4%). `finance.wallet_top_up_limit` defaults to 2_000_000_000 IRR; zero is the fail-closed online top-up kill switch. `electricity.contract_limits` stores lead days (0), maximum Jalali duration (24 months) and customer quantity-increase percentage (20%). `electricity.contract_template_version_id` stores the nullable selected supported active version UUID. Each write advances its version and updated timestamp and records the actor and previous/new values in audit history. Preserve defaults, validation and immutable submitted-order snapshots. |
| `03-core-business.md#T-03.04.02.02` | done | Recorded batch work | Admin API: retain versioned `GET`/`PUT` endpoints under `/api/admin/config/` for `green-electricity-rules`, `wallet-top-up-limit`, `contract-electricity-limits` and `electricity-contract-template`. Validate green thresholds as nonnegative safe integers and green percentages as finite 0–100 values; top-up limits are nonnegative integer IRR with zero disabling online top-ups. Contract limits and template references retain their existing bounds and eligibility validation. Preserve current role authorization, CSRF, step-up, locking, versioned audit and rollback safeguards. |
| `03-core-business.md#T-03.04.02.03` | done | Recorded batch work | Activating mandatory green rule is blocked unless green electricity product is Active, has a valid positive price, and its per-order limits are compatible with the configured percentage. |
| `03-core-business.md#T-03.04.02.04` | done | Recorded batch work | Settings changes affect new drafts only. Submitted orders retain the settings snapshot from confirmation time. |
| `03-core-business.md#T-03.04.03.01` | done | Recorded batch work | Implement shared `validateOrderComposition(orderInput, settings, products)` function used by both simple and advanced order validation: |
| `03-core-business.md#T-03.04.03.02` | done | Recorded batch work | Green rule simple mode: thermal is the only user-selected product. Backend auto-composes: thermal = total × (1 - green%), green = total × green%. The total requested energy is not increased. |
| `03-core-business.md#T-03.04.03.03` | done | Recorded batch work | Green rule advanced mode: when rule is enabled, green quantity is derived from thermal quantity (not independently editable). When rule disabled, customer can freely set green quantity. |
| `03-core-business.md#T-03.04.03.04` | done | Recorded batch work | When applied composition fails product limits (e.g. required green exceeds green max_kwh), the UI must explain the exact conflict. Never silently change the configured percentage. |
| `03-core-business.md#T-03.04.04.01` | done | Recorded batch work | Implement Jalali calendar period calculation functions: |
| `03-core-business.md#T-03.04.04.02` | done | Recorded batch work | Handle 29-, 30-, and 31-day Jalali months correctly. Handle Jalali leap years. |
| `03-core-business.md#T-03.04.04.03` | done | Recorded batch work | Current-week period starts at current time in Iran (not at Saturday 00:00 if already past it). Week boundaries use Iran official timezone, not customer's configured timezone. |
| `03-core-business.md#T-03.04.04.04` | done | Recorded batch work | Current-month period: starts at current time, ends at first instant of following Jalali month. Next-month period: covers the full next month `[start_of_month, start_of_following_month)`. |
| `03-core-business.md#T-03.05.01.01` | done | Recorded batch work | Customer UI: period type selector — "Weekly" or "Monthly" |
| `03-core-business.md#T-03.05.01.02` | done | Recorded batch work | Monthly period selector: dropdown with "Current month" and "Next month" (Jalali month names displayed). Pre-calculate and display exact start/end dates in Jalali and Gregorian. |
| `03-core-business.md#T-03.05.01.03` | done | Recorded batch work | Weekly period selector: options for "Current week", "Next week", "Week after next" (max 2 weeks ahead). Display Saturday-to-Friday range in Jalali. |
| `03-core-business.md#T-03.05.01.04` | partial | Recorded batch work | Bill data integration adapter: `GET /bill-data/:profileId` — external API call to retrieve historical consumption. Returns hourly kwh data for available lookback period. Implement provider abstraction with failure handling: timeout, auth error, no data. |
| `03-core-business.md#T-03.05.01.05` | done | Recorded batch work | Energy suggestion calculation: `suggestedKwh = avgHourlyConsumption × selectedPeriodHours`. Return `{ suggestedKwh, dataSource, dataPeriod, dataTimestamp, coverage}`. |
| `03-core-business.md#T-03.05.01.06` | done | Recorded batch work | UI: show suggested quantity labeled "Estimate" with source, period coverage, and timestamp disclaimer. Editable input field. |
| `03-core-business.md#T-03.05.01.07` | done | Recorded batch work | If bill data is unavailable/inaccessible/fails, customer enters kWh manually. Missing data never blocks manual entry. Show warning but allow proceed. |
| `03-core-business.md#T-03.05.02.01` | done | Recorded batch work | UI: kWh input field with numeric validation, min/max based on thermal product limits. Simple mode — only thermal quantity is user-selectable. |
| `03-core-business.md#T-03.05.02.02` | done | Recorded batch work | Real-time price preview API: `POST /electricity/preview/simple` — accepts period type, period selection, total kWh, gift code. Returns: |
| `03-core-business.md#T-03.05.02.03` | done | Recorded batch work | Preview UI: display thermal/green breakdown, unit prices, subtotals, discount, VAT, total. Must disclose mandatory green composition and price of each component before submission. |
| `03-core-business.md#T-03.05.02.04` | done | Recorded batch work | Gift code input with separate "Apply" action triggering validation API. Display validity and discount before submission. Re-validate atomically at submission. |
| `03-core-business.md#T-03.05.03.01` | done | Recorded batch work | `POST /electricity/orders/simple` — idempotent submission endpoint: |
| `03-core-business.md#T-03.05.03.02` | partial | Recorded batch work | Create `electricity_orders` table: `id` (UUIDv7), `profile_id` (FK), `type` (enum: `simple`, `advanced`), `status` (commercial state enum), `period_start`, `period_end`, `total_kwh`, `average_power_kw`, `green_rule_applied` (bool), `submitted_by` (FK to user — records the agent), `snapshot_data` (JSONB: prices, settings, composition), `created_at`, `updated_at` |
| `03-core-business.md#T-03.05.03.03` | done | Recorded batch work | Create `electricity_order_lines` table: `id`, `order_id` (FK), `product_id` (FK), `quantity_kwh`, `unit_price`, `line_total` |
| `03-core-business.md#T-03.05.03.04` | done | Recorded batch work | Create `electricity_contracts` table: `id`, `order_id` (FK), `contract_id` (FK — to Contracts module), `status` (draft/active/completed/cancelled/etc.) |
| `03-core-business.md#T-03.05.03.05` | done | Recorded batch work | Idempotency key required on submission. Retrying a timed-out request returns original result without creating duplicates. |
| `03-core-business.md#T-03.05.03.06` | done | Recorded batch work | Validate: simple mode selects only thermal electricity. Other products cannot be manually selected. Backend must reject any other product composition. |
| `03-core-business.md#T-03.05.04.01` | done | Recorded batch work | Step 1: Period type and period selection with Jalali calendar display |
| `03-core-business.md#T-03.05.04.02` | done | Recorded batch work | Step 2: kWh entry with bill-data suggestion (when available) and estimate label |
| `03-core-business.md#T-03.05.04.03` | done | Recorded batch work | Step 3: Price preview with mandatory green composition breakdown |
| `03-core-business.md#T-03.05.04.04` | done | Recorded batch work | Step 4: Optional gift code entry and validation |
| `03-core-business.md#T-03.05.04.05` | done | Recorded batch work | Step 5: Review page — full summary including profile, period, quantities, prices, discount, VAT, total, wallet balance, contract preview, cancellation/refund rules. Explicit "Submit" button. |
| `03-core-business.md#T-03.05.04.06` | done | Recorded batch work | Order confirmation page — redirects to order detail. Shows order ID, contract reference, invoice reference, payment options. |
| `03-core-business.md#T-03.05.04.07` | done | Recorded batch work | Multi-step form saves server-side draft after each completed step. Resumable safely. Validation errors identify exact field without clearing valid input. |
| `03-core-business.md#T-03.06.01.01` | done | Recorded batch work | UI: Start date and end date pickers (Jalali calendar with time). Start cannot be in the past. End must be after start. |
| `03-core-business.md#T-03.06.01.02` | done | Recorded batch work | Validate: duration ≤ admin-configured max (default 24 Jalali months). Validate lead time (default 0 days — start can be today). |
| `03-core-business.md#T-03.06.01.03` | done | Recorded batch work | Calculate exact hours between start and end timestamps for average power calculation. |
| `03-core-business.md#T-03.06.02.01` | done | Recorded batch work | UI: For each of the 4 electricity products (thermal, green, free-market, energy-saving), show: |
| `03-core-business.md#T-03.06.02.02` | done | Recorded batch work | `POST /electricity/preview/advanced` — accepts date range, per-product quantities, gift code. Returns: |
| `03-core-business.md#T-03.06.02.03` | done | Recorded batch work | When advanced green rule is enabled: green quantity is derived from thermal quantity (read-only display). Customer cannot edit green quantity; changing thermal recalculates green. When disabled: customer freely enters any allowed green quantity. |
| `03-core-business.md#T-03.06.02.04` | done | Recorded batch work | When thermal quantity is zero and mandatory green is enabled: calculated mandatory green quantity is zero. Customer cannot manually add separate green quantity. |
| `03-core-business.md#T-03.06.03.01` | done | Recorded batch work | `POST /electricity/orders/advanced` — idempotent submission: |
| `03-core-business.md#T-03.06.03.02` | done | Recorded batch work | Advanced order creates one contract and one initial invoice for the complete bundle. No installment or multiple invoice generation. |
| `03-core-business.md#T-03.06.03.03` | done | Recorded batch work | Backend performs authoritative calculation of bundle totals: never trust frontend-computed amounts. |
| `03-core-business.md#T-03.06.04.01` | done | Recorded batch work | Step 1: Date range selection with Jalali date pickers, duration display |
| `03-core-business.md#T-03.06.04.02` | done | Recorded batch work | Step 2: Bundle builder — 4 product quantity inputs with line totals, automatic green derivation when rule enabled |
| `03-core-business.md#T-03.06.04.03` | done | Recorded batch work | Step 3: Price preview with full breakdown: per-product, bundle totals, average power, green status |
| `03-core-business.md#T-03.06.04.04` | done | Recorded batch work | Step 4: Optional gift code |
| `03-core-business.md#T-03.06.04.05` | done | Recorded batch work | Step 5: Review & submit — full snapshot, wallet balance, explicit confirm |
| `03-core-business.md#T-03.06.04.06` | done | Recorded batch work | Lead time must be enforced: start date cannot violate lead days setting. |
| `03-core-business.md#T-03.07.01.01` | partial | Recorded batch work | Commercial state machine for electricity orders: |
| `03-core-business.md#T-03.07.01.02` | done | Recorded batch work | Financial state machine for electricity orders: |
| `03-core-business.md#T-03.07.01.03` | done | Recorded batch work | Order detail page: display both commercial and financial statuses separately with distinct labels. Never combine into one ambiguous status. |
| `03-core-business.md#T-03.07.01.04` | done | Recorded batch work | Show next action clearly for each status pair. For customer: what they need to do. For staff: what action is pending their review. |
| `03-core-business.md#T-03.07.02.01` | done | Recorded batch work | Staff API: `POST /staff/electricity/orders/:id/approve` — approve preliminary contract. Notify customer. |
| `03-core-business.md#T-03.07.02.02` | done | Recorded batch work | Staff API: `POST /staff/electricity/orders/:id/request-changes` — with reason. Notify customer. |
| `03-core-business.md#T-03.07.02.03` | done | Recorded batch work | Staff API: `POST /staff/electricity/orders/:id/reject` — with reason. If paid, trigger automatic refund workflow. |
| `03-core-business.md#T-03.07.02.04` | done | Recorded batch work | Staff UI: electricity order review work queue — list of orders awaiting staff review with priority/age |
| `03-core-business.md#T-03.07.02.05` | done | Recorded batch work | Staff UI: order detail view — customer info, period, product breakdown, prices, contract snapshot, decision buttons (approve/request changes/reject) |
| `03-core-business.md#T-03.07.04.01` | done | Recorded batch work | Customer order list: all profile-scoped electricity orders with commercial + financial status, period, total kWh, total price, submission date, next action callout |
| `03-core-business.md#T-03.07.04.02` | done | Recorded batch work | Order detail: full submitted data snapshot, per-product breakdown, contract reference, invoice reference and status, payment status, review timeline, comments |
| `03-core-business.md#T-03.07.04.03` | done | Recorded batch work | No dead ends: always show current state, what happened, next available action, who is responsible, how to get help. |
| `03-core-business.md#T-03.09.01.01` | partial | Recorded batch work | Create `saving_orders` table: `id` (UUIDv7), `profile_id` (FK), `saving_plan_id` (FK), `hardware_product_id` (FK), `bill_identifier` (VARCHAR), `installation_address_id` (FK — addresses), `agreement_version` (VARCHAR), `agreement_snapshot` (text — snapshot of accepted agreement), `status` (enum — commercial state), `financial_status` (enum), `submitted_at`, `created_at`, `updated_at` |
| `03-core-business.md#T-03.09.01.02` | done | Recorded batch work | Create `saving_order_lines` table: `id`, `order_id` (FK), `description` (text), `amount` (bigint — IRR), `type` (enum: `plan_price`, `hardware_price`, `discount`, `vat`) |
| `03-core-business.md#T-03.09.01.03` | done | Recorded batch work | Create `saving_fulfillment_stages` table for tracking fulfillment progress per order |
| `03-core-business.md#T-03.09.02.01` | done | Recorded batch work | Step 1: Saving plan selection — display list of active saving plans with title, price, one-line description. Show inactive plans as unavailable. |
| `03-core-business.md#T-03.09.02.02` | done | Recorded batch work | Step 2: Hardware product selection — after plan selected, show assigned hardware products. Customer picks exactly one. Display title, price, full description. Require explicit confirmation checkbox. |
| `03-core-business.md#T-03.09.02.03` | done | Recorded batch work | Step 3: Electricity bill identifier input — single text field. Local format validation. Optional backend verification when provider configured. |
| `03-core-business.md#T-03.09.02.04` | done | Recorded batch work | Bill identifier local validation (format regex). If provider configured, async verification call. Provider failure does not erase draft — retry or submit for manual staff review. |
| `03-core-business.md#T-03.09.02.05` | done | Recorded batch work | Duplicate detection: admin can prevent duplicate active saving orders for same bill identifier + plan. If detected, link customer to existing order or support — do not silently allow a second order. |
| `03-core-business.md#T-03.09.02.06` | done | Recorded batch work | Create `BillVerificationProvider` abstraction with adapter interface for Iranian bill-data APIs: `verify(billIdentifier) → { verified: boolean, data?: object, error?: string }`. Include timeout, bounded retry with jitter, and circuit breaker. |
| `03-core-business.md#T-03.09.02.07` | done | Recorded batch work | Add `verification_result` JSONB column to `saving_orders` table to persist verification attempt metadata: source provider, timestamp, verification status, raw result, error details. |
| `03-core-business.md#T-03.09.02.08` | done | Recorded batch work | Bill verification provider failure (timeout, auth error, provider unavailable) must not erase the draft. Customer can retry or submit for manual staff review. Failed verification state is persisted in `verification_result`; explicit "submit for staff review" action advances the order. |
| `03-core-business.md#T-03.09.03.01` | done | Recorded batch work | Step 4: Address selection — choose from profile's existing addresses or add new one inside the flow. Must select installation address. |
| `03-core-business.md#T-03.09.03.02` | done | Recorded batch work | Step 5: Agreement — display admin-editable saving plan agreement title and body. Require explicit "I accept" action. Record accepted version. |
| `03-core-business.md#T-03.09.03.03` | done | Recorded batch work | Step 6: Review & submit — full summary: saving plan, hardware, bill ID, address, individual price lines, subtotal, VAT and amount, gift code discount, total payable, wallet balance. Backend authoritative totals. |
| `03-core-business.md#T-03.09.03.04` | done | Recorded batch work | Submission: `POST /saving/orders` — idempotent. Atomic transaction creates: saving order, linked draft contract, linked unpaid invoice. Snapshots: installation address, selected prices, accepted agreement version. Redirects to order detail. |
| `03-core-business.md#T-03.09.03.05` | done | Recorded batch work | Idempotency prevents duplicate orders, contracts, or invoices. Use idempotency key on submission. |
| `03-core-business.md#T-03.09.03.06` | done | Recorded batch work | Backend enforces: active profile must be Individual (residential). Legal Entity profiles are rejected. |
| `03-core-business.md#T-03.09.04.01` | done | Recorded batch work | Saving order commercial states: `draft`, `submitted`, `awaiting_staff_review`, `approved`, `in_progress`, `completed`, `cancelled`, `rejected` |
| `03-core-business.md#T-03.09.04.02` | done | Recorded batch work | Saving order financial states: `unpaid`, `paid`, `refund_pending`, `refunded` (follows general invoice model) |
| `03-core-business.md#T-03.09.04.03` | done | Recorded batch work | Customer order list: all saving orders with status, plan name, hardware, price, date, next action |
| `03-core-business.md#T-03.09.04.04` | done | Recorded batch work | Customer order detail: submitted data, invoice status, contract status, payment options, fulfillment progress (5 stages), document upload, comments |
| `03-core-business.md#T-03.09.04.05` | done | Recorded batch work | Before payment: customer can request hardware/address change — recalculates draft invoice. After payment: only staff can apply changes via audited amendment. |
| `03-core-business.md#T-03.11.01.01` | done | Recorded batch work | Create `solar_construction_requests` table: `id` (UUIDv7), `profile_id` (FK), `status` (enum — overall state machine), `building_type` (enum: `building_apartment`, `non_household`), `grid_type` (enum: `on_grid`, `off_grid`), `bill_identifier` (VARCHAR nullable — required for on-grid), `property_form` (enum: `apartment`, `villa` — nullable, for building/apartment only), `structural_frame` (enum: `concrete`, `steel`, `other` — nullable), `building_completion_date` (date — nullable), `total_units` (int — nullable, for apartment), `site_category` (enum: `agricultural`, `industrial` — nullable, for non-household), `installation_surface` (enum: `land`, `rooftop`, `both` — nullable), `usable_area_sqm` (decimal — nullable), `site_address_id` (FK — nullable), `site_relationship` (enum: `owner`, `tenant`, `authorized_operator` — nullable), `site_description` (text — nullable), `agreement_accepted` (bool), `agreement_version` (text), `agreement_snapshot` (text), `created_at`, `updated_at` |
| `03-core-business.md#T-03.11.01.02` | done | Recorded batch work | Create `solar_construction_documents` table: `id`, `request_id` (FK), `document_id` (FK — documents/storage), `file_name`, `staff_status` (enum: `pending`, `approved`, `rejected`), `staff_reason` (text nullable), `staff_reviewed_by` (FK nullable), `staff_reviewed_at`, `uploaded_by` (FK), `uploaded_at` |
| `03-core-business.md#T-03.11.01.03` | done | Recorded batch work | Create `solar_construction_postal` table: `id`, `request_id` (FK), `status` (enum: `waiting_for_shipment`, `shipped`, `received`, `incomplete`, `not_received`), `courier` (text nullable), `tracking_number` (text nullable), `send_date` (timestamptz nullable), `receipt_image_id` (FK nullable), `staff_confirmed_by` (FK nullable), `staff_confirmed_at`, `staff_notes` (text nullable) |
| `03-core-business.md#T-03.11.02.01` | done | Recorded batch work | Screen 1: Persian instruction: `نوع نیروگاه خورشیدی مورد نظر خودتان را انتخاب کنید.` — Two option cards: "Building and apartment" and "Non-household" |
| `03-core-business.md#T-03.11.02.02` | done | Recorded batch work | Building/Apartment form: property form (Apartment / Villa), structural frame (Concrete / Steel / Other), building completion date (derive age), total unit count (when Apartment selected) |
| `03-core-business.md#T-03.11.02.03` | done | Recorded batch work | Non-household form: site category (Agricultural / Industrial), installation surface (Land / Rooftop / Both), approximate usable area (sq m), site address, relationship (Owner / Tenant / Authorized Operator), optional site description |
| `03-core-business.md#T-03.11.02.04` | done | Recorded batch work | Grid type selection: "On-Grid" (sell to grid) or "Off-Grid" (self-consumption) |
| `03-core-business.md#T-03.11.02.05` | done | Recorded batch work | On-Grid only: electricity bill identifier field (required) |
| `03-core-business.md#T-03.11.02.06` | done | Recorded batch work | Off-Grid disclaimer: generated electricity is used internally. May remain available during grid outages only subject to final technical design and installed storage equipment. |
| `03-core-business.md#T-03.11.03.01` | done | Recorded batch work | Display 5 contract-preparation stages before submission: |
| `03-core-business.md#T-03.11.03.02` | done | Recorded batch work | Required checkbox: `شرایط ثبت قرارداد را می‌پذیرم.` with the accepted text version and time retained. |
| `03-core-business.md#T-03.11.03.03` | done | Recorded batch work | Submission creates only a solar construction request (no contract or invoice). Redirects to request detail page. |
| `03-core-business.md#T-03.11.04.01` | done | Recorded batch work | Overall state machine: |
| `03-core-business.md#T-03.11.04.02` | done | Recorded batch work | Document-level decisions do not automatically reject the overall request. Only one file may be rejected while others are approved. |
| `03-core-business.md#T-03.11.04.03` | done | Recorded batch work | `Rejected` and `Cancelled` require reason and support path. `Approved` remains open until staff creates/linked contract or explicitly closes as "No contract required" with elevated permission and reason. |
| `03-core-business.md#T-03.90.01` | done | Recorded batch work | Configure default contract template for electricity orders in admin settings. The template is used when creating the preliminary contract at order submission. |
| `03-core-business.md#T-03.90.02` | done | Recorded batch work | All order review/submission pages must display current wallet balance. Payment is through wallet. If insufficient, show top-up option (online or bank receipt). |
| `03-core-business.md#T-03.90.03` | done | Recorded batch work | Audit every: order submission, status change, contract approval/rejection/cancellation, price change, fee setting, gift code redemption, document review decision, postal confirmation. Record: entity, previous/new state, actor, timestamp, reason, correlation ID, metadata. |
| `03-core-business.md#T-03.90.04` | done | Recorded batch work | Customer-facing history uses understandable labels. Internal notes and customer-visible comments are separate. Staff must choose visibility. |
| `03-core-business.md#T-03.90.05` | done | Recorded batch work | Rate limit order/consultation submission: 5 per profile per minute, plus duplicate/idempotency protection. |
| `03-core-business.md#T-03.90.06` | done | Recorded batch work | Rate limit gift code validation: reasonable limit to prevent brute-force guessing. |
| `03-core-business.md#T-03.90.07` | done | Recorded batch work | An electricity product required by an ordering rule cannot be sold if inactive or has no price. Customers see "ordering temporarily unavailable" + contact support rather than broken checkout. |
| `03-core-business.md#T-03.90.08` | done | Recorded batch work | Price/VAT/limit changes are versioned with effective dates. Existing orders keep snapshot from submission time. Admin changes never silently retroactive. |
| `03-core-business.md#T-03.90.09` | done | Recorded batch work | Admin dashboard: widget for pending consultation requests count, pending electricity orders count, pending solar construction requests count, pending document reviews. |
| `03-core-business.md#T-03.90.10` | done | Recorded batch work | Admin dashboard: refund obligations queue, failed refund obligations alert. |
| `03-core-business.md#T-03.90.11` | done | Recorded batch work | Unit tests: state machine transitions for all electricity/saving/solar/consultation states |
| `03-core-business.md#T-03.90.12` | done | Recorded batch work | Unit tests: Jalali period calculations, green rule composition, price calculation, gift code validation |
| `03-core-business.md#T-03.90.13` | done | Recorded batch work | Integration tests: order submission with idempotency, concurrent wallet operations, gift code atomic redemption, automatic refund obligation creation |
| `03-core-business.md#T-03.90.14` | done | Recorded batch work | E2E tests: simple electricity order → review → payment → contract lifecycle. Saving plan order wizard → fulfillment stages. Solar construction request → document upload → postal. |
| `03-core-business.md#T-03.90.15` | done | Recorded batch work | Implement a state machine engine (or use a library) that enforces allowed transitions, guards, side effects, and notification behavior. Used across all core business entities. |
| `03-core-business.md#T-03.90.16` | done | Recorded batch work | Create reusable `<WorkflowStatusBanner>` component that renders entity status, what happened, next available action, responsible party (customer/staff), and support contact for any business entity (order, contract, solar request, consultation, etc.). |
| `03-core-business.md#T-03.90.17` | done | Recorded batch work | Create `useFormDraft(key, schema)` hook that auto-saves multi-step form progress to backend after each completed step. Supports resume from interruption, error recovery, and validates that prior input is not cleared on error. |
| `03-core-business.md#T-03.90.18` | done | Recorded batch work | Add architectural checklist item (or automated test) verifying every customer-facing workflow displays: current state, what happened, next available action, who is responsible, and how to get help. |

## v0.3.0: Staff operations and financial closure

Staff can fulfill, revise, reject, cancel, refund and close work for all four services, with correct contracts, invoices, receipts and ledger history.

| Qualified task | State | Build evidence | Required work |
| --- | --- | --- | --- |
| `release-readiness#R-02.01` | partial | Recorded batch work | Renew fulfillment and financial closure acceptance |
| `release-readiness#R-02.02` | done | Recorded batch work | Verify staff operations and customer support for all services |
| `02-auth-users-admin.md#T-05.01.01` | done | Earlier acceptance_verified | CRM users list page |
| `02-auth-users-admin.md#T-05.01.02` | done | Earlier acceptance_verified | CRM filters and search |
| `02-auth-users-admin.md#T-05.02.01` | done | Earlier acceptance_verified | Full profile view for CRM staff |
| `02-auth-users-admin.md#T-05.02.02` | done | Earlier acceptance_verified | Staff profile editing |
| `02-auth-users-admin.md#T-05.02.03` | done | Earlier acceptance_verified | Verification state management |
| `02-auth-users-admin.md#T-05.02.04` | done | Earlier acceptance_verified | Force password change and session expiry |
| `02-auth-users-admin.md#T-05.02.05` | done | Earlier acceptance_verified | Identity correction through verification case |
| `02-auth-users-admin.md#T-05.02.06` | partial | Earlier partial | Profile deletion by staff |
| `02-auth-users-admin.md#T-05.03.01` | done | Earlier acceptance_verified | Create staff user |
| `02-auth-users-admin.md#T-05.03.02` | done | Earlier acceptance_verified | Staff role assignment |
| `02-auth-users-admin.md#T-05.04.01` | done | Earlier acceptance_verified | Agent list for legal entity |
| `02-auth-users-admin.md#T-05.04.02` | done | Earlier acceptance_verified | Agent invitation flow |
| `02-auth-users-admin.md#T-05.04.03` | done | Earlier acceptance_verified | Accept/decline invitation |
| `02-auth-users-admin.md#T-05.04.04` | done | Earlier partial | Agent role permissions enforcement |
| `02-auth-users-admin.md#T-05.04.05` | done | Earlier acceptance_verified | Ownership transfer |
| `02-auth-users-admin.md#T-05.05.01` | done | Earlier acceptance_verified | Profiles awaiting verification widget |
| `02-auth-users-admin.md#T-05.05.02` | done | Earlier acceptance_verified | Agent invitation dashboard widget |
| `02-auth-users-admin.md#T-06.01.01` | done | Earlier partial | Ticket creation |
| `02-auth-users-admin.md#T-06.01.02` | done | Earlier partial | Ticket list and detail view |
| `02-auth-users-admin.md#T-06.01.03` | done | Earlier acceptance_verified | Staff ticket management |
| `02-auth-users-admin.md#T-07.01.01` | done | Earlier partial | Verification mode setting |
| `02-auth-users-admin.md#T-07.01.03` | partial | Earlier partial | Verification notification to user |
| `02-auth-users-admin.md#T-09.02.01` | done | Earlier acceptance_verified | Province CRUD |
| `02-auth-users-admin.md#T-09.02.02` | done | Earlier acceptance_verified | City CRUD per province |
| `02-auth-users-admin.md#T-09.03.01` | done | Earlier acceptance_verified | TOS editor |
| `02-auth-users-admin.md#T-09.03.02` | done | Earlier acceptance_verified | TOS version history |
| `02-auth-users-admin.md#T-09.05.01` | done | Earlier acceptance_verified | Staff role management |
| `02-auth-users-admin.md#T-09.07.01` | done | Earlier acceptance_verified | Dual-approval threshold configuration |
| `02-auth-users-admin.md#T-09.07.02` | done | Earlier acceptance_verified | Dual-approval workflow |
| `02-auth-users-admin.md#T-09.08.01` | done | Earlier partial | Service response targets |
| `02-auth-users-admin.md#T-09.08.02` | done | Earlier partial | Staff teams and assignment rules |
| `02-auth-users-admin.md#T-09.08.03` | done | Earlier acceptance_verified | Escalation alerts |
| `02-auth-users-admin.md#T-09.09.01` | partial | Earlier partial | Reconciliation exceptions view |
| `02-auth-users-admin.md#T-09.09.02` | done | Earlier acceptance_verified | Failed jobs dashboard |
| `02-auth-users-admin.md#T-09.09.03` | done | Earlier acceptance_verified | Dead-letter notifications |
| `02-auth-users-admin.md#T-09.10.01` | done | Earlier acceptance_verified | Online wallet top-up limit |
| `02-auth-users-admin.md#T-09.10.02` | done | Earlier partial | Mandatory green-electricity rules |
| `02-auth-users-admin.md#T-09.10.03` | done | Earlier partial | Green rule activation safety check |
| `02-auth-users-admin.md#T-09.12.01` | done | Earlier acceptance_verified | Product catalogue management |
| `02-auth-users-admin.md#T-09.12.02` | done | Earlier acceptance_verified | VAT configuration |
| `02-auth-users-admin.md#T-09.12.03` | done | Earlier partial | Gift code management |
| `02-auth-users-admin.md#T-09.12.04` | done | Earlier partial | Contract template management |
| `02-auth-users-admin.md#T-09.12.05` | done | Earlier acceptance_verified | Upload policies configuration |
| `02-auth-users-admin.md#T-09.12.06` | partial | Earlier partial | Contract electricity increase limits |
| `02-auth-users-admin.md#T-10.01.01` | done | Earlier acceptance_verified | Staff user list (admin) |
| `02-auth-users-admin.md#T-10.01.02` | done | Earlier acceptance_verified | Staff permission audit view |
| `03-core-business.md#T-03.07.03.01` | done | Recorded batch work | Retain `refund_obligations` for legacy/order-only termination: `id`, `order_id` (FK), `contract_id` (FK nullable), `invoice_id` (FK), `profile_id` (FK), `total_paid_amount` (bigint), `completed_refund_amount` (bigint default 0), `status` (TEXT CHECK restricted to `pending`, `processing`, `completed`, `failed`), `idempotency_key` (unique), `created_at`, `updated_at`. Current contract cancellations retain `contract_refund_obligations` linked to the shared `refunds` ledger, with state and financial totals derived from that ledger. Owner approved these representations on 2026-10-07; mandatory full refunds and immutable credit, provenance, retry and closure safeguards remain required. |
| `03-core-business.md#T-03.07.03.02` | done | Recorded batch work | When an order transitions to `rejected` or `cancelled` and confirmed paid funds exceed completed refunds: automatically create the appropriate durable order/contract refund obligation and its `Requested` system refund, then queue it as `Processing` within the same terminal transaction. This is automatic, not optional for staff. Retain existing obligation ledgers as approved by the owner on 2026-10-07. |
| `03-core-business.md#T-03.07.03.03` | done | Recorded batch work | Worker: process refund obligations — post immutable wallet credit linked to contract, invoice, and original payment allocations. Use unique idempotency key to prevent duplicate credits. |
| `03-core-business.md#T-03.07.03.04` | done | Recorded batch work | Refundable amount = confirmed paid amount − previously completed refunds. Must never exceed this. |
| `03-core-business.md#T-03.07.03.05` | done | Recorded batch work | Contract/order cannot be marked financially closed until refund obligation is Completed. Staff cannot dismiss or manually mark complete without the linked wallet credit. |
| `03-core-business.md#T-03.07.03.06` | done | Recorded batch work | Failed refund processing must be retried and visible in a finance work queue/alert until resolved. Staff do not manually create the required full wallet refund. |
| `03-core-business.md#T-03.07.03.07` | done | Recorded batch work | Refund completion notification to customer: amount, reason, actor/system, timestamps. |
| `03-core-business.md#T-03.08.01.01` | partial | Recorded batch work | Admin config: `customer_increase_max_percentage` in electricity settings. Default 0 = disabled. |
| `03-core-business.md#T-03.08.01.02` | done | Recorded batch work | Customer UI: "Request quantity increase" button on active electricity contract detail page. Visible only if they haven't already requested once. |
| `03-core-business.md#T-03.08.01.03` | partial | Recorded batch work | `POST /electricity/contracts/:id/request-increase` — customer submits desired new quantity. Backend validates: |
| `03-core-business.md#T-03.08.01.04` | done | Recorded batch work | Staff UI: quantity increase work queue — pending increase requests with contract details, current vs requested quantity, percentage change |
| `03-core-business.md#T-03.08.01.05` | partial | Recorded batch work | Staff API: `POST /staff/electricity/contracts/:id/approve-increase` — approve with optional effective date. Creates amendment document. |
| `03-core-business.md#T-03.08.01.06` | partial | Recorded batch work | Staff API: `POST /staff/electricity/contracts/:id/reject-increase` — with reason. |
| `03-core-business.md#T-03.08.01.07` | partial | Recorded batch work | After approval: |
| `03-core-business.md#T-03.08.01.08` | partial | Recorded batch work | Record: old/new quantities, percentage, effective period, requester, reviewer, decision, signature, financial adjustment, timestamps. Each step notifies customer. |
| `03-core-business.md#T-03.08.02.01` | partial | Recorded batch work | `POST /staff/electricity/contracts/:id/adjust-price` — staff sets new price, effective date, reason. Backend: |
| `03-core-business.md#T-03.08.02.02` | done | Recorded batch work | Customer acceptance is not required, but contractual basis, reason, calculation, old/new price, and effective date must be visible to customer before the adjustment is finalized. |
| `03-core-business.md#T-03.08.02.03` | done | Recorded batch work | Requires explicit permission, step-up authentication, auditing, and mandatory customer notification. |
| `03-core-business.md#T-03.08.02.04` | done | Recorded batch work | Initially no configurable percentage cap on staff price adjustments. Non-payment follows normal invoice Overdue workflow — does not silently change historical service. |
| `03-core-business.md#T-03.09.05.01` | done | Recorded batch work | Customer cannot cancel directly. Button/link to "Request cancellation" with reason field. |
| `03-core-business.md#T-03.09.05.02` | done | Recorded batch work | Staff cancellation review UI: queue of cancellation requests with order details, customer reason |
| `03-core-business.md#T-03.09.05.03` | done | Recorded batch work | Staff API: `POST /staff/saving/orders/:id/approve-cancellation` — sets order, contract, invoice states consistently. Determines refund amount (full/partial) and destination (wallet/external). |
| `03-core-business.md#T-03.09.05.04` | done | Recorded batch work | Staff API: `POST /staff/saving/orders/:id/reject-cancellation` — with explanation. Contract unchanged. |
| `03-core-business.md#T-03.09.05.05` | done | Recorded batch work | All state transitions must be consistent across order, contract, and invoice. Records are never deleted. |
| `03-core-business.md#T-03.10.01.01` | done | Recorded batch work | Define 5 fulfillment stages: |
| `03-core-business.md#T-03.10.01.02` | done | Recorded batch work | Staff UI: order detail with stage advancement controls. Each stage advancement records previous/new state, actor, timestamp, explanation. |
| `03-core-business.md#T-03.10.01.03` | done | Recorded batch work | Customer UI: progress bar showing 5 stages, current stage highlighted, completed stages marked. |
| `03-core-business.md#T-03.10.01.04` | done | Recorded batch work | Equipment handover (stage 4) is optional by default. If performed, record handed-over item description, staff member, time. |
| `03-core-business.md#T-03.10.01.05` | done | Recorded batch work | Completed and Cancelled are terminal states. Every customer-visible status change sends notification. |
| `03-core-business.md#T-03.10.02.01` | done | Recorded batch work | Customer UI: upload documents (PDF, images, video) to saving order. Multiple files allowed. Replace/delete own files before submission. |
| `03-core-business.md#T-03.10.02.02` | done | Recorded batch work | Customer-Staff comment thread per order: chronological, author visible, staff comments trigger notification. No silent overwrites. |
| `03-core-business.md#T-03.10.02.03` | done | Recorded batch work | Document upload follows file storage rules: validation, scan, quarantine. Files linked to order are soft-delete only. |
| `03-core-business.md#T-03.10.03.01` | done | Recorded batch work | Optional inventory tracking on hardware products: `stock_count`, `reserved_count` columns. Admin-configurable per product. |
| `03-core-business.md#T-03.10.03.02` | done | Recorded batch work | When stock tracking is disabled: UI shows "availability subject to staff confirmation". |
| `03-core-business.md#T-03.10.03.03` | done | Recorded batch work | When stock tracking is enabled: submission reserves 1 unit for configurable period. Payment/staff confirmation completes allocation. Timeout/cancellation releases inventory. |
| `03-core-business.md#T-03.12.01.01` | done | Recorded batch work | Customer UI: upload documents, photos, and videos to construction request. Multiple files allowed. Guidance text is admin-editable. Display-only list of suggested/requested documents (no enforced minimum). |
| `03-core-business.md#T-03.12.01.02` | done | Recorded batch work | "I have uploaded all documents" checkbox — works even when no files uploaded. |
| `03-core-business.md#T-03.12.01.03` | done | Recorded batch work | Customer can delete or replace files even after submitting the set for review. Replacements must retain a link to the previous file and audit history (never erase). |
| `03-core-business.md#T-03.12.01.04` | done | Recorded batch work | Admin API: edit customer-facing document guidance text and maintain suggested document list. |
| `03-core-business.md#T-03.12.02.01` | done | Recorded batch work | Staff UI: document review queue — each document listed independently per request. Show file preview, uploader, timestamp, status. |
| `03-core-business.md#T-03.12.02.02` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/documents/:docId/approve` — approve individual file |
| `03-core-business.md#T-03.12.02.03` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/documents/:docId/reject` — with reason. Rejects only that file, not the entire submitted set. |
| `03-core-business.md#T-03.12.02.04` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/documents/request-additional` — request additional/replacement file with description. |
| `03-core-business.md#T-03.12.02.05` | done | Recorded batch work | When staff considers overall document set sufficient → staff advances request to postal submission stage (transition: `documents_under_review` → `waiting_for_postal_submission`). |
| `03-core-business.md#T-03.12.02.06` | done | Recorded batch work | Customer notified on each document decision (approve/reject/request). |
| `03-core-business.md#T-03.12.03.01` | done | Recorded batch work | Admin-editable postal guidance: destination address, contact details, requested original-document list. Display on postal stage page. |
| `03-core-business.md#T-03.12.03.02` | done | Recorded batch work | Customer UI: record courier name, tracking number, send date, optional receipt image upload. |
| `03-core-business.md#T-03.12.03.03` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/postal/confirm-received` — mark as `received`. |
| `03-core-business.md#T-03.12.03.04` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/postal/mark-incomplete` — with reason. Returns to `waiting_for_postal_submission` with clear instructions. Does not terminate request. |
| `03-core-business.md#T-03.12.03.05` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/postal/mark-not-received` — with reason. Returns to waiting. |
| `03-core-business.md#T-03.12.03.06` | done | Recorded batch work | Postal stage distinguishes: `waiting_for_shipment` (customer hasn't sent yet) vs `shipped` (customer sent) vs `received` (staff confirmed) vs `incomplete`/`not_received` (staff issues). |
| `03-core-business.md#T-03.13.01.01` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/final-approve` — final approval after postal receipt. No automatic side effects — just state transition to `approved`. |
| `03-core-business.md#T-03.13.01.02` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/create-contract` — authorized staff manually creates a linked contract: |
| `03-core-business.md#T-03.13.01.03` | done | Recorded batch work | Staff API: `POST /staff/solar/requests/:id/close-no-contract` — elevated permission. Requires reason. Closes request without contract. |
| `03-core-business.md#T-03.13.01.04` | done | Recorded batch work | Final approval and contract availability + invoice issuance notify customer. All decisions and transitions auditable. |
| `03-core-business.md#T-03.13.02.01` | done | Recorded batch work | Solar contracts follow the general contract lifecycle (E-04): |
| `03-core-business.md#T-03.13.02.02` | done | Recorded batch work | Customer cancellation follows the general rule: customers submit cancellation request, staff resolves. |
| `03-core-business.md#T-03.13.02.03` | done | Recorded batch work | Contract activation requires: internal approval + customer acceptance + optionally signature + optionally payment. Unmet activation requirements visible on detail page. |
| `04-invoices-wallet-contracts.md#T-04.1.01.01` | done | Earlier acceptance_verified | Define invoice DB table with columns: `id` (UUIDv7), `profileId`, `orderId?`, `contractId?`, `state`, `totalAmount` (int8), `paidAmount` (int8, default 0), `refundedAmount` (int8, default 0), `issuedAt`, `payableFrom`, `dueAt`, `cancelledAt?`, `metadata` (JSONB for snapshots), timestamps |
| `04-invoices-wallet-contracts.md#T-04.1.01.02` | done | Earlier acceptance_verified | Create `invoice_state` enum in DB matching all 9 states |
| `04-invoices-wallet-contracts.md#T-04.1.01.03` | done | Earlier acceptance_verified | Implement `InvoiceStateMachine` service with guard methods, transition validation, audit event emission |
| `04-invoices-wallet-contracts.md#T-04.1.01.04` | done | Earlier acceptance_verified | Add DB constraints: `CHECK (paidAmount <= totalAmount)`, `CHECK (refundedAmount <= paidAmount)` |
| `04-invoices-wallet-contracts.md#T-04.1.01.05` | done | Earlier acceptance_verified | Write audit repository entry for every invoice state transition |
| `04-invoices-wallet-contracts.md#T-04.1.01.06` | done | Earlier acceptance_verified | Integration tests: all happy-path transitions, every forbidden transition, concurrent state change rejection |
| `04-invoices-wallet-contracts.md#T-04.1.02.01` | done | Earlier acceptance_verified | Create `invoice_lines` and `invoice_items` tables with proper foreign keys and constraints |
| `04-invoices-wallet-contracts.md#T-04.1.02.02` | done | Earlier acceptance_verified | Build `ManualInvoiceService` — staff selects profile, adds lines, system calculates totals, issues invoice |
| `04-invoices-wallet-contracts.md#T-04.1.02.03` | partial | Earlier partial | Build `AutoInvoiceService` — called by order/contract creation within same transaction; snapshot prices and terms |
| `04-invoices-wallet-contracts.md#T-04.1.02.04` | done | Earlier acceptance_verified | Implement VAT calculation module with category default / product override resolution |
| `04-invoices-wallet-contracts.md#T-04.1.02.05` | done | Earlier partial | Link invoice to origin: nullable `orderId`, `contractId`, `consultationId` foreign keys |
| `04-invoices-wallet-contracts.md#T-04.1.02.06` | done | Earlier acceptance_verified | Ensure idempotency: same order cannot produce duplicate invoices (unique `orderId` + `type` index) |
| `04-invoices-wallet-contracts.md#T-04.1.02.07` | done | Earlier acceptance_verified | Implement `RoundingService.roundHalfUp(value: bigint, precision: number)` using half-up rounding rule (round half-up to nearest IRR); add table-driven unit tests with financial examples from product requirements |
| `04-invoices-wallet-contracts.md#T-04.1.02.08` | done | Earlier acceptance_verified | Add `invoice_calculation_snapshot` JSONB column on invoices storing all calculation inputs, intermediate rounding steps, and final totals for reproducibility |
| `04-invoices-wallet-contracts.md#T-04.1.02.09` | done | Earlier acceptance_verified | Verify reproducibility: integration test that replays invoice calculation inputs from snapshot and asserts same totals |
| `04-invoices-wallet-contracts.md#T-04.1.03.01` | done | Earlier acceptance_verified | Add `service_due_periods` admin config table (service type, default days, active period) |
| `04-invoices-wallet-contracts.md#T-04.1.03.02` | done | Earlier acceptance_verified | Add `dueAt` calculation logic: `issuedAt + config_days` (or staff override) |
| `04-invoices-wallet-contracts.md#T-04.1.03.03` | done | Earlier acceptance_verified | Build staff override UI/API: override input + reason field, stored in audit + invoice metadata |
| `04-invoices-wallet-contracts.md#T-04.1.03.04` | done | Earlier acceptance_verified | Cron job: mark invoices past `dueAt` as Overdue if still Unpaid or Partially funded |
| `04-invoices-wallet-contracts.md#T-04.1.04.01` | done | Earlier acceptance_verified | Design `invoice_reminder_schedule` table: `invoiceId`, `offset`, `channel`, `scheduledAt`, `sentAt?`, `status` |
| `04-invoices-wallet-contracts.md#T-04.1.04.02` | done | Earlier acceptance_verified | Build `ReminderScheduler` worker: on invoice issue, compute reminder datetimes and insert schedule rows |
| `04-invoices-wallet-contracts.md#T-04.1.04.03` | done | Earlier acceptance_verified | Build `ReminderSender` worker: cron every hour picks due reminders, checks invoice state, sends via outbox |
| `04-invoices-wallet-contracts.md#T-04.1.04.04` | done | Earlier acceptance_verified | Enforce idempotency: unique index on (invoiceId, offset, channel) |
| `04-invoices-wallet-contracts.md#T-04.1.04.05` | done | Earlier acceptance_verified | Admin toggle UI: enable/disable each offset per service type |
| `04-invoices-wallet-contracts.md#T-04.1.04.06` | done | Earlier acceptance_verified | Stop reminders: when invoice enters Paid/Cancelled/Refunded, mark all future schedule rows as Cancelled |
| `04-invoices-wallet-contracts.md#T-04.1.05.01` | done | Earlier acceptance_verified | Add `replacesInvoiceId` and `adjustmentForInvoiceId` nullable self-references on invoice table |
| `04-invoices-wallet-contracts.md#T-04.1.05.02` | done | Earlier acceptance_verified | Build `cancelAndReplaceInvoice(invoiceId, reason, newLines)` — validates no payment, cancels, creates linked replacement |
| `04-invoices-wallet-contracts.md#T-04.1.05.03` | done | Earlier acceptance_verified | Build `createAdjustmentInvoice(originalInvoiceId, amount, reason)` — positive = additional charge, negative = credit |
| `04-invoices-wallet-contracts.md#T-04.1.05.04` | done | Earlier acceptance_verified | Customer-facing invoice details page shows original + linked corrections/replacements with explanations |
| `04-invoices-wallet-contracts.md#T-04.2.01.01` | done | Earlier acceptance_verified | Create `wallets` table: `profileId` (PK, FK), `postedBalance` (int8, default 0), `reservedBalance` (int8, default 0), `version` (int, optimistic lock), `updatedAt`. `availableBalance` is NOT stored — it is derived at query time as `postedBalance - reservedBalance` |
| `04-invoices-wallet-contracts.md#T-04.2.01.02` | done | Earlier acceptance_verified | Create `wallet_transactions` table: `id` (UUIDv7), `walletId`, `type` (enum: topup, payment, refund, reservation, release, reversal, compensating), `amount` (int8, positive for credit, negative for debit), `state` (Pending, Reserved, Completed, Failed, Rejected, Released, Reversed), `idempotencyKey` (unique), `refId?`, `description?`, `metadata` (JSONB), timestamps |
| `04-invoices-wallet-contracts.md#T-04.2.01.03` | done | Earlier acceptance_verified | Implement `WalletService.credit(walletId, amount, ref, idempotencyKey)` — inserts ledger row, updates postedBalance with `WHERE version = X AND postedBalance >= 0` |
| `04-invoices-wallet-contracts.md#T-04.2.01.04` | done | Earlier acceptance_verified | Implement `WalletService.debit(walletId, amount, ref, idempotencyKey)` — checks availableBalance >= amount, atomically reserves then completes |
| `04-invoices-wallet-contracts.md#T-04.2.01.05` | done | Earlier acceptance_verified | Implement `WalletService.reserve(walletId, amount)` and `release(reservationId)` for payment flow |
| `04-invoices-wallet-contracts.md#T-04.2.01.06` | done | Earlier acceptance_verified | Implement optimistic locking: `UPDATE wallets SET postedBalance = postedBalance + delta, version = version + 1 WHERE id = X AND version = expectedVersion` |
| `04-invoices-wallet-contracts.md#T-04.2.01.07` | done | Earlier acceptance_verified | Add DB constraint: `CHECK ((postedBalance - reservedBalance) >= 0)` via generated column or trigger — enforces nonnegative available balance on the derived value, NOT a stored column |
| `04-invoices-wallet-contracts.md#T-04.2.01.08` | done | Earlier acceptance_verified | Scheduled reconciliation worker: compare ledger sum vs wallet balance, report mismatch to finance queue |
| `04-invoices-wallet-contracts.md#T-04.2.02.01` | done | Earlier acceptance_verified | Build online top-up initiation: validate limit, create Pending transaction, redirect to gateway |
| `04-invoices-wallet-contracts.md#T-04.2.02.02` | partial | Earlier partial | Build provider callback handler: verify signature, replay window, event id, merchant context; apply credit via `WalletService.credit()` with idempotency key |
| `04-invoices-wallet-contracts.md#T-04.2.02.03` | done | Earlier acceptance_verified | Build bank receipt top-up flow: customer uploads receipt → wallet transaction in Pending state |
| `04-invoices-wallet-contracts.md#T-04.2.02.04` | done | Earlier acceptance_verified | Staff confirmation UI: review receipt, confirm or reject with reason; on confirm → `WalletService.credit()` |
| `04-invoices-wallet-contracts.md#T-04.2.02.05` | done | Earlier acceptance_verified | Overpayment handling: if receipt amount > invoice remaining, credit excess to wallet |
| `04-invoices-wallet-contracts.md#T-04.2.02.06` | done | Earlier acceptance_verified | Admin-configurable `onlineTopUpLimit` with versioned config, enforced at submission |
| `04-invoices-wallet-contracts.md#T-04.2.02.07` | done | Earlier acceptance_verified | Expiry cron: auto-reject online top-ups stuck in Pending beyond TTL |
| `04-invoices-wallet-contracts.md#T-04.2.03.01` | done | Earlier acceptance_verified | Implement `payInvoiceWithWallet(invoiceId, profileId, idempotencyKey)` service method |
| `04-invoices-wallet-contracts.md#T-04.2.03.02` | done | Earlier acceptance_verified | Use DB transaction: `SELECT ... FOR UPDATE` on wallet and invoice, validate available balance, debit wallet, update invoice → Paid, insert wallet_transaction + audit |
| `04-invoices-wallet-contracts.md#T-04.2.03.03` | done | Earlier acceptance_verified | Implement idempotency: unique index on `(idempotencyKey, entityType)`, return cached result on retry |
| `04-invoices-wallet-contracts.md#T-04.2.03.04` | done | Earlier acceptance_verified | Integration tests: concurrent payment attempts (one succeeds, others fail), duplicate idempotency key, insufficient balance, race conditions |
| `04-invoices-wallet-contracts.md#T-04.2.04.01` | done | Earlier acceptance_verified | Implement `reverseTransaction(originalTransactionId, reason, idempotencyKey)` — creates reversal transaction, adjusts balance |
| `04-invoices-wallet-contracts.md#T-04.2.04.02` | partial | Earlier partial | Build provider chargeback detection: parse inbound notification, validate signature, map to original top-up |
| `04-invoices-wallet-contracts.md#T-04.2.04.03` | done | Earlier acceptance_verified | Finance alert: push notification + dashboard warning for unresolved chargeback |
| `04-invoices-wallet-contracts.md#T-04.3.01.01` | done | Earlier acceptance_verified | Create `bank_receipts` table: `id`, `invoiceId`, `profileId`, `amount`, `paymentDate`, `payerReference`, `attachmentKey`, `customerNote`, `state`, `confirmedBy?`, `confirmedAt?`, `rejectionReason?`, timestamps |
| `04-invoices-wallet-contracts.md#T-04.3.01.02` | done | Earlier acceptance_verified | Customer upload flow: validation (amount positive, file type/size), create receipt in Submitted state |
| `04-invoices-wallet-contracts.md#T-04.3.01.03` | done | Earlier acceptance_verified | Staff confirmation API: validate amount ≤ invoice remaining; if excess → auto-credit wallet; update invoice state; mark receipt Confirmed |
| `04-invoices-wallet-contracts.md#T-04.3.01.04` | done | Earlier acceptance_verified | Staff rejection API: mark receipt Rejected, store reason, notify customer |
| `04-invoices-wallet-contracts.md#T-04.3.01.05` | done | Earlier acceptance_verified | Dual-approval check: if receipt amount ≥ admin-configured threshold, require second finance staff confirmation |
| `04-invoices-wallet-contracts.md#T-04.3.01.06` | done | Recorded batch work | Overpayment wallet credit: separate `WalletService.credit()` with its own idempotency key |
| `04-invoices-wallet-contracts.md#T-04.3.01.07` | done | Recorded batch work | Update invoice state tracking: as bank receipts accumulate, invoice state flows Unpaid → Partially funded → Paid |
| `04-invoices-wallet-contracts.md#T-04.3.02.01` | done | Recorded batch work | Invoice detail API: aggregate invoice, lines, payments, bank receipts, refunds, adjustments |
| `04-invoices-wallet-contracts.md#T-04.3.02.02` | done | Recorded batch work | Wallet transaction list API: cursor-based pagination, filters (type, state, date range), sort |
| `04-invoices-wallet-contracts.md#T-04.3.02.03` | done | Recorded batch work | React components: InvoiceDetail, WalletTransactionList, BankReceiptList with full states |
| `04-invoices-wallet-contracts.md#T-04.3.02.04` | done | Recorded batch work | Localized state labels and descriptive text for every state |
| `04-invoices-wallet-contracts.md#T-04.4.01.01` | done | Recorded batch work | Create `refunds` table: `id`, `invoiceId`, `profileId`, `amount`, `state`, `destination` (wallet |
| `04-invoices-wallet-contracts.md#T-04.4.01.02` | done | Recorded batch work | Implement `RefundStateMachine` with all 9 transitions, guards, and audit events |
| `04-invoices-wallet-contracts.md#T-04.4.01.03` | partial | Recorded batch work | DB constraint: `CHECK (amount <= (SELECT paidAmount - refundedAmount FROM invoices WHERE id = invoiceId))` |
| `04-invoices-wallet-contracts.md#T-04.4.01.04` | partial | Recorded batch work | Wallet refund: `WalletService.credit()` with idempotency key tied to refund ID |
| `04-invoices-wallet-contracts.md#T-04.4.01.05` | done | Recorded batch work | External refund: workflow for staff to record bank reference; second reconciliation confirmation step |
| `04-invoices-wallet-contracts.md#T-04.4.01.06` | done | Recorded batch work | Dual-approval integration: if refund amount ≥ threshold, require second finance staff before Approved |
| `04-invoices-wallet-contracts.md#T-04.4.01.07` | done | Recorded batch work | Retry worker: pick up Failed refunds with bounded backoff; alert if max attempts exceeded |
| `04-invoices-wallet-contracts.md#T-04.4.02.01` | done | Recorded batch work | Build `AutomaticRefundObligation` trigger: on contract → Rejected/Cancelled, if paid amount > 0, create refund with state Requested, destination = wallet |
| `04-invoices-wallet-contracts.md#T-04.4.02.02` | partial | Recorded batch work | Worker: pick up auto-refund obligations, execute `WalletService.credit()`, mark refund Completed |
| `04-invoices-wallet-contracts.md#T-04.4.02.03` | done | Recorded batch work | Block contract/order financial closure until linked refund obligations are Completed |
| `04-invoices-wallet-contracts.md#T-04.4.02.04` | done | Recorded batch work | Finance queue: show failed auto-refund obligations with Retry action |
| `04-invoices-wallet-contracts.md#T-04.4.02.05` | done | Recorded batch work | Notify customer on completion and on failure (with support path) |
| `04-invoices-wallet-contracts.md#T-04.5.01.01` | done | Recorded batch work | Create `contracts` table: `id` (UUIDv7), `profileId`, `orderId?`, `serviceType` (enum), `state`, `currentVersionId`, `submittedAt`, `acceptedAt?`, `signedAt?`, `activatedAt?`, `completedAt?`, `cancelledAt?`, timestamps |
| `04-invoices-wallet-contracts.md#T-04.5.01.02` | done | Recorded batch work | Create `contract_versions` table: `id`, `contractId`, `versionNumber`, `content` (JSONB — full snapshot), `changeDescription`, `createdBy`, `createdAt`, `acceptedAt?` |
| `04-invoices-wallet-contracts.md#T-04.5.01.03` | done | Recorded batch work | Implement `ContractStateMachine` with all transitions, guards, prerequisites, audit events |
| `04-invoices-wallet-contracts.md#T-04.5.01.04` | done | Recorded batch work | Activation prerequisite checker: evaluate all requirements, surface unmet ones |
| `04-invoices-wallet-contracts.md#T-04.5.01.05` | done | Recorded batch work | Staff cancellation endpoint: requires reason + refund decision + step-up auth |
| `04-invoices-wallet-contracts.md#T-04.5.01.06` | done | Recorded batch work | Customer cancellation request: creates staff review task, cannot cancel directly |
| `04-invoices-wallet-contracts.md#T-04.5.01.07` | done | Recorded batch work | DB constraints: terminal states cannot transition; version must increment on material edit |
| `04-invoices-wallet-contracts.md#T-04.5.02.01` | done | Recorded batch work | Enforce version increment in `ContractService.updateContract()` — inserts new version, never edits existing |
| `04-invoices-wallet-contracts.md#T-04.5.02.02` | done | Recorded batch work | API: GET contract versions list with metadata; GET specific version full content |
| `04-invoices-wallet-contracts.md#T-04.5.02.03` | done | Recorded batch work | UI: version timeline showing who changed what and when; "View previous version" |
| `04-invoices-wallet-contracts.md#T-04.5.02.04` | done | Recorded batch work | Support amendment workflow: create amendment version, new acceptance cycle, link to original |
| `04-invoices-wallet-contracts.md#T-04.5.03.01` | done | Recorded batch work | Add `serviceType` to contracts table; per-type activation rule configuration in admin |
| `04-invoices-wallet-contracts.md#T-04.5.03.02` | done | Recorded batch work | Build `ActivationRuleResolver` — given a contract, check which prerequisites are met, return unmet list |
| `04-invoices-wallet-contracts.md#T-04.5.03.03` | done | Recorded batch work | UI: contract detail page shows each prerequisite (Staff approval, Customer acceptance, Signature, Payment, Service start) with current state |
| `04-invoices-wallet-contracts.md#T-04.5.04.01` | done | Recorded batch work | Create `contract_documents` link table: `contractVersionId`, `documentId`, `role` (original, signed, amendment, superseded) |
| `04-invoices-wallet-contracts.md#T-04.5.04.02` | done | Recorded batch work | Document state machine integration: wire contract documents into E-05's state machine (`T-05.11.01`); contract-specific guards (e.g., signed contracts cannot be replaced) enforced via policy on top of the base lifecycle |
| `04-invoices-wallet-contracts.md#T-04.5.04.03` | done | Recorded batch work | Replacement rule: new document linked to superseded doc; rejection requires reason + Replace action |
| `04-invoices-wallet-contracts.md#T-04.5.04.04` | done | Recorded batch work | Immutable signed docs: once Signed state reached, no replacement; new version for amendments |
| `04-invoices-wallet-contracts.md#T-04.5.04.05` | done | Recorded batch work | UI: contract detail shows all linked docs with states and version history |
| `04-invoices-wallet-contracts.md#T-04.6.01.01` | partial | Recorded batch work | Build customer quantity increase request UI/API: validate against max increase percentage, check one-per-contract limit |
| `04-invoices-wallet-contracts.md#T-04.6.01.02` | partial | Recorded batch work | Staff review queue: approve/reject with reason |
| `04-invoices-wallet-contracts.md#T-04.6.01.03` | partial | Recorded batch work | On approval: create amendment document version, trigger customer signature workflow |
| `04-invoices-wallet-contracts.md#T-04.6.01.04` | partial | Recorded batch work | After signature: calculate incremental amount (price snapshot), create adjustment invoice or refund |
| `04-invoices-wallet-contracts.md#T-04.6.01.05` | done | Recorded batch work | Enforce effective period: increase applies only to future periods |
| `04-invoices-wallet-contracts.md#T-04.6.01.06` | partial | Recorded batch work | Admin config for max increase percentage per service type |
| `04-invoices-wallet-contracts.md#T-04.6.02.01` | done | Recorded batch work | Build staff price adjustment UI: input percentage, effective date, reason, contractual basis |
| `04-invoices-wallet-contracts.md#T-04.6.02.02` | done | Recorded batch work | Validate: effective date not in past; never changes past/paid periods |
| `04-invoices-wallet-contracts.md#T-04.6.02.03` | done | Recorded batch work | Calculate adjustment: for each future period affected, compute net increase, create adjustment invoice |
| `04-invoices-wallet-contracts.md#T-04.6.02.04` | done | Recorded batch work | Step-up auth + audit: mandatory for this action |
| `04-invoices-wallet-contracts.md#T-04.6.02.05` | done | Recorded batch work | Notify customer: full disclosure of old/new price, calculation, effective date before invoice is issued |
| `04-invoices-wallet-contracts.md#T-04.6.02.06` | done | Recorded batch work | Decrease → refund/credit workflow (refund or wallet credit) |
| `05-notifications-documents-ai.md#T-05.11.01` | done | Recorded batch work | Document state machine |

## v0.4.0: Documents, notifications and AI

Documents are safely uploaded, reviewed and retained; notifications and configured AI work end to end without cross-profile disclosure.

| Qualified task | State | Build evidence | Required work |
| --- | --- | --- | --- |
| `release-readiness#R-03.01` | done | Recorded batch work | Renew document, notification and AI acceptance |
| `release-readiness#R-03.02` | partial | Recorded batch work | Verify live staging provider and storage boundaries |
| `02-auth-users-admin.md#T-09.04.01` | done | Earlier acceptance_verified | Notification template editor |
| `02-auth-users-admin.md#T-09.06.01` | done | Earlier acceptance_verified | Email transport configuration |
| `02-auth-users-admin.md#T-09.06.02` | done | Earlier acceptance_verified | SMS.ir configuration |
| `02-auth-users-admin.md#T-09.06.03` | done | Earlier acceptance_verified | Notification daytime window configuration |
| `02-auth-users-admin.md#T-09.11.01` | done | Earlier acceptance_verified | AI model management |
| `02-auth-users-admin.md#T-09.11.02` | done | Earlier partial | Knowledge base management |
| `02-auth-users-admin.md#T-09.11.03` | done | Earlier acceptance_verified | Policy management |
| `02-auth-users-admin.md#T-09.11.04` | done | Earlier partial | AI agent management |
| `02-auth-users-admin.md#T-09.11.05` | partial | Earlier partial | Agent slot assignment |
| `05-notifications-documents-ai.md#T-05.01.01` | done | Earlier acceptance_verified | Notification module scaffold |
| `05-notifications-documents-ai.md#T-05.01.02` | partial | Earlier acceptance_verified | Durable outbox table & write pipeline |
| `05-notifications-documents-ai.md#T-05.01.03` | done | Earlier acceptance_verified | Job queue with retry schedule |
| `05-notifications-documents-ai.md#T-05.01.04` | partial | Earlier partial | Idempotency for delivery |
| `05-notifications-documents-ai.md#T-05.01.05` | done | Earlier acceptance_verified | Status tracking & delivery logs |
| `05-notifications-documents-ai.md#T-05.01.06` | partial | Earlier partial | Dead-letter queue & admin UI |
| `05-notifications-documents-ai.md#T-05.01.07` | done | Earlier acceptance_verified | Metrics & observability |
| `05-notifications-documents-ai.md#T-05.02.01` | done | Earlier acceptance_verified | Notification entity & in-app transport |
| `05-notifications-documents-ai.md#T-05.02.02` | done | Earlier acceptance_verified | Notification center API |
| `05-notifications-documents-ai.md#T-05.02.03` | done | Earlier acceptance_verified | Notification center UI |
| `05-notifications-documents-ai.md#T-05.02.04` | done | Earlier acceptance_verified | New-notification polling / SSE |
| `05-notifications-documents-ai.md#T-05.03.01` | done | Earlier acceptance_verified | Notification type registry & classification |
| `05-notifications-documents-ai.md#T-05.03.02` | done | Earlier acceptance_verified | Delivery window logic |
| `05-notifications-documents-ai.md#T-05.03.03` | done | Earlier acceptance_verified | Admin delivery-window configuration UI |
| `05-notifications-documents-ai.md#T-05.04.01` | done | Earlier acceptance_verified | Template entity & CRUD API |
| `05-notifications-documents-ai.md#T-05.04.02` | done | Earlier acceptance_verified | Variable interpolation & escaping |
| `05-notifications-documents-ai.md#T-05.04.03` | done | Earlier acceptance_verified | Template preview |
| `05-notifications-documents-ai.md#T-05.04.04` | done | Earlier acceptance_verified | Test-send |
| `05-notifications-documents-ai.md#T-05.04.05` | done | Earlier acceptance_verified | Template seeding |
| `05-notifications-documents-ai.md#T-05.05.01` | done | Earlier acceptance_verified | Notification category model |
| `05-notifications-documents-ai.md#T-05.05.02` | done | Earlier acceptance_verified | Channel availability rules |
| `05-notifications-documents-ai.md#T-05.05.03` | done | Earlier acceptance_verified | Consent UI in profile settings |
| `05-notifications-documents-ai.md#T-05.06.01` | done | Earlier acceptance_verified | Provider config entity & lifecycle |
| `05-notifications-documents-ai.md#T-05.06.02` | done | Earlier acceptance_verified | SMTP configuration |
| `05-notifications-documents-ai.md#T-05.06.03` | done | Earlier acceptance_verified | Resend configuration |
| `05-notifications-documents-ai.md#T-05.06.04` | done | Earlier acceptance_verified | Provider admin UI |
| `05-notifications-documents-ai.md#T-05.06.05` | done | Earlier acceptance_verified | Secrets encryption & masking |
| `05-notifications-documents-ai.md#T-05.06.06` | partial | Earlier partial | Circuit breaker for email |
| `05-notifications-documents-ai.md#T-05.06.07` | done | Earlier acceptance_verified | Email delivery callback handling |
| `05-notifications-documents-ai.md#T-05.07.01` | partial | Recorded batch work | SMS.ir config entity |
| `05-notifications-documents-ai.md#T-05.07.02` | partial | Recorded batch work | Template mapping |
| `05-notifications-documents-ai.md#T-05.07.03` | done | Recorded batch work | SMS.ir adapter |
| `05-notifications-documents-ai.md#T-05.07.04` | partial | Recorded batch work | Credit monitoring |
| `05-notifications-documents-ai.md#T-05.07.05` | partial | Recorded batch work | SMS.ir admin UI |
| `05-notifications-documents-ai.md#T-05.08.01` | done | Recorded batch work | Error classification utility |
| `05-notifications-documents-ai.md#T-05.08.02` | partial | Recorded batch work | Circuit breaker implementation |
| `05-notifications-documents-ai.md#T-05.08.03` | done | Recorded batch work | Provider health dashboard |
| `05-notifications-documents-ai.md#T-05.08.04` | done | Recorded batch work | Provider runbook documentation |
| `05-notifications-documents-ai.md#T-05.08.05` | done | Recorded batch work | Provider test fakes & contract tests |
| `05-notifications-documents-ai.md#T-05.09.01` | done | Recorded batch work | File storage abstraction interface |
| `05-notifications-documents-ai.md#T-05.09.02` | done | Recorded batch work | S3 adapter |
| `05-notifications-documents-ai.md#T-05.09.03` | partial | Recorded batch work | Storage config entity & admin UI |
| `05-notifications-documents-ai.md#T-05.09.04` | done | Recorded batch work | Preview derivative generation |
| `05-notifications-documents-ai.md#T-05.10.01` | done | Recorded batch work | Document template entity |
| `05-notifications-documents-ai.md#T-05.10.02` | done | Recorded batch work | Template file upload & placeholder extraction |
| `05-notifications-documents-ai.md#T-05.10.03` | done | Recorded batch work | Template admin UI |
| `05-notifications-documents-ai.md#T-05.10.04` | done | Recorded batch work | Placeholder re-extraction on file changes |
| `05-notifications-documents-ai.md#T-05.10.05` | done | Recorded batch work | Placeholder conflict detection & validation |
| `05-notifications-documents-ai.md#T-05.11.02` | done | Recorded batch work | Upload pipeline |
| `05-notifications-documents-ai.md#T-05.11.03` | done | Recorded batch work | Document scanning integration |
| `05-notifications-documents-ai.md#T-05.11.04` | done | Recorded batch work | Document review workflow |
| `05-notifications-documents-ai.md#T-05.11.05` | done | Recorded batch work | Document supersession & immutability |
| `05-notifications-documents-ai.md#T-05.11.06` | done | Recorded batch work | Soft delete & hard delete |
| `05-notifications-documents-ai.md#T-05.11.07` | done | Recorded batch work | Document admin/staff UI |
| `05-notifications-documents-ai.md#T-05.12.01` | done | Recorded batch work | File validation service |
| `05-notifications-documents-ai.md#T-05.12.02` | done | Recorded batch work | Category & limit configuration |
| `05-notifications-documents-ai.md#T-05.12.03` | done | Recorded batch work | Rejection handling |
| `05-notifications-documents-ai.md#T-05.13.01` | done | Recorded batch work | Signed URL generation API |
| `05-notifications-documents-ai.md#T-05.13.02` | done | Recorded batch work | Access control middleware |
| `05-notifications-documents-ai.md#T-05.13.03` | done | Recorded batch work | Download access logging |
| `05-notifications-documents-ai.md#T-05.13.04` | done | Recorded batch work | Safe preview derivative endpoint |
| `05-notifications-documents-ai.md#T-05.14.01` | done | Recorded batch work | Retention policy configuration |
| `05-notifications-documents-ai.md#T-05.14.02` | done | Recorded batch work | Legal hold |
| `05-notifications-documents-ai.md#T-05.14.03` | partial | Recorded batch work | Destruction job |
| `05-notifications-documents-ai.md#T-05.15.01` | done | Recorded batch work | Multipart upload API |
| `05-notifications-documents-ai.md#T-05.15.02` | done | Recorded batch work | Orphan detection & cleanup |
| `05-notifications-documents-ai.md#T-05.16.01` | done | Recorded batch work | AI model entity & CRUD |
| `05-notifications-documents-ai.md#T-05.16.02` | done | Recorded batch work | AI model test |
| `05-notifications-documents-ai.md#T-05.16.03` | done | Recorded batch work | Model admin UI |
| `05-notifications-documents-ai.md#T-05.16.04` | done | Recorded batch work | AI model circuit breaker integration |
| `05-notifications-documents-ai.md#T-05.17.01` | done | Recorded batch work | Knowledge base entity & CRUD |
| `05-notifications-documents-ai.md#T-05.17.02` | done | Recorded batch work | KB processing pipeline |
| `05-notifications-documents-ai.md#T-05.17.03` | done | Recorded batch work | KB Groups |
| `05-notifications-documents-ai.md#T-05.17.04` | done | Recorded batch work | KB test query |
| `05-notifications-documents-ai.md#T-05.18.01` | done | Recorded batch work | Policy entity & CRUD |
| `05-notifications-documents-ai.md#T-05.18.02` | done | Recorded batch work | Policy Groups |
| `05-notifications-documents-ai.md#T-05.18.03` | done | Recorded batch work | Policy evaluation engine |
| `05-notifications-documents-ai.md#T-05.19.01` | done | Recorded batch work | Agent entity & CRUD |
| `05-notifications-documents-ai.md#T-05.19.02` | done | Recorded batch work | Agent CRUD API |
| `05-notifications-documents-ai.md#T-05.19.03` | done | Recorded batch work | Agent admin UI |
| `05-notifications-documents-ai.md#T-05.20.01` | done | Recorded batch work | Agent slot entity & configuration |
| `05-notifications-documents-ai.md#T-05.20.02` | done | Recorded batch work | Slot assignment admin UI |
| `05-notifications-documents-ai.md#T-05.21.01` | done | Recorded batch work | Test chat API |
| `05-notifications-documents-ai.md#T-05.21.02` | done | Recorded batch work | Test chat UI |
| `05-notifications-documents-ai.md#T-05.21.03` | done | Recorded batch work | Rate limiting for test |
| `05-notifications-documents-ai.md#T-05.22.01` | done | Recorded batch work | AuthZ for AI actions |
| `05-notifications-documents-ai.md#T-05.22.02` | superseded | Recorded batch work | Trusted-UI confirmation for writes |
| `05-notifications-documents-ai.md#T-05.22.03` | done | Recorded batch work | AI audit logging |
| `05-notifications-documents-ai.md#T-05.22.04` | partial | Recorded batch work | Data isolation per slot |
| `05-notifications-documents-ai.md#T-05.22.05` | done | Recorded batch work | Sensitive value redaction |
| `05-notifications-documents-ai.md#T-05.22.06` | done | Recorded batch work | Source attribution in answers |
| `05-notifications-documents-ai.md#T-05.23.01` | done | Recorded batch work | AI worker process isolation |
| `05-notifications-documents-ai.md#T-05.23.02` | done | Recorded batch work | Per-model token/cost budget |
| `05-notifications-documents-ai.md#T-05.23.03` | done | Recorded batch work | AI request queue & concurrency limit |
| `05-notifications-documents-ai.md#T-05.23.04` | done | Recorded batch work | Health endpoint isolation |
| `05-notifications-documents-ai.md#T-05.24.01` | done | Recorded batch work | Jobs table & entity |
| `05-notifications-documents-ai.md#T-05.24.02` | done | Recorded batch work | JobService submit & process |
| `05-notifications-documents-ai.md#T-05.24.03` | done | Recorded batch work | Job status & result API |
| `05-notifications-documents-ai.md#T-05.24.04` | done | Recorded batch work | JobProgress UI component |

## v0.5.0: Usable and accessible product

Customer and admin workflows work on desktop/mobile in both languages and themes, including keyboard use, errors, filters and safe confirmations.

| Qualified task | State | Build evidence | Required work |
| --- | --- | --- | --- |
| `release-readiness#R-04.01` | todo | Inventory needed | Verify full customer and admin UI adoption |
| `release-readiness#R-04.02` | todo | Inventory needed | Renew accessibility and performance evidence |
| `02-auth-users-admin.md#T-09.01.01` | partial | Earlier partial | Branding settings page |
| `02-auth-users-admin.md#T-09.01.02` | verify | Earlier acceptance_verified | Theme application |
| `07-ui-ux-design.md#T-07.01.01.01` | done | Earlier acceptance_verified | Initialize `packages/ui` with Tailwind CSS v4, PostCSS, autoprefixer. Configure `tailwind.config.ts` with extended color palette, font families (Vazirmatn for Persian, Inter for English), border-radius, spacing scale, and animation tokens. |
| `07-ui-ux-design.md#T-07.01.01.02` | partial | Earlier partial | Install and configure shadcn/ui CLI: set `style: "new-york"`, `baseColor: "zinc"`, `cssVariables: true`. Generate initial component set: Button, Input, Label, Card, Badge, Dialog, DropdownMenu, Select, Separator, Sheet, Skeleton, Toast, Tooltip, Tabs, Avatar, Popover, Command, Switch, Progress, Slider, Textarea, Alert, Breadcrumb, ScrollArea, Calendar, Checkbox, RadioGroup, Sonner (toaster). |
| `07-ui-ux-design.md#T-07.01.01.03` | partial | Earlier partial | Install and configure Base UI (by MUI — `@mui/base` / `@mui/base-ui`) for complex patterns: NumberField (with locale-aware formatting), DatePicker/DateRangePicker (with Jalali support), ComboBox (with search + keyboard nav), Select (with multi-select + chips), Table (sortable, selectable rows via useTable). |
| `07-ui-ux-design.md#T-07.01.01.04` | done | Recorded batch work | Configure `cva` (class-variance-authority) or `tailwind-variants` for all components: define `buttonVariants`, `inputVariants`, `cardVariants`, `badgeVariants` as exportable variant objects. |
| `07-ui-ux-design.md#T-07.01.01.05` | partial | Recorded batch work | Set up Storybook or Ladle in `packages/ui` for visual component documentation. Add stories for each component showing all variants, RTL mode, dark mode, and interactive states. |
| `07-ui-ux-design.md#T-07.01.01.06` | done | Recorded batch work | Create a `packages/ui/src/index.ts` barrel export. Verify tree-shaking: importing only Button should not pull in Dialog or DatePicker. |
| `07-ui-ux-design.md#T-07.01.01.07` | partial | Recorded batch work | Verify all shadcn/ui components render correctly in RTL mode. Patch any component that uses hardcoded `left`/`right` margins or assumes LTR direction. |
| `07-ui-ux-design.md#T-07.01.01.08` | partial | Recorded batch work | Verify all Base UI components respect the theme's CSS custom properties and dark mode. Fix any hardcoded colors in vendor components. |
| `07-ui-ux-design.md#T-07.01.02.01` | partial | Recorded batch work | Button — variants: `default` (primary brand), `secondary`, `destructive` (danger red), `outline`, `ghost`, `link`. Sizes: `xs`, `sm`, `default`, `lg`, `xl` (full-width responsive). States: loading (spinner icon + disabled), disabled (reduced opacity + no events), active (press animation). Support `asChild` from Radix for polymorphic rendering (buttons as anchors or router Links). |
| `07-ui-ux-design.md#T-07.01.02.02` | done | Recorded batch work | Input — variants: `default`, `error` (red border + error icon), `success` (green check). Sizes matching Button. States: disabled, read-only, focused (ring). Supporting elements: leading icon slot, trailing icon slot (for password visibility toggle, clear button), helper text below, error message below. Prefix/suffix text (e.g. IRR currency prefix, kWh suffix). |
| `07-ui-ux-design.md#T-07.01.02.03` | done | Recorded batch work | Label — association with input via `htmlFor`. Required indicator (red asterisk). Optional muted text. Disabled label styling when associated input is disabled. |
| `07-ui-ux-design.md#T-07.01.02.04` | done | Recorded batch work | Card — variants: `default` (bordered, shadow-sm), `interactive` (hover elevation + cursor-pointer), `flat` (no border, subtle bg), `widget` (dashboard card with icon header). Subcomponents: CardHeader, CardTitle, CardDescription, CardContent, CardFooter. |
| `07-ui-ux-design.md#T-07.01.02.05` | done | Recorded batch work | Badge — variants: `default` (neutral), `secondary`, `destructive`, `outline`, `success` (green), `warning` (amber), `info` (blue), `purple` (premium). Sizes: `sm`, `default`, `lg`. Dot mode (colored dot without text background). Used for status indicators throughout the app. |
| `07-ui-ux-design.md#T-07.01.03.01` | done | Recorded batch work | Dialog/Modal — sizes: `sm`, `default`, `lg`, `xl`, `fullscreen`. Props: open/close, onOpenChange, preventCloseOnOverlayClick (for forms), closeButton (optional). Portal rendering, focus trap, Escape to close, aria-labelledby/describedby. Animation: scale + fade on open/close. |
| `07-ui-ux-design.md#T-07.01.03.02` | done | Recorded batch work | Sheet (Drawer) — side: `left` (sidebar mobile menu), `right` (notification panel, details panel), `top`, `bottom` (mobile action sheet). Sizes proportional to viewport. Backdrop blur option. |
| `07-ui-ux-design.md#T-07.01.03.03` | done | Recorded batch work | DropdownMenu — nested submenus, checkbox items, radio items, separator, disabled items, shortcut labels. Used in table row actions, user menu, overflow menus. |
| `07-ui-ux-design.md#T-07.01.03.04` | done | Recorded batch work | Popover — controlled/uncontrolled, placement (top/bottom/left/right + align start/center/end), offset, arrow. Used for date picker popups, filter dropdowns, info tooltips (rich content). |
| `07-ui-ux-design.md#T-07.01.03.05` | partial | Recorded batch work | Tooltip — delay show/hide, placement, rich content (HTML, links), disabled trigger handling. |
| `07-ui-ux-design.md#T-07.01.03.06` | done | Recorded batch work | Select (native & custom) — native `<select>` fallback for mobile. Custom Select with search/filter, grouped options, multi-select with chips/tags, clearable. |
| `07-ui-ux-design.md#T-07.01.03.07` | done | Recorded batch work | Command Palette / Combobox — searchable list with keyboard navigation (arrow keys, typeahead). Used for searchable dropdowns (city selector, product selector, agent selector). |
| `07-ui-ux-design.md#T-07.01.03.08` | done | Recorded batch work | Tabs — variants: `underline` (default), `pills`, `boxed`. Orientation: horizontal, vertical. Controlled/uncontrolled. Responsive: horizontal scroll on mobile with overflow buttons. |
| `07-ui-ux-design.md#T-07.01.03.09` | done | Recorded batch work | Accordion — single or multiple open. Used for FAQ, settings sections, order detail sections. Chevron icon rotation animation. |
| `07-ui-ux-design.md#T-07.01.03.10` | done | Recorded batch work | Switch / Toggle — used for boolean settings, enable/disable toggles. Accessible label via `aria-label` or `htmlFor`. |
| `07-ui-ux-design.md#T-07.01.03.11` | done | Recorded batch work | Checkbox & RadioGroup — Checkbox: indeterminate state (for select-all). RadioGroup: horizontal/vertical layout. Both with error state integration. |
| `07-ui-ux-design.md#T-07.01.03.12` | done | Recorded batch work | Progress — linear progress bar (used for order fulfillment stages, document upload progress). Variants: `default`, `success` (green), `warning` (amber). Animated stripe option. |
| `07-ui-ux-design.md#T-07.01.03.13` | done | Recorded batch work | Slider — single thumb and range thumbs. Used for percentage inputs (green rule %, capacity). Step increments. |
| `07-ui-ux-design.md#T-07.01.03.14` | done | Recorded batch work | Textarea — auto-resize, character limit counter, error state. Used for ticket body, staff notes, address input. |
| `07-ui-ux-design.md#T-07.01.03.15` | done | Recorded batch work | Alert / Banner — severity: `info`, `success`, `warning`, `error`, `critical` (red pulse). Dismissible option. Action button slot (e.g. "Retry", "View details"). Use for: no-dead-end messages, profile verification banners, service outage notices. |
| `07-ui-ux-design.md#T-07.01.03.16` | done | Recorded batch work | Breadcrumb — auto-generated from route hierarchy. Collapse on mobile (show only last + "..." indicator). |
| `07-ui-ux-design.md#T-07.01.03.17` | done | Recorded batch work | ScrollArea — custom scrollbar styling matching the theme (thinner, themed thumb). Support for both LTR and RTL scrollbar positions. |
| `07-ui-ux-design.md#T-07.01.03.18` | partial | Recorded batch work | Avatar — image fallback to initials (extracted from user name). Sizes: `xs` (24px) through `xl` (96px). Status ring (online/offline/busy). Used in profile switcher, user menu, agent list. |
| `07-ui-ux-design.md#T-07.01.03.19` | partial | Recorded batch work | Skeleton — shimmer loading placeholders. Variants: `text` (single line, multi-line), `card`, `avatar` (circle), `table-row`, `chart`. Used on every list, detail, and dashboard page. |
| `07-ui-ux-design.md#T-07.01.03.20` | partial | Recorded batch work | Separator — horizontal and vertical. Used in dropdowns, sidebars, form sections. |
| `07-ui-ux-design.md#T-07.01.03.21` | done | Recorded batch work | — Pagination compound component: Previous/Next buttons, page number buttons, ellipsis for large ranges, page size selector (10/20/50/100), total count display ("Showing 1–20 of 154"). Compatible with both cursor and offset pagination. |
| `07-ui-ux-design.md#T-07.01.04.01` | done | Recorded batch work | Install `@tanstack/react-query` and configure `QueryClient` in the app root with production defaults: `staleTime: 30_000` (30s for non-financial reads), `gcTime: 5 * 60_000` (5 min cache), `retry: 2` with exponential backoff, `refetchOnWindowFocus: true` for list pages, `refetchOnMount: true`. Create `QueryProvider` wrapper component. |
| `07-ui-ux-design.md#T-07.01.04.02` | partial | Recorded batch work | Define shared query key factory conventions: `queryKeys.profiles.all`, `queryKeys.orders.list(filters)`, `queryKeys.orders.detail(id)`, `queryKeys.invoices.list(filters)`, `queryKeys.wallet.balance`, etc. All list and detail queries use the factory pattern for consistent invalidation. Document in `packages/ui` README. |
| `07-ui-ux-design.md#T-07.01.04.03` | partial | Recorded batch work | Create `useServerListQuery` hook: wraps `useQuery` with cursor/offset pagination params, filter/sort/search serialization, and `keepPreviousData: true` to prevent layout shift during pagination. Shared by all list pages. Create `useServerDetailQuery(id)` for single-entity fetches. |
| `07-ui-ux-design.md#T-07.01.04.04` | partial | Recorded batch work | Create `useServerMutation` hook: wraps `useMutation` with automatic toast on success/error, `onSettled` invalidation via query key factory, and optimistic updates only for low-risk actions (mark notification read, toggle boolean preference). Never optimistic for payments, wallet, orders, contracts. |
| `07-ui-ux-design.md#T-07.01.04.05` | partial | Recorded batch work | Set up query cancellation: abort in-flight queries on unmount (via `AbortController`). Ensure financial/wallet queries have `refetchInterval: false` or long intervals — never auto-refresh balance without user action. |
| `07-ui-ux-design.md#T-07.01.04.06` | done | Recorded batch work | Configure `@tanstack/react-query-devtools` in development mode only. Never expose query cache, stale data, or retry attempts in production. Devtools toggle bound to `process.env.NODE_ENV`. |
| `07-ui-ux-design.md#T-07.02.01.01` | verify | Inventory needed | Define global color palette tokens in `globals.css`: neutral gray scale (`50–950`), brand primary (`50–950`), brand secondary, success (green), warning (amber), danger (red), info (blue). Each scale has light and dark values. |
| `07-ui-ux-design.md#T-07.02.01.02` | verify | Inventory needed | Define semantic CSS variables mapped from palette: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`, `--shadow-sm` through `--shadow-2xl`. |
| `07-ui-ux-design.md#T-07.02.01.03` | verify | Inventory needed | Define typography tokens: `--font-sans` (Inter for EN, Vazirmatn for FA), `--font-mono` (monospace for code/data), `--font-heading` (usually same as sans), `--font-size-xs` through `--font-size-4xl`, `--font-weight-normal/medium/semibold/bold`, `--line-height-tight/normal/relaxed`. |
| `07-ui-ux-design.md#T-07.02.01.04` | verify | Inventory needed | Define spacing tokens: `--spacing-1` through `--spacing-16` (4px base unit). Layout tokens: `--sidebar-width` (default 280px), `--topbar-height` (default 64px), `--container-max-width` (default 1280px), `--auth-panel-max-width` (default 480px). |
| `07-ui-ux-design.md#T-07.02.01.05` | verify | Inventory needed | Define animation tokens: `--duration-fast` (150ms), `--duration-normal` (200ms), `--duration-slow` (300ms), `--ease-in-out`, `--ease-out`, `--ease-in`. |
| `07-ui-ux-design.md#T-07.02.01.06` | verify | Inventory needed | Ensure all shadcn/ui and custom components reference CSS variables exclusively in `className` via Tailwind's `theme()` or arbitary `var(--variable)`. Zero hardcoded hex colors in component source files. |
| `07-ui-ux-design.md#T-07.02.01.07` | verify | Inventory needed | Add a CI lint rule (`stylelint` or `eslint-plugin-tailwind`) that flags hardcoded color values (hex, rgb, hsl) in component files — all colors must use CSS variable references. |
| `07-ui-ux-design.md#T-07.02.02.01` | verify | Inventory needed | Define `:root` (light default) and `.dark` CSS variable overrides for every semantic token in `globals.css`. Use `oklch` or `hsl` color space for perceptually uniform luminance adjustments. |
| `07-ui-ux-design.md#T-07.02.02.02` | verify | Inventory needed | Implement `ThemeProvider` React component that reads: (1) user's `prefers-color-scheme` system preference (via `matchMedia`), (2) persisted user choice in localStorage, (3) admin brand config (server-provided). Priority: admin brand > user preference > system preference. |
| `07-ui-ux-design.md#T-07.02.02.03` | verify | Inventory needed | Add `class` to `<html>` element on initial load to prevent flash of wrong theme (FOUC). Inline a blocking `<script>` in the document `<head>` that reads a cookie or localStorage and sets the class before paint. |
| `07-ui-ux-design.md#T-07.02.02.04` | verify | Inventory needed | Provide a `useTheme()` hook returning `{ theme, setTheme, resolvedTheme }`. `theme` is the user's choice (`'light'` |
| `07-ui-ux-design.md#T-07.03.01.01` | verify | Inventory needed | Configure Tailwind CSS with `rtl` variant: `dark:rtl:bg-red-500`. Add direction-aware utilities: `ps-*` (padding-inline-start), `pe-*` (padding-inline-end), `ms-*` (margin-inline-start), `me-*` (margin-inline-end), `text-start`, `text-end`, `inset-inline-start`, `inset-inline-end`, `start-*`, `end-*`. |
| `07-ui-ux-design.md#T-07.03.01.02` | verify | Inventory needed | Create `DirectionProvider` that reads the current locale from react-i18next/next-intl, sets `dir="rtl"` or `dir="ltr"` on `<html>`, and provides `isRtl` boolean to the component tree. |
| `07-ui-ux-design.md#T-07.03.01.03` | verify | Inventory needed | Create `useDirection()` hook returning `{ dir, isRtl, isLtr }`. Create `DirectionAware` utility component that renders different content based on direction. |
| `07-ui-ux-design.md#T-07.03.01.04` | verify | Inventory needed | Audit all shadcn/ui components for hardcoded LTR assumptions in their Radix props (e.g. `side="right"` in DropdownMenu should be `side="left"` in RTL). Create a `useFlippedPlacement(placement)` hook that flips `left` ↔ `right` when `isRtl`. |
| `07-ui-ux-design.md#T-07.03.01.05` | verify | Inventory needed | Import and configure `packages/i18n` in `apps/web`. Set up `react-i18next` or `next-intl` with `lng` detection (cookie, URL, user preference), fallback language (`fa`), and language namespaces. |
| `07-ui-ux-design.md#T-07.03.01.06` | verify | Inventory needed | Icons with directional meaning (arrows, chevrons, carets) must flip horizontally in RTL mode. Implement `Icon` wrapper that auto-flips icons ending in `-left`/`-right` (e.g. `ChevronLeft` → mirrored in RTL). |
| `07-ui-ux-design.md#T-07.03.01.07` | verify | Inventory needed | Test every component and page in both RTL and LTR modes. Persian Lorem ipsum (`لورم ایپسوم`) should render correctly in all containers. Verify no text overflow, clipped content, or misaligned elements. |
| `07-ui-ux-design.md#T-07.03.02.01` | verify | Recorded batch work | Build LanguageSwitcher component: button/dropdown showing "FA" / "EN" labels. Changes language, toggles direction, persists in cookie and localStorage for subsequent client visits. |
| `07-ui-ux-design.md#T-07.03.02.02` | verify | Inventory needed | Implement early client language detection for the approved Vite SPA: read the persisted language preference from cookie/localStorage, falling back to browser language preferences. Set `dir` and `lang` attributes on `<html>` before React renders. No flash of the wrong direction during initial client rendering. |
| `07-ui-ux-design.md#T-07.03.02.03` | verify | Inventory needed | When language changes: (1) update `dir` on `<html>`, (2) update `lang` attribute, (3) reload i18n resources, (4) re-translate current page without full browser reload. Animations should not be required to transition direction. |
| `07-ui-ux-design.md#T-07.03.02.04` | verify | Inventory needed | Date and number formatting must change with language — Persian uses Jalali calendar, Arabic numerals with Persian separators; English uses Gregorian calendar and Western numerals. Direction change is decoupled from locale data change but both happen together. |
| `07-ui-ux-design.md#T-07.04.01.01` | verify | Inventory needed | Define Tailwind breakpoints: `xs: 375px`, `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`. Use `mobile-first` (min-width) consistently. Document breakpoint usage conventions. |
| `07-ui-ux-design.md#T-07.04.01.02` | verify | Inventory needed | Create `ResponsiveContainer` component: max-width container with responsive padding. `full` on mobile → `container mx-auto` on desktop. |
| `07-ui-ux-design.md#T-07.04.01.03` | verify | Inventory needed | Create `Stack` and `Inline` layout primitives: `Stack` (vertical, with gap), `Inline` (horizontal, wraps on mobile). Responsive gap: different gap values per breakpoint. |
| `07-ui-ux-design.md#T-07.04.01.04` | verify | Inventory needed | Create `Grid` responsive layout component: `columns` prop accepts object `{ base: 1, sm: 2, lg: 3 }` mapping to CSS grid. Used for dashboard card grids, admin table layouts. |
| `07-ui-ux-design.md#T-07.04.01.05` | verify | Inventory needed | All list pages must have a mobile card view as an alternative to the desktop table view. When viewport < `md`, switch from `<DataTable>` to `<CardList>` where each card shows key fields. |
| `07-ui-ux-design.md#T-07.04.01.06` | verify | Inventory needed | Touch targets: ensure all interactive elements (buttons, links, inputs, toggles) have minimum 44×44px tap area per WCAG 2.5.8. |
| `07-ui-ux-design.md#T-07.04.02.01` | verify | Inventory needed | On mobile (< `lg`): sidebar becomes a bottom tab bar with 4–5 primary navigation icons (Home, Orders, Wallet, Profile, More). "More" opens a sheet with all remaining navigation items. |
| `07-ui-ux-design.md#T-07.04.02.02` | verify | Recorded batch work | On mobile: topbar shows only hamburger menu, app logo/title, notification bell, and profile avatar. All secondary actions move into the "More" drawer or overflow menus. |
| `07-ui-ux-design.md#T-07.04.02.03` | verify | Inventory needed | On tablet (`md`–`lg`): sidebar collapses to icon-only rail (60px wide). Expand on hover or tap. |
| `07-ui-ux-design.md#T-07.04.02.04` | verify | Recorded batch work | Verify all pages look correct at `320px`, `375px`, `390px`, `414px`, `768px`, `1024px`, `1280px`, and `1920px` viewport widths. No horizontal scroll, no overlapping text, no tiny touch targets. |
| `07-ui-ux-design.md#T-07.05.01.01` | verify | Inventory needed | Implement `SkipLink` component (first focusable element on every page, visible on focus: "Skip to main content"). All pages have a `<main>` element with `id="main-content"`. |
| `07-ui-ux-design.md#T-07.05.01.02` | verify | Inventory needed | Ensure all interactive elements have visible focus indicators. Define a custom focus ring via `:focus-visible` in CSS: `outline: 2px solid var(--ring)`, `outline-offset: 2px`. Never use `outline: none` without a visible replacement. |
| `07-ui-ux-design.md#T-07.05.01.03` | verify | Inventory needed | Implement a `FocusTrap` component for modals, sheets, and dropdowns. When open, Tab/Shift+Tab cycles within the dialog. Focus returns to trigger on close. |
| `07-ui-ux-design.md#T-07.05.01.04` | verify | Inventory needed | Add `aria-live="polite"` region for dynamic content updates (toast messages, notifications count, form submission status). `aria-live="assertive"` for critical errors (payment failures, session expiry). |
| `07-ui-ux-design.md#T-07.05.01.05` | verify | Inventory needed | Ensure all form inputs have programmatically associated labels (`<label htmlFor>` or `aria-label`). Error messages use `aria-describedby` or `aria-errormessage` to link to the input. Required fields use `aria-required="true"`. |
| `07-ui-ux-design.md#T-07.05.01.06` | verify | Inventory needed | Ensure all images have meaningful `alt` text. Decorative icons use `aria-hidden="true"`. Status icons (success/error/warning) have screen-reader-visible text (visually hidden `sr-only` label). |
| `07-ui-ux-design.md#T-07.05.01.07` | verify | Inventory needed | Implement proper heading hierarchy (`h1` → `h2` → `h3` → `h4`) on every page. A single `<h1>` per page. Landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` with `aria-label` when multiple instances exist. |
| `07-ui-ux-design.md#T-07.05.01.08` | verify | Inventory needed | Ensure all color combinations pass WCAG AA contrast ratios: normal text ≥ 4.5:1, large text ≥ 3:1, UI components ≥ 3:1. Verify with automated tools. Provide a "high contrast" mode toggle that strengthens all contrast ratios. |
| `07-ui-ux-design.md#T-07.05.01.09` | verify | Inventory needed | All custom interactive components (select, combobox, date picker, slider, tabs, accordion) must have correct ARIA roles (`combobox`, `listbox`, `option`, `tab`, `tabpanel`, `slider`, `progressbar`) and keyboard interaction patterns from WAI-ARIA Authoring Practices. |
| `07-ui-ux-design.md#T-07.05.01.10` | verify | Inventory needed | Ensure custom file upload inputs are keyboard accessible and have clear screen-reader instructions. Drop zones must announce "drop files here or click to browse". |
| `07-ui-ux-design.md#T-07.05.01.11` | verify | Inventory needed | Add `sr-only` utility class (visually hidden, available to screen readers) and use it for descriptive labels on icon-only buttons, status indicators, and progress information. |
| `07-ui-ux-design.md#T-07.05.02.01` | verify | Inventory needed | Install `@axe-core/playwright` and configure in Playwright test suite. Add `AxeBuilder` to critical page E2E tests (login, dashboard, order list, wallet, contract detail). Verify zero violations for WCAG AA. |
| `07-ui-ux-design.md#T-07.05.02.02` | verify | Inventory needed | Add component-level a11y tests in React Testing Library using `jest-axe` or testing-library's `toBeInTheDocument` + role queries. Every component must pass basic role/name/value checks. |
| `07-ui-ux-design.md#T-07.05.02.03` | verify | Inventory needed | Write keyboard-navigation E2E tests for critical flows: Tab through login form, navigate dashboard with arrow keys, open/close modal with Escape, select from combobox with keyboard. |
| `07-ui-ux-design.md#T-07.05.02.04` | verify | Inventory needed | Add CI gate: a11y violations on critical pages block PR merge. Non-critical pages warn but do not block. Violations must be triaged with reason or exemption. |
| `07-ui-ux-design.md#T-07.06.01.01` | verify | Inventory needed | Build `ThemeToggle` component: sun/moon icon button in topbar. Cycles: `light` → `dark` → `system` → `light`. Shows current icon based on resolved theme. |
| `07-ui-ux-design.md#T-07.06.01.02` | verify | Inventory needed | Persist theme choice: localStorage key `barghsa-theme`. On server render, read from cookie (set by middleware or client script) to prevent flash. |
| `07-ui-ux-design.md#T-07.06.01.03` | verify | Inventory needed | Verify dark mode colors pass contrast checks. Dark backgrounds must not be pure `#000` (use `#0a0a0a` or similar). Dark foregrounds must not be pure `#fff` (use `#f5f5f5`). All surface colors appropriate for their role. |
| `07-ui-ux-design.md#T-07.06.01.04` | verify | Inventory needed | Check all shadcn/ui components for missing dark mode variants. Common issues: shadows too harsh in dark mode, borders invisible, subtle backgrounds not dark enough. |
| `07-ui-ux-design.md#T-07.06.01.05` | verify | Inventory needed | Verify dark mode renders correctly in all browsers (Chrome, Firefox, Safari, Edge) on desktop and mobile. Verify print stylesheet overrides dark mode to light. |
| `07-ui-ux-design.md#T-07.07.01.01` | verify | Inventory needed | Build `BrandConfigProvider`: on app mount, fetch `GET /api/v1/branding` (cached, long TTL). Set CSS custom properties on `:root` based on response. Support `primary`, `secondary`, `accent` colors separately for light and dark themes. |
| `07-ui-ux-design.md#T-07.07.01.02` | verify | Inventory needed | Support brand logo upload: `logoUrl` (light variant), `logoDarkUrl` (dark variant), `faviconUrl`. Swap logo in topbar, auth pages, and email templates based on current theme. |
| `07-ui-ux-design.md#T-07.07.01.03` | verify | Inventory needed | Support `appTitle` (brand name shown in topbar, browser tab title, auth pages). `appTitleEn` and `appTitleFa` for bilingual display. |
| `07-ui-ux-design.md#T-07.07.01.04` | verify | Inventory needed | Validate admin-configured colors have sufficient contrast against backgrounds. If an admin sets primary to a low-contrast value, show a warning before activation. Use WCAG contrast formula to check. |
| `07-ui-ux-design.md#T-07.07.01.05` | verify | Inventory needed | Branding changes use Draft → Active lifecycle. When a new branding version is saved as Draft, show a "Preview brand" button that temporarily applies Draft tokens so admin can see before activating. |
| `07-ui-ux-design.md#T-07.07.01.06` | verify | Inventory needed | Fallback: if branding API is unreachable or returns invalid data, use hardcoded defaults. Never crash the app on branding load failure. |
| `07-ui-ux-design.md#T-07.08.01.01` | verify | Inventory needed | Define CSS keyframes for: `fadeIn`, `fadeOut`, `slideInUp`/`slideInDown`/`slideInLeft`/`slideInRight`, `scaleIn` (popover, modal open), `scaleOut`, `shimmer` (skeleton), `spin` (loading spinner), `pulse` (attention). |
| `07-ui-ux-design.md#T-07.08.01.02` | verify | Inventory needed | Create `useReducedMotion()` hook: reads `prefers-reduced-motion` media query. When true: disable all non-essential animations, set transition duration to 0, skip entrance animations. Essential animations (loading spinner) use reduced-speed variant (slower spin). |
| `07-ui-ux-design.md#T-07.08.01.03` | verify | Inventory needed | Create `Animated` wrapper component: `fade`, `slide`, `scale`, `shimmer` variants. Respects `reducedMotion` — uses instant show/hide instead of animate when reduced motion is preferred. |
| `07-ui-ux-design.md#T-07.08.01.04` | verify | Inventory needed | Apply entrance animations to: page transitions (subtle fade + slide up), list items appearing (staggered fade), dashboard cards (staggered scale + fade), skeleton loading (shimmer). |
| `07-ui-ux-design.md#T-07.08.01.05` | verify | Inventory needed | Apply micro-interactions: button press scale(0.97), card hover lift, switch toggle slide, accordion chevron rotate, progress bar fill, toast slide-in from top-right (LTR) / top-left (RTL). |
| `07-ui-ux-design.md#T-07.08.01.06` | verify | Inventory needed | `prefers-reduced-motion: reduce` must disable: all entrance animations, hover transitions, parallax, shimmer (show flat gray instead), scale/rotate transforms. Keep only: loading spinner (reduced speed), progress bar fill (reduced speed), toast appear (instant, no slide). |
| `07-ui-ux-design.md#T-07.08.02.01` | verify | Inventory needed | Implement route-level page transition using TanStack Router's `onEnter`/`onExit` hooks or a layout animation wrapper. Transition: 200ms fade + slight vertical slide (20px). |
| `07-ui-ux-design.md#T-07.08.02.02` | verify | Inventory needed | Respects `prefers-reduced-motion`: when enabled, page transitions are instant with no animation. |
| `07-ui-ux-design.md#T-07.08.02.03` | verify | Inventory needed | Ensure animations don't cause layout shift or inaccessible content delays. Content must be immediately readable even during animation. |
| `07-ui-ux-design.md#T-07.09.01.01` | verify | Inventory needed | Integrate `date-fns-jalali` (or equivalent) into `packages/i18n`. Create `useCalendar()` hook that returns `{ calendar, format, parse, addDays, ... }` pointing to either `date-fns` (Gregorian) or `date-fns-jalali` functions based on current locale. |
| `07-ui-ux-design.md#T-07.09.01.02` | verify | Inventory needed | Create `DateDisplay` component: renders a date in the active calendar. Props: `date` (ISO string or Date), `format` (e.g. `"PPP"` for full, `"PP"` for medium, `"P"` for short), `showTime` (optional). Example: Persian `۱۴۰۳/۰۶/۰۱`, English `2024/08/22`. |
| `07-ui-ux-design.md#T-07.09.01.03` | verify | Inventory needed | Create `DateTimeDisplay` component: renders date + time in user's timezone. `date` + `timezone` props. Falls back to profile timezone if not provided. Displays: Persian `۱۴۰۳/۰۶/۰۱ ۱۵:۳۰`, English `2024-08-22 15:30`. |
| `07-ui-ux-design.md#T-07.09.01.04` | verify | Inventory needed | Create `RelativeTime` component: "2 hours ago", "3 days ago", "لحظاتی پیش", "۲ ساعت پیش". Respects locale. Updates automatically within a page (poll or mount-time calculation). |
| `07-ui-ux-design.md#T-07.09.01.05` | verify | Recorded batch work | Ensure timezone conversion is correct. Dates stored as UTC `timestamptz`; display converts to user's timezone (default Iran Standard Time, UTC+3:30, with DST awareness). Profile timezone setting overrides default. |
| `07-ui-ux-design.md#T-07.09.02.01` | verify | Inventory needed | Build `DatePicker` component using Base UI DatePicker primitives or a purpose-built Jalali-aware picker (e.g. `react-day-picker` with Jalali adapter). Props: `value`, `onChange`, `minDate`, `maxDate`, `disabled`, `error`, `placeholder`. Calendar switches to Jalali in Persian locale, Gregorian in English. |
| `07-ui-ux-design.md#T-07.09.02.02` | verify | Inventory needed | Build `DateRangePicker` component: selects start and end dates. Used in advanced electricity ordering (custom period). Same locale switching as single DatePicker. |
| `07-ui-ux-design.md#T-07.09.02.03` | verify | Inventory needed | Build `MonthPicker` component: selects a single Jalali/Gregorian month (used in simple electricity ordering for "current month" / "next month" selection). |
| `07-ui-ux-design.md#T-07.09.02.04` | verify | Recorded batch work | Build `DateTimePicker` component: date + time selection. Time formats: Persian uses 24-hour, English uses 12-hour with AM/PM. |
| `07-ui-ux-design.md#T-07.09.02.05` | verify | Inventory needed | Ensure keyboard accessibility: date picker is fully navigable via arrow keys, Tab, Enter, Escape. Screen reader announces selected date in correct calendar system. |
| `07-ui-ux-design.md#T-07.09.02.06` | verify | Inventory needed | Jalali leap years must be handled correctly. Test boundary dates (Esfand 29th in non-leap, Esfand 30th in leap, Farvardin 1st). |
| `07-ui-ux-design.md#T-07.09.02.07` | verify | Recorded batch work | When language switches from Persian to English (or vice versa), the displayed date in the picker converts. For example, ۱۴۰۳/۰۶/۰۱ becomes 2024/08/22. The underlying Date value doesn't change. |
| `07-ui-ux-design.md#T-07.10.01.01` | verify | Recorded batch work | Install `react-hook-form`, `@hookform/resolvers`, `zod`. Create shared form utilities in `packages/ui/src/form/`: `FormField` (wrapper with label + error + helper text), `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`. |
| `07-ui-ux-design.md#T-07.10.01.02` | verify | Recorded batch work | Create `useZodForm()` hook: wraps `useForm` with default zod resolver config, automatic focus-on-error, and `mode: 'onTouched'` for validation timing (validate on blur + change after first interaction). |
| `07-ui-ux-design.md#T-07.10.01.03` | verify | Recorded batch work | Create form field components for each input type: `FormInput`, `FormSelect`, `FormTextarea`, `FormCheckbox`, `FormSwitch`, `FormRadioGroup`, `FormCombobox`, `FormDatePicker`, `FormDateRangePicker`, `FormSlider`, `FormPhoneInput`. Each auto-binds to react-hook-form `field` and displays `fieldState.error`. |
| `07-ui-ux-design.md#T-07.10.01.04` | verify | Recorded batch work | Server-side validation errors (returned from API) must be mapped back to form fields using `setError()`. Generic server errors (e.g. "network error") display as a top-of-form Alert component. |
| `07-ui-ux-design.md#T-07.10.01.05` | verify | Recorded batch work | All forms must preserve valid input values when a server validation error occurs. Never clear a field because another field failed validation. |
| `07-ui-ux-design.md#T-07.10.01.06` | verify | Recorded batch work | Form submission button shows loading spinner and is disabled during submission. Prevent double submission via `formState.isSubmitting`. |
| `07-ui-ux-design.md#T-07.10.02.01` | verify | Recorded batch work | Build `FormWizard` component: multi-step form with step indicator (numbered steps, completed/current/pending states), next/back navigation, server-side draft save after each step, resume capability. Used for: electricity ordering (4–5 steps), solar construction, onboarding. |
| `07-ui-ux-design.md#T-07.10.02.02` | verify | Recorded batch work | Build `FormStep` component within wizard: each step validates only its fields on "Next". Steps store partial data in react-hook-form. On last step "Submit", validate all fields. |
| `07-ui-ux-design.md#T-07.10.02.03` | verify | Recorded batch work | Build `DynamicFieldArray` component: add/remove/reorder items in a list. Used for: invoice lines (manual invoice creation), document uploads, agent permissions. Each item has its own sub-fields with validation. |
| `07-ui-ux-design.md#T-07.10.02.04` | verify | Recorded batch work | Build `DependentSelect` component: selecting option A filters options in select B. Used for: Province → City cascading selects in address forms. Supports async options (fetch cities when province changes). |
| `07-ui-ux-design.md#T-07.10.02.05` | verify | Inventory needed | Build `FormReview` component (read-only summary of all form fields before final submission). Used for order review step before submit. Backend-rendered snapshot for financial orders. |
| `07-ui-ux-design.md#T-07.11.01.01` | verify | Inventory needed | Configure Sonner (shadcn's toast wrapper) in `apps/web`. Set up `<Toaster />` with: position (top-right for LTR, top-left for RTL), close button, rich colors (success green, error red, warning amber, info blue), max 3 visible toasts, swipe to dismiss. |
| `07-ui-ux-design.md#T-07.11.01.02` | verify | Inventory needed | Create `useToast()` hook: `toast.success(msg)`, `toast.error(msg)`, `toast.warning(msg)`, `toast.info(msg)`, `toast.promise(promise, { loading, success, error })`. Supports i18n keys or string messages. |
| `07-ui-ux-design.md#T-07.11.01.03` | verify | Inventory needed | Create an API response interceptor that auto-shows toasts for: successful CRUD operations ("Invoice created", "Profile updated", "Order submitted"), API errors (error message from API), network failures ("Connection lost. Retrying..."). |
| `07-ui-ux-design.md#T-07.11.01.04` | verify | Inventory needed | Toasts must not block or interrupt critical flows. Only one persistent toast for in-progress operations (e.g. "Uploading document..."). |
| `07-ui-ux-design.md#T-07.11.01.05` | verify | Inventory needed | Ensure toasts are reachable by screen readers via `aria-live="polite"`. Toast content must be announced without stealing focus. |
| `07-ui-ux-design.md#T-07.11.02.01` | verify | Inventory needed | Build `NotificationBell` component in topbar: bell icon with unread count badge. Fetches unread count via API (short-poll every 30s or SSE stream). Animates badge on new notification. |
| `07-ui-ux-design.md#T-07.11.02.02` | verify | Inventory needed | Build `NotificationDropdown`: last 10 notifications with icon (per type: security, payment, contract, order, system, document), title, body, relative time, read/unread dot. "Mark all as read" action. "View all" link to full notification center. Click navigates to linked record. |
| `07-ui-ux-design.md#T-07.11.02.03` | verify | Inventory needed | Build full `/app/notifications` page: cursor-based pagination, filter by `all` / `unread`, grouped by date (Today, Yesterday, This Week, Older). Each notification: icon + title + body + timestamp + action link. Mark single as read, mark all as read. Empty state when no notifications. |
| `07-ui-ux-design.md#T-07.11.02.04` | verify | Inventory needed | Optimistic mark-as-read (low-risk, reversible). Show read state immediately, queue API call. If API fails, revert to unread with a toast warning. |
| `07-ui-ux-design.md#T-07.11.02.05` | verify | Inventory needed | Update document title with unread count when tab is backgrounded: "Barghsa (3)" or "برقسا (۳)". |
| `07-ui-ux-design.md#T-07.12.01.01` | verify | Inventory needed | Create `AsyncView` component: renders one of three states based on `{ loading, error, data }` props. Loading → `<Skeleton />`, Error → `<ErrorState />`, Empty (data=[] or null) → `<EmptyState />`, Data→ children. |
| `07-ui-ux-design.md#T-07.12.01.02` | verify | Inventory needed | Create `ErrorState` component: icon (sad face, broken connection, warning), error title (i18n), error description, retry button ("Try again"), optional "Contact support" link with pre-filled correlation ID. Error details in collapsible section for debugging (safe, no stack traces). |
| `07-ui-ux-design.md#T-07.12.01.03` | verify | Inventory needed | Create `EmptyState` component: icon (empty box, search icon, document icon), title ("No items yet", "No results found"), description (helpful message), action button ("Create first order", "Clear filters", "Browse products"), optional illustration. |
| `07-ui-ux-design.md#T-07.12.01.04` | verify | Inventory needed | Create `LoadingSkeleton` variants for common patterns: `PageSkeleton` (full page shimmer), `TableSkeleton` (5 row shimmer), `CardGridSkeleton` (6 card shimmers in grid), `FormSkeleton` (input + button shimmers), `DetailSkeleton` (header + body shimmers). |
| `07-ui-ux-design.md#T-07.12.01.05` | verify | Inventory needed | Create `useAsyncData<T>(fetcher, deps)` hook: returns `{ data, loading, error, refetch }`. Handles: initial fetch, re-fetch on dependency change, abort on unmount, error transform (localized message + code). |
| `07-ui-ux-design.md#T-07.12.01.06` | verify | Inventory needed | Build `WaitingForBarghsa` state component: shown when an action is awaiting Barghsa staff. Displays: "Waiting for Barghsa", submission timestamp, latest update/status, expected response time, related ticket/comment link. Used on: order pages awaiting review, verification pending, contract awaiting signature, document awaiting review. See README no-dead-end principle. |
| `07-ui-ux-design.md#T-07.12.01.07` | verify | Inventory needed | Build `NoDeadEndBanner` component: appears on any page whose underlying data cannot be loaded or written due to dependency/service failure. Shows: current state, what happened, next available action (Retry / Contact support), responsible team, help link. Applied to: external-provider outages, missing prerequisite data, admin-disabled features. Never leaves a customer on a disabled screen without explanation. |
| `07-ui-ux-design.md#T-07.12.01.08` | verify | Inventory needed | Every list page, detail page, dashboard widget, and admin page must implement the loading/empty/error pattern. No view renders a blank white page or infinite spinner. |
| `07-ui-ux-design.md#T-07.12.01.09` | verify | Inventory needed | Error boundaries per route: React Error Boundary catches unhandled render errors. Shows `ErrorState` with "Something went wrong" + reload button. Logs error to Sentry. |
| `07-ui-ux-design.md#T-07.13.01.01` | verify | Inventory needed | Build `ConfirmDialog` component: configurable title, description, confirm button text + variant (`primary` for info, `destructive` for delete/cancel, `warning` for financial), cancel button text. Props: `open`, `onConfirm`, `onCancel`, `loading` (spinner on confirm button). Variants: |
| `07-ui-ux-design.md#T-07.13.01.02` | verify | Inventory needed | Build `DestructiveConfirmDialog`: confirm button is red/destructive. User must type a confirmation phrase (e.g. "DELETE") to enable the button. Used for: deleting resources, removing agents, cancelling contracts. |
| `07-ui-ux-design.md#T-07.13.01.03` | verify | Inventory needed | Build `FinancialConfirmDialog`: shows structured financial preview before user can confirm. Displays: amounts in IRR and toman, what will happen, what the consequences are, refund policy. User must check "I understand" checkbox to enable confirm button. Used for: wallet payments, order submissions, contract acceptance, gift code redemption. |
| `07-ui-ux-design.md#T-07.13.01.04` | verify | Inventory needed | Create `useConfirm()` hook: `const confirm = useConfirm()` → `await confirm({ title, description, variant })`. Returns `true` if user confirmed, `false` if cancelled. Promise-based API for inline use. |
| `07-ui-ux-design.md#T-07.13.01.05` | verify | Inventory needed | Build `FinancialReviewSummary` component: structured read-only preview of all financial fields before an irreversible action. Fields: profile info, service type, quantities, unit prices, discounts, VAT, total (IRR), payment source, contract implications, cancellation/refund rules. Backend generates authoritative snapshot. Used in: order review step, contract acceptance, payment confirmation. See README lines 177–181. |
| `07-ui-ux-design.md#T-07.13.01.06` | verify | Inventory needed | All destructive UI actions (delete, cancel, remove, revoke, disable) must use `DestructiveConfirmDialog`. No one-click delete for any resource. Financial actions use `FinancialConfirmDialog` with `FinancialReviewSummary`. |
| `07-ui-ux-design.md#T-07.13.01.07` | verify | Inventory needed | Confirmation dialogs maintain focus trap, close on Escape, and have a clear "Cancel" button. The destructive action button is never the default/auto-focused button. |
| `07-ui-ux-design.md#T-07.14.01.01` | verify | Inventory needed | Build `PasswordStrengthMeter` component: hidden by default, appears with slide-down animation when password field is focused. Stays visible as long as password field has content. Contains: strength bar (0–4 segments, color-coded: empty=gray, weak=red, fair=orange, strong=yellow, very-strong=green), strength label (i18n), optional checklist of requirements. |
| `07-ui-ux-design.md#T-07.14.01.02` | verify | Inventory needed | Implement strength calculation: `weak` (< 8 chars or only lowercase), `fair` (8+ chars, mixed case), `strong` (8+ chars, mixed case + number), `very-strong` (12+ chars, mixed case + number + special char). Bonus points for length > 16. |
| `07-ui-ux-design.md#T-07.14.01.03` | verify | Inventory needed | Localize strength labels and recommendation text. Persian: `خیلی ضعیف` / `ضعیف` / `متوسط` / `قوی` / `بسیار قوی`. Each level shows improvement hint in the correct language. |
| `07-ui-ux-design.md#T-07.14.01.04` | verify | Inventory needed | Password strength meter is informational only — never block form submission based on strength. Minimum strength requirements are enforced by backend zod validation. |
| `07-ui-ux-design.md#T-07.14.01.05` | verify | Inventory needed | Password visibility toggle button (eye icon) in the password input's trailing slot. Clicking toggles between `password` and `text` input types. |
| `07-ui-ux-design.md#T-07.15.01.01` | verify | Inventory needed | Build `ProfileSwitcher` component: shows currently active profile avatar + name + type badge (Individual/Legal). Clicking opens a dropdown listing all user's profiles. Each row: avatar, name, type badge, verification badge (verified/unverified). Selected profile has checkmark. "Manage profiles" link at bottom. |
| `07-ui-ux-design.md#T-07.15.01.02` | verify | Inventory needed | Build `ProfileBadge` in topbar: compact version showing avatar + type icon + name. Used in topbar when sidebar is collapsed. |
| `07-ui-ux-design.md#T-07.15.01.03` | verify | Inventory needed | On profile switch: show a full-page loading state (not jarring), refetch all dashboard/list data for the new profile. Persist the selected profile as default in the backend (so next login restores it). |
| `07-ui-ux-design.md#T-07.15.01.04` | verify | Inventory needed | If active profile is unverified and verification is enforced: show a warning banner but allow profile switch to view data. Block only new commercial orders. |
| `07-ui-ux-design.md#T-07.15.01.05` | verify | Recorded batch work | Profile switching must never expose another profile's data. All API requests include `profileId` header or query param, validated server-side for ownership. |
| `07-ui-ux-design.md#T-07.16.01.01` | verify | Inventory needed | Build `AppShell` layout component: CSS grid or flex layout with `--sidebar-width` and `--topbar-height` variables. Sidebar (left in LTR, right in RTL) + Topbar + `<main>` scrollable content. |
| `07-ui-ux-design.md#T-07.16.01.02` | verify | Inventory needed | Build `Sidebar` component: app logo/brand at top, `ProfileSwitcher` below, main navigation links with icons and labels, section dividers, "Admin" section visible only for admin users. Active link highlighted. Collapsible on tablet. |
| `07-ui-ux-design.md#T-07.16.01.03` | verify | Recorded batch work | Build `Topbar` component: `LanguageSwitcher`, `ThemeToggle`, `NotificationBell`, `ProfileMenu` (avatar + dropdown: settings, logout). Compact on mobile. |
| `07-ui-ux-design.md#T-07.16.01.04` | verify | Recorded batch work | Build `ProfileMenu` dropdown: avatar, name, email/mobile, "My Profile" link, "Settings" link, "Logout" button. Staff+admin users see "Switch to staff view" link. |
| `07-ui-ux-design.md#T-07.16.01.05` | verify | Recorded batch work | Build `BottomTabBar` (mobile < `lg`): 5 primary navigation tabs with icons + labels. Active tab highlighted. "More" tab opens a Sheet with remaining navigation items. |
| `07-ui-ux-design.md#T-07.16.01.06` | verify | Recorded batch work | Build `BreadcrumbBar` below topbar: shows current page path. Collapse on mobile (show only last + "..." with dropdown). |
| `07-ui-ux-design.md#T-07.16.01.07` | verify | Recorded batch work | Sidebar navigation items must be role-aware. Staff see different items than customers. Admin sees additional items. Individual vs Legal profiles see different items. Navigation config fetched from backend based on permissions. |
| `07-ui-ux-design.md#T-07.16.02.01` | verify | Recorded batch work | Define navigation groups and items per role: Customer (Dashboard, Orders, Contracts, Invoices, Wallet, Consultations, Solar, Tickets, Documents, My Profile), Staff (same + CRM, document templates, operations queues), Admin (all staff + Admin Settings with sub-sections). |
| `07-ui-ux-design.md#T-07.16.02.02` | verify | Recorded batch work | Legal Entity customers see additional items: Agents, Legal Profile details. Individual customers see: Saving Plans, Personal Profile. Both see shared items. |
| `07-ui-ux-design.md#T-07.16.02.03` | verify | Recorded batch work | Show/hide navigation items based on backend-resolved permissions, not frontend role checks alone. Navigation config fetch at app mount, cached session-long. |
| `07-ui-ux-design.md#T-07.17.01.01` | verify | Inventory needed | Build `AuthLayout` component: CSS grid with two columns. Left column (50%): brand logo, app title (persian + english), slogan, 3–4 value propositions with icons (e.g. rocket for speed, shield for security, heart for support). Right column (50%): centered card containing the form. |
| `07-ui-ux-design.md#T-07.17.01.02` | verify | Inventory needed | On mobile (< `md`): single column. Brand section collapses to compact strip at top (logo + title only), form takes full width. Value propositions are hidden or moved below the form. |
| `07-ui-ux-design.md#T-07.17.01.03` | verify | Inventory needed | Auth layout must NOT render the app sidebar, topbar, or bottom tab bar. It is a completely separate layout from `AppShell`. Use TanStack Router's layout nesting for auth routes. |
| `07-ui-ux-design.md#T-07.17.01.04` | verify | Inventory needed | Add language switcher in auth pages (top-right for LTR, top-left for RTL) so users can switch language before login/register. |
| `07-ui-ux-design.md#T-07.17.01.05` | verify | Inventory needed | Auth pages must never render authenticated app data. If already authenticated, redirect to `/app/dashboard`. |
| `07-ui-ux-design.md#T-07.17.02.01` | verify | Inventory needed | Build `LoginPage`: username field (email or mobile, auto-detect type), password field with visibility toggle, "Forgot password?" link, "Login" button, "Register" link. OTP step appears conditionally after credential validation. |
| `07-ui-ux-design.md#T-07.17.02.02` | verify | Inventory needed | Build `RegisterPage`: username field, password field with strength meter, TOS acceptance checkbox with link, "Register" button. OTP step after submission. Back-to-login and forgot-password links. |
| `07-ui-ux-design.md#T-07.17.02.03` | verify | Inventory needed | Build `ForgotPasswordPage`: username field, "Send reset code" button. OTP step. New password entry with strength meter. Success → redirect to login. |
| `07-ui-ux-design.md#T-07.17.02.04` | verify | Inventory needed | Build `OtpInput` component: 6-digit code entry. Auto-focus first digit, auto-advance on entry, paste support, backspace to previous. Countdown timer for resend (60s). Resend button after countdown. Error display for invalid/expired OTP. |
| `07-ui-ux-design.md#T-07.17.02.05` | verify | Inventory needed | Build `ForcePasswordChangePage`: shown when user is required to change password (admin-enforced). New password + confirm. Strength meter. On success → show success toast → redirect to login. |
| `07-ui-ux-design.md#T-07.17.02.06` | verify | Inventory needed | Build `TosPage`: simple page rendering TOS content (fetched from API). Shows last-updated date. Version history accessible. Used both for TOS display and re-acceptance flow. |
| `07-ui-ux-design.md#T-07.17.02.07` | verify | Inventory needed | OTP responses must always be generic: "If valid, a code was sent." Never reveal whether an account/email/mobile exists. |
| `07-ui-ux-design.md#T-07.18.01.01` | verify | Recorded batch work | Create `useListQuery` hook: manages `{ search, sort, filters, page, pageSize }` from URL search params. Syncs with router (shareable URLs). Returns query params for API calls. Supports cursor pagination as a variant. |
| `07-ui-ux-design.md#T-07.18.01.02` | verify | Recorded batch work | Build `ListToolbar` component: search input (with debounce, 300ms), filter button (opens filter popover/drawer), sort dropdown, "Add new" button (for create actions). Responsive: wraps on mobile. |
| `07-ui-ux-design.md#T-07.18.01.03` | verify | Recorded batch work | Build `ListFilterPanel`: popover/drawer with filter fields. Each field type: text, select (single/multi), date range, number range, status checkboxes. "Apply" and "Clear all" buttons. Active filter count badge on filter button. Populated filters shown as tag/chips above the list. |
| `07-ui-ux-design.md#T-07.18.01.04` | verify | Recorded batch work | Build `ListSortDropdown`: selects sort field + direction (asc/desc). Uses allowlisted sort fields from API. Default sort applied if none selected. |
| `07-ui-ux-design.md#T-07.18.01.05` | verify | Recorded batch work | Build `ListViewToggle`: switch between Table view and Card view. Persisted preference per user (localStorage). Default: table on desktop, cards on mobile. |
| `07-ui-ux-design.md#T-07.18.01.06` | verify | Recorded batch work | Build `ListPage` compound component: combines ListToolbar + ListFilterPanel + AsyncView(DataTable or CardList) + Pagination. All list pages use this compound component for consistency. |
| `07-ui-ux-design.md#T-07.18.02.01` | verify | Recorded batch work | `StatusFilter`: multi-select checkboxes for status values. Show colored badges for each status in the filter list. |
| `07-ui-ux-design.md#T-07.18.02.02` | verify | Recorded batch work | `DateRangeFilter`: two date pickers (start/end) with preset ranges (Today, Last 7 days, This month, Last month, Custom). Localized (Jalali/Gregorian). |
| `07-ui-ux-design.md#T-07.18.02.03` | verify | Recorded batch work | `TextFilter`: single search input with debounce. `NumberFilter`: min/max range inputs. `SelectFilter`: single-select dropdown with search. `MultiSelectFilter`: combobox with chips. |
| `07-ui-ux-design.md#T-07.18.02.04` | verify | Recorded batch work | All filter state serialized to URL search params so filters survive page refresh and are shareable. |
| `07-ui-ux-design.md#T-07.18.02.05` | verify | Recorded batch work | "Clear all filters" button shown only when filters are active. Active filter count badge on filter button. |
| `07-ui-ux-design.md#T-07.18.03.01` | verify | Recorded batch work | Contract list/detail page pattern: List columns (contract number, type, status badge, legal entity, start date, end date, amount). Detail sections (header with status, parties, terms, schedule, version timeline, amendment history, download links). Prerequisite display: show linked order, invoice, and document statuses. Contract detail page owned by E-04; this pattern defines the UI composition. |
| `07-ui-ux-design.md#T-07.18.03.02` | verify | Recorded batch work | Invoice list/detail page pattern: List columns (invoice number, type, status badge, period, amount, due date, payment status). Detail sections (header with status + amount, line items table, VAT breakdown, payment timeline, bank receipt attachment, payment method). Invoice detail page owned by E-04. |
| `07-ui-ux-design.md#T-07.18.03.03` | verify | Recorded batch work | Bank receipt list/detail page pattern: List columns (receipt ID, invoice reference, amount, bank name, deposit date, verification status). Detail sections (receipt image, deposit metadata, matched invoice, verification timeline). Bank receipt page owned by E-04. |
| `07-ui-ux-design.md#T-07.18.03.04` | verify | Recorded batch work | Electricity order detail page pattern: Detail sections (header with dual status badge, period, bundle/quantity breakdown, green composition, price preview, gift code used, payment status, contract link, timeline, document requirements). Uses `DualStatusDisplay` from T-07.27.01.04. Owned by E-03. |
| `07-ui-ux-design.md#T-07.18.03.05` | verify | Recorded batch work | Solar postal tracking page pattern: Detail sections (header with stage status, current postal stage, estimated delivery, tracking number link, document checklist, construction stage progress stepper). Uses `ProgressStepper` from T-07.27.01.03. Owned by E-03. |
| `07-ui-ux-design.md#T-07.19.01.01` | verify | Recorded batch work | Build `DashboardLayout` component: responsive grid of widgets. 1 column mobile, 2 columns tablet, 3 columns desktop. Each widget is a Card with header (icon + title + optional "View all" link) and body (data content). |
| `07-ui-ux-design.md#T-07.19.01.02` | verify | Recorded batch work | Build `DashboardWidget` wrapper: loading skeleton (per-widget), error state (per-widget retry), empty state, data content slot. Each widget independently fetches data with `useAsyncData`. |
| `07-ui-ux-design.md#T-07.19.01.03` | verify | Recorded batch work | Widget layout must be stable — no layout shift as widgets load. Each widget reserves its card space with a skeleton placeholder. |
| `07-ui-ux-design.md#T-07.19.02.01` | verify | Inventory needed | `WalletBalanceWidget`: current available balance (IRR/toman), charge button, low-balance warning if pending invoices exceed balance. Alert banner if wallet data fails to load. |
| `07-ui-ux-design.md#T-07.19.02.02` | verify | Inventory needed | `QuickStatusWidget`: grid of 4 small stat cards — Active Contracts, Pending Orders, Open Tickets, Unpaid Invoices. Each: icon + count + label + color indicator (green/yellow/red). Click navigates to filtered list. |
| `07-ui-ux-design.md#T-07.19.02.03` | verify | Recorded batch work | `PendingVerificationWidget` (staff): profiles awaiting verification. Count + last 5 entries + "Show all" link. |
| `07-ui-ux-design.md#T-07.19.02.04` | verify | Recorded batch work | `AgentInvitationWidget` (customer): banner for pending legal entity invitations. Accept/Decline buttons. Not dismissible until action taken. |
| `07-ui-ux-design.md#T-07.19.02.05` | verify | Recorded batch work | `LatestOrdersWidget`: last 5 orders with status, date, amount. "View all" link. |
| `07-ui-ux-design.md#T-07.19.02.06` | verify | Recorded batch work | `UpcomingInvoicesWidget`: next due invoices with amount, due date, days remaining. Color-coded urgency. Pay Now button. |
| `07-ui-ux-design.md#T-07.19.02.07` | verify | Recorded batch work | `ActiveContractsWidget`: active contracts with end date, status, progress. |
| `07-ui-ux-design.md#T-07.19.02.08` | verify | Recorded batch work | `StaffWorkQueueWidget` (staff): pending tickets, awaiting-review orders, unassigned consultations. Counts with links to each work queue. |
| `07-ui-ux-design.md#T-07.19.02.09` | verify | Recorded batch work | `FailedJobsWidget` (admin): failed background jobs count, failed notifications in dead-letter queue, unresolved refund obligations. Severity indicators. |
| `07-ui-ux-design.md#T-07.20.01.01` | verify | Recorded batch work | Build `AIChatPanel`: slide-over sheet from right (LTR) / left (RTL) triggered by a floating action button (bottom-right/bottom-left corner of the app). Contains: chat header (AI avatar + "Barghsa AI Assistant" + close button), message list (scrollable, auto-scroll to bottom), input area (textarea + send button + suggested prompts). |
| `07-ui-ux-design.md#T-07.20.01.02` | verify | Recorded batch work | Build `ChatMessage` component: user message (right-aligned, brand-colored bubble), AI message (left-aligned, muted bubble). AI messages include: text content, source KB citations (expandable "Sources" section with KB name + title + excerpt), policy filter badges applied. Timestamp per message. |
| `07-ui-ux-design.md#T-07.20.01.03` | verify | Recorded batch work | Build `ChatInput` component: auto-resizing textarea, send button (disabled while AI is responding), suggested prompt chips (3–4 contextual suggestions, e.g. "Show my invoices", "What's my wallet balance?"). Enter to send, Shift+Enter for newline. |
| `07-ui-ux-design.md#T-07.20.01.04` | verify | Recorded batch work | Build `ChatWelcome` component: greeting message ("Hi [name]! How can I help you today?"), suggested starting prompts, profile context indicator ("You're asking as [profile name]"). |
| `07-ui-ux-design.md#T-07.20.01.05` | verify | Recorded batch work | Implement streaming AI response: show typing indicator (animated dots) while waiting for response. Render response progressively as tokens arrive (SSE or WebSocket stream). |
| `07-ui-ux-design.md#T-07.20.01.06` | verify | Recorded batch work | Build `TrustedUIConfirmation` component: for write actions proposed by AI, show a structured action card above the chat input area. Card displays: action type, parameters, consequences. User confirms or rejects with explicit buttons. AI cannot programmatically confirm. |
| `07-ui-ux-design.md#T-07.20.01.07` | verify | Recorded batch work | Chat must respect user's language preference. AI responses in same language as user's messages. Date/number formatting locale-aware. |
| `07-ui-ux-design.md#T-07.20.01.08` | verify | Recorded batch work | Data isolation: Individual chatbot sees only Individual profile data. Legal chatbot sees only Legal profile data. Staff chatbot sees data based on staff roles. |
| `07-ui-ux-design.md#T-07.21.01.01` | verify | Recorded batch work | Build `AgentTestChat` component: agent selector dropdown (lists all agents), chat message list (reuses ChatMessage from E-07.20), input area + send button. Below chat: response metadata panel showing source KBs (expandable with excerpts), policy filters applied, token usage, latency. |
| `07-ui-ux-design.md#T-07.21.01.02` | verify | Recorded batch work | Build `ResponseMetadataPanel`: expandable sections for "Knowledge Bases Used" (KB name + document title + excerpt), "Policies Applied" (policy name + rule matched), "Token Usage" (prompt/completion/total), "Latency" (ms). |
| `07-ui-ux-design.md#T-07.21.01.03` | verify | Inventory needed | Build "New Conversation" button to clear test chat history. |
| `07-ui-ux-design.md#T-07.21.01.04` | verify | Inventory needed | Rate limit test chat: 10 requests/min per admin. Show remaining quota. Return 429 with retry-after. |
| `07-ui-ux-design.md#T-07.21.01.05` | verify | Inventory needed | Test chat is isolated — does not affect production conversations or AI audit logs. |
| `07-ui-ux-design.md#T-07.22.01.01` | verify | Recorded batch work | Build `FormWizard` component: step indicator (numbered circles with labels, completed/active/pending visual states, connector lines), step content area, navigation bar (Back/Save Draft/Next). Back button preserved on all non-first steps. Next validates current step fields only. |
| `07-ui-ux-design.md#T-07.22.01.02` | verify | Recorded batch work | Implement server-side draft saving: after each completed step, POST server draft. On resume, fetch draft and prefill form. Drafts have TTL (admin-configurable, default 7 days). |
| `07-ui-ux-design.md#T-07.22.01.03` | verify | Recorded batch work | Build `StepReviewPage`: final step showing all collected data in read-only format. Backend-rendered snapshot for financial orders (authoritative total). "Edit" links next to each section to return to that step. |
| `07-ui-ux-design.md#T-07.22.01.04` | verify | Recorded batch work | If user navigates away mid-wizard, show confirmation dialog: "You have unsaved changes. Save draft before leaving?" |
| `07-ui-ux-design.md#T-07.22.01.05` | verify | Recorded batch work | Wizard state preserved in URL (step number as search param) for deep-linkability. |
| `07-ui-ux-design.md#T-07.22.02.01` | verify | Inventory needed | Simple electricity order wizard: Step 1 (Period type: weekly/monthly + period selector), Step 2 (kWh entry with bill data suggestion), Step 3 (Price preview with green composition breakdown), Step 4 (Gift code optional), Step 5 (Review + submit). |
| `07-ui-ux-design.md#T-07.22.02.02` | verify | Inventory needed | Advanced electricity order wizard: Step 1 (Date range: start/end Jalali date pickers), Step 2 (Bundle builder: 4 product quantity inputs with green rule derivation), Step 3 (Price preview), Step 4 (Gift code), Step 5 (Review + submit). |
| `07-ui-ux-design.md#T-07.22.02.03` | verify | Recorded batch work | Solar construction request wizard: Step 1 (Solar type + property details), Step 2 (On-Grid/Off-Grid selection + bill identifier for On-Grid), Step 3 (Contract stages preview + TOS check), Step 4 (Review + submit). |
| `07-ui-ux-design.md#T-07.22.02.04` | verify | Inventory needed | Saving plan order wizard: Step 1 (Select plan), Step 2 (Select hardware), Step 3 (Bill identifier), Step 4 (Address select/add), Step 5 (Accept agreement + Review + Submit). |
| `07-ui-ux-design.md#T-07.22.02.05` | verify | Recorded batch work | Onboarding wizard: Step 1 (Select profile type: Individual/Legal), Step 2a (Individual: name, national ID, province/city, address, postal code), Step 2b (Legal: company info, representative, address, registration info), Step 3 (Review + Submit). |
| `07-ui-ux-design.md#T-07.23.01.01` | verify | Recorded batch work | Build `TicketListPage`: uses ListPage compound component. Columns: subject, status badge, priority indicator (P1/P2/P3), last update (relative time), related entity link. Expandable row on mobile. |
| `07-ui-ux-design.md#T-07.23.01.02` | verify | Recorded batch work | Build `TicketDetailPage`: header (subject, status badge, priority, created date, related entity), conversation thread, reply input area (for public reply), internal note toggle (staff only). |
| `07-ui-ux-design.md#T-07.23.01.03` | verify | Recorded batch work | Build `CommentThread` component: chronological message list. Customer comments (white bubble, left-aligned in LTR), Staff comments (brand-colored border, same alignment), Internal notes (yellow background, "INTERNAL" badge, visible only to staff). Each comment: author avatar + name, timestamp, content, attachment thumbnails. |
| `07-ui-ux-design.md#T-07.23.01.04` | verify | Recorded batch work | Build `TicketReplyInput`: textarea with formatting toolbar (bold, italic, list, link), file upload (drag & drop), "Add internal note" toggle (staff only), "Submit reply" button. |
| `07-ui-ux-design.md#T-07.23.01.05` | verify | Recorded batch work | Build `TicketStatusDropdown` (staff): change ticket status with reason input. Statuses: Open, In Progress, Waiting on Customer, Waiting on Staff, Resolved, Closed. |
| `07-ui-ux-design.md#T-07.23.01.06` | verify | Recorded batch work | Staff internal notes must never be visible to customers. Backend enforces visibility flag. Frontend never renders internal notes when role is customer. |
| `07-ui-ux-design.md#T-07.24.01.01` | verify | Recorded batch work | Build `DataTable` component using Base UI Table or TanStack Table. Features: column definition with header, accessor, cell renderer, sorting (client or server), row selection (checkbox), expandable rows (sub-row), sticky header, horizontal scroll for many columns, row hover highlight. |
| `07-ui-ux-design.md#T-07.24.01.02` | verify | Recorded batch work | Build column renderers: `TextCell`, `NumberCell` (locale-formatted), `DateCell` (localized relative/absolute), `StatusCell` (colored badge), `ActionCell` (dropdown menu with row actions), `CurrencyCell` (IRR/toman formatted), `AvatarCell` (small avatar + name), `LinkCell` (clickable reference). |
| `07-ui-ux-design.md#T-07.24.01.03` | verify | Recorded batch work | Build `CardListView` as mobile alternative: each row renders as a card showing key fields. Responsive switch at `md` breakpoint. |
| `07-ui-ux-design.md#T-07.24.01.04` | verify | Recorded batch work | Ensure table is keyboard navigable: Tab through rows, Enter/Space for row actions, arrow keys for sort/filter navigation. Screen reader announces row count, column headers, current sort. |
| `07-ui-ux-design.md#T-07.25.01.01` | verify | Recorded batch work | Build `FileUpload` component: drop zone (dashed border, icon, "Drag files here or click to browse" text), file list (name, size, progress bar per file), file type validation (extension + MIME against configured allowlist), size validation, max file count. Accessibility: keyboard-accessible drop zone, screen reader announces upload progress. |
| `07-ui-ux-design.md#T-07.25.01.02` | verify | Recorded batch work | Build `FilePreview` component: image preview (thumbnail), PDF preview (first page), document icon fallback. Used in document lists, ticket attachments, upload review. |
| `07-ui-ux-design.md#T-07.25.01.03` | verify | Recorded batch work | Build `DocumentStatusBadge` component: state labels with colored badges — Uploading (gray), Pending scan (yellow pulse), Available (green), Submitted for review (blue), Approved (green check), Rejected (red, with reason shown), Superseded (outline), Quarantined (red alert), Removed (gray strikethrough). |
| `07-ui-ux-design.md#T-07.25.01.04` | verify | Recorded batch work | Build `DocumentList` component: list of documents with icon, filename, size, upload date, status badge, download/delete/replace actions per permission. |
| `07-ui-ux-design.md#T-07.25.01.05` | verify | Recorded batch work | Upload validation errors must be specific: "PDF files up to 25MB are accepted", "File type .exe is not supported". |
| `07-ui-ux-design.md#T-07.25.01.06` | verify | Recorded batch work | Quarantined files show safe message: "This file cannot be accepted. Please upload a replacement." — never reveal malware detection details to customer. |
| `07-ui-ux-design.md#T-07.26.01.01` | verify | Recorded batch work | Build `Currency` component: displays amount in IRR with locale formatting. Props: `amount` (integer IRR), `showToman` (show toman equivalent in parentheses), `showCurrencyCode` (show "IRR" suffix), `variant` (default, large for wallet balance, small for inline). Persian format: `۱,۲۳۴,۵۶۷ ریال`, English format: `IRR 1,234,567`. |
| `07-ui-ux-design.md#T-07.26.01.02` | verify | Recorded batch work | Build `WalletBalanceCard`: available balance (large), posted balance (muted), reserved balance (muted, if > 0). "Charge wallet" button. Low-balance warning (red text) when pending invoices exceed balance. Clickable → navigates to wallet page. |
| `07-ui-ux-design.md#T-07.26.01.03` | verify | Recorded batch work | Build `TransactionList` component: chronological list of wallet transactions. Each row: date (localized), type icon + label (top-up, payment, refund, etc.), amount (+/- in green/red), state badge, description, reference link. Cursor-based pagination. |
| `07-ui-ux-design.md#T-07.26.01.04` | verify | Recorded batch work | Build `InvoicePaymentSummary`: shows invoice total, paid amount (green progress fill), remaining amount (red if > 0), payment status bar, wallet pay button (enabled if sufficient balance). |
| `07-ui-ux-design.md#T-07.27.01.01` | verify | Recorded batch work | Build `StatusBadge` component: maps state strings to colored badges. Color map: `pending/waiting` → yellow, `active/approved/paid/signed` → green, `rejected/cancelled/failed` → red, `draft/submitted` → blue, `completed/resolved` → gray. Supports dot-only variant. Each badge has a descriptive title attribute. |
| `07-ui-ux-design.md#T-07.27.01.02` | verify | Recorded batch work | Build `StatusTimeline` component: vertical timeline showing state transitions. Each entry: dot (colored by state), date (localized), state label (i18n), actor name, reason/note. Used in: order detail, contract detail, invoice detail, consultation detail. |
| `07-ui-ux-design.md#T-07.27.01.03` | verify | Recorded batch work | Build `ProgressStepper` component: horizontal step indicator (used for solar construction stages, saving plan fulfillment). Steps: completed (green check), current (blue circle + pulse), pending (gray circle). Connector lines between steps. |
| `07-ui-ux-design.md#T-07.27.01.04` | verify | Recorded batch work | Build `DualStatusDisplay` for electricity orders: shows commercial status (e.g. "Active") AND financial status (e.g. "Paid") as two separate labeled badges side by side. Never combine into one. |
| `07-ui-ux-design.md#T-07.27.01.05` | verify | Recorded batch work | Build `NotificationStatusBadge` component: maps notification classification (security, payment, contract, order, system, document) to icon + color. Used in notification center and notification dropdown. Customer-visible notification types always show a label and icon. |
| `07-ui-ux-design.md#T-07.27.01.06` | verify | Recorded batch work | Build `SolarStageProgress` component: horizontal progress stepper specific to solar construction postal stages — Document review, Contract signing, Postal submission, In-progress, Delivered, Installed. Each stage shows status (pending/current/completed), date, and detail. Composes `ProgressStepper` from T-07.27.01.03. Owned by E-03. |
| `07-ui-ux-design.md#T-07.27.01.07` | verify | Recorded batch work | All status labels are i18n. Persian labels match the product's business language (e.g. `در انتظار بررسی` not `Pending`). |
| `07-ui-ux-design.md#T-07.28.01.01` | verify | Recorded batch work | Build `OnboardingPage`: full-page wizard (not inside AppShell). Step 1: "What type of profile would you like to create?" — two large cards with icons: "Individual" and "Legal Entity". User can select one or both (checkboxes). "Continue" button. |
| `07-ui-ux-design.md#T-07.28.01.02` | verify | Recorded batch work | Build `IndividualProfileForm`: title (optional, text input), first name (required), last name (required), province → city cascading selects (fetched from API), full address (textarea), postal code (required, 10-digit Iranian format validation), national ID number (required, 10-digit validation). Save as draft after each step. |
| `07-ui-ux-design.md#T-07.28.01.03` | verify | Recorded batch work | Build `LegalProfileForm`: legal name (required), national identifier / شناسه ملی (required, unique), registration number (required), company type dropdown (required), registration date (optional Jalali date picker), economic code (optional), official phone/email (optional), province → city → address → postal code (required), authorized representative name + title (required), optional document uploads. |
| `07-ui-ux-design.md#T-07.28.01.04` | verify | Recorded batch work | Build `OnboardingReviewPage`: shows created profile(s) summary. "Done" button redirects to `/app/dashboard` with first profile selected as default. |
| `07-ui-ux-design.md#T-07.28.01.05` | verify | Recorded batch work | If user has no profiles and tries to access any `/app/*` route, redirect to `/onboarding`. |
| `07-ui-ux-design.md#T-07.29.01.01` | verify | Recorded batch work | Build `AgentListPage`: list of all agents for the active legal profile. Columns: avatar + name, username (masked email/mobile), role badges (Manager/Finance/Legal), status (active/pending), invited date, last active date. Owner has crown icon. Owner row shows "Transfer ownership" action. "Invite agent" button. |
| `07-ui-ux-design.md#T-07.29.01.02` | verify | Recorded batch work | Build `InviteAgentDialog`: input field for username (email or mobile), role radio/select (Manager, Finance, Legal), optional message. "Send invitation" button. Validates: cannot invite existing agent, cannot invite self. |
| `07-ui-ux-design.md#T-07.29.01.03` | verify | Recorded batch work | Build `AgentDetailDialog`: shows agent details, role, activity history. Actions: change role, remove agent (with destructive confirmation dialog), withdraw pending invite. |
| `07-ui-ux-design.md#T-07.29.01.04` | verify | Recorded batch work | Build `AgentInvitationBanner` (on dashboard): when the current user has been invited to a legal entity, show a prominent card: "You've been invited to join [Legal Entity Name] by [Inviter Name]". Accept / Decline buttons. Not dismissible until action taken. |
| `07-ui-ux-design.md#T-07.29.01.05` | verify | Recorded batch work | Removing the last owner is blocked unless ownership is transferred first. Show explanatory message. |
| `07-ui-ux-design.md#T-07.30.01.01` | verify | Recorded batch work | Build `AdminSettingsLayout`: nested sidebar navigation (left) + content area (right). Categories: Branding, Staff & Roles, Geography, Products, Pricing & VAT, Gift Codes, Notifications, Documents, Electricity, AI Orchestration, Security, System. Section collapse on mobile into dropdown. |
| `07-ui-ux-design.md#T-07.30.01.02` | verify | Recorded batch work | Build `SettingsFormSection` pattern: card with title, description, form fields. Save button per section (not full page save). Shows toast on success. |
| `07-ui-ux-design.md#T-07.30.01.03` | verify | Recorded batch work | Build `VersionedSettingsCard`: shows current active config, last updated date, updated by. "Edit" button opens edit mode. Save creates Draft version. "Activate" button promotes Draft to Active. "View history" shows versions (date, author, status badge). Rollback button on superseded versions. |
| `07-ui-ux-design.md#T-07.30.01.04` | verify | Recorded batch work | Build `ConfigPreviewCard`: side-by-side "Current" vs "Draft" comparison. Used for branding preview, template changes, VAT rate changes. |
| `07-ui-ux-design.md#T-07.30.01.05` | verify | Recorded batch work | Build `AuditLogViewer`: timeline of config changes — field changed, old value, new value, changed by, timestamp. Expandable per entry. |
| `07-ui-ux-design.md#T-07.30.01.06` | verify | Recorded batch work | Build `StepUpAuthGate`: when admin attempts a sensitive action (provider config, refund threshold, role change), show MFA step-up dialog. User re-authenticates (OTP) and the action proceeds only after successful step-up. Dialog shows "Sensitive action requires re-authentication." |
| `07-ui-ux-design.md#T-07.30.02.01` | verify | Inventory needed | BrandingSettingsPage: logo upload with preview (light + dark), color pickers (primary, secondary, accent), app title inputs (FA/EN), favicon upload, preview toggle, versioned save + activate. |
| `07-ui-ux-design.md#T-07.30.02.02` | verify | Recorded batch work | StaffRolesPage: roles table with permissions grouped by module (checkbox grid). Read-only for predefined roles initially. "View effective permissions" per staff user. |
| `07-ui-ux-design.md#T-07.30.02.03` | verify | Recorded batch work | GeographyPage: provinces table with expandable cities per row. Add/edit/delete actions. Persian and English names. Bulk import for city seed. |
| `07-ui-ux-design.md#T-07.30.02.04` | verify | Inventory needed | TosEditorPage: rich text editor (TipTap-like) with side-by-side diff against current active version, "Mark as material change" toggle, version history list. |
| `07-ui-ux-design.md#T-07.30.02.05` | verify | Recorded batch work | NotificationTemplatesPage: template list (event key filter, language toggle, channel filter), template editor with variable sidebar, preview pane with sample data, test send button. |
| `07-ui-ux-design.md#T-07.30.02.06` | verify | Recorded batch work | EmailProviderPage: provider selector (SMTP/Resend), conditional credential fields (secrets masked), test connection button, activate/disable/rollback buttons, current active version display. |
| `07-ui-ux-design.md#T-07.30.02.07` | verify | Recorded batch work | SmsProviderPage: API key (masked), sender line, throughput, low-credit threshold. Template mapping sub-section: event key → SMS template ID + variable mapping. Test send. |
| `07-ui-ux-design.md#T-07.30.02.08` | verify | Recorded batch work | AiOrchestrationPage: nested tabs — Models (table + add/edit), Knowledge Bases (tree/list + upload + processing status), Policies (list + editor), Agents (list + create/edit + test chat at bottom), Agent Slots (table + assignment dropdown). |
| `07-ui-ux-design.md#T-07.30.02.09` | verify | Inventory needed | ElectricitySettingsPage: two sections (Simple/Advanced green rule), each with enable toggle, threshold input, percentage slider. Online top-up limit. Max contract duration, lead days. Customer increase max %. Safety validation on activation. |
| `07-ui-ux-design.md#T-07.30.02.10` | verify | Inventory needed | VatSettingsPage: table of VAT configurations (category, rate, effective dates), product override toggle. Add new rate with future effective date. |
| `07-ui-ux-design.md#T-07.30.02.11` | verify | Inventory needed | GiftCodesPage: codes list with search/filter, create/edit form, usage statistics per code, active/inactive toggle. |
| `07-ui-ux-design.md#T-07.30.02.12` | verify | Recorded batch work | UploadPoliciesPage: table (category, allowed formats, max size), edit modal per category. Deployment-safe boundary warnings. |
| `07-ui-ux-design.md#T-07.30.02.13` | verify | Inventory needed | DualApprovalPage: threshold input (IRR) with large number format, description of affected actions. Step-up required to change. Emergency override section. |
| `07-ui-ux-design.md#T-07.30.02.14` | verify | Recorded batch work | VerificationSettingsPage: identity verification requirements per profile type (Individual/Legal), required document types, verification expiry, auto-verification for staff profiles, manual verification override. Versioned settings with Draft → Active lifecycle. |
| `07-ui-ux-design.md#T-07.30.02.15` | verify | Recorded batch work | ServiceTargetsPage: admin page for configuring service-level targets — max response time per ticket priority, max order fulfillment time, max contract review time, max verification time. Each target: service type, threshold (hours/days), escalation rule, notification trigger. |
| `07-ui-ux-design.md#T-07.30.02.16` | verify | Recorded batch work | TeamAssignmentPage: staff team management — create teams (Support, Finance, Operations, Legal), assign staff to teams, set team lead, configure auto-assignment rules (round-robin, least-loaded, skill-based), team escalation path. |
| `07-ui-ux-design.md#T-07.30.02.17` | verify | Inventory needed | EscalationRulesPage: configure escalation rules — condition (e.g. SLA breached, ticket priority), from-role/team, to-role/team, notification behavior, auto-escalation timeout. Used for ticket, order review, and verification workflows. |

## v0.6.0: Production readiness

Infrastructure, security, migration, provider configuration, backups, monitoring and recovery are proven for the selected production topology.

| Qualified task | State | Build evidence | Required work |
| --- | --- | --- | --- |
| `release-readiness#R-05.01` | blocked | Inventory needed | Resolve the six recorded owner decisions |
| `release-readiness#R-05.02` | todo | Inventory needed | Renew security and operational task acceptance |
| `release-readiness#R-05.03` | todo | Inventory needed | Prove production deployment, backup and recovery prerequisites |
| `01-platform-infrastructure.md#T-01.01.01` | done | Earlier acceptance_verified | Create `pnpm-workspace.yaml` with `packages: ['apps/*', 'packages/*']` and verify `pnpm install` resolves correctly |
| `01-platform-infrastructure.md#T-01.01.02` | verify | Earlier acceptance_verified | Create root `turbo.json` pipeline definition |
| `01-platform-infrastructure.md#T-01.01.03` | verify | Earlier acceptance_verified | Create root `.npmrc` with strict peer dependencies and no shameful hoisting |
| `01-platform-infrastructure.md#T-01.01.04` | verify | Earlier acceptance_verified | Create root `package.json` with `packageManager`, scripts, and engines constraint |
| `01-platform-infrastructure.md#T-01.01.05` | verify | Earlier acceptance_verified | Verify monorepo integrity: install deps, run `turbo build` across all packages, confirm no cross-package resolution errors |
| `01-platform-infrastructure.md#T-01.02.01` | done | Earlier acceptance_verified | Create `packages/tsconfig/base.json` with strict shared settings |
| `01-platform-infrastructure.md#T-01.02.02` | verify | Earlier acceptance_verified | Configure per-package tsconfig with project references in each of: `packages/db`, `packages/shared`, `packages/i18n`, `packages/ui`, `apps/web`, `apps/api` |
| `01-platform-infrastructure.md#T-01.02.03` | done | Earlier acceptance_verified | Create root-level `tsconfig.json` that references all sub-projects with `files: []` so IDE picks up project references |
| `01-platform-infrastructure.md#T-01.02.04` | verify | Earlier acceptance_verified | Wire `turbo.json` `typecheck` task and CI step to run `turbo typecheck` |
| `01-platform-infrastructure.md#T-01.03.01` | verify | Earlier acceptance_verified | Configure Vite SPA build pipeline in `apps/web` |
| `01-platform-infrastructure.md#T-01.03.02` | verify | Earlier acceptance_verified | Configure NestJS build pipeline in `apps/api` |
| `01-platform-infrastructure.md#T-01.03.03` | verify | Earlier acceptance_verified | Implement route-level code splitting and lazy loading for heavy modules |
| `01-platform-infrastructure.md#T-01.03.04` | verify | Earlier acceptance_verified | Implement bundle budget checking in CI |
| `01-platform-infrastructure.md#T-01.03.05` | verify | Earlier acceptance_verified | Configure hashed filenames and CDN-ready public asset output |
| `01-platform-infrastructure.md#T-01.04.01` | verify | Earlier acceptance_verified | Create root `vitest.workspace.ts` that includes all packages and apps |
| `01-platform-infrastructure.md#T-01.04.02` | verify | Earlier acceptance_verified | Configure per-package Vitest with coverage thresholds |
| `01-platform-infrastructure.md#T-01.04.03` | partial | Earlier partial | Configure backend integration test setup with real PostgreSQL |
| `01-platform-infrastructure.md#T-01.04.04` | partial | Earlier partial | Configure Playwright for E2E testing |
| `01-platform-infrastructure.md#T-01.04.05` | verify | Earlier acceptance_verified | Wire `test` and `test:coverage` tasks in `turbo.json` |
| `01-platform-infrastructure.md#T-01.04.06` | partial | Earlier partial | Configure flaky-test quarantine process |
| `01-platform-infrastructure.md#T-01.05.01` | verify | Earlier acceptance_verified | Implement global NestJS `HttpExceptionFilter` and `CorrelationIdMiddleware` |
| `01-platform-infrastructure.md#T-02.01.01` | verify | Earlier acceptance_verified | Initialize `packages/db` with Drizzle ORM, `pg`, `pg-pool`, and drizzle-kit |
| `01-platform-infrastructure.md#T-02.01.02` | verify | Earlier acceptance_verified | Create PostgreSQL pool factory with configurable pool, statement timeout, lock timeout, and idle transaction guard |
| `01-platform-infrastructure.md#T-02.01.03` | verify | Earlier acceptance_verified | Implement query timeout and cancellation via Drizzle configuration |
| `01-platform-infrastructure.md#T-02.01.04` | verify | Earlier acceptance_verified | Set up database health check endpoint for readiness probes |
| `01-platform-infrastructure.md#T-02.02.01` | done | Earlier acceptance_verified | Create `packages/db/src/types.ts` with custom Drizzle type definitions |
| `01-platform-infrastructure.md#T-02.02.02` | partial | Earlier partial | Create base table factory with `id`, `createdAt`, `updatedAt` columns |
| `01-platform-infrastructure.md#T-02.02.03` | verify | Earlier acceptance_verified | Create UUIDv7 generation function migration |
| `01-platform-infrastructure.md#T-02.02.04` | verify | Earlier acceptance_verified | Document and enforce column conventions in ADR |
| `01-platform-infrastructure.md#T-02.03.01` | verify | Earlier acceptance_verified | Configure `drizzle.config.ts` in `packages/db` |
| `01-platform-infrastructure.md#T-02.03.02` | partial | Earlier partial | Create migration runner script for production deployments |
| `01-platform-infrastructure.md#T-02.03.03` | verify | Earlier acceptance_verified | Create migration validation test (clean + upgrade path) |
| `01-platform-infrastructure.md#T-02.03.04` | verify | Earlier acceptance_verified | Implement expand/migrate/contract documentation and PR checklist |
| `01-platform-infrastructure.md#T-02.04.01` | verify | Earlier acceptance_verified | Create seed script `packages/db/src/seed/index.ts` |
| `01-platform-infrastructure.md#T-02.04.02` | verify | Earlier acceptance_verified | Create four default electricity products in seed |
| `01-platform-infrastructure.md#T-02.04.03` | verify | Earlier acceptance_verified | Create admin bootstrap mechanism |
| `01-platform-infrastructure.md#T-02.04.04` | partial | Earlier partial | Wire `pnpm db:seed` script in `packages/db/package.json` |
| `01-platform-infrastructure.md#T-02.04.05` | verify | Earlier acceptance_verified | Add seed verification test |
| `01-platform-infrastructure.md#T-02.04.06` | verify | Earlier acceptance_verified | Configure database constraint to prevent deletion of system electricity products and creation of additional electricity-product types |
| `01-platform-infrastructure.md#T-03.01.01` | partial | Earlier partial | Create `Dockerfile.web` with multi-stage build |
| `01-platform-infrastructure.md#T-03.01.02` | partial | Earlier partial | Create shared `Dockerfile.base` for API and worker (same build, different CMD) |
| `01-platform-infrastructure.md#T-03.01.03` | verify | Earlier acceptance_verified | Create `.dockerignore` |
| `01-platform-infrastructure.md#T-03.01.04` | verify | Earlier acceptance_verified | Add `HEALTHCHECK` instruction to all Dockerfiles |
| `01-platform-infrastructure.md#T-03.01.05` | verify | Earlier acceptance_verified | Implement security hardening in Docker images |
| `01-platform-infrastructure.md#T-03.02.01` | verify | Earlier acceptance_verified | Create `docker-compose.yml` with PostgreSQL, Redis, MinIO |
| `01-platform-infrastructure.md#T-03.02.02` | verify | Earlier acceptance_verified | Create `.env.example` with all required development variables |
| `01-platform-infrastructure.md#T-03.02.03` | verify | Earlier acceptance_verified | Create root `pnpm dev` script for hot-reload local development across all apps |
| `01-platform-infrastructure.md#T-03.02.04` | verify | Earlier acceptance_verified | Configure file-watch with proper polling for Docker-for-Mac compatibility |
| `01-platform-infrastructure.md#T-03.03.01` | verify | Earlier acceptance_verified | Implement liveness and readiness controllers in NestJS API |
| `01-platform-infrastructure.md#T-03.03.02` | verify | Earlier acceptance_verified | Implement graceful `SIGTERM` handler for NestJS API and worker |
| `01-platform-infrastructure.md#T-03.03.03` | verify | Earlier acceptance_verified | Implement graceful shutdown for web frontend server |
| `01-platform-infrastructure.md#T-03.03.04` | partial | Earlier partial | Add readiness check that excludes non-critical dependencies |
| `01-platform-infrastructure.md#T-04.01.01` | partial | Earlier partial | Configure PostgreSQL connection pooling strategy |
| `01-platform-infrastructure.md#T-04.01.02` | partial | Earlier partial | Configure automated backups with WAL archiving and PITR |
| `01-platform-infrastructure.md#T-04.01.03` | partial | Earlier partial | Document and automate restore procedure |
| `01-platform-infrastructure.md#T-04.01.04` | partial | Earlier partial | Implement PostgreSQL performance baseline and monitoring |
| `01-platform-infrastructure.md#T-04.01.05` | partial | Earlier partial | Quarterly restore exercise |
| `01-platform-infrastructure.md#T-04.01.06` | partial | Earlier partial | Hybrid deployment: separate managed PostgreSQL from app VM |
| `01-platform-infrastructure.md#T-04.01.07` | partial | Earlier partial | Encrypted off-server backup of config, secrets, and critical application files |
| `01-platform-infrastructure.md#T-04.02.01` | done | Earlier acceptance_verified | Create Redis connection factory with graceful fallback |
| `01-platform-infrastructure.md#T-04.02.02` | verify | Earlier acceptance_verified | Implement distributed rate-limiting with Redis acceleration + PostgreSQL fallback |
| `01-platform-infrastructure.md#T-04.02.03` | verify | Earlier acceptance_verified | Implement configuration caching with clear invalidation |
| `01-platform-infrastructure.md#T-04.02.04` | done | Earlier acceptance_verified | Document Redis architecture decision in ADR |
| `01-platform-infrastructure.md#T-04.03.01` | verify | Earlier acceptance_verified | Create S3 storage provider abstraction |
| `01-platform-infrastructure.md#T-04.03.02` | verify | Earlier acceptance_verified | Implement presigned URL workflow for direct browser upload/download |
| `01-platform-infrastructure.md#T-04.03.03` | partial | Earlier partial | Configure bucket versioning and lifecycle policies |
| `01-platform-infrastructure.md#T-04.03.04` | verify | Earlier acceptance_verified | Create admin configuration UI for storage |
| `01-platform-infrastructure.md#T-04.03.05` | partial | Earlier partial | Enforce immutability for signed contracts and critical records |
| `01-platform-infrastructure.md#T-04.04.01` | verify | Earlier acceptance_verified | Create NGINX/Caddy configuration for pilot (single-node) topology |
| `01-platform-infrastructure.md#T-04.04.02` | partial | Earlier partial | Configure security headers in reverse proxy |
| `01-platform-infrastructure.md#T-04.04.03` | verify | Earlier acceptance_verified | Configure edge rate limiting for auth, upload, and AI endpoints |
| `01-platform-infrastructure.md#T-04.04.04` | verify | Earlier acceptance_verified | Configure static asset caching and CDN readiness |
| `01-platform-infrastructure.md#T-04.04.05` | verify | Earlier acceptance_verified | Implement ETag support for safe metadata endpoints |
| `01-platform-infrastructure.md#T-05.01.01` | verify | Earlier deferred | Create Ansible playbook or deploy script for pilot topology |
| `01-platform-infrastructure.md#T-05.01.02` | verify | Earlier deferred | Create `docker-compose.prod.yml` for pilot single-VM deployment |
| `01-platform-infrastructure.md#T-05.01.03` | verify | Earlier deferred | Document explicitly that single-server deployment has lower availability |
| `01-platform-infrastructure.md#T-05.02.01` | verify | Earlier deferred | Design and document commercial HA topology |
| `01-platform-infrastructure.md#T-05.02.02` | verify | Earlier deferred | Configure rolling/blue-green deployment automation for HA |
| `01-platform-infrastructure.md#T-05.02.03` | verify | Earlier deferred | Implement circuit breaker for external providers |
| `01-platform-infrastructure.md#T-05.02.04` | verify | Earlier deferred | Configure maintenance mode per capability, not whole-application |
| `01-platform-infrastructure.md#T-05.03.01` | verify | Earlier deferred | Create CI workflow definition (GitHub Actions, GitLab CI, or equivalent) |
| `01-platform-infrastructure.md#T-05.03.02` | verify | Earlier deferred | Implement migration validation step (two environments) |
| `01-platform-infrastructure.md#T-05.03.03` | verify | Earlier deferred | Implement OpenAPI generation and drift check |
| `01-platform-infrastructure.md#T-05.03.04` | verify | Earlier deferred | Configure security scans in PR gate |
| `01-platform-infrastructure.md#T-05.03.05` | verify | Earlier deferred | Implement coverage threshold enforcement |
| `01-platform-infrastructure.md#T-05.04.01` | verify | Earlier deferred | Create staging gate CI workflow |
| `01-platform-infrastructure.md#T-05.04.02` | verify | Earlier deferred | Create production promotion workflow with canary/gradual rollout |
| `01-platform-infrastructure.md#T-05.04.03` | verify | Earlier deferred | Implement post-deploy smoke tests and SLO comparison |
| `01-platform-infrastructure.md#T-05.04.04` | verify | Earlier deferred | Create runbooks for rollback scenarios |
| `01-platform-infrastructure.md#T-05.05.01` | verify | Earlier deferred | Create nightly CI schedule |
| `01-platform-infrastructure.md#T-05.05.02` | verify | Earlier deferred | Create weekly load/performance regression test |
| `01-platform-infrastructure.md#T-05.05.03` | verify | Earlier deferred | Create quarterly disaster-recovery and restore exercise |
| `01-platform-infrastructure.md#T-05.05.04` | verify | Earlier deferred | Create quarterly access review and threat-model update |
| `01-platform-infrastructure.md#T-06.01.01` | verify | Earlier deferred | Initialize `packages/shared` with tsconfig and dependencies |
| `01-platform-infrastructure.md#T-06.01.02` | verify | Earlier deferred | Create username validation and normalization helpers |
| `01-platform-infrastructure.md#T-06.01.03` | verify | Earlier deferred | Create password validation with strength meter logic |
| `01-platform-infrastructure.md#T-06.01.04` | verify | Earlier acceptance_verified | Create stable error code enum with HTTP status mapping |
| `01-platform-infrastructure.md#T-06.01.05` | verify | Earlier deferred | Create pagination helper schemas |
| `01-platform-infrastructure.md#T-06.02.01` | verify | Earlier deferred | Initialize `packages/i18n` with message dictionary structure |
| `01-platform-infrastructure.md#T-06.02.02` | verify | Earlier deferred | Create Jalali calendar date utilities |
| `01-platform-infrastructure.md#T-06.02.03` | verify | Earlier acceptance_verified | Create timezone-aware date/time display utilities |
| `01-platform-infrastructure.md#T-06.02.04` | verify | Earlier acceptance_verified | Create logic for RTL/LTR switching based on locale |
| `01-platform-infrastructure.md#T-06.02.05` | verify | Earlier acceptance_verified | Localize number/currency formatting |
| `01-platform-infrastructure.md#T-06.03.01` | verify | Earlier deferred | Initialize `packages/ui` with shadcn/ui and Base UI |
| `01-platform-infrastructure.md#T-06.03.02` | verify | Earlier acceptance_verified | Create themed component set with RTL support |
| `01-platform-infrastructure.md#T-06.03.03` | verify | Earlier acceptance_verified | Implement WCAG 2.2 AA accessibility in all shared components |
| `01-platform-infrastructure.md#T-06.03.04` | verify | Earlier acceptance_verified | Create localized DatePicker component |
| `01-platform-infrastructure.md#T-06.03.05` | partial | Earlier partial | Implement theme system with admin overrides |
| `01-platform-infrastructure.md#T-06.03.06` | verify | Earlier acceptance_verified | Create loading/empty/error state components |
| `01-platform-infrastructure.md#T-06.04.01` | verify | Earlier deferred | Create privacy-safe analytics abstraction with consent gate and redaction |
| `01-platform-infrastructure.md#T-07.01.01` | verify | Earlier deferred | Create `pnpm setup:dev` convenience script |
| `01-platform-infrastructure.md#T-07.01.02` | verify | Earlier deferred | Configure dev-mode OTP bypass and console printing |
| `01-platform-infrastructure.md#T-07.01.03` | verify | Earlier deferred | Create `pnpm db:push` script for dev schema synchronization |
| `01-platform-infrastructure.md#T-07.01.04` | verify | Earlier deferred | Add environment indicator middleware |
| `01-platform-infrastructure.md#T-07.02.01` | verify | Earlier deferred | Create versioned configuration store in PostgreSQL |
| `01-platform-infrastructure.md#T-07.02.02` | verify | Earlier deferred | Create configuration validation framework |
| `01-platform-infrastructure.md#T-07.02.03` | verify | Earlier deferred | Implement configuration rollback |
| `01-platform-infrastructure.md#T-07.02.04` | verify | Earlier deferred | Create secrets encryption and masking service |
| `01-platform-infrastructure.md#T-07.02.05` | verify | Earlier deferred | Implement provider configuration lifecycle with test-send |
| `01-platform-infrastructure.md#T-07.03.01` | verify | Earlier deferred | Create shared ESLint configuration |
| `01-platform-infrastructure.md#T-07.03.02` | verify | Earlier deferred | Configure Prettier with consistent formatting |
| `01-platform-infrastructure.md#T-07.03.03` | verify | Earlier deferred | Set up Husky, lint-staged, and commitlint |
| `01-platform-infrastructure.md#T-07.03.04` | verify | Earlier deferred | Create `.editorconfig` and `.vscode` workspace settings |
| `01-platform-infrastructure.md#T-07.04.01` | verify | Earlier deferred | Create incident runbooks directory (`docs/runbooks/`) |
| `01-platform-infrastructure.md#T-07.04.02` | verify | Earlier deferred | Create initial ADRs |
| `01-platform-infrastructure.md#T-07.04.03` | verify | Earlier deferred | Create deployment guide |
| `01-platform-infrastructure.md#T-07.04.04` | verify | Earlier deferred | Create incident response plan |
| `01-platform-infrastructure.md#T-07.05.01` | verify | Earlier deferred | Enforce “no external call inside a database transaction” |
| `01-platform-infrastructure.md#T-07.05.02` | verify | Earlier deferred | Generate and verify TypeScript API client contracts from OpenAPI |
| `01-platform-infrastructure.md#T-07.05.03` | verify | Earlier deferred | Verify health-endpoint middleware exclusions |
| `01-platform-infrastructure.md#T-07.05.04` | verify | Earlier deferred | Document and gate module extraction criteria |
| `06-security-testing-observability.md#T-06.01.01.01` | verify | Inventory needed | Implement `PasswordService` with Argon2id via Node.js crypto bindings (e.g. `argon2` npm package) |
| `06-security-testing-observability.md#T-06.01.01.02` | verify | Inventory needed | Create benchmark script to determine optimal cost/time/memory/parallelism parameters for target hardware |
| `06-security-testing-observability.md#T-06.01.01.03` | verify | Inventory needed | Store benchmarked parameters in configuration (env vars / admin settings); allow overriding per env |
| `06-security-testing-observability.md#T-06.01.01.04` | verify | Inventory needed | Ensure passwords are hashed with a per-password cryptographically random salt (16+ bytes) |
| `06-security-testing-observability.md#T-06.01.01.05` | verify | Inventory needed | Add migration for existing plain/hash migration if any; ensure seamless upgrade |
| `06-security-testing-observability.md#T-06.01.01.06` | verify | Inventory needed | Write unit tests: hash verification, salt uniqueness, cost parameter changes, timing-safe comparison |
| `06-security-testing-observability.md#T-06.01.01.07` | verify | Inventory needed | Security review: confirm no plaintext password leaks via error paths, logs, analytics, or serialization |
| `06-security-testing-observability.md#T-06.01.02.01` | verify | Inventory needed | Implement `OtpService` with cryptographically random OTP generation (6-digit numeric) |
| `06-security-testing-observability.md#T-06.01.02.02` | verify | Inventory needed | Store OTPs as SHA-256/Argonid hashes; never store plaintext |
| `06-security-testing-observability.md#T-06.01.02.03` | verify | Inventory needed | Implement attempt counter (max 5 per challenge → auto-invalidate) |
| `06-security-testing-observability.md#T-06.01.02.04` | verify | Inventory needed | Implement TTL expiry (configurable: default 5 min) with cleanup job |
| `06-security-testing-observability.md#T-06.01.02.05` | verify | Inventory needed | Implement rate limiting: 1 OTP per destination per 60s, 5/hour, 10/day; IP + device aggregates |
| `06-security-testing-observability.md#T-06.01.02.06` | verify | Inventory needed | Ensure all OTP responses are generic ("If valid, an OTP was sent") — never reveal account existence |
| `06-security-testing-observability.md#T-06.01.02.07` | verify | Inventory needed | Invalidate OTP after: successful verification, replacement request, expiry, or account compromise |
| `06-security-testing-observability.md#T-06.01.02.08` | verify | Inventory needed | Print OTP to console in DEV environment only; never in production logs |
| `06-security-testing-observability.md#T-06.01.02.09` | verify | Inventory needed | Write integration tests: OTP create, verify, consume, expire, exceed attempts, rate limit |
| `06-security-testing-observability.md#T-06.01.03.01` | verify | Inventory needed | Design MFA enforcement engine: risk rules for customers, mandatory for staff/admins |
| `06-security-testing-observability.md#T-06.01.03.02` | verify | Inventory needed | Implement step-up authentication gate for sensitive actions (payment confirmation, refunds, role changes, credential changes, session revocation) |
| `06-security-testing-observability.md#T-06.01.03.03` | verify | Inventory needed | Implement device fingerprinting and trust scoring (cookie-based device ID, user-agent, IP geo, known device list) |
| `06-security-testing-observability.md#T-06.01.03.04` | verify | Inventory needed | Build "trust this device for N days" flow with visible trust management UI |
| `06-security-testing-observability.md#T-06.01.03.05` | verify | Inventory needed | Build device management UI: list active devices, trust status, last seen, revoke individual device or all devices |
| `06-security-testing-observability.md#T-06.01.03.06` | verify | Inventory needed | Ensure OTP is re-requested when step-up is triggered |
| `06-security-testing-observability.md#T-06.01.03.07` | verify | Inventory needed | Write integration tests: customer MFA only on new device, staff MFA always, step-up for sensitive ops, device trust expiry |
| `06-security-testing-observability.md#T-06.01.04.01` | verify | Inventory needed | Implement opaque session token generation and cookie management (HttpOnly, Secure in prod, SameSite policy per T-06.02.01.04, Path) |
| `06-security-testing-observability.md#T-06.01.04.02` | verify | Inventory needed | Implement session store in PostgreSQL (not Redis; Redis is optional, auth must work without it) |
| `06-security-testing-observability.md#T-06.01.04.03` | verify | Inventory needed | Implement session rotation: login, MFA step-up, password change, privilege change, account recovery |
| `06-security-testing-observability.md#T-06.01.04.04` | verify | Inventory needed | Implement refresh token rotation with reuse detection (stealing detection + user alert + revoke token family) |
| `06-security-testing-observability.md#T-06.01.04.05` | verify | Inventory needed | Implement absolute session expiry (configurable, e.g. 7 days) + idle expiry (configurable, e.g. 30 min) |
| `06-security-testing-observability.md#T-06.01.04.06` | verify | Inventory needed | Build session/device management UI: list active sessions, device info, last activity, revoke action |
| `06-security-testing-observability.md#T-06.01.04.07` | verify | Inventory needed | Implement session revocation triggers: password reset, staff disablement, ownership transfer, compromise detection |
| `06-security-testing-observability.md#T-06.01.04.08` | verify | Inventory needed | Ensure tokens, refresh tokens, OTPs, passwords, national IDs never in localStorage, URLs, analytics, or client logs |
| `06-security-testing-observability.md#T-06.01.04.09` | verify | Inventory needed | Write concurrency tests: session fixation prevention, refresh token reuse, simultaneous session mutations |
| `06-security-testing-observability.md#T-06.01.04.10` | verify | Inventory needed | Security review: verify no cookie leakage, no fixation vectors, proper SameSite/Path/Domain/HostOnly |
| `06-security-testing-observability.md#T-06.02.01.01` | verify | Inventory needed | Implement CSRF token service: generate per-session token, store in session store, validate custom header |
| `06-security-testing-observability.md#T-06.02.01.02` | verify | Inventory needed | Implement NestJS CSRF guard/ interceptor for state-changing routes |
| `06-security-testing-observability.md#T-06.02.01.03` | verify | Inventory needed | Implement Origin validation against allowlist (configurable via admin settings or env) |
| `06-security-testing-observability.md#T-06.02.01.04` | verify | Inventory needed | Implement centralized SameSite cookie policy (security-owned): evaluate cross-origin needs, set appropriate policy per route/topology, document in security policy, supersedes all per-module SameSite decisions |
| `06-security-testing-observability.md#T-06.02.01.05` | verify | Inventory needed | Rotate CSRF token on session rotation (login, MFA, password change, privilege change) |
| `06-security-testing-observability.md#T-06.02.01.06` | verify | Inventory needed | Ensure CSRF failures return safe error + correlation ID; log as security event |
| `06-security-testing-observability.md#T-06.02.01.07` | verify | Inventory needed | Write integration tests: valid CSRF token, missing token, expired token, rotated token, origin mismatch, same-site bypass |
| `06-security-testing-observability.md#T-06.02.01.08` | verify | Inventory needed | DAST security test: automated CSRF injection attempts |
| `06-security-testing-observability.md#T-06.02.02.01` | verify | Inventory needed | Design CSP directive set for web app (nonce-based scripts, hashed styles where needed) |
| `06-security-testing-observability.md#T-06.02.02.02` | verify | Inventory needed | Implement CSP middleware in web process; support Report-Only mode toggle via config |
| `06-security-testing-observability.md#T-06.02.02.03` | verify | Inventory needed | Configure CSP reporting endpoint (e.g. `csp-reports` route or external `report-uri`) |
| `06-security-testing-observability.md#T-06.02.02.04` | verify | Inventory needed | Ensure nonce generation and propagation for inline scripts/styles across the served HTML shell and client |
| `06-security-testing-observability.md#T-06.02.02.05` | verify | Inventory needed | Add CI test that verifies CSP headers in production build |
| `06-security-testing-observability.md#T-06.02.02.06` | verify | Inventory needed | Roll out: 1 week Report-Only monitoring → analyze violations → switch to Enforce |
| `06-security-testing-observability.md#T-06.02.02.07` | verify | Inventory needed | Verify no `unsafe-eval` usage across codebase (replace `eval`, `new Function`, string setTimeout) |
| `06-security-testing-observability.md#T-06.02.03.01` | verify | Inventory needed | Implement security headers middleware: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| `06-security-testing-observability.md#T-06.02.03.02` | verify | Inventory needed | Implement `Strict-Transport-Security` header configurable by env; enable HSTS only in production with verified TLS |
| `06-security-testing-observability.md#T-06.02.03.03` | verify | Inventory needed | Ensure `frame-ancestors 'none'` in CSP prevents clickjacking |
| `06-security-testing-observability.md#T-06.02.03.04` | verify | Inventory needed | Write integration tests: verify all security headers present and correct on responses |
| `06-security-testing-observability.md#T-06.02.03.05` | verify | Inventory needed | Add CI check that fails if required security headers are missing or misconfigured |
| `06-security-testing-observability.md#T-06.02.04.01` | verify | Inventory needed | Implement CORS middleware with exact origin allowlist (env config, not wildcard) |
| `06-security-testing-observability.md#T-06.02.04.02` | verify | Inventory needed | Ensure credentialed CORS (credentials: include) never accepts wildcard origin |
| `06-security-testing-observability.md#T-06.02.04.03` | verify | Inventory needed | Restrict allowed methods to required subset; restrict allowed headers |
| `06-security-testing-observability.md#T-06.02.04.04` | verify | Inventory needed | Cache preflight response (e.g. `Access-Control-Max-Age: 3600`) |
| `06-security-testing-observability.md#T-06.02.04.05` | verify | Inventory needed | Write CORS integration tests: valid origin, invalid origin, credentialed request, preflight |
| `06-security-testing-observability.md#T-06.03.01.01` | verify | Inventory needed | Design authorization policy engine: roles, capabilities/permissions, resource types, scopes (profile, system) |
| `06-security-testing-observability.md#T-06.03.01.02` | verify | Inventory needed | Implement `AuthorizationService` with deny-by-default policy resolution |
| `06-security-testing-observability.md#T-06.03.01.03` | verify | Inventory needed | Implement NestJS guard/decorator for endpoint-level permission checks |
| `06-security-testing-observability.md#T-06.03.01.04` | verify | Inventory needed | Implement profile-scoped data access: load resources by both `id` and `activeProfileId`; reject cross-profile access |
| `06-security-testing-observability.md#T-06.03.01.05` | verify | Inventory needed | Extend authorization to background workers, AI tool calls, file access URLs, exports, and admin actions |
| `06-security-testing-observability.md#T-06.03.01.06` | verify | Inventory needed | Implement staff role permissions: deny-by-default, additive by role (CS, CRM, Finance, Legal, Ops, Admin) |
| `06-security-testing-observability.md#T-06.03.01.07` | verify | Inventory needed | Ensure all staff permissions are explicit capabilities; high-risk commands require dedicated capability + step-up auth |
| `06-security-testing-observability.md#T-06.03.01.08` | verify | Inventory needed | Write integration tests: each role's permitted/denied actions, profile isolation, cross-tenant BOLA attempts |
| `06-security-testing-observability.md#T-06.03.01.09` | verify | Inventory needed | Ensure AuthorizationService logs every authorization denial as a structured audit event with actor, resource, action, reason, timestamp |
| `06-security-testing-observability.md#T-06.03.01.10` | verify | Inventory needed | Write integration test: authorization denials are logged and appear on audit event dashboard |
| `06-security-testing-observability.md#T-06.03.02.01` | verify | Inventory needed | Audit all existing resource-loading endpoints for BOLA gaps (load by ID without profile scope check) |
| `06-security-testing-observability.md#T-06.03.02.02` | verify | Inventory needed | Implement reusable query scope filter: `where({ id, profileId: activeProfileId })` for customer resources |
| `06-security-testing-observability.md#T-06.03.02.03` | verify | Inventory needed | Ensure staff/staff-admin routes verify explicit permission, not just "is staff" |
| `06-security-testing-observability.md#T-06.03.02.04` | verify | Inventory needed | Write BOLA/IDOR penetration tests: attempt cross-profile access via UUID enumeration, direct ID manipulation |
| `06-security-testing-observability.md#T-06.03.02.05` | verify | Inventory needed | Add DAST/security E2E: attempt access to another profile's invoices, orders, contracts, wallet |
| `06-security-testing-observability.md#T-06.03.03.01` | verify | Inventory needed | Implement audit-logging interceptor for ownership/role/identity changes: before/after values, actor, timestamp |
| `06-security-testing-observability.md#T-06.03.03.02` | verify | Inventory needed | Implement dual-approval engine: configurable IRR threshold, second authorized user approval needed |
| `06-security-testing-observability.md#T-06.03.03.03` | verify | Inventory needed | Implement emergency override: reason, elevated permission, immediate alert, audit review |
| `06-security-testing-observability.md#T-06.03.03.04` | verify | Inventory needed | Write integration tests: dual-approval flow, override flow, denial flow, alert triggers |
| `06-security-testing-observability.md#T-06.04.01.01` | verify | Inventory needed | Audit existing Zod schemas for completeness: types, lengths, ranges, enums, pagination caps |
| `06-security-testing-observability.md#T-06.04.01.02` | verify | Inventory needed | Add `z.strictObject()` or `stripUnknown: false` to all command DTOs to reject unknown fields |
| `06-security-testing-observability.md#T-06.04.01.03` | verify | Inventory needed | Implement reusable pagination validation: max limit, cursor/offset constraints |
| `06-security-testing-observability.md#T-06.04.01.04` | verify | Inventory needed | Add Zod refinement for business-rule validation (e.g. date ranges, amount limits) |
| `06-security-testing-observability.md#T-06.04.01.05` | verify | Inventory needed | Write unit tests: valid request, invalid type, out of range, extra field, pagination abuse |
| `06-security-testing-observability.md#T-06.04.02.01` | verify | Inventory needed | Audit all database access for raw SQL; flag any untrusted interpolation |
| `06-security-testing-observability.md#T-06.04.02.02` | verify | Inventory needed | Implement allowlist-based field mapping for dynamic `ORDER BY` / `WHERE` fields |
| `06-security-testing-observability.md#T-06.04.02.03` | verify | Inventory needed | Add lint rule: forbid raw SQL interpolation of non-literal strings |
| `06-security-testing-observability.md#T-06.04.02.04` | verify | Inventory needed | Write SAST scan configuration targeting SQL injection patterns |
| `06-security-testing-observability.md#T-06.04.03.01` | verify | Inventory needed | Implement or integrate DOM purify / allowlist HTML sanitizer for rich text content |
| `06-security-testing-observability.md#T-06.04.03.02` | verify | Inventory needed | Audit all `dangerouslySetInnerHTML` usage; replace with sanitizer or remove |
| `06-security-testing-observability.md#T-06.04.03.03` | verify | Inventory needed | Add lint rule: ban `eval`, `new Function`, string `setTimeout`/`setInterval`, `document.write` |
| `06-security-testing-observability.md#T-06.04.03.04` | verify | Inventory needed | Ensure all user-provided data in React is rendered as text (not HTML) by default |
| `06-security-testing-observability.md#T-06.04.03.05` | verify | Inventory needed | Write unit tests: XSS vectors through sanitizer, URL params, user display names, rich text fields |
| `06-security-testing-observability.md#T-06.04.04.01` | verify | Inventory needed | Implement SSRF guard middleware: intercept all outbound HTTP requests from the application |
| `06-security-testing-observability.md#T-06.04.04.02` | verify | Inventory needed | Build allowlist-based URL validator: permit only configured HTTPS hosts, reject IP literals when hostname expected |
| `06-security-testing-observability.md#T-06.04.04.03` | verify | Inventory needed | Block private/link-local/metadata IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fd00::/8) |
| `06-security-testing-observability.md#T-06.04.04.04` | verify | Inventory needed | Enforce redirect limits (e.g. max 5 redirects) and verify each redirect destination |
| `06-security-testing-observability.md#T-06.04.04.05` | verify | Inventory needed | Set strict timeouts, response-size caps (e.g. 10MB) per outbound call |
| `06-security-testing-observability.md#T-06.04.04.06` | verify | Inventory needed | Write SSRF injection tests: internal IPs, metadata endpoints (169.254.169.254), redirect to private, DNS rebinding |
| `06-security-testing-observability.md#T-06.05.01.01` | verify | Inventory needed | Design rate-limiting dimensions: IP, user, profile, device, action. Define limit configuration schema |
| `06-security-testing-observability.md#T-06.05.01.02` | verify | Inventory needed | Implement PostgreSQL-backed rate-limit counters (durable, required for critical paths) |
| `06-security-testing-observability.md#T-06.05.01.03` | verify | Inventory needed | Implement Redis-accelerated rate-limit counters (optional, fallback to PG) |
| `06-security-testing-observability.md#T-06.05.01.04` | verify | Inventory needed | Implement NestJS rate-limit guard/decorator with configurable dimensions and limits |
| `06-security-testing-observability.md#T-06.05.01.05` | verify | Inventory needed | Implement edge-layer rate limiting (nginx/openresty/Caddy config or WAF) |
| `06-security-testing-observability.md#T-06.05.01.06` | verify | Inventory needed | Ensure `429` response includes `Retry-After` header and localized safe message |
| `06-security-testing-observability.md#T-06.05.01.07` | verify | Inventory needed | Write integration tests: IP limit, user limit, profile limit, action limit; verify Redis loss doesn't weaken critical limits |
| `06-security-testing-observability.md#T-06.05.02.01` | verify | Inventory needed | Configure OTP send limits: 1/dest/60s, 5/hour, 10/day; IP+device aggregates |
| `06-security-testing-observability.md#T-06.05.02.02` | verify | Inventory needed | Configure OTP verify limits: 5 failed attempts per challenge → invalidate |
| `06-security-testing-observability.md#T-06.05.02.03` | verify | Inventory needed | Configure login limits: progressive delay after 5 failures per account+IP in 15min; IP/device spray detection |
| `06-security-testing-observability.md#T-06.05.02.04` | verify | Inventory needed | Configure password reset: 5 starts per account or dest/hour; separate IP limits |
| `06-security-testing-observability.md#T-06.05.02.05` | verify | Inventory needed | Configure order/consultation limits: 5 per profile/minute; idempotency key as secondary protect |
| `06-security-testing-observability.md#T-06.05.02.06` | verify | Inventory needed | Configure wallet/payment/refund limits: 10 per profile/minute; stricter provider+anomaly controls |
| `06-security-testing-observability.md#T-06.05.02.07` | verify | Inventory needed | Configure file upload limits: 20 per profile/minute; concurrent upload, size, storage quotas |
| `06-security-testing-observability.md#T-06.05.02.08` | verify | Inventory needed | Configure AI limits: per-user requests, concurrency, token, cost budgets; stricter for tool-enabled actions |
| `06-security-testing-observability.md#T-06.05.02.09` | verify | Inventory needed | Admin UI: view/edit limits within safe min/max bounds; versioned configuration |
| `06-security-testing-observability.md#T-06.05.02.10` | verify | Inventory needed | Emergency rule engine: security can set temporary rules with owner, expiry, reason, audit record |
| `06-security-testing-observability.md#T-06.05.02.11` | verify | Inventory needed | Write tests: each action limit enforced correctly, admin tuning, emergency override |
| `06-security-testing-observability.md#T-06.06.01.01` | verify | Inventory needed | Implement upload validation pipeline: extension allowlist → MIME detection → size check → malware scan → store |
| `06-security-testing-observability.md#T-06.06.01.02` | verify | Inventory needed | Build extension+MIME allowlist configurable by category (docs, images, video) with admin limits |
| `06-security-testing-observability.md#T-06.06.01.03` | verify | Inventory needed | Generate random object keys (UUID); never use original filenames in storage path |
| `06-security-testing-observability.md#T-06.06.01.04` | verify | Inventory needed | Implement malware scanning integration (ClamAV socket or cloud API) with Quarantine state on detection |
| `06-security-testing-observability.md#T-06.06.01.05` | verify | Inventory needed | Implement download disposition: potentially active formats → `Content-Disposition: attachment`; safe formats → inline only after sandbox preview |
| `06-security-testing-observability.md#T-06.06.01.06` | verify | Inventory needed | Ensure uploads are private by default; access via short-lived authorized URLs or backend streaming after auth check |
| `06-security-testing-observability.md#T-06.06.01.07` | verify | Inventory needed | Write tests: valid upload, invalid extension, mismatched MIME, oversized, malware detected, quarantine alert |
| `06-security-testing-observability.md#T-06.06.01.08` | verify | Inventory needed | Security review: file path traversal, double extension, magic byte manipulation, zip bombs |
| `06-security-testing-observability.md#T-06.06.02.01` | verify | Inventory needed | Implement generic webhook verification service: signature/HMAC verification, replay window (e.g. ±5 min), event ID dedup |
| `06-security-testing-observability.md#T-06.06.02.02` | verify | Inventory needed | Build payment provider callback adapter: verify provider signature, merchant context, server-side status check; browser redirect ignored |
| `06-security-testing-observability.md#T-06.06.02.03` | verify | Inventory needed | Build SMS provider callback adapter: verify authenticity, replay-safe delivery status |
| `06-security-testing-observability.md#T-06.06.02.04` | verify | Inventory needed | Build storage provider callback: verify signature, replay-safe, idempotent status update |
| `06-security-testing-observability.md#T-06.06.02.05` | verify | Inventory needed | Implement webhook idempotency: store webhook event hash + processed flag; reject duplicates |
| `06-security-testing-observability.md#T-06.06.02.06` | verify | Inventory needed | Ensure raw provider events stored securely (encrypted or access-controlled) when permitted by policy |
| `06-security-testing-observability.md#T-06.06.02.07` | verify | Inventory needed | Write tests: valid callback, expired timestamp, replayed event, wrong signature, missing signature, duplicate delivery |
| `06-security-testing-observability.md#T-06.07.01.01` | verify | Inventory needed | Implement secrets resolution abstraction: env vars, AWS Secrets Manager / HashiCorp Vault / encrypted config file |
| `06-security-testing-observability.md#T-06.07.01.02` | verify | Inventory needed | Ensure secrets are encrypted at rest and masked in every API response and admin UI display |
| `06-security-testing-observability.md#T-06.07.01.03` | verify | Inventory needed | Exclude secrets from logs, analytics, error tracking, telemetry, and support exports |
| `06-security-testing-observability.md#T-06.07.01.04` | verify | Inventory needed | Implement rotation support: overlapping active/previous key period; key versioning |
| `06-security-testing-observability.md#T-06.07.01.05` | verify | Inventory needed | Audit codebase for hardcoded secrets, .env committed, frontend-bundled secrets |
| `06-security-testing-observability.md#T-06.07.01.06` | verify | Inventory needed | Add CI secret scan (e.g. truffleHog, gitLeaks) to block commits with secrets |
| `06-security-testing-observability.md#T-06.07.02.01` | verify | Inventory needed | Configure SCA tool (e.g. Snyk, npm audit, OWASP Dependency-Check) in CI |
| `06-security-testing-observability.md#T-06.07.02.02` | verify | Inventory needed | Configure SAST tool (e.g. CodeQL, Semgrep) with custom rules for NestJS/Drizzle security patterns |
| `06-security-testing-observability.md#T-06.07.02.03` | verify | Inventory needed | Configure container vulnerability scanning (e.g. Trivy, Grype) on Docker images |
| `06-security-testing-observability.md#T-06.07.02.04` | verify | Inventory needed | Configure secret scanning on every PR (e.g. gitLeaks, truffleHog) |
| `06-security-testing-observability.md#T-06.07.02.05` | verify | Inventory needed | Define triage policy: critical/high with credible production path → block release |
| `06-security-testing-observability.md#T-06.07.02.06` | verify | Inventory needed | Set up license compliance check (e.g. license-checker) for dependency licenses |
| `06-security-testing-observability.md#T-06.07.02.07` | verify | Inventory needed | Generate SBOM (Software Bill of Materials) for each production build |
| `06-security-testing-observability.md#T-06.07.02.08` | verify | Inventory needed | Create CI gate config: SCA/SAST/secret/container scans on every PR, full scan on main |
| `06-security-testing-observability.md#T-06.07.03.01` | verify | Inventory needed | Harden Dockerfile: non-root user, read-only rootfs where practical, no inspector, `NODE_OPTIONS=--no-deprecation` |
| `06-security-testing-observability.md#T-06.07.03.02` | verify | Inventory needed | Disable `insecureHTTPParser`; set explicit request/body/header/time limits at proxy and application level |
| `06-security-testing-observability.md#T-06.07.03.03` | verify | Inventory needed | Configure TLS at reverse proxy: modern protocols (TLS 1.2+), secure ciphers, HSTS |
| `06-security-testing-observability.md#T-06.07.03.04` | verify | Inventory needed | Ensure proxy trust configured to exact hop topology (not `trust proxy` globally) |
| `06-security-testing-observability.md#T-06.07.03.05` | verify | Inventory needed | Add container security scanning to CI (Trivy, etc.) |
| `06-security-testing-observability.md#T-06.07.03.06` | verify | Inventory needed | Write container smoke test: non-root user, inspector not available, no unsafe parser |
| `06-security-testing-observability.md#T-06.08.01.01` | verify | Inventory needed | Create initial threat model document (`docs/threat-model.md`) covering all critical flows |
| `06-security-testing-observability.md#T-06.08.01.02` | verify | Inventory needed | Map trust boundaries, data flows, assets, threat actors (customer, staff, admin, external attacker, provider) |
| `06-security-testing-observability.md#T-06.08.01.03` | verify | Inventory needed | Apply STRIDE or similar framework to each domain (auth, isolation, wallet, contracts, files, config, providers, AI) |
| `06-security-testing-observability.md#T-06.08.01.04` | verify | Inventory needed | Document accepted risks with owner, justification, compensating controls, expiry, approval |
| `06-security-testing-observability.md#T-06.08.01.05` | verify | Inventory needed | Define review cadence: quarterly full review + review on material flow changes |
| `06-security-testing-observability.md#T-06.08.01.06` | verify | Inventory needed | Create PR checklist item: threat model update required when trust boundary, sensitive data, provider, permission, or financial flow changes |
| `06-security-testing-observability.md#T-06.08.02.01` | verify | Inventory needed | Define pen test scope: auth, session, MFA, CSRF, CSP, BOLA/IDOR, rate limits, SSRF, file upload, webhooks, wallet/payment, AI tools |
| `06-security-testing-observability.md#T-06.08.02.02` | verify | Inventory needed | Schedule pre-launch independent penetration test; budget and vendor selection |
| `06-security-testing-observability.md#T-06.08.02.03` | verify | Inventory needed | Define criteria: critical/high with credible production path → fix before release; accepted risk requires owner+expiry |
| `06-security-testing-observability.md#T-06.08.02.04` | verify | Inventory needed | Implement automated authenticated DAST in staging (e.g. OWASP ZAP API scan) |
| `06-security-testing-observability.md#T-06.08.02.05` | verify | Inventory needed | Write custom security E2E suite for targeted API test cases CSRF, CORS, session rotation, rate limits, BOLA, SSRF, open redirect |
| `06-security-testing-observability.md#T-06.08.03.01` | verify | Inventory needed | Create incident response runbook (`docs/runbooks/security-incident.md`): detection, containment, eradication, recovery, post-mortem |
| `06-security-testing-observability.md#T-06.08.03.02` | verify | Inventory needed | Create key/token revocation procedure: API keys, provider secrets, session mass-revocation, certificate rotation |
| `06-security-testing-observability.md#T-06.08.03.03` | verify | Inventory needed | Create customer communication templates: breach notification, service disruption, credential rotation |
| `06-security-testing-observability.md#T-06.08.03.04` | verify | Inventory needed | Set up security event channel separate from ordinary error queues (e.g. dedicated Slack/alert channel) |
| `06-security-testing-observability.md#T-06.08.03.05` | verify | Inventory needed | Define post-incident review process: timeline, root cause, corrective actions, documentation update |
| `06-security-testing-observability.md#T-06.09.01.01` | verify | Inventory needed | Configure Vitest across all packages with shared config, coverage thresholds, and reporter |
| `06-security-testing-observability.md#T-06.09.01.02` | verify | Inventory needed | Implement test utilities: controllable clock, fixed UUIDs, deterministic random, fake provider factories |
| `06-security-testing-observability.md#T-06.09.01.03` | verify | Inventory needed | Implement table-driven test helper for financial examples (inputs → expected outputs) |
| `06-security-testing-observability.md#T-06.09.01.04` | verify | Inventory needed | Add `vitest --related` for affected-only test runs in CI |
| `06-security-testing-observability.md#T-06.09.02.01` | verify | Inventory needed | Author unit tests for all state machines: Orders, Contracts, Invoices, Payments, Refunds, Documents, Wallet transactions, Invitations, Verification cases |
| `06-security-testing-observability.md#T-06.09.02.02` | verify | Inventory needed | Author unit tests for pricing engine: VAT calculation, discounts, rounding (half-up to IRR), electricity composition rules, Jalali period calculations |
| `06-security-testing-observability.md#T-06.09.02.03` | verify | Inventory needed | Author unit tests for authorization policy: role permissions, capability checks, profile-scoped access, BOLA denial |
| `06-security-testing-observability.md#T-06.09.02.04` | verify | Inventory needed | Author unit tests for idempotency: idempotency key verification, duplicate detection, refund-amount calculations |
| `06-security-testing-observability.md#T-06.09.02.05` | verify | Inventory needed | Author unit tests for input validation: Zod schema edge cases, normalization, locale-specific formatting |
| `06-security-testing-observability.md#T-06.09.02.06` | verify | Inventory needed | Author unit tests for provider adapter responses: success, timeout, throttle, error classification, mapping |
| `06-security-testing-observability.md#T-06.09.02.07` | verify | Inventory needed | Author unit tests for Jalali calendar: month lengths, leap years, period boundaries, Gregorian conversion |
| `06-security-testing-observability.md#T-06.09.03.01` | verify | Inventory needed | Configure RTL with custom render helpers, providers (auth, i18n, theme), and MSW/api contract fixtures |
| `06-security-testing-observability.md#T-06.09.03.02` | verify | Inventory needed | Write RTL tests for registration form: validation, OTP flow, error states, RTL layout |
| `06-security-testing-observability.md#T-06.09.03.03` | verify | Inventory needed | Write RTL tests for login form: validation, error states, MFA step-up, RTL/LTR |
| `06-security-testing-observability.md#T-06.09.03.04` | verify | Inventory needed | Write RTL tests for onboarding/profile forms: INDIVIDUAL and LEGAL flows, field validation, address selection |
| `06-security-testing-observability.md#T-06.09.03.05` | verify | Inventory needed | Write RTL tests for dashboard: profile display, verification warning, agent invitation |
| `06-security-testing-observability.md#T-06.09.03.06` | verify | Inventory needed | Write RTL tests for electricity order wizards: simple order, advanced order, green rule disclosure, price review |
| `06-security-testing-observability.md#T-06.09.03.07` | verify | Inventory needed | Write RTL tests for wallet/invoice/payment pages: balance display, top-up, invoice payment, refund view |
| `06-security-testing-observability.md#T-06.09.03.08` | verify | Inventory needed | Write RTL tests for admin pages: configuration, role management, product/settings CRUD |
| `06-security-testing-observability.md#T-06.09.03.09` | verify | Inventory needed | Ensure every critical form preserves valid input after server validation/provider error |
| `06-security-testing-observability.md#T-06.09.03.10` | verify | Inventory needed | Write RTL tests for permission-dependent UI: elements hidden/disabled per role |
| `06-security-testing-observability.md#T-06.10.01.01` | verify | Inventory needed | Set up test PostgreSQL instance in CI and local dev (Docker Compose service) |
| `06-security-testing-observability.md#T-06.10.01.02` | verify | Inventory needed | Configure NestJS testing module: bootstrap real app with test DB, apply migrations before each suite |
| `06-security-testing-observability.md#T-06.10.01.03` | verify | Inventory needed | Implement test DB lifecycle: per-worker isolated schema or database for parallel runs |
| `06-security-testing-observability.md#T-06.10.01.04` | verify | Inventory needed | Build fake adapter servers: SMTP fake, SMS.ir fake, payment gateway fake, document storage fake |
| `06-security-testing-observability.md#T-06.10.01.05` | verify | Inventory needed | Implement deterministic signed webhook fixture builder |
| `06-security-testing-observability.md#T-06.10.01.06` | verify | Inventory needed | Write helper utilities: create user, create profile, authenticate, create order, create invoice, add wallet funds |
| `06-security-testing-observability.md#T-06.10.02.01` | verify | Inventory needed | Write migration integration tests: clean database apply, upgrade-path apply, rollback, data preservation |
| `06-security-testing-observability.md#T-06.10.02.02` | verify | Inventory needed | Write constraint tests: unique indexes, foreign keys, NOT NULL, CHECK constraints, exclusion constraints |
| `06-security-testing-observability.md#T-06.10.02.03` | verify | Inventory needed | Write transaction tests: atomic wallet debit + invoice settlement, atomic order+contract+invoice creation |
| `06-security-testing-observability.md#T-06.10.02.04` | verify | Inventory needed | Write locking tests: row-level lock for wallet mutations, optimistic version for concurrent state changes |
| `06-security-testing-observability.md#T-06.10.02.05` | verify | Inventory needed | Write profile-scoped data isolation tests: customer A cannot access customer B's data |
| `06-security-testing-observability.md#T-06.10.02.06` | verify | Inventory needed | Write audit log tests: every state transition recorded, append-only, no edit/delete via API |
| `06-security-testing-observability.md#T-06.10.02.07` | verify | Inventory needed | Write outbox tests: transactional outbox write + commit, worker read + idempotent processing + dead letter |
| `06-security-testing-observability.md#T-06.10.02.08` | verify | Inventory needed | Write idempotency tests: duplicate request returns original result, same idempotency key different payload rejected |
| `06-security-testing-observability.md#T-06.10.02.09` | verify | Inventory needed | Mandatory concurrency tests: simultaneous wallet payments, duplicate provider callbacks, duplicate bank confirmation, concurrent refund workers, repeated order submission, ownership/role changes during requests, competing state transitions |
| `06-security-testing-observability.md#T-06.10.02.10` | verify | Inventory needed | Write provider adapter integration tests: fake SMTP, fake SMS.ir, fake payment gateway with all error modes |
| `06-security-testing-observability.md#T-06.10.03.01` | verify | Inventory needed | Configure Playwright: project structure, environment, auth helpers, seed data, parallel workers with isolated DB schemas |
| `06-security-testing-observability.md#T-06.10.03.02` | verify | Inventory needed | Write E2E: registration → OTP verify → onboarding INDIVIDUAL → dashboard |
| `06-security-testing-observability.md#T-06.10.03.03` | verify | Inventory needed | Write E2E: registration → OTP verify → onboarding LEGAL → profile verification flow |
| `06-security-testing-observability.md#T-06.10.03.04` | verify | Inventory needed | Write E2E: login → OTP (new device) → MFA → session revocation |
| `06-security-testing-observability.md#T-06.10.03.05` | verify | Inventory needed | Write E2E: legal-agent invitation → accept → role-permission verification |
| `06-security-testing-observability.md#T-06.10.03.06` | verify | Inventory needed | Write E2E: simple electricity order → wallet top-up → invoice payment → contract review → approval |
| `06-security-testing-observability.md#T-06.10.03.07` | verify | Inventory needed | Write E2E: advanced electricity order with mandatory green rule → bank receipt → staff confirm → refund on rejection |
| `06-security-testing-observability.md#T-06.10.03.08` | verify | Inventory needed | Write E2E: saving-plan order → agreement → invoice → payment → fulfillment stages |
| `06-security-testing-observability.md#T-06.10.03.09` | verify | Inventory needed | Write E2E: consultation pricing → fee offer → accept → pay |
| `06-security-testing-observability.md#T-06.10.03.10` | verify | Inventory needed | Write E2E: solar construction request → document upload → staff review → postal → contract creation |
| `06-security-testing-observability.md#T-06.10.03.11` | verify | Inventory needed | Write E2E: contract version acceptance/signature → adjustment invoice |
| `06-security-testing-observability.md#T-06.10.03.12` | verify | Inventory needed | Write E2E: admin configuration change → effective version → rollback |
| `06-security-testing-observability.md#T-06.10.03.13` | verify | Inventory needed | Write E2E: profile switching → data isolation verification |
| `06-security-testing-observability.md#T-06.10.03.14` | verify | Inventory needed | Configure CI E2E: PR → Chromium only; nightly → Chromium + Firefox + WebKit; release → + mobile viewports |
| `06-security-testing-observability.md#T-06.10.03.15` | verify | Inventory needed | Ensure E2E never calls production payment, SMS, email, storage, bill-data, or AI providers |
| `06-security-testing-observability.md#T-06.10.03.16` | verify | Inventory needed | Ensure every E2E test runs with Persian (fa) locale as default, verifying RTL layout and Jalali calendar |
| `06-security-testing-observability.md#T-06.10.03.17` | verify | Inventory needed | Add dedicated English/LTR smoke tests and Gregorian calendar boundary tests |
| `06-security-testing-observability.md#T-06.11.01.01` | verify | Inventory needed | Integrate `@axe-core/playwright` into E2E pipeline; run on all critical pages |
| `06-security-testing-observability.md#T-06.11.01.02` | verify | Inventory needed | Create accessibility test suite covering: keyboard navigation, focus visibility, contrast, labels, ARIA roles, error announcements, reduced motion |
| `06-security-testing-observability.md#T-06.11.01.03` | verify | Inventory needed | Add CI gate: axe violations block PR; track severity |
| `06-security-testing-observability.md#T-06.11.01.04` | verify | Inventory needed | Document manual testing checklist for screen readers (NVDA/JAWS, VoiceOver) and keyboard-only |
| `06-security-testing-observability.md#T-06.11.02.01` | verify | Inventory needed | Integrate OWASP ZAP for authenticated API scanning in staging environment |
| `06-security-testing-observability.md#T-06.11.02.02` | verify | Inventory needed | Write targeted security test scenarios: CSRF, CORS misconfiguration, BOLA/IDOR, rate limit bypass, upload abuse, open redirect, SSRF, webhook replay, session rotation corner cases |
| `06-security-testing-observability.md#T-06.11.02.03` | verify | Inventory needed | Configure Semgrep/CodeQL with security-focused rules for NestJS/Drizzle patterns |
| `06-security-testing-observability.md#T-06.11.02.04` | verify | Inventory needed | Add CI gate: critical/high SAST findings block merge; medium triaged within sprint |
| `06-security-testing-observability.md#T-06.11.03.01` | verify | Inventory needed | Establish query and route latency budgets (p50/p95/p99) before load testing |
| `06-security-testing-observability.md#T-06.11.03.02` | verify | Inventory needed | Write performance test scenarios: electricity price preview, order submission, wallet payment, invoice lists, CRM search, file upload auth, notification fan-out |
| `06-security-testing-observability.md#T-06.11.03.03` | verify | Inventory needed | Run load test with realistic Persian/English payloads and production-like indexes |
| `06-security-testing-observability.md#T-06.11.03.04` | verify | Inventory needed | Configure database protection: request/statement/lock/idle-transaction timeouts, pool limits, pagination caps, export/report concurrency limits |
| `06-security-testing-observability.md#T-06.11.03.05` | verify | Inventory needed | Set up CI performance budget: route JS size, Core Web Vitals regression check for primary mobile flows |
| `06-security-testing-observability.md#T-06.11.03.06` | verify | Inventory needed | Schedule weekly performance regression run in staging |
| `06-security-testing-observability.md#T-06.11.04.01` | verify | Inventory needed | Write failure-injection tests: provider timeout → circuit breaker → queue; Redis unavailable → fallback to PG |
| `06-security-testing-observability.md#T-06.11.04.02` | verify | Inventory needed | Write worker reliability tests: crash during job → reprocess or dead-letter; duplicate delivery → idempotency |
| `06-security-testing-observability.md#T-06.11.04.03` | verify | Inventory needed | Write DB connection exhaustion test: pool full → queue/backpressure → graceful degradation |
| `06-security-testing-observability.md#T-06.11.04.04` | verify | Inventory needed | Schedule quarterly PostgreSQL restore test: measure RPO/RTO, document in runbook |
| `06-security-testing-observability.md#T-06.11.04.05` | verify | Inventory needed | Schedule quarterly object storage recovery test: version retrieval, policy enforcement, orphan detection |
| `06-security-testing-observability.md#T-06.11.04.06` | verify | Inventory needed | Write reconciliation tests: deliberately inconsistent fixtures → mismatch alert → finance exception |
| `06-security-testing-observability.md#T-06.12.01.01` | verify | Inventory needed | Configure Vitest coverage thresholds per package with different target levels for critical vs non-critical |
| `06-security-testing-observability.md#T-06.12.01.02` | verify | Inventory needed | Define critical domain packages: auth, authorization, payments, wallet, refunds, pricing, contracts, state-machine |
| `06-security-testing-observability.md#T-06.12.01.03` | verify | Inventory needed | Implement CI coverage check: changed-file coverage gateway with exception mechanism |
| `06-security-testing-observability.md#T-06.12.01.04` | verify | Inventory needed | Write coverage exception template: requires technical justification + domain owner approval |
| `06-security-testing-observability.md#T-06.12.02.01` | verify | Inventory needed | Implement CI workflow with all 12 PR gate checks in parallel where possible |
| `06-security-testing-observability.md#T-06.12.02.02` | verify | Inventory needed | Configure step dependencies: lint → typecheck → unit → integration → migration → OpenAPI → build → coverage → security scans → review |
| `06-security-testing-observability.md#T-06.12.02.03` | verify | Inventory needed | Implement migration validation: apply on clean DB + upgrade from previous schema |
| `06-security-testing-observability.md#T-06.12.02.04` | verify | Inventory needed | Implement OpenAPI drift detection: generated schema vs committed spec |
| `06-security-testing-observability.md#T-06.12.02.05` | verify | Inventory needed | Configure required reviewers: domain owner; Finance/Security/Legal when protected rules change |
| `06-security-testing-observability.md#T-06.12.02.06` | verify | Inventory needed | Add status check reporting: pass/fail per check, summary comment on PR |
| `06-security-testing-observability.md#T-06.12.03.01` | verify | Inventory needed | Implement main-branch CI workflow: full test suites, E2E, accessibility, container build+scan, SBOM |
| `06-security-testing-observability.md#T-06.12.03.02` | verify | Inventory needed | Build staging smoke deployment: readiness/liveness verification, migration rehearsal |
| `06-security-testing-observability.md#T-06.12.03.03` | verify | Inventory needed | Implement automatic gate: block RC if P0/P1 defect or unexplained flaky critical test |
| `06-security-testing-observability.md#T-06.12.03.04` | verify | Inventory needed | Provider contract tests in CI: SMTP fake, SMS.ir fake, payment fake, storage fake |
| `06-security-testing-observability.md#T-06.12.04.01` | verify | Inventory needed | Define production release checklist and automated gate runner |
| `06-security-testing-observability.md#T-06.12.04.02` | verify | Inventory needed | Implement automatic canary/gradual rollout for high-risk changes (payment, wallet, auth, contract, pricing) |
| `06-security-testing-observability.md#T-06.12.04.03` | verify | Inventory needed | Implement auto-halt/rollback on: smoke failure, elevated error rate, SLO burn, reconciliation mismatch, security alert |
| `06-security-testing-observability.md#T-06.12.04.04` | verify | Inventory needed | Create production release notes template: changes, customer/support impact, owner, dashboard links, alert/runbook links, on-call |
| `06-security-testing-observability.md#T-06.12.04.05` | verify | Inventory needed | Implement post-deploy smoke tests and SLO/error comparison against previous release |
| `06-security-testing-observability.md#T-06.12.05.01` | verify | Inventory needed | Configure nightly CI: cross-browser E2E, full dep + security scan, dead-link check, flaky test report |
| `06-security-testing-observability.md#T-06.12.05.02` | verify | Inventory needed | Configure weekly CI: load/performance regression, critical-domain mutation testing, dependency update PR |
| `06-security-testing-observability.md#T-06.12.05.03` | verify | Inventory needed | Configure quarterly manual trigger: PG restore, DR rehearsal, access review, threat-model review, incident runbook exercise |
| `06-security-testing-observability.md#T-06.12.05.04` | verify | Inventory needed | Flaky test management: quarantine system with owner, issue, expiry, equivalent temporary coverage |
| `06-security-testing-observability.md#T-06.12.05.05` | verify | Inventory needed | Flaky test report dashboard: list, trend, owner, days in quarantine |
| `06-security-testing-observability.md#T-06.13.01.01` | verify | Inventory needed | Install OpenTelemetry JS SDK + instrumentations (HTTP, NestJS, Express, PostgreSQL, Redis, gRPC) |
| `06-security-testing-observability.md#T-06.13.01.02` | verify | Inventory needed | Configure OTel SDK auto-instrumentation for all process types (web, API, worker) |
| `06-security-testing-observability.md#T-06.13.01.03` | verify | Inventory needed | Implement custom NestJS decorator/interceptor for span creation in domain services |
| `06-security-testing-observability.md#T-06.13.01.04` | verify | Inventory needed | Propagate trace context across HTTP headers (W3C TraceContext) |
| `06-security-testing-observability.md#T-06.13.01.05` | verify | Inventory needed | Propagate trace context through PostgreSQL outbox → worker processing |
| `06-security-testing-observability.md#T-06.13.01.06` | verify | Inventory needed | Implement trace sampling: sample rate for successful traces (e.g. 10%), always sample errors and slow traces (>500ms) |
| `06-security-testing-observability.md#T-06.13.01.07` | verify | Inventory needed | Configure OTel exporter: OTLP to Grafana Tempo / Jaeger-compatible backend |
| `06-security-testing-observability.md#T-06.13.01.08` | verify | Inventory needed | Ensure trace context logged in all structured log entries |
| `06-security-testing-observability.md#T-06.13.01.09` | verify | Inventory needed | Write integration test: verify trace context propagation across HTTP → service → DB → outbox → worker |
| `06-security-testing-observability.md#T-06.13.02.01` | verify | Inventory needed | Implement structured JSON logger (pino or winston) with consistent schema across all processes |
| `06-security-testing-observability.md#T-06.13.02.02` | verify | Inventory needed | Add correlation ID to every log entry (from request header or generate) |
| `06-security-testing-observability.md#T-06.13.02.03` | verify | Inventory needed | Add pseudonymous actor/profile IDs to logs (never raw national IDs, secrets, tokens) |
| `06-security-testing-observability.md#T-06.13.02.04` | verify | Inventory needed | Implement environment-aware log level: debug in dev, info in staging, warn+ in production |
| `06-security-testing-observability.md#T-06.13.02.05` | verify | Inventory needed | Configure Loki log shipping agent (Promtail / Grafana Alloy) |
| `06-security-testing-observability.md#T-06.13.02.06` | verify | Inventory needed | Ensure secrets, PII, payment details, and tokens are redacted from all log output |
| `06-security-testing-observability.md#T-06.13.02.07` | verify | Inventory needed | Write integration test: log format compliance, redaction, correlation ID presence |
| `06-security-testing-observability.md#T-06.14.01.01` | verify | Inventory needed | Implement Prometheus metrics endpoint in API and worker processes |
| `06-security-testing-observability.md#T-06.14.01.02` | verify | Inventory needed | Instrument RED metrics: request rate, error count (by status/route), latency (p50/p95/p99) |
| `06-security-testing-observability.md#T-06.14.01.03` | verify | Inventory needed | Instrument database metrics: pool size, active/idle/waiting connections, query duration, slow queries |
| `06-security-testing-observability.md#T-06.14.01.04` | verify | Inventory needed | Instrument queue metrics: queue depth, oldest-unprocessed age, processing time, failure rate, dead-letter count |
| `06-security-testing-observability.md#T-06.14.01.05` | verify | Inventory needed | Instrument external provider metrics: call latency, success/error count, circuit-breaker state |
| `06-security-testing-observability.md#T-06.14.01.06` | verify | Inventory needed | Instrument business safety metrics: unresolved refund count, reconciliation mismatch count, outbox backlog age |
| `06-security-testing-observability.md#T-06.14.01.07` | verify | Inventory needed | Instrument worker metrics: job processing rate, lease expiry, retry count, dead-letter count |
| `06-security-testing-observability.md#T-06.14.01.08` | verify | Inventory needed | Instrument AI metrics: request count, token usage, latency, cost per model, concurrency |
| `06-security-testing-observability.md#T-06.14.02.01` | verify | Inventory needed | Create Executive SLO dashboard: availability, latency (p95/p99), error budget, burn rate |
| `06-security-testing-observability.md#T-06.14.02.02` | verify | Inventory needed | Create API Health dashboard: RED metrics, top slow routes, error breakdown by status, correlation with deploys |
| `06-security-testing-observability.md#T-06.14.02.03` | verify | Inventory needed | Create PostgreSQL/Pool dashboard: connection pool, query throughput, slow queries, replication lag, cache hit ratio |
| `06-security-testing-observability.md#T-06.14.02.04` | verify | Inventory needed | Create Worker/Outbox dashboard: queue depth, oldest age, processing rate, retries, dead-letter count |
| `06-security-testing-observability.md#T-06.14.02.05` | verify | Inventory needed | Create External Providers dashboard: latency, error rate, circuit-breaker state, quota usage |
| `06-security-testing-observability.md#T-06.14.02.06` | verify | Inventory needed | Create Authentication/Security dashboard: login rate, MFA pass/fail, OTP send/verify rate, rate-limit hits, audit events |
| `06-security-testing-observability.md#T-06.14.02.07` | verify | Inventory needed | Create Payments/Wallet/Refunds dashboard: transaction volume, success rate, refund count/value, mismatch alerts |
| `06-security-testing-observability.md#T-06.14.02.08` | verify | Inventory needed | Create Storage/Uploads dashboard: upload count, size distribution, scan state, malware count |
| `06-security-testing-observability.md#T-06.14.02.09` | verify | Inventory needed | Create Notifications dashboard: delivery rate by channel, queue age, failure breakdown, bounce rate |
| `06-security-testing-observability.md#T-06.14.02.10` | verify | Inventory needed | Create AI Usage/Cost dashboard: request volume, token usage, cost per model per day, error rate |
| `06-security-testing-observability.md#T-06.14.02.11` | verify | Inventory needed | Add production release markers to all dashboards (annotation per deploy) |
| `06-security-testing-observability.md#T-06.14.03.01` | verify | Inventory needed | Implement monthly cost tracking instrumentation: compute (per environment), PostgreSQL, object storage/egress, Redis, notification providers, observability stack, AI provider/model |
| `06-security-testing-observability.md#T-06.14.03.02` | verify | Inventory needed | Expose unit-cost metrics: cost per active profile, cost per order |
| `06-security-testing-observability.md#T-06.14.03.03` | verify | Inventory needed | Configure alert on >20% monthly variance from budget per cost category |
| `06-security-testing-observability.md#T-06.15.01.01` | verify | Inventory needed | Define alert severity taxonomy: P1 (user-facing outage, payment/refund risk), P2 (degradation, backlog), P3 (warning, info) |
| `06-security-testing-observability.md#T-06.15.01.02` | verify | Inventory needed | Configure P1 alerts: payment/refund duplication risk, ledger mismatch, backup failure, outbox backlog > threshold, elevated auth failures, SLO burn rate |
| `06-security-testing-observability.md#T-06.15.01.03` | verify | Inventory needed | Configure P2 alerts: provider circuit-breaker open, queue age > target, database connection pool saturation, elevated error rate on critical routes |
| `06-security-testing-observability.md#T-06.15.01.04` | verify | Inventory needed | Configure P3 alerts: certificate expiry, storage lifecycle warning, reconciliation mismatch, low SMS credit |
| `06-security-testing-observability.md#T-06.15.01.05` | verify | Inventory needed | Configure alert routing: P1 → on-call pager/phone, P2 → team channel + task, P3 → review board |
| `06-security-testing-observability.md#T-06.15.01.06` | verify | Inventory needed | Configure deduplication and alert grouping to prevent noise storms |
| `06-security-testing-observability.md#T-06.15.01.07` | verify | Inventory needed | Set up dead-man check / watchdog for alert delivery pipeline |
| `06-security-testing-observability.md#T-06.15.01.08` | verify | Inventory needed | Every alert links to its dashboard and runbook |
| `06-security-testing-observability.md#T-06.15.02.01` | verify | Inventory needed | Define SLOs with SLIs: availability, API latency (p95), core page LCP (p75), job start time (p99), RPO, RTO |
| `06-security-testing-observability.md#T-06.15.02.02` | verify | Inventory needed | Implement SLO burn-rate alerting: fast burn (5% budget/hour) → P1, slow burn (2% budget/day) → P2 |
| `06-security-testing-observability.md#T-06.15.02.03` | verify | Inventory needed | Implement error budget tracking dashboard with consumption rate and burn-down |
| `06-security-testing-observability.md#T-06.15.02.04` | verify | Inventory needed | Configure multi-window, multi-burn-rate alert (MWMBR) for accurate detection |
| `06-security-testing-observability.md#T-06.15.02.05` | verify | Inventory needed | Ensure outbox backlog, refund mismatch, and provider health alerts have SLO-linked burn budgets |
| `06-security-testing-observability.md#T-06.15.03.01` | verify | Inventory needed | Configure unresolved refund obligation alert: count > 0 for > 1 hour → P2 |
| `06-security-testing-observability.md#T-06.15.03.02` | verify | Inventory needed | Configure reconciliation mismatch alert: wallet/cached balance drift > threshold → P1 |
| `06-security-testing-observability.md#T-06.15.03.03` | verify | Inventory needed | Configure outbox backlog age alert: oldest-unprocessed > 5 min → P2, > 15 min → P1 |
| `06-security-testing-observability.md#T-06.15.03.04` | verify | Inventory needed | Configure duplicate payment detection: same idempotency key with different payload → P1 |
| `06-security-testing-observability.md#T-06.15.03.05` | verify | Inventory needed | Configure provider callback anomaly alert: unexpected signature, replay, stale timestamp → P1 |
| `06-security-testing-observability.md#T-06.15.03.06` | verify | Inventory needed | Implement safe outbox replay endpoint/CLI: re-queue unprocessed outbox rows within a configurable date range with idempotency protection and operator confirmation |
| `06-security-testing-observability.md#T-06.15.03.07` | verify | Inventory needed | Write integration test: outbox replay produces no duplicate deliveries, respects idempotency keys |
| `06-security-testing-observability.md#T-06.16.01.01` | verify | Inventory needed | Configure OTel trace exporter to Tempo/Jaeger via OTLP |
| `06-security-testing-observability.md#T-06.16.01.02` | verify | Inventory needed | Ensure trace context propagation across async boundaries: outbox → worker, queue → handler |
| `06-security-testing-observability.md#T-06.16.01.03` | verify | Inventory needed | Configure retention: sampled traces 7 days, error/slow 30 days |
| `06-security-testing-observability.md#T-06.16.01.04` | verify | Inventory needed | Create Grafana Explore / Tempo search UI integration for trace discovery |
| `06-security-testing-observability.md#T-06.16.01.05` | verify | Inventory needed | Write trace verification test: single request produces complete trace across service → DB → outbox → worker |
| `06-security-testing-observability.md#T-06.16.02.01` | verify | Inventory needed | Integrate Sentry SDK (or open-source alternative) into API, worker, and web processes |
| `06-security-testing-observability.md#T-06.16.02.02` | verify | Inventory needed | Configure PII scrubbing: strip secrets, national IDs, financial details, tokens from error reports |
| `06-security-testing-observability.md#T-06.16.02.03` | verify | Inventory needed | Configure environment-specific sampling: 100% in dev/staging, sample rate in production |
| `06-security-testing-observability.md#T-06.16.02.04` | verify | Inventory needed | Implement release correlation: send release marker to Sentry on each production deploy |
| `06-security-testing-observability.md#T-06.16.02.05` | verify | Inventory needed | Configure performance monitoring integration (tracing) with Sentry |
| `06-security-testing-observability.md#T-06.16.02.06` | verify | Inventory needed | Write integration test: error reported to Sentry, PII scrubbed, release tag present |
| `06-security-testing-observability.md#T-06.17.01.01` | verify | Inventory needed | Write Payment/Wallet Mismatch runbook: detection, freeze, reconciliation, correction, verification |
| `06-security-testing-observability.md#T-06.17.01.02` | verify | Inventory needed | Write Refund Backlog runbook: identify stuck refunds, manual intervention, idempotent replay |
| `06-security-testing-observability.md#T-06.17.01.03` | verify | Inventory needed | Write Database Failover/Restore runbook: promote replica, PITR restore, verify RPO/RTO, application reconnect |
| `06-security-testing-observability.md#T-06.17.01.04` | verify | Inventory needed | Write Object-Storage Outage runbook: fallback to local/read-only, switch region, restore from versioning |
| `06-security-testing-observability.md#T-06.17.01.05` | verify | Inventory needed | Write Notification Outage runbook: switch provider, verify OTP delivery, in-app fallback |
| `06-security-testing-observability.md#T-06.17.01.06` | verify | Inventory needed | Write Credential Compromise runbook: revoke sessions, rotate keys, notify users, audit trail |
| `06-security-testing-observability.md#T-06.17.01.07` | verify | Inventory needed | Write Bad Deployment runbook: rollback, smoke test, incident report, blameless post-mortem |
| `06-security-testing-observability.md#T-06.17.01.08` | verify | Inventory needed | Store runbooks in `docs/runbooks/` with alert links; review quarterly |
| `06-security-testing-observability.md#T-06.17.02.01` | verify | Recorded batch work | Design capability-based maintenance mode: granular toggles per module/capability with admin UI |
| `06-security-testing-observability.md#T-06.17.02.02` | verify | Inventory needed | Implement maintenance mode middleware: check capability toggle before processing; return `503` with safe message and support link |
| `06-security-testing-observability.md#T-06.17.02.03` | verify | Recorded batch work | Build admin UI: view active maintenance modes, activate/deactivate with reason + estimated duration + owner |
| `06-security-testing-observability.md#T-06.17.02.04` | verify | Inventory needed | Ensure in-app and synthetic health checks respect maintenance mode (don't alert on expected unavailability) |
| `06-security-testing-observability.md#T-06.17.02.05` | verify | Recorded batch work | Write integration tests: maintenance-prevented action returns correct status; non-maintained capabilities unaffected |
| `06-security-testing-observability.md#T-06.17.03.01` | verify | Inventory needed | Define synthetic check endpoints: `/health` (public), authenticated read-only query, login flow |
| `06-security-testing-observability.md#T-06.17.03.02` | verify | Inventory needed | Implement synthetic monitoring configuration (Checkly / Grafana Synthetics / independent provider) |
| `06-security-testing-observability.md#T-06.17.03.03` | verify | Inventory needed | Ensure synthetic checks use isolated test accounts and never create real orders/payments |
| `06-security-testing-observability.md#T-06.17.03.04` | verify | Inventory needed | Configure alert on synthetic check failure → on-call |
| `06-security-testing-observability.md#T-06.18.01.01` | verify | Inventory needed | Configure Loki log retention: 30 days searchable, longer-term archive to cold storage |
| `06-security-testing-observability.md#T-06.18.01.02` | verify | Inventory needed | Configure Prometheus metric retention: 13 months at downsampled resolution |
| `06-security-testing-observability.md#T-06.18.01.03` | verify | Inventory needed | Configure Tempo trace retention: 7 days ordinary, 30 days error/slow |
| `06-security-testing-observability.md#T-06.18.01.04` | verify | Inventory needed | Ensure audit/security/financial evidence follows legal retention (10 years default) and cannot be shortened via operational settings |
| `06-security-testing-observability.md#T-06.18.01.05` | verify | Inventory needed | Admin UI: view and change operational retention (with warning about audit retention) |
| `06-security-testing-observability.md#T-06.18.02.01` | verify | Inventory needed | Implement CI step: send release annotation to Grafana (deploy time, version, change summary, owner) |
| `06-security-testing-observability.md#T-06.18.02.02` | verify | Inventory needed | Configure Sentry release tracking: associate commits, tag errors with release version |
| `06-security-testing-observability.md#T-06.18.02.03` | verify | Inventory needed | Include release marker in structured logs for correlation |
| `06-security-testing-observability.md#T-06.18.02.04` | verify | Inventory needed | Post-deploy dashboard comparison: error rate, latency, SLO burn before/after deployment |
| `06-security-testing-observability.md#T-06.19.01.01` | verify | Inventory needed | Create DoD PR checklist template (5 categories, 25+ items) with checkboxes |
| `06-security-testing-observability.md#T-06.19.01.02` | verify | Inventory needed | Integrate DoD checklist into ticket system (Linear / GitHub Issues) as issue template |
| `06-security-testing-observability.md#T-06.19.01.03` | verify | Inventory needed | Add CI check: PR description must contain completed DoD checklist or link to exception record |
| `06-security-testing-observability.md#T-06.19.01.04` | verify | Inventory needed | Create exception template: written scope, risk, compensating control, owner, approver, expiry |
| `06-security-testing-observability.md#T-06.19.01.05` | verify | Inventory needed | Automate exception expiry: reopen after expiry if not renewed |
| `06-security-testing-observability.md#T-06.19.01.06` | verify | Inventory needed | DoD items cannot waive: financial correctness, authorization, auditability, backup/recovery, or Credential Critical security issue |

## v0.9.0: Launch rehearsal

A frozen candidate proves all four services from a clean deployment through operational recovery and customer support.

| Qualified task | State | Build evidence | Required work |
| --- | --- | --- | --- |
| `release-readiness#R-06.01` | todo | Inventory needed | Run frozen all-service launch-candidate acceptance |
| `release-readiness#R-06.02` | todo | Inventory needed | Approve launch operations and rollback rehearsal |

## v1.0.0: First production launch

Launch all four services after the owner authorizes production promotion of the accepted candidate.

| Qualified task | State | Build evidence | Required work |
| --- | --- | --- | --- |
| `release-readiness#R-07.01` | todo | Inventory needed | Authorize and execute all-four-service production launch |
