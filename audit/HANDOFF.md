# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements and evidence. Use feature batches; preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **ff75281**. Last consolidated batch **R01-wallet-ledger** remains complete at48ac9d7:8 new task acceptances plus preserved balance card;14 PR reviews closed. Preserve unchanged money/concurrency and dashboard evidence.

Active **R01-bank-receipts-approval**:16 saved PRs195,196,266–268,278–279,286–287,296–302;10 mapped tasks. Exact keys, criteria, deferrals and checks are in progress.json.active_batch. No receipt task/PR closure yet.

Five repairs verified locally:

- **0d75b64**: customer receipt session/owner/Finance authority through commit, atomic empty-wallet creation and submission audit.222 distinct affected API cases.
- **397d8fd**: generic approval creation/resolution retains current account, role, session and step-up.64 distinct affected API cases.
- **d646396**: wallet/invoice confirmation and rejection retain session/step-up through every commit, including replay and approval parking.202 distinct affected API cases.
- **18ee061**: threshold session authority, first-write previous-value/version audit, and policy held through decisions.215 distinct affected API cases. Policy locks precede staff/session locks; earlier order deadlocked receipt notification recipient FKs and was corrected.
- **ff75281**: wallet bytes sealed using extracted invoice policy; both flows journal interrupted copies for cleanup and keep matching retries.90 distinct affected API cases, including real production-worker cleanup. A cleaned failed copy requires a new upload; retries cannot recreate an untracked object.

Counts overlap across repairs. Relevant API types/lint/format/build/OpenAPI pass.1529 logs indexed, including failures. No new browser/budget/broad/coverage claim. Fixtures and extraction/type errors are documented with retained logs in progress.json. Receipt API fixtures rebuild worker; the cleanup integration imports its built output to respect TypeScript project boundaries.

WalletService getWallet/createWallet now accept an optional transaction client. Default behavior is unchanged; customer receipt regression includes wallet unit/controller checks. Refresh narrow wallet/card bindings when consolidating; do not rerun or claim renewal of all648 historical finance cases. Historical receipt bytes modified before the sealing repair cannot be reconstructed locally.

## Next action

Review current customer/staff receipt UI, queue and shared approval criteria. T-09.07.01 emergency override remains unimplemented: reason, elevated permission, immediate alert and audit are required. Current dual-approver permission checks read the other approver without retained locks; examine the actual settlement race before deciding a fix. Wallet approval helper still creates unrelated correlation IDs and omits session metadata; review against required audit/notification binding.

Compare repeated confirmation/overpayment PRs once and close individual tasks/PRs with one batch review. PR298 may incidentally cover T-04.3.01.06 notification; inspect before declaring it unbuilt. Provider callbacks/expiry remain a following batch. Preserve stored requirements, earlier checks and user decisions.

## Counts and preserved work

**88 verified /20 partial /214 pending =322 claims.234 unresolved task reviews are not coding effort.** Saved PR reviews: **42 closed /8 open /251 not reviewed** of301. Mapping counts205 unresolved/92 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. GitHub inventory still ends September3.12 older evidence refreshes remain separately queued.

Preserve registration/OTP, agents/invitations/ownership, session/recovery, profiles/onboarding, account-settings, addresses/current commercial-order and CRM closures. Address PR115/116 remain open for savings/solar product dependencies in V01/B01. Current address/order batch1c06613 has110 distinct API,24 Chromium and2 production migration cases; no rerun needed for worker-only changes. Pre-login CSRFf1b879b and shared CSRF race71f5e49 are completed. Do not rebuild them.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification remains unavailable and manual verification is supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB is separate. Lost-contact policy remains pending; do not ask again.

Migrations0123/0124 must precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not overlap consumer typechecks with shared/API builds or browser setup. Build web before browser fixtures. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Broad V02, coverage and image evidence remain revision-bound. Keep work active while meaningful tasks remain.
