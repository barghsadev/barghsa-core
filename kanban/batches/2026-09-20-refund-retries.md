# Durable refund retries

Branch: `codex/refund-retry-batch`, based on merged PR #312 at `4eea6d198341581d1b3f8af2e7a9b9ddaf5ca5fb`.

## Scope and current state

Continue `04-invoices-wallet-contracts.md#T-04.4.01.07` and the remaining `.02` lifecycle criteria. This batch is in progress, not accepted or merged.

The first implementation step moves wallet credit posting into the server-only `@barghsa/db/wallet-credit` entry point. The API still owns its existing transaction, profile lock and HTTP error mapping. The shared helper preserves ledger identity, exact bigint amounts, profile/wallet matching, archived-profile restrictions, row locking, optimistic balance updates and caller-owned commit/rollback. It does not start a background worker by itself.

API unit mocks now return the canonical profile ID for profile-based lookups, matching PostgreSQL behavior. New real-database cases prove worker-style posting followed by an API replay returns one credit, including an amount above JavaScript safe integer precision, and that caller rollback removes both ledger and balance changes.

## Validation for the first implementation step

- API and worker dependency builds pass.
- API typecheck and changed-file ESLint pass.
- Wallet service, real PostgreSQL credit and refund suites: 167 tests pass.
- Full pinned Semgrep scan passes with zero findings and scanner errors.

## Remaining implementation

The API currently rolls a failed wallet process back to Approved, so a durable failure producer is required along with worker scheduling. Add per-refund due times, bounded attempt counts and exhausted-retry alerts; the existing generic worker job recorder does not enforce its display-only next-run time. Reuse shared credit posting in the actual registered worker. Keep profile, threshold/current financial authority, invoice, refund and wallet locks in consistent order. Test concurrent workers/staff, crashes and retries, changed approval/policy/profile state, due-time enforcement, exhaustion, and atomic invoice/audit/notice completion.

Pending approval-time ledger entries remain a `.02` criterion. External bank transfers must retain distinct current finance reconciliation against immutable recorded evidence; the worker must never invent or replay a bank transfer. Automatic contract obligations remain separately dependent on contract work.

Run the relevant final validation, obtain independent exact-HEAD review and require all active CI checks before publishing completion or merging. No supervisor state or historical completion arrays are changed.
