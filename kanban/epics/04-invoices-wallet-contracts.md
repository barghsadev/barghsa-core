# Epic E-04: Invoices, Wallet, Payments & Contracts

> **Domain:** Financial & Contractual Operations
> **Audit status:** Cross-referenced against README.md and architecture.md — exhaustive
> **Dependencies:** E-01 (Platform), E-02 (Auth/Users/CRM), E-03 (Core Business — Products, Orders)
> **Depended by:** E-05 (Notifications, Documents)

---

## Table of Contents

1. [Epic Overview](#epic-overview)
2. [E-04.1 — Invoices](#e-041--invoices)
3. [E-04.2 — Wallet](#e-042--wallet)
4. [E-04.3 — Bank Receipts & Payment Confirmation](#e-043--bank-receipts--payment-confirmation)
5. [E-04.4 — Refunds](#e-044--refunds)
6. [E-04.5 — Contracts](#e-045--contracts)
7. [E-04.6 — Electricity Contract Changes (Quantity & Price Adjustments)](#e-046--electricity-contract-changes-quantity--price-adjustments)
8. [Cross-Cutting Concerns](#cross-cutting-concerns)
9. [Dependency Graph](#dependency-graph)

---

## Epic Overview

### Domain scope

This epic covers everything related to **money and legal commitments**:

| Subdomain | Coverage |
|-----------|----------|
| **Invoices** | Draft → Paid → Refunded lifecycle, manual/auto generation, bank receipts, payment reminders, corrections |
| **Wallet** | Per-profile ledger, online/bank top-ups, atomic invoice settlement, reconciliation, chargebacks |
| **Payments/Refunds** | Refund state machine, dual-approval thresholds, automatic wallet return for rejected contracts |
| **Contracts** | Full lifecycle (Draft → Signed → Active → Completed/Cancelled), versioning, amendments, electricity contract quantity/price changes |

### Key architectural rules

1. **No direct online gateway on invoices** — customers fund wallet first, then pay invoice from wallet in one full debit.
2. **IRR only** — all amounts stored as signed 64-bit integers; floating-point arithmetic strictly forbidden.
3. **Idempotency key** required on every money-moving command.
4. **Atomicity** — wallet debit + invoice settlement in one DB transaction.
5. **Optimistic/pessimistic locking** on wallet balance, invoice state, contract version.
6. **Audit** — every transition records actor, previous/new state, timestamp, reason, correlation ID. Append-only.
7. **PostgreSQL outbox** for background work (notifications, refund processing).
8. **Staff step-up auth** required for payment confirmation, refunds, contract cancellation, price changes.

---

## E-04.1 — Invoices

### S-04.1.01 — Invoice state machine

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.1.01 | Implement the complete invoice state machine with guard transitions, audit logging, and enforced constraints | XL | E-01 (DB schema), E-02 (Auth/permissions) |

#### State machine specification

**States:** `Draft → Unpaid → Payment under review → Partially funded → Paid → Overdue → Cancelled → Partially refunded → Refunded`

| Transition | From | To | Trigger | Permissions | Side effects |
|------------|------|----|---------|-------------|--------------|
| Issue | Draft | Unpaid | Staff action or auto-generation from order/contract | Finance staff or system | Notify customer; set `issuedAt`, `payableFrom`, `dueAt`; begin reminder schedule |
| Submit bank receipt | Unpaid, Partially funded | Payment under review | Customer uploads receipt | Customer (active profile) | Create pending bank receipt record |
| Confirm bank receipt | Payment under review | Unpaid / Partially funded / Paid | Finance staff confirmation | Finance (or dual-approval if ≥ threshold) | Wallet credit if overpayment occurs; invoice progress update |
| Pay from wallet | Unpaid, Partially funded | Paid | Customer or system | Customer (sufficient wallet balance) | Atomic wallet debit; close invoice; stop reminders |
| Overdue | Unpaid, Partially funded | Overdue | Time-based cron | System | Set overdue flag; continue reminders; no auto-penalty in v1 |
| Cancel | Unpaid, Overdue, Draft | Cancelled | Staff action | Finance (+ reason) | Release any reserved funds; notify customer; stop reminders |
| Partial refund | Paid, Partially refunded | Partially refunded | Staff action | Finance (dual-approval if ≥ threshold) | Create refund transaction; update invoice paid/refunded amounts |
| Full refund | Paid | Refunded | Staff action | Finance (dual-approval if ≥ threshold) | Create refund transaction; close invoice fully |
| Correction (replace) | Draft, Unpaid | Cancelled + new Draft | Staff action | Finance (+ reason) | Cancel old, create linked replacement invoice |

**Constraints enforced by DB and application:**
- `Paid` can only be reached when `confirmed_amount >= total_amount`
- `Refunded` requires `total_refunded == total_paid`
- `Partially funded` applies when `0 < confirmed_amount < total_amount`
- No transition from a terminal state (`Paid`, `Cancelled`, `Refunded`) except `Partially refunded` from `Paid`
- `Payment under review` is a transient holding state per bank receipt submission, not a stored invoice state — reconsider if multiple receipts overlap

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.1.01.01 | Define invoice DB table with columns: `id` (UUIDv7), `profileId`, `orderId?`, `contractId?`, `state`, `totalAmount` (int8), `paidAmount` (int8, default 0), `refundedAmount` (int8, default 0), `issuedAt`, `payableFrom`, `dueAt`, `cancelledAt?`, `metadata` (JSONB for snapshots), timestamps | M |
| T-04.1.01.02 | Create `invoice_state` enum in DB matching all 9 states | S |
| T-04.1.01.03 | Implement `InvoiceStateMachine` service with guard methods, transition validation, audit event emission | L |
| T-04.1.01.04 | Add DB constraints: `CHECK (paidAmount <= totalAmount)`, `CHECK (refundedAmount <= paidAmount)` | M |
| T-04.1.01.05 | Write audit repository entry for every invoice state transition | M |
| T-04.1.01.06 | Integration tests: all happy-path transitions, every forbidden transition, concurrent state change rejection | L |

---

### S-04.1.02 — Invoice generation (manual & automatic)

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.1.02 | Staff can create manual invoices with custom lines; system auto-generates invoices from orders/contracts | L | S-04.1.01, E-03 (Orders) |

#### Requirements

- **Manual invoices:** Finance staff can create an invoice with N custom description+price lines, linked optionally to a profile and/or contract. No order required.
- **Auto-generated invoices:** Order submission creates a linked invoice atomically (same DB transaction). Saving-plan orders, electricity orders (simple & advanced), consultation fee offers.
- **Full upfront settlement:** An order creates one initial invoice for the complete amount. No installment schedules.
- **Snapshots:** Invoice stores snapshot of prices, VAT rate, product composition, gift-code discount at time of creation.
- **VAT calculation:** After discount on taxable lines; rate from category default or product override; rounded half-up to nearest IRR.
- **Invoice lines table:** `invoiceId`, `description`, `quantity`, `unitPrice`, `lineTotal`, `vatRate`, `vatAmount`, `isTaxable`.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.1.02.01 | Create `invoice_lines` and `invoice_items` tables with proper foreign keys and constraints | M |
| T-04.1.02.02 | Build `ManualInvoiceService` — staff selects profile, adds lines, system calculates totals, issues invoice | L |
| T-04.1.02.03 | Build `AutoInvoiceService` — called by order/contract creation within same transaction; snapshot prices and terms | M |
| T-04.1.02.04 | Implement VAT calculation module with category default / product override resolution | L |
| T-04.1.02.05 | Link invoice to origin: nullable `orderId`, `contractId`, `consultationId` foreign keys | S |
| T-04.1.02.06 | Ensure idempotency: same order cannot produce duplicate invoices (unique `orderId` + `type` index) | M |

---

### S-04.1.03 — Invoice due dates & staff override

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.1.03 | Admin-configured default due periods by service type; staff can override with reason | M | E-01 (Admin configuration), S-04.1.01 |

#### Requirements

- Admin configures default due period (in days) per service type (electricity, saving plan, consultation, manual).
- Each invoice stores `issuedAt`, `payableFrom`, `dueAt`.
- Staff override of `dueAt` requires explicit permission and a customer-visible reason stored in audit.
- Overdue invoice remains payable unless explicitly Cancelled. No automatic late fees in v1.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.1.03.01 | Add `service_due_periods` admin config table (service type, default days, active period) | M |
| T-04.1.03.02 | Add `dueAt` calculation logic: `issuedAt + config_days` (or staff override) | S |
| T-04.1.03.03 | Build staff override UI/API: override input + reason field, stored in audit + invoice metadata | M |
| T-04.1.03.04 | Cron job: mark invoices past `dueAt` as Overdue if still Unpaid or Partially funded | M |

---

### S-04.1.04 — Payment reminders

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.1.04 | Multi-offset payment reminder schedule: 7, 3, 1 day before dueAt, on due, 1 & 7 days after | L | S-04.1.01, E-05 (Notifications) |

#### Requirements

- Default offsets (days relative to `dueAt`): `-7`, `-3`, `-1`, `0`, `+1`, `+7`.
- Reminders sent in-app + enabled external channel (SMS/email per profile preferences).
- Admin can enable/disable individual offsets per service type.
- **Idempotent per (invoice, offset, channel):** same reminder never sent twice.
- **Stop immediately** when invoice reaches Paid, Cancelled, or Refunded.
- Use daytime delivery rules (09:00–21:00 profile timezone; queued outside window).
- Reminder templates are versioned, localized (FA/EN).

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.1.04.01 | Design `invoice_reminder_schedule` table: `invoiceId`, `offset`, `channel`, `scheduledAt`, `sentAt?`, `status` | M |
| T-04.1.04.02 | Build `ReminderScheduler` worker: on invoice issue, compute reminder datetimes and insert schedule rows | M |
| T-04.1.04.03 | Build `ReminderSender` worker: cron every hour picks due reminders, checks invoice state, sends via outbox | M |
| T-04.1.04.04 | Enforce idempotency: unique index on (invoiceId, offset, channel) | S |
| T-04.1.04.05 | Admin toggle UI: enable/disable each offset per service type | M |
| T-04.1.04.06 | Stop reminders: when invoice enters Paid/Cancelled/Refunded, mark all future schedule rows as Cancelled | M |

---

### S-04.1.05 — Invoice corrections (cancel+replace & adjustment)

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.1.05 | Pre-payment corrections via cancel+replace; post-payment via adjustment invoice or refund/credit | L | S-04.1.01, S-04.4.01 (Refunds) |

#### Requirements

- **Before payment:** Staff cancels invoice (with reason), creates a linked corrected invoice. Customer sees the chain.
- **After payment:** Corrections use an adjustment invoice (positive or negative amount) or refund/credit transaction. Never edit issued or paid lines.
- **Linking:** Corrected invoice stores `replacesInvoiceId`; adjustment invoice stores `adjustmentForInvoiceId`.
- **UI:** Customer sees original invoice, correction chain, explanation of changes.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.1.05.01 | Add `replacesInvoiceId` and `adjustmentForInvoiceId` nullable self-references on invoice table | S |
| T-04.1.05.02 | Build `cancelAndReplaceInvoice(invoiceId, reason, newLines)` — validates no payment, cancels, creates linked replacement | M |
| T-04.1.05.03 | Build `createAdjustmentInvoice(originalInvoiceId, amount, reason)` — positive = additional charge, negative = credit | M |
| T-04.1.05.04 | Customer-facing invoice details page shows original + linked corrections/replacements with explanations | M |

---

## E-04.2 — Wallet

### S-04.2.01 — Wallet ledger & balances

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.2.01 | Per-profile wallet with posted, reserved, and available balances; immutable ledger; version-based concurrency | XL | E-01 (DB schema), E-02 (Auth — profile isolation) |

#### Core rules

- **One wallet per customer profile** (Individual or Legal), NOT per login user.
- Profile switching changes the visible wallet.
- **Ledger:** Every balance change is a ledger transaction. No direct wallet balance overwrite.
- **Three derived balances:**
  - `postedBalance` — sum of all completed credits minus completed debits
  - `reservedBalance` — sum of all pending/active reservations
  - `availableBalance` = `postedBalance - reservedBalance`
- **No negative available balance** — enforced by DB constraints and application logic.
- **Database locking/version checks** on every mutation.
- **IRR only** — signed 64-bit integer.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.2.01.01 | Create `wallets` table: `profileId` (PK, FK), `postedBalance` (int8, default 0), `reservedBalance` (int8, default 0), `version` (int, optimistic lock), `updatedAt` | M |
| T-04.2.01.02 | Create `wallet_transactions` table: `id` (UUIDv7), `walletId`, `type` (enum: topup, payment, refund, reservation, release, reversal, compensating), `amount` (int8, positive for credit, negative for debit), `state` (Pending, Reserved, Completed, Failed, Rejected, Released, Reversed), `idempotencyKey` (unique), `refId?`, `description?`, `metadata` (JSONB), timestamps | L |
| T-04.2.01.03 | Implement `WalletService.credit(walletId, amount, ref, idempotencyKey)` — inserts ledger row, updates postedBalance with `WHERE version = X AND postedBalance >= 0` | M |
| T-04.2.01.04 | Implement `WalletService.debit(walletId, amount, ref, idempotencyKey)` — checks availableBalance >= amount, atomically reserves then completes | L |
| T-04.2.01.05 | Implement `WalletService.reserve(walletId, amount)` and `release(reservationId)` for payment flow | M |
| T-04.2.01.06 | Implement optimistic locking: `UPDATE wallets SET postedBalance = postedBalance + delta, version = version + 1 WHERE id = X AND version = expectedVersion` | M |
| T-04.2.01.07 | Add DB constraint: `CHECK (availableBalance >= 0)` via generated column or trigger | M |
| T-04.2.01.08 | Scheduled reconciliation worker: compare ledger sum vs wallet balance, report mismatch to finance queue | M |

---

### S-04.2.02 — Wallet top-ups (online & bank receipt)

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.2.02 | Customers top up wallet via online payment (with provider callback) or bank receipt (staff confirmation) | L | S-04.2.01, S-04.3.01 (Bank receipts) |

#### Requirements

- **Online top-up:**
  - Subject to admin-configured `onlineTopUpLimit` (default 2,000,000,000 IRR per transaction).
  - Requires authenticated provider callback — browser redirect alone is insufficient proof.
  - Pending top-ups expire safely after timeout; reconcilable later via provider reference.
  - Transaction limit enforced at submission; retry with reduced amount.
- **Bank receipt top-up:**
  - No configured maximum.
  - Customer submits receipt (amount, date, payer ref, attachment, note).
  - Stays Pending until finance staff confirm. Rejected submissions never increase balance.
  - Overpayment handling: excess credited to wallet via separate verified credit, not invoice over-settlement.
- **Wallet credited only after** confirmed callback or staff confirmation.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.2.02.01 | Build online top-up initiation: validate limit, create Pending transaction, redirect to gateway | M |
| T-04.2.02.02 | Build provider callback handler: verify signature, replay window, event id, merchant context; apply credit via `WalletService.credit()` with idempotency key | L |
| T-04.2.02.03 | Build bank receipt top-up flow: customer uploads receipt → wallet transaction in Pending state | M |
| T-04.2.02.04 | Staff confirmation UI: review receipt, confirm or reject with reason; on confirm → `WalletService.credit()` | M |
| T-04.2.02.05 | Overpayment handling: if receipt amount > invoice remaining, credit excess to wallet | M |
| T-04.2.02.06 | Admin-configurable `onlineTopUpLimit` with versioned config, enforced at submission | M |
| T-04.2.02.07 | Expiry cron: auto-reject online top-ups stuck in Pending beyond TTL | M |

---

### S-04.2.03 — Atomic wallet-to-invoice payment

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.2.03 | Pay an invoice with a single full wallet debit — atomic, idempotent, concurrent-safe | XL | S-04.2.01, S-04.1.01 |

#### Requirements

- **Single full debit:** Wallet deducts the exact remaining invoice amount in one transaction.
- **Enabled only when** `availableBalance >= remainingInvoiceAmount`.
- **Atomic:** Wallet debit and invoice state change in one DB transaction. If either fails, both roll back.
- **Idempotent:** Retrying with same idempotency key returns original result, never debits twice.
- **Concurrency:** Use `SELECT ... FOR UPDATE` on wallet row + invoice row within transaction. Optimistic version check as second line of defense.
- **After payment:** Invoice state → `Paid`. Wallet postedBalance reduced.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.2.03.01 | Implement `payInvoiceWithWallet(invoiceId, profileId, idempotencyKey)` service method | L |
| T-04.2.03.02 | Use DB transaction: `SELECT ... FOR UPDATE` on wallet and invoice, validate available balance, debit wallet, update invoice → Paid, insert wallet_transaction + audit | L |
| T-04.2.03.03 | Implement idempotency: unique index on `(idempotencyKey, entityType)`, return cached result on retry | M |
| T-04.2.03.04 | Integration tests: concurrent payment attempts (one succeeds, others fail), duplicate idempotency key, insufficient balance, race conditions | L |

---

### S-04.2.04 — Chargeback / reversal handling

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.2.04 | Handle provider-initiated chargebacks and reversals with explicit transactions + finance alert | M | S-04.2.01 |

#### Requirements

- Chargeback or reversed provider payment creates an explicit reversal/exception ledger transaction.
- Never silently edit wallet history — use compensating transactions.
- Alert finance team immediately on chargeback detection.
- Reverse the specific original transaction when traceable; otherwise create a general exception.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.2.04.01 | Implement `reverseTransaction(originalTransactionId, reason, idempotencyKey)` — creates reversal transaction, adjusts balance | M |
| T-04.2.04.02 | Build provider chargeback detection: parse inbound notification, validate signature, map to original top-up | M |
| T-04.2.04.03 | Finance alert: push notification + dashboard warning for unresolved chargeback | M |

---

## E-04.3 — Bank Receipts & Payment Confirmation

### S-04.3.01 — Bank receipt submission & confirmation

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.3.01 | Customer submits bank receipts; finance staff confirms or rejects; overpayment auto-credited to wallet | L | S-04.1.01, S-04.2.01 |

#### State machine for bank receipts

**States:** `Submitted → (Under review) → Confirmed | Rejected`

| Transition | From | To | Trigger | Rules |
|------------|------|----|---------|-------|
| Submit | — | Submitted | Customer uploads | Store amount, date, payer ref, attachment, note |
| Review | Submitted | Under review | Staff picks up | Auto-assigned or manual |
| Confirm | Submitted, Under review | Confirmed | Finance staff | Cannot exceed invoice remaining balance; dual-approval if ≥ threshold |
| Reject | Submitted, Under review | Rejected | Finance staff | Store reason; notify customer; never affects balance |

#### Overpayment rule
If confirmed amount > invoice remaining, excess amount creates a verified profile-wallet credit (separate from invoice settlement). Staff cannot over-settle the invoice.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.3.01.01 | Create `bank_receipts` table: `id`, `invoiceId`, `profileId`, `amount`, `paymentDate`, `payerReference`, `attachmentKey`, `customerNote`, `state`, `confirmedBy?`, `confirmedAt?`, `rejectionReason?`, timestamps | M |
| T-04.3.01.02 | Customer upload flow: validation (amount positive, file type/size), create receipt in Submitted state | M |
| T-04.3.01.03 | Staff confirmation API: validate amount ≤ invoice remaining; if excess → auto-credit wallet; update invoice state; mark receipt Confirmed | L |
| T-04.3.01.04 | Staff rejection API: mark receipt Rejected, store reason, notify customer | M |
| T-04.3.01.05 | Dual-approval check: if receipt amount ≥ admin-configured threshold, require second finance staff confirmation | L |
| T-04.3.01.06 | Overpayment wallet credit: separate `WalletService.credit()` with its own idempotency key | M |
| T-04.3.01.07 | Update invoice state tracking: as bank receipts accumulate, invoice state flows Unpaid → Partially funded → Paid | M |

---

### S-04.3.02 — Invoice & wallet transaction history UI

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.3.02 | Customer-visible history of invoice payments, wallet transactions, and bank receipts | L | S-04.1.01, S-04.2.01, S-04.3.01 |

#### Requirements

- **Invoice detail page:** Shows line items, payment status, paid amount, remaining amount, linked wallet transactions, bank receipts with their states, adjustment links, refund records.
- **Wallet transaction history:** Filterable, sortable, paginated list of all wallet transactions. Columns: date, type, amount (+/-), state, description, reference entity.
- **Customer-friendly labels:** Internal state codes translated to understandable Persian/English labels.
- **No dead ends:** Terminal states show full history, documents, financial outcome, and support access.
- **Profile-scoped:** Customers see only their active profile's data.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.3.02.01 | Invoice detail API: aggregate invoice, lines, payments, bank receipts, refunds, adjustments | M |
| T-04.3.02.02 | Wallet transaction list API: cursor-based pagination, filters (type, state, date range), sort | M |
| T-04.3.02.03 | React components: InvoiceDetail, WalletTransactionList, BankReceiptList with full states | L |
| T-04.3.02.04 | Localized state labels and descriptive text for every state | M |

---

## E-04.4 — Refunds

### S-04.4.01 — Refund state machine

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.4.01 | Complete refund lifecycle: Requested → Approved → Processing → Completed/Failed/Rejected/Cancelled | XL | S-04.2.01, S-04.1.01 |

#### State machine specification

**States:** `Requested → Approved → Processing → Completed | Failed | Rejected | Cancelled`

| Transition | From | To | Trigger | Permissions | Side effects |
|------------|------|----|---------|-------------|--------------|
| Request | — | Requested | Staff action OR system (auto on contract rejection with paid invoice) | Finance staff or system | Link to original payment allocations |
| Approve | Requested | Approved | Finance staff (dual-approval if ≥ threshold) | Finance | Create pending refund transaction; set refund destination |
| Process | Approved | Processing | Worker or staff | System | Execute wallet credit or record external bank transfer reference |
| Complete | Processing | Completed | Worker (wallet) OR staff (external, after bank ref) | System (wallet) or Finance (external) | Wallet credit posted; invoice refunded amounts updated |
| Fail | Processing | Failed | System | System | Retry; if exhausted, alert finance |
| Reject | Requested, Approved | Rejected | Finance staff | Finance (+ reason) | Notify customer; no balance change |
| Cancel | Requested, Approved | Cancelled | Finance staff | Finance (+ reason) | Cancel without processing |

#### Rules
- **Full or partial refund** — staff specifies amount.
- **Wallet vs external destination** — staff selects.
- **Wallet refunds** post only through the ledger (no manual balance edit).
- **External refunds** stay Processing until staff records bank reference; second reconciliation check confirms completion.
- **Idempotency:** retrying/reopening a refund never duplicates returned amount.
- **Constraint:** refunded amount can never exceed `confirmedPaidAmount - completedRefunds`.
- **Dual-approval** thresholds apply to refunds ≥ configured amount.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.4.01.01 | Create `refunds` table: `id`, `invoiceId`, `profileId`, `amount`, `state`, `destination` (wallet | external_bank), `staffId`, `idempotencyKey`, `bankReference?`, `reconciliationStatus?`, timestamps | L |
| T-04.4.01.02 | Implement `RefundStateMachine` with all 9 transitions, guards, and audit events | L |
| T-04.4.01.03 | DB constraint: `CHECK (amount <= (SELECT paidAmount - refundedAmount FROM invoices WHERE id = invoiceId))` | M |
| T-04.4.01.04 | Wallet refund: `WalletService.credit()` with idempotency key tied to refund ID | M |
| T-04.4.01.05 | External refund: workflow for staff to record bank reference; second reconciliation confirmation step | M |
| T-04.4.01.06 | Dual-approval integration: if refund amount ≥ threshold, require second finance staff before Approved | L |
| T-04.4.01.07 | Retry worker: pick up Failed refunds with bounded backoff; alert if max attempts exceeded | M |

---

### S-04.4.02 — Automatic wallet return on contract rejection

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.4.02 | Rejecting/cancelling a paid electricity contract automatically triggers full wallet refund (mandatory system workflow) | L | S-04.1.01, S-04.2.01, E-04.5 (Contracts) |

#### Requirements

- **Mandatory system workflow:** When an electricity contract is rejected or cancelled AND `refundablePaidBalance > 0`, a durable refund obligation is created automatically.
- **Contract/order cannot be marked financially closed** until the refund obligation is Completed.
- **Worker** posts an immutable wallet credit linked to contract, invoice, and original payment allocations.
- **Idempotency key** per refund obligation prevents duplicate wallet credits during retries or repeated staff actions.
- **Refundable amount** = confirmed paid amount minus previously completed refunds.
- **Failed processing** shown in finance work queue/alert until resolved. Staff cannot manually dismiss.
- **Completion** notifies customer and records actor (system), amount, reason, timestamps.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.4.02.01 | Build `AutomaticRefundObligation` trigger: on contract → Rejected/Cancelled, if paid amount > 0, create refund with state Requested, destination = wallet | L |
| T-04.4.02.02 | Worker: pick up auto-refund obligations, execute `WalletService.credit()`, mark refund Completed | M |
| T-04.4.02.03 | Block contract/order financial closure until linked refund obligations are Completed | M |
| T-04.4.02.04 | Finance queue: show failed auto-refund obligations with Retry action | M |
| T-04.4.02.05 | Notify customer on completion and on failure (with support path) | M |

---

## E-04.5 — Contracts

### S-04.5.01 — Contract state machine (full lifecycle)

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.5.01 | Complete contract lifecycle: Draft → Awaiting staff review → Changes requested → Awaiting customer acceptance → Accepted → Awaiting signature → Signed → Active → Completed/Cancelled | XL | E-01, E-02, S-04.1.01 |

#### State machine specification

**States:** `Draft → Awaiting staff review → Changes requested → Awaiting customer acceptance → Accepted → Awaiting signature → Signed → Active → Completed | Cancelled`

**Standard path:**
```
Draft → Awaiting staff review → Awaiting customer acceptance → Accepted → Awaiting signature → Signed → Active → Completed
```

| Transition | From | To | Trigger | Permissions | Side effects |
|------------|------|----|---------|-------------|--------------|
| Create | — | Draft | Staff or system (from order) | Staff or system | Initial version created |
| Submit for review | Draft | Awaiting staff review | Staff action | Staff (Legal) | Notify reviewing staff |
| Request changes | Awaiting staff review | Changes requested | Staff action | Staff (Legal, + reason) | Customer notified; optional new version |
| Resubmit | Changes requested | Awaiting staff review | Staff creates new version | Staff (Legal) | New immutable version; customer notified |
| Send to customer | Awaiting staff review | Awaiting customer acceptance | Staff action | Staff (Legal) | Customer notified; exact version locked |
| Accept | Awaiting customer acceptance | Accepted | Customer action | Customer (Legal role) | Exact version accepted; next step depends on contract type |
| Submit for signature | Accepted | Awaiting signature | Staff or system | Staff (Legal) | Generate signature-ready document |
| Upload signed | Awaiting signature | Signed | Customer or staff | Customer uploads; Staff records signed copy | Staff upload identifies actor; never imply staff signed for customer |
| Activate | Signed (or Accepted if no signature required) | Active | System (after prerequisites met) | System | Prerequisites: staff approval + customer acceptance + (signature if required) + (any type-specific rules) |
| Complete | Active | Completed | System (end of term) | System | Terminal state |
| Staff-cancel | Any non-terminal | Cancelled | Staff action | Staff (Legal, + reason, + refund decision) | Creates refund obligation if paid; terminal |
| Customer-cancel request | Awaiting customer acceptance, Active | — | Customer requests | Customer (reason, preferred refund dest) | Creates review task for staff; NOT a direct cancel |

#### Prerequisites for activation
- Staff approval given
- Customer acceptance recorded
- Signature confirmed (when contract type requires it)
- Any type-specific prerequisite (e.g., specific invoice paid)
- Unmet requirements visible on contract detail page

#### Cancellation rules
- **Staff-cancellation:** Authorized staff can cancel any contract with reason + refund decision (full/partial, wallet/external). Auditable.
- **Customer cancellation requests:** Customer submits reason + preferred refund destination. Staff must approve or reject with explanation. Approved → refund workflow. Rejected → unchanged + support path.
- **Terminal states:** Cancelled and Completed cannot be reopened. Corrections use audited administrative reversal.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.5.01.01 | Create `contracts` table: `id` (UUIDv7), `profileId`, `orderId?`, `serviceType` (enum), `state`, `currentVersionId`, `submittedAt`, `acceptedAt?`, `signedAt?`, `activatedAt?`, `completedAt?`, `cancelledAt?`, timestamps | L |
| T-04.5.01.02 | Create `contract_versions` table: `id`, `contractId`, `versionNumber`, `content` (JSONB — full snapshot), `changeDescription`, `createdBy`, `createdAt`, `acceptedAt?` | M |
| T-04.5.01.03 | Implement `ContractStateMachine` with all transitions, guards, prerequisites, audit events | L |
| T-04.5.01.04 | Activation prerequisite checker: evaluate all requirements, surface unmet ones | M |
| T-04.5.01.05 | Staff cancellation endpoint: requires reason + refund decision + step-up auth | M |
| T-04.5.01.06 | Customer cancellation request: creates staff review task, cannot cancel directly | M |
| T-04.5.01.07 | DB constraints: terminal states cannot transition; version must increment on material edit | M |

---

### S-04.5.02 — Contract versioning

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.5.02 | Every material contract edit creates a new immutable version; previous versions remain accessible | L | S-04.5.01 |

#### Requirements

- **Every material edit** → new `contract_versions` row. Previous version, creator, timestamp, change description remain available.
- **Customer-facing contract detail** shows current version; previous versions viewable.
- **After acceptance:** material edit requires renewed acceptance (+ new signature if applicable).
- **Amendment workflow:** a change after acceptance creates an amendment document as a new version with renewed acceptance cycle.
- **Document linking:** each version can reference uploaded documents (contract PDF, signed copy, amendments).

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.5.02.01 | Enforce version increment in `ContractService.updateContract()` — inserts new version, never edits existing | M |
| T-04.5.02.02 | API: GET contract versions list with metadata; GET specific version full content | M |
| T-04.5.02.03 | UI: version timeline showing who changed what and when; "View previous version" | M |
| T-04.5.02.04 | Support amendment workflow: create amendment version, new acceptance cycle, link to original | L |

---

### S-04.5.03 — Contract types & activation rules

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.5.03 | Per-service-type activation rules; some require signature, some skip it; payment ≠ contract approval | L | S-04.5.01 |

#### Rules by service type

- **Electricity supply:** Preliminary contract from order. Admin-configured template. Requires staff approval + customer acceptance + (optionally signature) + payment of the initial invoice.
- **Saving plan:** Agreement from order flow. Customer acceptance alone sufficient; staff can skip signature step.
- **Solar construction:** Manually created by staff after final approval. Uses document template. Customer acceptance + signature required.
- **Consultation:** No automatic contract; staff issues fee invoice directly.

**Core principle:** Payment status and contract status are separate. Invoice detail page shows both with their separate prerequisites.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.5.03.01 | Add `serviceType` to contracts table; per-type activation rule configuration in admin | M |
| T-04.5.03.02 | Build `ActivationRuleResolver` — given a contract, check which prerequisites are met, return unmet list | M |
| T-04.5.03.03 | UI: contract detail page shows each prerequisite (Staff approval, Customer acceptance, Signature, Payment, Service start) with current state | M |

---

### S-04.5.04 — Contract document linking

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.5.04 | Contracts link to documents (generated PDFs, signed uploads, amendments); document state machine integrates with contract workflow | L | S-04.5.01, E-05 (Documents) |

#### Document lifecycle for contracts
- Contract created → document generated from template → Uploading → Pending scan → Available → Submitted for review → Approved / Rejected
- Customer uploads signed version → same lifecycle
- Staff uploads signed copy received through approved channel → record identifying uploader
- Amendments → new document version linked to superseded document

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.5.04.01 | Create `contract_documents` link table: `contractVersionId`, `documentId`, `role` (original, signed, amendment, superseded) | S |
| T-04.5.04.02 | Document state machine for contract docs: Pending scan → Available → Submitted → Approved/Rejected | M |
| T-04.5.04.03 | Replacement rule: new document linked to superseded doc; rejection requires reason + Replace action | M |
| T-04.5.04.04 | Immutable signed docs: once Signed state reached, no replacement; new version for amendments | M |
| T-04.5.04.05 | UI: contract detail shows all linked docs with states and version history | M |

---

## E-04.6 — Electricity Contract Changes (Quantity & Price Adjustments)

### S-04.6.01 — Customer-requested quantity increase

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.6.01 | Customer submits one-time quantity-increase request; staff approves; new amendment + adjustment invoice | L | S-04.5.01, S-04.1.01 |

#### Requirements

- **One request per contract** — configurable max increase percentage (admin setting).
- **Applies only to eligible future periods** — never changes past or Paid/Cancelled/finalized invoice allocations.
- **Workflow:** Customer requests → Staff approves/rejects → Creates amendment document → Customer signs → Backend calculates incremental amount → Adjustment invoice created → Invoice must be paid before increase takes effect (unless staff approves different condition with reason).
- **Negative adjustment** (decrease) → refund/credit instead of negative invoice.
- **Audit:** old/new quantities, percentage, effective period, requester, reviewer, decision, signature, financial adjustment, timestamps. Notify customer at each step.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.6.01.01 | Build customer quantity increase request UI/API: validate against max increase percentage, check one-per-contract limit | M |
| T-04.6.01.02 | Staff review queue: approve/reject with reason | M |
| T-04.6.01.03 | On approval: create amendment document version, trigger customer signature workflow | M |
| T-04.6.01.04 | After signature: calculate incremental amount (price snapshot), create adjustment invoice or refund | L |
| T-04.6.01.05 | Enforce effective period: increase applies only to future periods | M |
| T-04.6.01.06 | Admin config for max increase percentage per service type | S |

---

### S-04.6.02 — Staff-initiated price adjustment

| ID | Story | Complexity | Dependencies |
|----|-------|------------|-------------|
| S-04.6.02 | Authorized staff apply percentage price increase to eligible future periods of an electricity contract | L | S-04.5.01, S-04.1.01 |

#### Requirements

- **Staff applies percentage price increase** from a specified effective date to eligible future portions of the contract.
- **Customer acceptance not required** BUT contractual basis, reason, calculation, old/new price, effective date must be visible before finalization.
- **Never rewrites past or paid invoice lines.**
- **Adjustment invoice:** backend creates linked adjustment invoice for net increase over affected future quantities.
- **Decrease** → refund/credit, not negative invoice.
- **No configurable percentage cap in v1** → explicit permission + step-up auth + auditing + customer notification are mandatory.
- **Non-payment** follows normal Overdue workflow; does not silently change historical service.

#### Tasks

| ID | Task | Complexity |
|----|------|------------|
| T-04.6.02.01 | Build staff price adjustment UI: input percentage, effective date, reason, contractual basis | M |
| T-04.6.02.02 | Validate: effective date not in past; never changes past/paid periods | M |
| T-04.6.02.03 | Calculate adjustment: for each future period affected, compute net increase, create adjustment invoice | L |
| T-04.6.02.04 | Step-up auth + audit: mandatory for this action | M |
| T-04.6.02.05 | Notify customer: full disclosure of old/new price, calculation, effective date before invoice is issued | M |
| T-04.6.02.06 | Decrease → refund/credit workflow (refund or wallet credit) | M |

---

## Cross-Cutting Concerns

### C-04.CC.01 — Idempotency framework

| Story | Complexity |
|-------|------------|
| Unified idempotency key mechanism across all money-moving and state-changing commands | L |

**Applies to:** invoice creation, wallet top-up callback, wallet debit, invoice payment, bank receipt confirmation, refund processing.

**Implementation:**
- `idempotency_keys` table: `key` (unique), `entityType`, `entityId`, `response` (JSONB — cached result), `expiresAt`, timestamps.
- On retry with same key: return cached response if original succeeded; reject if in-flight.
- TTL-based cleanup for stale keys (configurable, e.g. 24h).

### C-04.CC.02 — Dual-approval system

| Story | Complexity |
|-------|------------|
| Configurable IRR threshold; actions at or above require second authorized staff approval | L |

**Applies to:** Refunds, manual financial adjustments, bank-payment confirmations, contract cancellation with financial impact.

**Implementation:**
- Admin configures threshold (`dualApprovalThresholdIr` in admin settings).
- First staff initiates action → enters `Pending approval` state.
- Second staff (different user) reviews and approves/rejects.
- Emergency override: requires reason, elevated permission, immediate alert, audit trail.

### C-04.CC.03 — Staff permissions matrix

| Story | Complexity |
|-------|------------|
| Finance, Legal/Contracts, and Admin role permissions for all invoice, wallet, refund, and contract operations | M |

**Staff roles (from README):**
- **Finance:** Invoices, bank receipts, offline payments, wallet top-ups, refunds, financial reporting.
- **Legal & Contracts:** Contract preparation, review, versioning, approval, signature workflows.
- **Admin:** All of the above + role assignment, price/limit/template configuration, security-sensitive credentials.
- **Operations:** Service orders, fulfillment — read-only on financial data.

**Agent permissions (legal entity roles):**
- **Finance agent:** View invoices, wallet, payments, receipts, refunds; charge wallet, submit bank receipts. Cannot accept/sign contracts unless also Legal or Manager.
- **Legal agent:** View, accept, sign, reject, request contract changes. Cannot move wallet funds unless also Finance or Manager.

### C-04.CC.04 — Audit & compliance

| Story | Complexity |
|-------|------------|
| Every state transition, financial mutation, and permission-sensitive action records immutable audit trail | L |

**Fields per audit entry:** `entityType`, `entityId`, `previousState`, `newState`, `actorId`, `actorType` (customer/staff/system), `timestamp`, `reason`, `correlationId`, `metadata` (JSONB).

**Applies to:** All invoice, wallet, refund, contract transitions; bank receipt confirmation/rejection; price adjustments; quantity increases; cancellations; dual-approval actions.

### C-04.CC.05 — Concurrency & locking

| Story | Complexity |
|-------|------------|
| Prevent race conditions on wallet balance, invoice state, contract state, and refund amounts | L |

**Strategy:**
- `SELECT ... FOR UPDATE` within transactions for wallet + invoice + contract state changes.
- Optimistic version column (`version` integer) on wallets as second line of defense.
- Unique constraints on idempotency keys as ultimate safeguard against duplicates.
- Application-level reject-retry for version conflicts (HTTP 409).

### C-04.CC.06 — Reconciliation

| Story | Complexity |
|-------|------------|
| Scheduled reconciliation for wallet ledger vs cached balance, invoices, refunds, and provider transactions | L |

**Checks:**
- Wallet: `SUM(completed_transactions.amount) = wallets.postedBalance`
- Invoice: `SUM(confirmed_receipts + wallet_payments) = invoices.paidAmount`
- Refund: `SUM(completed_refunds) <= invoices.paidAmount - invoices.refundedAmount`
- Open exceptions: unmatched provider callbacks, chargebacks, expired pending top-ups

**Reporting:** Mismatches logged to finance exception queue with severity. Staff can investigate and resolve.

---

## Dependency Graph

```
E-01 (Platform & Infrastructure)
  └─ E-02 (Auth, Users, CRM, Admin)
       ├─ E-03 (Core Business — Products, Orders)
       │    └─ E-04 (Invoices, Wallet, Payments & Contracts)
       │         ├─ S-04.1.01  → S-04.1.02  → S-04.1.05
       │         ├─ S-04.1.01  → S-04.1.03  → S-04.1.04
       │         ├─ S-04.2.01  → S-04.2.02  → S-04.2.03  → S-04.2.04
       │         ├─ S-04.1.01 + S-04.2.01 → S-04.3.01  → S-04.3.02
       │         ├─ S-04.1.01 + S-04.2.01 → S-04.4.01  → S-04.4.02
       │         └─ S-04.5.01  → S-04.5.02  → S-04.5.03  → S-04.5.04
       │                            └─ E-04.6 (depends on S-04.5.01)
       └─ E-05 (Notifications, Documents, AI)
            └─ Uses outbox events from E-04 (reminders, contract workflow notifications, refund notifications)
```

---

## Complexity summary

| Story | Complexity | Estimated effort |
|-------|------------|-----------------|
| S-04.1.01 — Invoice state machine | XL | 3-4 weeks |
| S-04.1.02 — Invoice generation (manual & auto) | L | 2-3 weeks |
| S-04.1.03 — Due dates & staff override | M | 1-2 weeks |
| S-04.1.04 — Payment reminders | L | 2-3 weeks |
| S-04.1.05 — Invoice corrections | L | 2 weeks |
| S-04.2.01 — Wallet ledger & balances | XL | 3-4 weeks |
| S-04.2.02 — Wallet top-ups | L | 2-3 weeks |
| S-04.2.03 — Atomic wallet-to-invoice payment | XL | 3-4 weeks |
| S-04.2.04 — Chargeback/reversal handling | M | 1-2 weeks |
| S-04.3.01 — Bank receipts & confirmation | L | 2-3 weeks |
| S-04.3.02 — Invoice & wallet history UI | L | 2 weeks |
| S-04.4.01 — Refund state machine | XL | 3-4 weeks |
| S-04.4.02 — Automatic wallet return | L | 2-3 weeks |
| S-04.5.01 — Contract state machine | XL | 3-4 weeks |
| S-04.5.02 — Contract versioning | L | 2 weeks |
| S-04.5.03 — Contract types & activation rules | L | 2 weeks |
| S-04.5.04 — Contract document linking | L | 2-3 weeks |
| S-04.6.01 — Quantity increase | L | 2-3 weeks |
| S-04.6.02 — Staff price adjustment | L | 2-3 weeks |
| C-04.CC.01 — Idempotency framework | L | 2 weeks |
| C-04.CC.02 — Dual-approval system | L | 2 weeks |
| C-04.CC.03 — Staff permissions matrix | M | 1 week |
| C-04.CC.04 — Audit & compliance | L | 2 weeks |
| C-04.CC.05 — Concurrency & locking | L | 2 weeks |
| C-04.CC.06 — Reconciliation | L | 2-3 weeks |

**Estimated total:** ~48-64 weeks of developer effort across all stories. Recommend prioritizing in phases:

1. **Phase 1 (Foundation):** S-04.1.01, S-04.2.01, S-04.5.01, C-04.CC.01, C-04.CC.03, C-04.CC.04, C-04.CC.05
2. **Phase 2 (Core flows):** S-04.1.02, S-04.2.02, S-04.2.03, S-04.3.01, S-04.5.02, S-04.5.03
3. **Phase 3 (Advanced):** S-04.1.03, S-04.1.04, S-04.1.05, S-04.4.01, S-04.5.04, C-04.CC.02, C-04.CC.06
4. **Phase 4 (Changes):** S-04.6.01, S-04.6.02, S-04.2.04, S-04.4.02, S-04.3.02

---

## Gap Remediation

The following gaps were identified during the cross-audit of this epic against `README.md` (1260 lines) and `architecture.md` (177 lines).

### G-04.01 — Pre-action review page: authoritative backend snapshot + shared component
- **Source:** README.md §Customer transparency (lines 177–178)
- **Gap:** While order-type review pages are described individually, there is no shared review-page component pattern, no utility for backend-authoritative snapshot generation, and no cross-cutting task ensuring EVERY irreversible/financial action follows the same review pattern (profile, service, quantities, dates, unit prices, discounts, VAT, total, payment source, contract implications, refund rules).
- **Suggested Task:** Add cross-cutting story `C-04.CC.07`: Create `<FinancialReviewCard>` component and server-side `ReviewSnapshotService` that generates an authoritative JSON snapshot. Add a PR checklist item: any new financial/irreversible action must include a review step using the shared pattern.

### G-04.02 — Invoice calculation reproducibility: half-up rounding specification
- **Source:** README.md §Customer transparency (line 181)
- **Gap:** T-04.1.02.04 covers VAT calculation but does not explicitly specify the half-up rounding rule (round half-up to nearest IRR) or the reproducibility requirement (invoice stores inputs, rounding results, and totals).
- **Suggested Task:** Add task to S-04.1.02: implement `RoundingService.roundHalfUp(value: bigint, precision: number)` that uses banker's rounding or half-up as specified. Add an `invoice_calculation_snapshot` JSONB column on invoices that stores all calculation inputs, intermediate rounding steps, and final totals for reproducibility. Add table-driven unit tests with financial examples from the product requirements.

### G-04.03 — Wallet availableBalance as derived value (not stored)
- **Source:** README.md §Wallet (line 1104)
- **Gap:** T-04.2.01.01 creates `postedBalance` and `reservedBalance` columns, but the task does not explicitly state that `availableBalance` is a DERIVED value (`postedBalance - reservedBalance`) computed at query time, not a stored column. There is no DB constraint preventing negative available balance.
- **Suggested Task:** Add task: ensure `availableBalance` is computed in application code (not stored). Add DB-level CHECK constraint or generated column that ensures `(postedBalance - reservedBalance) >= 0`. Add integration test that verifies the constraint prevents over-draft.