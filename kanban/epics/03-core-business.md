# Epic 03 — Core Business: Products, Electricity, Saving, Solar, Consultation

> **Domain:** Products, Electricity Supply, Power Saving, Solar Power Station Construction, Consultation
> **Status:** ⏳ Being drafted
> **Dependencies:** Epic 01 (Platform & Infrastructure), Epic 02 (Auth, Users, CRM & Admin)
> **Cross-references:** Epic 04 (Invoices, Wallet, Payments & Contracts), Epic 05 (Notifications, Documents & AI Orchestration)

---

## Table of Contents

1. [E-03.01: Product Catalog Management](#e-0301-product-catalog-management)
2. [E-03.02: Gift Code System](#e-0302-gift-code-system)
3. [E-03.03: Consultation Products & Requests](#e-0303-consultation-products--requests)
4. [E-03.04: Electricity Supply — Shared Infrastructure](#e-0304-electricity-supply--shared-infrastructure)
5. [E-03.05: Electricity Supply — Simple Ordering](#e-0305-electricity-supply--simple-ordering)
6. [E-03.06: Electricity Supply — Advanced Ordering](#e-0306-electricity-supply--advanced-ordering)
7. [E-03.07: Electricity Supply — Contract, Invoice, Payment & Status](#e-0307-electricity-supply--contract-invoice-payment--status)
8. [E-03.08: Electricity Contract Changes (Quantity Increase & Price Adjustment)](#e-0308-electricity-contract-changes)
9. [E-03.09: Power Saving Ordering](#e-0309-power-saving-ordering)
10. [E-03.10: Power Saving — Fulfillment & Operations](#e-0310-power-saving--fulfillment--operations)
11. [E-03.11: Solar Power Station Construction Request](#e-0311-solar-power-station-construction-request)
12. [E-03.12: Solar Construction — Document Verification & Postal Workflow](#e-0312-solar-construction--document-verification--postal-workflow)
13. [E-03.13: Solar Construction — Contract Creation & Finalization](#e-0313-solar-construction--contract-creation--finalization)
14. [Cross-cutting Concerns](#cross-cutting-concerns)

---

## Legend

| Icon | Meaning |
|------|---------|
| **E-NN.MM** | Epic.Story identifier |
| **S** | Complexity: Small (hours) |
| **M** | Complexity: Medium (days) |
| **L** | Complexity: Large (~week) |
| **XL** | Complexity: Multi-week, split recommended |
| 🧩 | Sub-task |
| ⚠️ | Validation / edge case |
| 🔐 | Permission / authorization check |
| 📋 | UI/UX requirement |
| 🔧 | Backend / API / database |
| 🔄 | State machine transition |
| 📊 | Reporting / admin |

---

## E-03.01: Product Catalog Management

**Goal:** Admin CRUD for all product types (consultation, electricity, hardware, saving plans). Default seed data, versioned pricing, activation/deactivation, and catalog management.

**Complexity:** L
**Depends on:** E-02 (Admin roles, permission model), E-01 (Database schema, migrations)

---

### S-03.01.01: Database Schema — Products

| ID | Task | Complexity |
|----|------|------------|
| **T-03.01.01.01** | Create `products` table with columns: `id` (UUIDv7 PK), `type` (enum: `consultation`, `electricity`, `hardware`, `saving_plan`), `system_key` (nullable unique — used for immutable system products like electricity types), `title` (localized JSONB), `description` (localized JSONB, nullable), `price` (bigint nullable, in IRR), `status` (enum: `active`, `inactive`, `archived`), `created_at`, `updated_at` | M |
| **T-03.01.01.02** | Create `product_price_versions` table for versioned pricing: `id`, `product_id` (FK), `price` (bigint), `vat_category_override` (FK nullable), `effective_from` (timestamptz), `effective_until` (timestamptz nullable), `created_by` (FK to users) | M |
| **T-03.01.01.03** | Create `product_categories` table: `id`, `product_id` (FK), `category` (enum: `electricity_generation_station_consultation`, `electricity_saving_certificate_consultation`, `thermal_electricity`, `green_electricity`, `free_market_electricity`, `energy_saving_electricity`). Only for electricity and consultation types. | S |
| **T-03.01.01.04** | Create `electricity_product_limits` table: `id`, `product_id` (FK to electricity products only), `min_kwh` (bigint, default 0 = no limit), `max_kwh` (bigint, default 0 = no limit) | S |
| **T-03.01.01.05** | Create `saving_plans` table (separate from products, linked many-to-many to hardware products): `id`, `title` (localized JSONB), `description` (localized JSONB nullable), `price` (bigint), `agreement_title` (text), `agreement_body` (text, admin-editable), `status` (active/inactive), `created_at`, `updated_at` | M |
| **T-03.01.01.06** | Create `saving_plan_hardware` junction table: `saving_plan_id` (FK), `hardware_product_id` (FK to products where type=hardware), unique constraint on pair | S |
| **T-03.01.01.07** | Add database constraints: non-negative price enforcement at DB level for products and saving plans, unique `(type, system_key)` for system products, FK with ON DELETE RESTRICT for referenced products | M |

### S-03.01.02: Default Electricity Products — Seed Migration

| ID | Task | Complexity |
|----|------|------------|
| **T-03.01.02.01** | Create idempotent seed migration that upserts four default electricity products by `system_key`:
  - `thermal_electricity` (برق حرارتی)
  - `green_electricity` (برق سبز)
  - `free_market_electricity` (برق آزاد)
  - `energy_saving_electricity` (برق صرفه‌جویی) | M |
| **T-03.01.02.02** | Each default product gets: type=`electricity`, `system_key` set to the immutable key, `price`=null (unavailable until admin sets price), `status`=`inactive` by default | S |
| **T-03.01.02.03** | Verify `pnpm db:seed` is idempotent — running it multiple times does not create duplicate system products (use ON CONFLICT on `system_key` with unique index) | S |
| **T-03.01.02.04** | ⚠️ Admin cannot delete a system electricity product, cannot change its `system_key` or `type`, cannot create additional electricity-product types. Validate at both API and DB level. | M |

### S-03.01.03: Hardware Product CRUD

| ID | Task | Complexity |
|----|------|------------|
| **T-03.01.03.01** | Admin API: `POST /admin/products/hardware` — create hardware product (title, description, price). Validate price > 0. | S |
| **T-03.01.03.02** | Admin API: `GET /admin/products/hardware` — list with search, filter by status, sort, pagination | S |
| **T-03.01.03.03** | Admin API: `GET /admin/products/hardware/:id` — detail view | S |
| **T-03.01.03.04** | Admin API: `PATCH /admin/products/hardware/:id` — update. Price change creates a new versioned price record. | M |
| **T-03.01.03.05** | Admin API: `DELETE /admin/products/hardware/:id` — archive only (soft delete). Reject if referenced by historical saving-plan associations. | S |
| **T-03.01.03.06** | ⚠️ Hardware products are not directly orderable by customers. No customer-facing order flow creates hardware-only orders. | S |
| **T-03.01.03.07** | ⚠️ Product without a valid positive price is not orderable in any context (saving plan, etc.) | S |

### S-03.01.04: Saving Plan CRUD

| ID | Task | Complexity |
|----|------|------------|
| **T-03.01.04.01** | Admin API: `POST /admin/products/saving-plans` — create. Validate at least one hardware product selected (many-to-many). | M |
| **T-03.01.04.02** | Admin API: `PATCH /admin/products/saving-plans/:id` — update title, description, price, agreement, hardware associations | M |
| **T-03.01.04.03** | Admin API: `DELETE /admin/products/saving-plans/:id` — archive. Reject if referenced by active/paid orders. | S |
| **T-03.01.04.04** | ⚠️ Saving plan agreement is admin-editable. Changes must be versioned. Orders snapshot the accepted agreement version at time of submission. | M |

### S-03.01.05: Consultation Product Configuration

| ID | Task | Complexity |
|----|------|------------|
| **T-03.01.05.01** | Seed two consultation products via migration:
  - Electricity generation station establishment consultation (`system_key`: `electricity_generation_station`)
  - Electricity-saving certificate consultation (`system_key`: `electricity_saving_certificate`) | M |
| **T-03.01.05.02** | Consultation products have no predefined price. Price field in products table is null. Creating a consultation request does not immediately create an invoice. | S |
| **T-03.01.05.03** | ⚠️ Certificate consultation is available only when active profile is Legal Entity. Frontend must hide/disable and backend must reject for Individual profiles. | M |
| **T-03.01.05.04** | ⚠️ Consultation for establishing a power station and construction request for a solar power station are independent products/records. System must not automatically convert or link them unless staff explicitly adds a reference. | S |

---

## E-03.02: Gift Code System

**Goal:** Admin-managed gift codes with public/profile-restricted eligibility, fixed/percentage discounts, usage limits, and atomic redemption at order creation.

**Complexity:** L
**Depends on:** E-01 (DB schema), E-03.01 (product catalog for eligible categories)

---

### S-03.02.01: Gift Code Database Schema

| ID | Task | Complexity |
|----|------|------------|
| **T-03.02.01.01** | Create `gift_codes` table: `id` (UUIDv7), `code` (VARCHAR, unique, normalized case-insensitively), `type` (enum: `fixed_amount`, `percentage`), `value` (bigint for fixed IRR, bigint for percentage * 10000 for precision), `max_discount` (bigint nullable — cap for percentage), `eligibility` (enum: `public`, `profile_list`), `starts_at` (timestamptz nullable), `expires_at` (timestamptz nullable), `status` (active/inactive), `total_usage_limit` (int nullable), `per_profile_usage_limit` (int nullable), `min_order_amount` (bigint nullable), `eligible_categories` (VARCHAR[] nullable — references product category keys), `restore_on_cancel` (boolean, default true), `created_at`, `updated_at` | L |
| **T-03.02.01.02** | Create `gift_code_profiles` junction table for profile-restricted codes: `gift_code_id`, `profile_id` (FK), unique constraint | S |
| **T-03.02.01.03** | Create `gift_code_redemptions` table: `id`, `gift_code_id` (FK), `profile_id` (FK), `order_id` (FK nullable — polymorphic, points to the parent order/request), `amount` (bigint — actual discount applied in IRR), `redeemed_at`, `restored_at` (nullable — set when usage is returned after cancellation) | M |

### S-03.02.02: Gift Code Admin CRUD

| ID | Task | Complexity |
|----|------|------------|
| **T-03.02.02.01** | Admin API: `POST /admin/gift-codes` — create with all fields. Normalize code to uppercase (store as-is but query normalized). | M |
| **T-03.02.02.02** | Admin API: `GET /admin/gift-codes` — list with search by code, filter by status/eligibility/expiry, pagination | S |
| **T-03.02.02.03** | Admin API: `PATCH /admin/gift-codes/:id` — update. Usage counts cannot be reset manually. | M |
| **T-03.02.02.04** | Admin API: `DELETE /admin/gift-codes/:id` — soft-delete / deactivate. Cannot delete codes with active redemptions. | S |
| **T-03.02.02.05** | 📋 Admin UI: separate gift code management section with full grid, create/edit form with validation, usage statistics per code | M |

### S-03.02.03: Gift Code Validation & Redemption

| ID | Task | Complexity |
|----|------|------------|
| **T-03.02.03.01** | Public API: `POST /gift-codes/validate` — accept code string, validate: exists, active, not expired, within usage limits, within per-profile limit, eligible for order categories, meets min order amount. Return discount amount if valid. | L |
| **T-03.02.03.02** | ⚠️ Preview validation (`POST /gift-codes/validate`) does **not** reserve or consume a code. It is a stateless check. | S |
| **T-03.02.03.03** | Atomic redemption at order creation: within the order-creation transaction, decrement total usage + increment per-profile usage. Fail if limits would be exceeded. Redemption is atomically coupled to order creation. | M |
| **T-03.02.03.04** | ⚠️ Failed order submission does not consume a gift code — rollback the redemption as part of the transaction rollback. | S |
| **T-03.02.03.05** | ⚠️ Once gift code applied, the discount must be recalculated authoritatively by backend at submission time (never trust frontend-computed discount). | S |
| **T-03.02.03.06** | Discount applied before VAT: `discount` is subtracted from taxable subtotal, then VAT calculated on net amount. | S |

### S-03.02.04: Gift Code Restoration on Cancellation

| ID | Task | Complexity |
|----|------|------------|
| **T-03.02.04.01** | On order/request cancellation **before payment**, restore gift code usage atomically: decrement total usage decrement and per-profile usage counter, set `restored_at` timestamp on the redemption record. If `restore_on_cancel` is false, do not restore. | M |
| **T-03.02.04.02** | Post-payment cancellation: gift code is not restored unless the promotion policy explicitly allows it. Follow admin setting. | S |
| **T-03.02.04.03** | ⚠️ Restoration is idempotent: running the cancellation workflow twice must not double-restore usage. Use idempotency key on the restoration operation. | M |

### S-03.02.05: VAT Configuration

| ID | Task | Complexity |
|----|------|------------|
| **T-03.02.05.01** | Create `vat_configurations` table: `id`, `category` (VARCHAR — charge category key), `rate` (integer — basis points, e.g. 900 = 9%), `effective_from` (timestamptz), `effective_until` (timestamptz nullable), `created_by` | M |
| **T-03.02.05.02** | Create `product_vat_overrides` table: `product_id` (FK), `vat_config_id` (FK), `effective_from`, `effective_until` | S |
| **T-03.02.05.03** | VAT resolution logic: if product has an active override, use it; else if the charge category has an active rate, use it; else zero. Snapshot the resolved rate on the invoice line at creation time. | M |
| **T-03.02.05.04** | Admin API: CRUD for VAT configurations and product overrides with effective dating | M |
| **T-03.02.05.05** | ⚠️ VAT calculation: tax = net taxable amount × rate, rounded half-up to nearest IRR. Discount applied before VAT. Stored inputs, rounding steps, and totals must be reproducible. | M |

---

## E-03.03: Consultation Products & Requests

**Goal:** Customer-facing consultation request submission and lifecycle. Staff-defined fee and invoicing.

**Complexity:** L
**Depends on:** E-03.01 (products seeded), E-02 (profile verification, permissions), E-04 (invoice creation)

---

### S-03.03.01: Consultation Request Lifecycle — Backend

| ID | Task | Complexity |
|----|------|------------|
| **T-03.03.01.01** | Create `consultation_requests` table: `id` (UUIDv7), `profile_id` (FK), `product_id` (FK — consultation product), `status` (enum: `submitted`, `under_review`, `awaiting_customer_info`, `offer_pending`, `offer_accepted`, `offer_declined`, `completed`, `rejected`, `cancelled`), `staff_owner_id` (FK nullable), `staff_team` (VARCHAR nullable), `fee` (bigint nullable), `scope` (text nullable), `deliverables` (text nullable), `expected_next_step` (text nullable), `offer_valid_until` (timestamptz nullable), `invoice_id` (FK nullable — to invoices), `submitted_at`, `created_at`, `updated_at` | L |
| **T-03.03.01.02** | 🔄 State machine for consultation requests with full transition rules:
  - `submitted` → `under_review` (staff picks up)
  - `under_review` → `awaiting_customer_info` (staff needs info)
  - `awaiting_customer_info` → `under_review` (customer provides info)
  - `under_review` → `offer_pending` (staff sets fee, scope, deliverables; creates invoice)
  - `offer_pending` → `offer_accepted` (customer accepts and pays)
  - `offer_pending` → `offer_declined` (customer declines — no payment trap)
  - `offer_pending` → `under_review` (staff changes fee — cancels/replaces unpaid invoice)
  - Any non-terminal → `cancelled` (staff cancels with reason)
  - Any non-terminal → `rejected` (staff rejects with reason)
  - `offer_accepted` → `completed` (staff completes) | L |
| **T-03.03.01.03** | 🔐 Consultation access control: customer sees only own profile's requests. Staff sees assigned or unassigned based on roles. | M |
| **T-03.03.01.04** | ⚠️ Consultation for electricity-saving certificate is available only when active profile is Legal Entity. Backend must reject Individual profiles at submission. | M |

### S-03.03.02: Customer Consultation Request UI

| ID | Task | Complexity |
|----|------|------------|
| **T-03.03.02.01** | 📋 Customer UI: "Consultation" section — list of available consultation products with descriptions, each with a "Request" button | M |
| **T-03.03.02.02** | 📋 Consultation request submission form: profile selection verification, product detail display, submit button with confirmation | S |
| **T-03.03.02.03** | 📋 Consultation request detail page: status, assigned staff, fee (when set), scope, deliverables, validity period. Accept/Decline buttons when `offer_pending`. | M |
| **T-03.03.02.04** | 📋 Customer's consultation list: all profile-scoped requests with status, submission date, staff owner, next action indicator | M |
| **T-03.03.02.05** | ⚠️ Every status change sends a notification. The detail page shows full status history with actor, timestamp, and reason. | S |

### S-03.03.03: Staff Consultation Management

| ID | Task | Complexity |
|----|------|------------|
| **T-03.03.03.01** | 📋 Staff UI: consultation work queue — list of unassigned and assigned requests with filtering by status, priority, age | M |
| **T-03.03.03.02** | 📋 Staff UI: consultation detail — full history, customer info, fee entry form, scope and deliverables fields, invoice creation trigger | L |
| **T-03.03.03.03** | 🔧 Staff API: `POST /staff/consultations/:id/fee` — set fee, scope, deliverables, validity period. Creates associated invoice. If a previous unpaid invoice exists, cancel and replace it. Notify customer. | L |
| **T-03.03.03.04** | 🔧 Staff API: `POST /staff/consultations/:id/assign` — assign self or team | S |
| **T-03.03.03.05** | 🔧 Staff API: `POST /staff/consultations/:id/reject` — with reason | S |
| **T-03.03.03.06** | 🔧 Staff API: `POST /staff/consultations/:id/cancel` — with reason | S |
| **T-03.03.03.07** | ⚠️ Fee changes after customer has already paid creates an adjustment/refund workflow — do not silently change or replace the paid invoice. | M |

---

## E-03.04: Electricity Supply — Shared Infrastructure

**Goal:** Common calculation rules, product limits, mandatory green-electricity composition engine shared by simple and advanced ordering.

**Complexity:** L
**Depends on:** E-03.01 (electricity product definitions, prices, limits)

---

### S-03.04.01: Calculation Engine

| ID | Task | Complexity |
|----|------|------------|
| **T-03.04.01.01** | Implement `ElectricityCalculationService` with pure functions:
  - `calculateDuration(start, end) → hours` — exact decimal hours between two timestamps
  - `calculateAveragePower(totalKwh, durationHours) → decimal kW`
  - `calculateLineTotal(quantityKwh, unitPriceIrR) → bigint` | M |
| **T-03.04.01.02** | Mandatory green rule engine:
  - `checkGreenRule(config, averagePower) → { applies: boolean, requiredGreenKwh: bigint }`
  - Input config: `enabled`, `thresholdKw` (default 1000), `minGreenPercentage` (default 4% = 0.04)
  - If not enabled or averagePower ≤ threshold → requiredGreenKwh = 0
  - If enabled and averagePower > threshold → requiredGreenKwh = totalKwh × percentage
  - ⚠️ If requiredGreenKwh exceeds green product's max_kwh → return validation error | L |
| **T-03.04.01.03** | Product limit validation:
  - For each product in order: validate quantity ≥ min_kwh (if min > 0 and quantity > 0)
  - Validate quantity ≤ max_kwh (if max > 0)
  - Limits are the same for weekly, monthly, complete, and partial periods — not prorated | M |
| **T-03.04.01.04** | ⚠️ Zero-quantity products do not trigger their min_kwh validation. A product omitted from the order has no limit check. | S |
| **T-03.04.01.05** | ⚠️ Prices snapshot at submission time: capture unit prices, VAT rates, gift code discount rate. Store in order/contract snapshot JSON. | M |

### S-03.04.02: Admin Settings for Electricity Ordering

| ID | Task | Complexity |
|----|------|------------|
| **T-03.04.02.01** | Create `electricity_settings` table: `id`, `simple_green_rule_enabled` (bool, default true), `advanced_green_rule_enabled` (bool, default false), `green_threshold_kw` (int, default 1000), `green_min_percentage` (int, basis points, default 400 = 4%), `online_wallet_topup_limit` (bigint, default 2_000_000_000), `advanced_lead_days` (int, default 0), `advanced_max_duration_months` (int, default 24), `default_contract_template_id` (FK nullable), `customer_increase_max_percentage` (int, basis points), `updated_by`, `updated_at` | L |
| **T-03.04.02.02** | Admin API: `GET /admin/settings/electricity` and `PATCH /admin/settings/electricity` — versioned settings with validation: threshold ≥ 0, percentage 0–10000, topup limit > 0. | M |
| **T-03.04.02.03** | ⚠️ Activating mandatory green rule is blocked unless green electricity product is Active, has a valid positive price, and its per-order limits are compatible with the configured percentage. | M |
| **T-03.04.02.04** | ⚠️ Settings changes affect new drafts only. Submitted orders retain the settings snapshot from confirmation time. | S |

### S-03.04.03: Green Rule Enforcement — Shared Validation

| ID | Task | Complexity |
|----|------|------------|
| **T-03.04.03.01** | Implement shared `validateOrderComposition(orderInput, settings, products)` function used by both simple and advanced order validation:
  - Validate each product exists, is active, has positive price
  - Validate quantities within per-product limits
  - Calculate total Kwh, duration, average power
  - Apply green rule if enabled
  - Return validated composition or detailed validation errors | L |
| **T-03.04.03.02** | ⚠️ Green rule simple mode: thermal is the only user-selected product. Backend auto-composes: thermal = total × (1 - green%), green = total × green%. The total requested energy is not increased. | M |
| **T-03.04.03.03** | ⚠️ Green rule advanced mode: when rule is enabled, green quantity is derived from thermal quantity (not independently editable). When rule disabled, customer can freely set green quantity. | M |
| **T-03.04.03.04** | ⚠️ When applied composition fails product limits (e.g. required green exceeds green max_kwh), the UI must explain the exact conflict. Never silently change the configured percentage. | S |

### S-03.04.04: Jalali Month/Week Period Calculation

| ID | Task | Complexity |
|----|------|------------|
| **T-03.04.04.01** | Implement Jalali calendar period calculation functions:
  - `getCurrentJalaliMonthRange(now) → { start, end }` — half-open `[now, start_of_next_month)` in Iran timezone
  - `getNextJalaliMonthRange(now) → { start, end }` — full month after current
  - `getCurrentWeekRange(now) → { start, end }` — Saturday 00:00 IRT to next Saturday 00:00 IRT, starting at `now`
  - `getNextWeekRange(now) → { start, end }` — full next week
  - `getWeekAfterNextRange(now) → { start, end }` | L |
| **T-03.04.04.02** | ⚠️ Handle 29-, 30-, and 31-day Jalali months correctly. Handle Jalali leap years. | M |
| **T-03.04.04.03** | ⚠️ Current-week period starts at current time in Iran (not at Saturday 00:00 if already past it). Week boundaries use Iran official timezone, not customer's configured timezone. | S |
| **T-03.04.04.04** | ⚠️ Current-month period: starts at current time, ends at first instant of following Jalali month. Next-month period: covers the full next month `[start_of_month, start_of_following_month)`. | M |

---

## E-03.05: Electricity Supply — Simple Ordering

**Goal:** Optimized single-product (thermal) order flow with auto green composition, bill data integration, period selection, review, and submission.

**Complexity:** XL
**Depends on:** E-03.04 (shared calculation engine, period helpers), E-02 (profile/Legal Entity check)

---

### S-03.05.01: Period Selection & Bill Data Integration

| ID | Task | Complexity |
|----|------|------------|
| **T-03.05.01.01** | 📋 Customer UI: period type selector — "Weekly" or "Monthly" | S |
| **T-03.05.01.02** | 📋 Monthly period selector: dropdown with "Current month" and "Next month" (Jalali month names displayed). Pre-calculate and display exact start/end dates in Jalali and Gregorian. | M |
| **T-03.05.01.03** | 📋 Weekly period selector: options for "Current week", "Next week", "Week after next" (max 2 weeks ahead). Display Saturday-to-Friday range in Jalali. | M |
| **T-03.05.01.04** | 🔧 Bill data integration adapter: `GET /bill-data/:profileId` — external API call to retrieve historical consumption. Returns hourly kwh data for available lookback period. Implement provider abstraction with failure handling: timeout, auth error, no data. | L |
| **T-03.05.01.05** | 🔧 Energy suggestion calculation: `suggestedKwh = avgHourlyConsumption × selectedPeriodHours`. Return `{ suggestedKwh, dataSource, dataPeriod, dataTimestamp, coverage}`. | M |
| **T-03.05.01.06** | 📋 UI: show suggested quantity labeled "Estimate" with source, period coverage, and timestamp disclaimer. Editable input field. | M |
| **T-03.05.01.07** | ⚠️ If bill data is unavailable/inaccessible/fails, customer enters kWh manually. Missing data never blocks manual entry. Show warning but allow proceed. | S |

### S-03.05.02: Energy Quantity Input & Price Preview

| ID | Task | Complexity |
|----|------|------------|
| **T-03.05.02.01** | 📋 UI: kWh input field with numeric validation, min/max based on thermal product limits. Simple mode — only thermal quantity is user-selectable. | M |
| **T-03.05.02.02** | 🔧 Real-time price preview API: `POST /electricity/preview/simple` — accepts period type, period selection, total kWh, gift code. Returns:
  - Duration in hours, average power kW
  - Green rule applicability + required green kWh
  - Thermal line: quantity, unit price, subtotal
  - Green line (if green rule applies): quantity, unit price, subtotal
  - Total bundle kWh, subtotal, discount, VAT, total
  - ⚠️ Backend authoritative — never trust frontend calculaton | L |
| **T-03.05.02.03** | 📋 Preview UI: display thermal/green breakdown, unit prices, subtotals, discount, VAT, total. Must disclose mandatory green composition and price of each component before submission. | M |
| **T-03.05.02.04** | ⚠️ Gift code input with separate "Apply" action triggering validation API. Display validity and discount before submission. Re-validate atomically at submission. | M |

### S-03.05.03: Simple Order Submission

| ID | Task | Complexity |
|----|------|------------|
| **T-03.05.03.01** | 🔧 `POST /electricity/orders/simple` — idempotent submission endpoint:
  - Validate: profile is Legal Entity, profile is verified (if required)
  - Validate: thermal product is active, has positive price
  - Calculate period based on type and selection
  - Apply green rule composition
  - Validate composed quantities against per-product limits
  - Apply gift code (atomic redemption)
  - Atomic transaction: create Order, create draft Contract, create Invoice
  - Snapshot all prices, settings, composition rules
  - Return order ID with contract and invoice references | XL |
| **T-03.05.03.02** | Create `electricity_orders` table: `id` (UUIDv7), `profile_id` (FK), `type` (enum: `simple`, `advanced`), `status` (commercial state enum), `period_start`, `period_end`, `total_kwh`, `average_power_kw`, `green_rule_applied` (bool), `submitted_by` (FK to user — records the agent), `snapshot_data` (JSONB: prices, settings, composition), `created_at`, `updated_at` | L |
| **T-03.05.03.03** | Create `electricity_order_lines` table: `id`, `order_id` (FK), `product_id` (FK), `quantity_kwh`, `unit_price`, `line_total` | M |
| **T-03.05.03.04** | Create `electricity_contracts` table: `id`, `order_id` (FK), `contract_id` (FK — to Contracts module), `status` (draft/active/completed/cancelled/etc.) | S |
| **T-03.05.03.05** | ⚠️ Idempotency key required on submission. Retrying a timed-out request returns original result without creating duplicates. | M |
| **T-03.05.03.06** | ⚠️ Validate: simple mode selects only thermal electricity. Other products cannot be manually selected. Backend must reject any other product composition. | S |

### S-03.05.04: Simple Order UI Flow

| ID | Task | Complexity |
|----|------|------------|
| **T-03.05.04.01** | 📋 Step 1: Period type and period selection with Jalali calendar display | M |
| **T-03.05.04.02** | 📋 Step 2: kWh entry with bill-data suggestion (when available) and estimate label | M |
| **T-03.05.04.03** | 📋 Step 3: Price preview with mandatory green composition breakdown | M |
| **T-03.05.04.04** | 📋 Step 4: Optional gift code entry and validation | M |
| **T-03.05.04.05** | 📋 Step 5: Review page — full summary including profile, period, quantities, prices, discount, VAT, total, wallet balance, contract preview, cancellation/refund rules. Explicit "Submit" button. | L |
| **T-03.05.04.06** | 📋 Order confirmation page — redirects to order detail. Shows order ID, contract reference, invoice reference, payment options. | M |
| **T-03.05.04.07** | 📋 Multi-step form saves server-side draft after each completed step. Resumable safely. Validation errors identify exact field without clearing valid input. | L |

---

## E-03.06: Electricity Supply — Advanced Ordering

**Goal:** Custom date-range, multi-product (4-product) bundle ordering with per-product quantities.

**Complexity:** XL
**Depends on:** E-03.04 (shared calculation engine), E-03.05 (order tables shared)

---

### S-03.06.01: Date Range Selection

| ID | Task | Complexity |
|----|------|------------|
| **T-03.06.01.01** | 📋 UI: Start date and end date pickers (Jalali calendar with time). Start cannot be in the past. End must be after start. | M |
| **T-03.06.01.02** | 🔧 Validate: duration ≤ admin-configured max (default 24 Jalali months). Validate lead time (default 0 days — start can be today). | S |
| **T-03.06.01.03** | 🔧 Calculate exact hours between start and end timestamps for average power calculation. | S |

### S-03.06.02: Multi-Product Bundle Builder

| ID | Task | Complexity |
|----|------|------------|
| **T-03.06.02.01** | 📋 UI: For each of the 4 electricity products (thermal, green, free-market, energy-saving), show:
  - Product title, unit price, current availability
  - Quantity input (kWh) — zero means omitted from bundle
  - Min/max indicators per product limits
  - Line total calculation | L |
| **T-03.06.02.02** | 🔧 `POST /electricity/preview/advanced` — accepts date range, per-product quantities, gift code. Returns:
  - Per-product line: quantity, unit price, line total
  - Total bundle kWh, exact duration hours, average power kW
  - Green rule applicability
  - Subtotal, discount, VAT, total
  - Wallet balance | L |
| **T-03.06.02.03** | ⚠️ When advanced green rule is enabled: green quantity is derived from thermal quantity (read-only display). Customer cannot edit green quantity; changing thermal recalculates green. When disabled: customer freely enters any allowed green quantity. | M |
| **T-03.06.02.04** | ⚠️ When thermal quantity is zero and mandatory green is enabled: calculated mandatory green quantity is zero. Customer cannot manually add separate green quantity. | S |

### S-03.06.03: Advanced Order Submission

| ID | Task | Complexity |
|----|------|------------|
| **T-03.06.03.01** | 🔧 `POST /electricity/orders/advanced` — idempotent submission:
  - All validations from simple order plus:
  - Bundle composition must include at least one product with positive quantity
  - Per-product minimums/maximums
  - Green rule applied correctly (derived or free)
  - Atomic transaction: order + contract + invoice
  - Create bundle with all selected products as order lines | XL |
| **T-03.06.03.02** | ⚠️ Advanced order creates one contract and one initial invoice for the complete bundle. No installment or multiple invoice generation. | S |
| **T-03.06.03.03** | ⚠️ Backend performs authoritative calculation of bundle totals: never trust frontend-computed amounts. | S |

### S-03.06.04: Advanced Order UI Flow

| ID | Task | Complexity |
|----|------|------------|
| **T-03.06.04.01** | 📋 Step 1: Date range selection with Jalali date pickers, duration display | M |
| **T-03.06.04.02** | 📋 Step 2: Bundle builder — 4 product quantity inputs with line totals, automatic green derivation when rule enabled | L |
| **T-03.06.04.03** | 📋 Step 3: Price preview with full breakdown: per-product, bundle totals, average power, green status | M |
| **T-03.06.04.04** | 📋 Step 4: Optional gift code | S |
| **T-03.06.04.05** | 📋 Step 5: Review & submit — full snapshot, wallet balance, explicit confirm | L |
| **T-03.06.04.06** | ⚠️ Lead time must be enforced: start date cannot violate lead days setting. | S |

---

## E-03.07: Electricity Supply — Contract, Invoice, Payment & Status

**Goal:** Post-subscription lifecycle: commercial/financial status display, contract review, payment, automatic refund on rejection/cancellation after payment.

**Complexity:** XL
**Depends on:** E-03.05/E-03.06 (orders created), E-04 (Contracts module, Invoices/Payments module, Wallet module)

---

### S-03.07.01: Electricity Order Status Machine

| ID | Task | Complexity |
|----|------|------------|
| **T-03.07.01.01** | 🔄 Commercial state machine for electricity orders:
  - `draft` (multi-step form in progress, not yet submitted)
  - `submitted` → `awaiting_staff_review` (initial after submission)
  - `awaiting_staff_review` → `changes_requested` (staff requests corrections)
  - `changes_requested` → `submitted` (customer resubmits amended order)
  - `awaiting_staff_review` → `approved` (contract approved)
  - `approved` → `active` (contract signed, payment confirmed, prerequisites met)
  - `active` → `completed` (period ends)
  - Any pre-active → `rejected` (staff rejects with reason)
  - Any pre-active → `cancelled` (staff cancels with reason)
  - ⚠️ `Rejected`/`Cancelled` paid orders auto-enter refund pending | L |
| **T-03.07.01.02** | 🔄 Financial state machine for electricity orders:
  - `unpaid` (initial — invoice created but not settled)
  - `payment_under_review` (bank payment submitted, awaiting confirmation)
  - `partially_funded` (bank payments cover part of the invoice)
  - `paid` (full settlement confirmed)
  - `refund_pending` (automatic after rejection/cancellation of paid order)
  - `partially_refunded`
  - `refunded` (terminal) | L |
| **T-03.07.01.03** | 📋 Order detail page: display **both** commercial and financial statuses separately with distinct labels. Never combine into one ambiguous status. | L |
| **T-03.07.01.04** | 📋 Show next action clearly for each status pair. For customer: what they need to do. For staff: what action is pending their review. | M |

### S-03.07.02: Preliminary Contract Review

| ID | Task | Complexity |
|----|------|------------|
| **T-03.07.02.01** | 🔧 Staff API: `POST /staff/electricity/orders/:id/approve` — approve preliminary contract. Notify customer. | M |
| **T-03.07.02.02** | 🔧 Staff API: `POST /staff/electricity/orders/:id/request-changes` — with reason. Notify customer. | M |
| **T-03.07.02.03** | 🔧 Staff API: `POST /staff/electricity/orders/:id/reject` — with reason. If paid, trigger automatic refund workflow. | L |
| **T-03.07.02.04** | 📋 Staff UI: electricity order review work queue — list of orders awaiting staff review with priority/age | M |
| **T-03.07.02.05** | 📋 Staff UI: order detail view — customer info, period, product breakdown, prices, contract snapshot, decision buttons (approve/request changes/reject) | L |

### S-03.07.03: Automatic Refund on Rejection/Cancellation After Payment

| ID | Task | Complexity |
|----|------|------------|
| **T-03.07.03.01** | 🔧 Create `refund_obligations` table: `id`, `order_id` (FK), `contract_id` (FK nullable), `invoice_id` (FK), `profile_id` (FK), `total_paid_amount` (bigint), `completed_refund_amount` (bigint default 0), `status` (enum: `pending`, `processing`, `completed`, `failed`), `idempotency_key` (unique), `created_at`, `updated_at` | L |
| **T-03.07.03.02** | 🔧 When an order transitions to `rejected` or `cancelled` and `total_paid_amount > completed_refund_amount`: automatically create a `refund_obligation` with status `pending`. This is automatic, not optional for staff. | M |
| **T-03.07.03.03** | 🔧 Worker: process refund obligations — post immutable wallet credit linked to contract, invoice, and original payment allocations. Use unique idempotency key to prevent duplicate credits. | L |
| **T-03.07.03.04** | ⚠️ Refundable amount = confirmed paid amount − previously completed refunds. Must never exceed this. | M |
| **T-03.07.03.05** | ⚠️ Contract/order cannot be marked financially closed until refund obligation is Completed. Staff cannot dismiss or manually mark complete without the linked wallet credit. | M |
| **T-03.07.03.06** | ⚠️ Failed refund processing must be retried and visible in a finance work queue/alert until resolved. Staff do not manually create the required full wallet refund. | M |
| **T-03.07.03.07** | 🔧 Refund completion notification to customer: amount, reason, actor/system, timestamps. | S |

### S-03.07.04: Order List & Detail — Customer Side

| ID | Task | Complexity |
|----|------|------------|
| **T-03.07.04.01** | 📋 Customer order list: all profile-scoped electricity orders with commercial + financial status, period, total kWh, total price, submission date, next action callout | L |
| **T-03.07.04.02** | 📋 Order detail: full submitted data snapshot, per-product breakdown, contract reference, invoice reference and status, payment status, review timeline, comments | L |
| **T-03.07.04.03** | 📋 No dead ends: always show current state, what happened, next available action, who is responsible, how to get help. | M |

---

## E-03.08: Electricity Contract Changes

**Goal:** Customer-initiated quantity increase (one per contract, staff approved). Staff-initiated price adjustment with mandatory transparency.

**Complexity:** L
**Depends on:** E-03.07 (active contracts/orders), E-04 (Contracts module, Invoices module)

---

### S-03.08.01: Customer Quantity Increase Request

| ID | Task | Complexity |
|----|------|------------|
| **T-03.08.01.01** | 🔧 Admin config: `customer_increase_max_percentage` in electricity settings. Default 0 = disabled. | S |
| **T-03.08.01.02** | 📋 Customer UI: "Request quantity increase" button on active electricity contract detail page. Visible only if they haven't already requested once. | M |
| **T-03.08.01.03** | 🔧 `POST /electricity/contracts/:id/request-increase` — customer submits desired new quantity. Backend validates:
  - Contract is active
  - No prior increase request for this contract
  - New total ≤ original × (1 + max_percentage / 10000)
  - ⚠️ Applies only to eligible future periods, not past or paid periods | L |
| **T-03.08.01.04** | 📋 Staff UI: quantity increase work queue — pending increase requests with contract details, current vs requested quantity, percentage change | M |
| **T-03.08.01.05** | 🔧 Staff API: `POST /staff/electricity/contracts/:id/approve-increase` — approve with optional effective date. Creates amendment document. | L |
| **T-03.08.01.06** | 🔧 Staff API: `POST /staff/electricity/contracts/:id/reject-increase` — with reason. | S |
| **T-03.08.01.07** | 🔧 After approval:
  - Create amendment document requiring customer signature
  - Customer signs → backend calculates incremental amount (amendment price snapshot)
  - Create linked adjustment invoice
  - Quantity change effective after adjustment invoice is fully paid (unless staff explicitly approves different condition with reason)
  - Negative adjustment = approved refund/credit instead of negative invoice | L |
| **T-03.08.01.08** | ⚠️ Record: old/new quantities, percentage, effective period, requester, reviewer, decision, signature, financial adjustment, timestamps. Each step notifies customer. | M |

### S-03.08.02: Staff Price Adjustment

| ID | Task | Complexity |
|----|------|------------|
| **T-03.08.02.01** | 🔧 `POST /staff/electricity/contracts/:id/adjust-price` — staff sets new price, effective date, reason. Backend:
  - Validates effective date applies to eligible future periods only
  - Never rewrites past or paid invoice lines
  - Calculates net increase over affected future quantities
  - Creates linked adjustment invoice (increase) or refund/credit (decrease) | L |
| **T-03.08.02.02** | ⚠️ Customer acceptance is not required, but contractual basis, reason, calculation, old/new price, and effective date must be visible to customer before the adjustment is finalized. | M |
| **T-03.08.02.03** | 🔐 Requires explicit permission, step-up authentication, auditing, and mandatory customer notification. | M |
| **T-03.08.02.04** | ⚠️ Initially no configurable percentage cap on staff price adjustments. Non-payment follows normal invoice Overdue workflow — does not silently change historical service. | S |

---

## E-03.09: Power Saving Ordering

**Goal:** 6-step order wizard for individual (residential) customers: plan selection, hardware, bill ID, address, agreement, submit. Creates order + draft contract + invoice atomically.

**Complexity:** XL
**Depends on:** E-03.01 (saving plans, hardware products seeded/priced), E-02 (Individual profile enforcement), E-04 (contract/invoice creation)

---

### S-03.09.01: Saving Order Database Schema

| ID | Task | Complexity |
|----|------|------------|
| **T-03.09.01.01** | Create `saving_orders` table: `id` (UUIDv7), `profile_id` (FK), `saving_plan_id` (FK), `hardware_product_id` (FK), `bill_identifier` (VARCHAR), `installation_address_id` (FK — addresses), `agreement_version` (VARCHAR), `agreement_snapshot` (text — snapshot of accepted agreement), `status` (enum — commercial state), `financial_status` (enum), `submitted_at`, `created_at`, `updated_at` | L |
| **T-03.09.01.02** | Create `saving_order_lines` table: `id`, `order_id` (FK), `description` (text), `amount` (bigint — IRR), `type` (enum: `plan_price`, `hardware_price`, `discount`, `vat`) | M |
| **T-03.09.01.03** | Create `saving_fulfillment_stages` table for tracking fulfillment progress per order | M |

### S-03.09.02: Order Wizard — Steps 1–3

| ID | Task | Complexity |
|----|------|------------|
| **T-03.09.02.01** | 📋 Step 1: Saving plan selection — display list of active saving plans with title, price, one-line description. Show inactive plans as unavailable. | M |
| **T-03.09.02.02** | 📋 Step 2: Hardware product selection — after plan selected, show assigned hardware products. Customer picks exactly one. Display title, price, full description. Require explicit confirmation checkbox. | M |
| **T-03.09.02.03** | 📋 Step 3: Electricity bill identifier input — single text field. Local format validation. Optional backend verification when provider configured. | M |
| **T-03.09.02.04** | ⚠️ Bill identifier local validation (format regex). If provider configured, async verification call. Provider failure does not erase draft — retry or submit for manual staff review. | M |
| **T-03.09.02.05** | ⚠️ Duplicate detection: admin can prevent duplicate active saving orders for same bill identifier + plan. If detected, link customer to existing order or support — do not silently allow a second order. | M |

### S-03.09.03: Order Wizard — Steps 4–6

| ID | Task | Complexity |
|----|------|------------|
| **T-03.09.03.01** | 📋 Step 4: Address selection — choose from profile's existing addresses or add new one inside the flow. Must select installation address. | M |
| **T-03.09.03.02** | 📋 Step 5: Agreement — display admin-editable saving plan agreement title and body. Require explicit "I accept" action. Record accepted version. | M |
| **T-03.09.03.03** | 📋 Step 6: Review & submit — full summary: saving plan, hardware, bill ID, address, individual price lines, subtotal, VAT and amount, gift code discount, total payable, wallet balance. Backend authoritative totals. | L |
| **T-03.09.03.04** | 🔧 Submission: `POST /saving/orders` — idempotent. Atomic transaction creates: saving order, linked draft contract, linked unpaid invoice. Snapshots: installation address, selected prices, accepted agreement version. Redirects to order detail. | XL |
| **T-03.09.03.05** | ⚠️ Idempotency prevents duplicate orders, contracts, or invoices. Use idempotency key on submission. | M |
| **T-03.09.03.06** | ⚠️ Backend enforces: active profile must be Individual (residential). Legal Entity profiles are rejected. | M |

### S-03.09.04: Saving Order Status & Customer UI

| ID | Task | Complexity |
|----|------|------------|
| **T-03.09.04.01** | 🔄 Saving order commercial states: `draft`, `submitted`, `awaiting_staff_review`, `approved`, `in_progress`, `completed`, `cancelled`, `rejected` | L |
| **T-03.09.04.02** | 🔄 Saving order financial states: `unpaid`, `paid`, `refund_pending`, `refunded` (follows general invoice model) | M |
| **T-03.09.04.03** | 📋 Customer order list: all saving orders with status, plan name, hardware, price, date, next action | L |
| **T-03.09.04.04** | 📋 Customer order detail: submitted data, invoice status, contract status, payment options, fulfillment progress (5 stages), document upload, comments | L |
| **T-03.09.04.05** | 📋 Before payment: customer can request hardware/address change — recalculates draft invoice. After payment: only staff can apply changes via audited amendment. | M |

### S-03.09.05: Saving Order Cancellation

| ID | Task | Complexity |
|----|------|------------|
| **T-03.09.05.01** | 📋 Customer cannot cancel directly. Button/link to "Request cancellation" with reason field. | M |
| **T-03.09.05.02** | 📋 Staff cancellation review UI: queue of cancellation requests with order details, customer reason | M |
| **T-03.09.05.03** | 🔧 Staff API: `POST /staff/saving/orders/:id/approve-cancellation` — sets order, contract, invoice states consistently. Determines refund amount (full/partial) and destination (wallet/external). | L |
| **T-03.09.05.04** | 🔧 Staff API: `POST /staff/saving/orders/:id/reject-cancellation` — with explanation. Contract unchanged. | S |
| **T-03.09.05.05** | ⚠️ All state transitions must be consistent across order, contract, and invoice. Records are never deleted. | M |

---

## E-03.10: Power Saving — Fulfillment & Operations

**Goal:** 5-stage fulfillment tracking, document uploads, customer-staff comments, stock management.

**Complexity:** L
**Depends on:** E-03.09 (order placed), E-05 (document upload/download/scan), E-05 (notifications)

---

### S-03.10.01: Fulfillment Stages

| ID | Task | Complexity |
|----|------|------------|
| **T-03.10.01.01** | Define 5 fulfillment stages:
  1. `request_confirmation` — staff confirms the request
  2. `product_delivery` — hardware product delivered
  3. `installation_and_document_upload` — installed, docs uploaded
  4. `equipment_handover` (تحویل داغی) — old equipment handover (optional)
  5. `process_completion` — order completed | M |
| **T-03.10.01.02** | 📋 Staff UI: order detail with stage advancement controls. Each stage advancement records previous/new state, actor, timestamp, explanation. | L |
| **T-03.10.01.03** | 📋 Customer UI: progress bar showing 5 stages, current stage highlighted, completed stages marked. | M |
| **T-03.10.01.04** | ⚠️ Equipment handover (stage 4) is optional by default. If performed, record handed-over item description, staff member, time. | S |
| **T-03.10.01.05** | ⚠️ Completed and Cancelled are terminal states. Every customer-visible status change sends notification. | S |

### S-03.10.02: Document Upload & Comments

| ID | Task | Complexity |
|----|------|------------|
| **T-03.10.02.01** | 📋 Customer UI: upload documents (PDF, images, video) to saving order. Multiple files allowed. Replace/delete own files before submission. | M |
| **T-03.10.02.02** | 📋 Customer-Staff comment thread per order: chronological, author visible, staff comments trigger notification. No silent overwrites. | L |
| **T-03.10.02.03** | ⚠️ Document upload follows file storage rules: validation, scan, quarantine. Files linked to order are soft-delete only. | M |

### S-03.10.03: Inventory/Capacity Management

| ID | Task | Complexity |
|----|------|------------|
| **T-03.10.03.01** | 🔧 Optional inventory tracking on hardware products: `stock_count`, `reserved_count` columns. Admin-configurable per product. | M |
| **T-03.10.03.02** | ⚠️ When stock tracking is disabled: UI shows "availability subject to staff confirmation". | S |
| **T-03.10.03.03** | 🔧 When stock tracking is enabled: submission reserves 1 unit for configurable period. Payment/staff confirmation completes allocation. Timeout/cancellation releases inventory. | M |

---

## E-03.11: Solar Power Station Construction Request

**Goal:** Customer-facing construction request: building type selection, on-grid/off-grid selection, document upload workflow stages, submission.

**Complexity:** XL
**Depends on:** E-02 (profile/verification), E-05 (documents/storage)

---

### S-03.11.01: Solar Construction Request — Database Schema

| ID | Task | Complexity |
|----|------|------------|
| **T-03.11.01.01** | Create `solar_construction_requests` table: `id` (UUIDv7), `profile_id` (FK), `status` (enum — overall state machine), `building_type` (enum: `building_apartment`, `non_household`), `grid_type` (enum: `on_grid`, `off_grid`), `bill_identifier` (VARCHAR nullable — required for on-grid), `property_form` (enum: `apartment`, `villa` — nullable, for building/apartment only), `structural_frame` (enum: `concrete`, `steel`, `other` — nullable), `building_completion_date` (date — nullable), `total_units` (int — nullable, for apartment), `site_category` (enum: `agricultural`, `industrial` — nullable, for non-household), `installation_surface` (enum: `land`, `rooftop`, `both` — nullable), `usable_area_sqm` (decimal — nullable), `site_address_id` (FK — nullable), `site_relationship` (enum: `owner`, `tenant`, `authorized_operator` — nullable), `site_description` (text — nullable), `agreement_accepted` (bool), `agreement_version` (text), `agreement_snapshot` (text), `created_at`, `updated_at` | XL |
| **T-03.11.01.02** | Create `solar_construction_documents` table: `id`, `request_id` (FK), `document_id` (FK — documents/storage), `file_name`, `staff_status` (enum: `pending`, `approved`, `rejected`), `staff_reason` (text nullable), `staff_reviewed_by` (FK nullable), `staff_reviewed_at`, `uploaded_by` (FK), `uploaded_at` | L |
| **T-03.11.01.03** | Create `solar_construction_postal` table: `id`, `request_id` (FK), `status` (enum: `waiting_for_shipment`, `shipped`, `received`, `incomplete`, `not_received`), `courier` (text nullable), `tracking_number` (text nullable), `send_date` (timestamptz nullable), `receipt_image_id` (FK nullable), `staff_confirmed_by` (FK nullable), `staff_confirmed_at`, `staff_notes` (text nullable) | L |

### S-03.11.02: Construction Request — Initial Screens

| ID | Task | Complexity |
|----|------|------------|
| **T-03.11.02.01** | 📋 Screen 1: Persian instruction: `نوع نیروگاه خورشیدی مورد نظر خودتان را انتخاب کنید.` — Two option cards: "Building and apartment" and "Non-household" | M |
| **T-03.11.02.02** | 📋 Building/Apartment form: property form (Apartment / Villa), structural frame (Concrete / Steel / Other), building completion date (derive age), total unit count (when Apartment selected) | M |
| **T-03.11.02.03** | 📋 Non-household form: site category (Agricultural / Industrial), installation surface (Land / Rooftop / Both), approximate usable area (sq m), site address, relationship (Owner / Tenant / Authorized Operator), optional site description | M |
| **T-03.11.02.04** | 📋 Grid type selection: "On-Grid" (sell to grid) or "Off-Grid" (self-consumption) | S |
| **T-03.11.02.05** | 📋 On-Grid only: electricity bill identifier field (required) | S |
| **T-03.11.02.06** | ⚠️ Off-Grid disclaimer: generated electricity is used internally. May remain available during grid outages only subject to final technical design and installed storage equipment. | S |

### S-03.11.03: Contract Preparation Stages Display

| ID | Task | Complexity |
|----|------|------------|
| **T-03.11.03.01** | 📋 Display 5 contract-preparation stages before submission:
  1. Contract request
  2. Document upload
  3. Document verification
  4. Postal submission of documents
  5. Final approval | M |
| **T-03.11.03.02** | 📋 Required checkbox: `شرایط ثبت قرارداد را می‌پذیرم.` with the accepted text version and time retained. | S |
| **T-03.11.03.03** | ⚠️ Submission creates only a solar construction request (no contract or invoice). Redirects to request detail page. | M |

### S-03.11.04: Construction Request State Machine

| ID | Task | Complexity |
|----|------|------------|
| **T-03.11.04.01** | 🔄 Overall state machine:
  - `draft` (form in progress)
  - `submitted` (initial after submission)
  - `uploading_documents` (document upload phase)
  - `documents_under_review` (staff reviewing)
  - `changes_requested` (staff requests additional/replacement documents)
  - `waiting_for_postal_submission`
  - `postal_documents_received`
  - `final_review`
  - `approved`
  - `rejected`
  - `cancelled`
  - `contract_created` (terminal — staff created contract) | XL |
| **T-03.11.04.02** | ⚠️ Document-level decisions do not automatically reject the overall request. Only one file may be rejected while others are approved. | M |
| **T-03.11.04.03** | ⚠️ `Rejected` and `Cancelled` require reason and support path. `Approved` remains open until staff creates/linked contract or explicitly closes as "No contract required" with elevated permission and reason. | M |

---

## E-03.12: Solar Construction — Document Verification & Postal Workflow

**Goal:** Per-file independent staff document review. Postal tracking and receipt confirmation.

**Complexity:** L
**Depends on:** E-03.11 (request submitted), E-05 (document upload, scan)

---

### S-03.12.01: Document Upload & Management

| ID | Task | Complexity |
|----|------|------------|
| **T-03.12.01.01** | 📋 Customer UI: upload documents, photos, and videos to construction request. Multiple files allowed. Guidance text is admin-editable. Display-only list of suggested/requested documents (no enforced minimum). | L |
| **T-03.12.01.02** | 📋 "I have uploaded all documents" checkbox — works even when no files uploaded. | S |
| **T-03.12.01.03** | 📋 Customer can delete or replace files even after submitting the set for review. Replacements must retain a link to the previous file and audit history (never erase). | M |
| **T-03.12.01.04** | 🔧 Admin API: edit customer-facing document guidance text and maintain suggested document list. | S |

### S-03.12.02: Staff Document Review

| ID | Task | Complexity |
|----|------|------------|
| **T-03.12.02.01** | 📋 Staff UI: document review queue — each document listed independently per request. Show file preview, uploader, timestamp, status. | L |
| **T-03.12.02.02** | 🔧 Staff API: `POST /staff/solar/requests/:id/documents/:docId/approve` — approve individual file | S |
| **T-03.12.02.03** | 🔧 Staff API: `POST /staff/solar/requests/:id/documents/:docId/reject` — with reason. Rejects only that file, not the entire submitted set. | S |
| **T-03.12.02.04** | 🔧 Staff API: `POST /staff/solar/requests/:id/documents/request-additional` — request additional/replacement file with description. | M |
| **T-03.12.02.05** | 🔧 When staff considers overall document set sufficient → staff advances request to postal submission stage (transition: `documents_under_review` → `waiting_for_postal_submission`). | M |
| **T-03.12.02.06** | ⚠️ Customer notified on each document decision (approve/reject/request). | S |

### S-03.12.03: Postal Stage

| ID | Task | Complexity |
|----|------|------------|
| **T-03.12.03.01** | 📋 Admin-editable postal guidance: destination address, contact details, requested original-document list. Display on postal stage page. | M |
| **T-03.12.03.02** | 📋 Customer UI: record courier name, tracking number, send date, optional receipt image upload. | M |
| **T-03.12.03.03** | 🔧 Staff API: `POST /staff/solar/requests/:id/postal/confirm-received` — mark as `received`. | S |
| **T-03.12.03.04** | 🔧 Staff API: `POST /staff/solar/requests/:id/postal/mark-incomplete` — with reason. Returns to `waiting_for_postal_submission` with clear instructions. Does not terminate request. | M |
| **T-03.12.03.05** | 🔧 Staff API: `POST /staff/solar/requests/:id/postal/mark-not-received` — with reason. Returns to waiting. | S |
| **T-03.12.03.06** | ⚠️ Postal stage distinguishes: `waiting_for_shipment` (customer hasn't sent yet) vs `shipped` (customer sent) vs `received` (staff confirmed) vs `incomplete`/`not_received` (staff issues). | M |

---

## E-03.13: Solar Construction — Contract Creation & Finalization

**Goal:** Staff creates full contract after final approval. Uses document templates. Invoice linked.

**Complexity:** L
**Depends on:** E-03.12 (postal confirmed), E-04 (Contracts module, document templates, invoices)

---

### S-03.13.01: Final Approval & Contract Creation

| ID | Task | Complexity |
|----|------|------------|
| **T-03.13.01.01** | 🔧 Staff API: `POST /staff/solar/requests/:id/final-approve` — final approval after postal receipt. No automatic side effects — just state transition to `approved`. | S |
| **T-03.13.01.02** | 🔧 Staff API: `POST /staff/solar/requests/:id/create-contract` — authorized staff manually creates a linked contract:
  - Uses a document template or uploaded document
  - Creates related invoices
  - Transitions request to `contract_created`
  - Notifies customer | L |
| **T-03.13.01.03** | 🔧 Staff API: `POST /staff/solar/requests/:id/close-no-contract` — elevated permission. Requires reason. Closes request without contract. | M |
| **T-03.13.01.04** | ⚠️ Final approval and contract availability + invoice issuance notify customer. All decisions and transitions auditable. | S |

### S-03.13.02: Contract Lifecycle for Solar

| ID | Task | Complexity |
|----|------|------------|
| **T-03.13.02.01** | 🔄 Solar contracts follow the general contract lifecycle (E-04):
  - `draft` → `awaiting_staff_review` → `awaiting_customer_acceptance` → `accepted` → (optionally `awaiting_signature`) → `signed` → `active` → `completed` / `cancelled` | M |
| **T-03.13.02.02** | ⚠️ Customer cancellation follows the general rule: customers submit cancellation request, staff resolves. | S |
| **T-03.13.02.03** | ⚠️ Contract activation requires: internal approval + customer acceptance + optionally signature + optionally payment. Unmet activation requirements visible on detail page. | M |

---

## Cross-cutting Concerns

### C-03.01: Electricity Ordering Default Contracts

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.01.01** | Configure default contract template for electricity orders in admin settings. The template is used when creating the preliminary contract at order submission. | M |

### C-03.02: Wallet Balance Display on Order Review

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.02.01** | All order review/submission pages must display current wallet balance. Payment is through wallet. If insufficient, show top-up option (online or bank receipt). | L |

### C-03.03: Audit Trail for All Core Business Actions

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.03.01** | Audit every: order submission, status change, contract approval/rejection/cancellation, price change, fee setting, gift code redemption, document review decision, postal confirmation. Record: entity, previous/new state, actor, timestamp, reason, correlation ID, metadata. | L |
| **T-CC-03.03.02** | Customer-facing history uses understandable labels. Internal notes and customer-visible comments are separate. Staff must choose visibility. | M |

### C-03.04: Rate Limiting

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.04.01** | Rate limit order/consultation submission: 5 per profile per minute, plus duplicate/idempotency protection. | S |
| **T-CC-03.04.02** | Rate limit gift code validation: reasonable limit to prevent brute-force guessing. | S |

### C-03.05: Configuration Safety

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.05.01** | ⚠️ An electricity product required by an ordering rule cannot be sold if inactive or has no price. Customers see "ordering temporarily unavailable" + contact support rather than broken checkout. | M |
| **T-CC-03.05.02** | ⚠️ Price/VAT/limit changes are versioned with effective dates. Existing orders keep snapshot from submission time. Admin changes never silently retroactive. | M |

### C-03.06: Admin Dashboard Widgets

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.06.01** | 📊 Admin dashboard: widget for pending consultation requests count, pending electricity orders count, pending solar construction requests count, pending document reviews. | M |
| **T-CC-03.06.02** | 📊 Admin dashboard: refund obligations queue, failed refund obligations alert. | S |

### C-03.07: Test Coverage Requirements

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.07.01** | Unit tests: state machine transitions for all electricity/saving/solar/consultation states | M |
| **T-CC-03.07.02** | Unit tests: Jalali period calculations, green rule composition, price calculation, gift code validation | M |
| **T-CC-03.07.03** | Integration tests: order submission with idempotency, concurrent wallet operations, gift code atomic redemption, automatic refund obligation creation | L |
| **T-CC-03.07.04** | E2E tests: simple electricity order → review → payment → contract lifecycle. Saving plan order wizard → fulfillment stages. Solar construction request → document upload → postal. | L |

### C-03.08: State Machine Transition Enforcement

| ID | Task | Complexity |
|----|------|------------|
| **T-CC-03.08.01** | Implement a state machine engine (or use a library) that enforces allowed transitions, guards, side effects, and notification behavior. Used across all core business entities. | L |

---

## Dependency Graph

```
E-01 (Platform & Infrastructure)
  └── E-02 (Auth, Users, CRM & Admin)
        ├── E-03.01 (Product Catalog)
        │     ├── E-03.02 (Gift Code System)
        │     ├── E-03.03 (Consultation)
        │     ├── E-03.04 (Electricity Shared)
        │     │     ├── E-03.05 (Simple Order)
        │     │     ├── E-03.06 (Advanced Order)
        │     │     └── E-03.07 (Contract/Invoice/Payment/Status)
        │     │           └── E-03.08 (Contract Changes)
        │     └── E-03.09 (Power Saving Order)
        │           └── E-03.10 (Power Saving Fulfillment)
        └── E-03.11 (Solar Construction Request)
              ├── E-03.12 (Solar Document/Postal)
              │     └── E-03.13 (Solar Contract Creation)
              └── E-04 (Invoices, Wallet, Payments & Contracts)
```

---

## Summary of Complexity

| Epic | Stories | Tasks | Complexity |
|------|---------|-------|------------|
| E-03.01 Product Catalog | 5 | 24 | L |
| E-03.02 Gift Code System | 5 | 16 | L |
| E-03.03 Consultation | 3 | 15 | L |
| E-03.04 Electricity Shared | 4 | 17 | L |
| E-03.05 Simple Ordering | 4 | 20 | XL |
| E-03.06 Advanced Ordering | 4 | 14 | XL |
| E-03.07 Contract/Invoice/Status | 4 | 18 | XL |
| E-03.08 Contract Changes | 2 | 12 | L |
| E-03.09 Power Saving Order | 5 | 21 | XL |
| E-03.10 Saving Fulfillment | 3 | 10 | L |
| E-03.11 Solar Construction Request | 4 | 14 | XL |
| E-03.12 Solar Document/Postal | 3 | 12 | L |
| E-03.13 Solar Contract Creation | 2 | 7 | L |
| Cross-cutting | 8 | 10 | — |
| **Total** | **52** | **210** | — |

> **Next:** Epic 04 — Invoices, Wallet, Payments & Contracts

---

## Gap Remediation

The following gaps were identified during the cross-audit of this epic against `README.md` (1260 lines) and `architecture.md` (177 lines).

### G-03.01 — Cross-cutting "No Dead Ends" principle enforcement
- **Source:** README.md §Product-wide operating principles (lines 143–153)
- **Gap:** T-03.07.04.03 mentions "no dead ends" for one screen, but there is no cross-cutting task ensuring EVERY workflow implements the principle: always show current state, what happened, next action, responsible party, and support path. Multi-step form draft auto-save is mentioned for electricity (T-03.05.04.07) but not generalized.
- **Suggested Task:** Add cross-cutting story `C-03.09`: Create `<WorkflowStatusBanner>` component that renders state/next-action/support-contact for any business entity. Create `useFormDraft(key, schema)` hook for auto-saving multi-step form progress server-side after each step. Add an architectural test/checklist item verifying every customer-facing workflow has status, next-action, and support-contact displayed.

### G-03.02 — Power-saving ordering: billing provider integration for bill identifier verification
- **Source:** README.md §Power saving (lines 860–861)
- **Gap:** T-03.09.02.04 mentions "optional backend verification when provider configured" but there is no task for building a provider abstraction for bill-data verification (similar to how bill-data is fetched for electricity orders). The provider failure and retry logic for bill verification are not defined.
- **Suggested Task:** Add task to S-03.09.02: create `BillVerificationProvider` abstraction with adapter for official Iranian bill-data APIs. Include timeout, retry, circuit breaker, and `verification_result` field on saving orders. Provider failure must not erase the draft.

### G-03.03 — Gift code: percentage discount max-cap validation at admin entry
- **Source:** README.md §Gift codes (line 975)
- **Gap:** T-03.02.01.01 includes `max_discount` field but there is no task for admin-side validation that a percentage code MUST have a max_discount cap, and that the cap cannot be lower than the calculated percentage of a reference order amount.
- **Suggested Task:** Add validation task: when admin creates/edits a percentage-type gift code, `max_discount` is required (not optional). Validate the cap is reasonable (>= 1 IRR). Add UI hint: "Percentage codes require a maximum discount cap to limit financial exposure."

### G-03.04 — Saving plan agreement versioning and snapshots
- **Source:** README.md §Power saving (line 858, 969)
- **Gap:** T-03.01.04.04 mentions "changes must be versioned" and T-03.09.03.02 records the accepted version. But there is no task for building the versioning system for saving-plan agreements (title + body) with Draft/Active/Superseded lifecycle, storing the snapshot on order submission, and displaying the agreement the customer accepted.
- **Suggested Task:** Add task to S-03.01.04: create `saving_plan_agreement_versions` table, implement Draft → Active → Superseded lifecycle for agreement title/body, store the agreement version snapshot on order submission (T-03.09.01.01's `agreement_snapshot` field should capture the full rendered agreement text, not just the version ID).