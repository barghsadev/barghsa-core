# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements and evidence. Use feature batches; preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **3b67bbc**. Last consolidated batch **R01-wallet-ledger** remains complete at48ac9d7:8 new task acceptances plus preserved balance card;14 PR reviews closed. Preserve unchanged money/concurrency and dashboard evidence.

Active **R01-bank-receipts-approval**:16 saved PRs195,196,266–268,278–279,286–287,296–302;10 mapped tasks. Exact keys, criteria, deferrals and checks are in progress.json.active_batch. No receipt task/PR closure yet.

Eleven repairs verified locally:

- **0d75b64**: customer receipt session/owner/Finance authority through commit, atomic empty-wallet creation and submission audit.222 distinct affected API cases.
- **397d8fd**: generic approval creation/resolution retains current account, role, session and step-up.64 distinct affected API cases.
- **d646396**: wallet/invoice confirmation and rejection retain session/step-up through every commit, including replay and approval parking.202 distinct affected API cases.
- **18ee061**: threshold session authority, first-write previous-value/version audit, and policy held through decisions.215 distinct affected API cases. Policy locks precede staff/session locks; earlier order deadlocked receipt notification recipient FKs and was corrected.
- **ff75281**: wallet bytes sealed using extracted invoice policy; both flows journal interrupted copies for cleanup and keep matching retries.90 distinct affected API cases, including real production-worker cleanup. A cleaned failed copy requires a new upload; retries cannot recreate an untracked object.

- **f7efbb9**: wallet confirm/reject step-up retries retain their original receipt; queue selection is disabled during actions.15 web unit cases.
- **c9567b9**: both approvers retain account/role authority until settlement. Conflicting authority locks return retryable409.143 affected API cases.
- **6ed1703**: receipt approval audits retain current session and request correlation; no session IDs in exposed approval details.122 affected API cases.
- **341246f**: required emergency override for one already-pending receipt, separate permission, fresh step-up, reason, atomic audit/settlement and immediate private in-app finance alerts.168 distinct affected API cases including explicit grants, expiry, evidence/rejection, rollback and busy-recipient retries.
- **1bb1556**: permitted emergency wallet UI captures target/reason through step-up, restores focus and supports fa/en.17 web unit cases and9 production Chromium checks, including two new axe/focus cases, pass.

- **3b67bbc**: missing threshold screen added to the approval queue, strict localized amounts, captured password-verified save, zero/failure/permission states. Corrupt persisted reads return503 instead of a false disabled default.14 API and9 distinct Chromium cases pass, including four new threshold cases and the five refreshed approval queue cases. Both locale threshold cases pass axe. Types/lint/web build pass.

Counts overlap across repairs. Relevant API types/lint/format/build/OpenAPI pass.1569 logs indexed, including failures. Receipt/emergency and threshold browser evidence is saved separately; their five shared queue cases overlap. No new budget/broad/coverage claim. Fixtures and extraction/type errors are documented with retained logs in progress.json. Receipt API fixtures rebuild worker; the cleanup integration imports its built output to respect TypeScript project boundaries.

WalletService getWallet/createWallet now accept an optional transaction client. Default behavior is unchanged; customer receipt regression includes wallet unit/controller checks. Refresh narrow wallet/card bindings when consolidating; do not rerun or claim renewal of all648 historical finance cases. Historical receipt bytes modified before the sealing repair cannot be reconstructed locally.

## Next action

Finish bounded receipt acceptance: customer upload UI/evidence and remaining repeated PR product diffs, incidental T-04.3.01.06 coverage, narrow wallet/card source refresh, then one consolidated task/PR batch closure. Threshold UI and corrupt-read handling are now complete; do not rebuild them.

No receipt task/PR closure yet. No required fix is knowingly left in the four newly reviewed paths. Remaining acceptance and historical PR dispositions still need consolidation. T-04.3.01.06 is **overpayment wallet credit**, not a notification task; correct that earlier shorthand when reviewing PR298. Notification delivery remains R02 where required.

Emergency override does not change the global threshold. It must settle the receipt in the same transaction as its exception; no reusable override grant remains. Standard self-approval stays forbidden. API reason limit is the shared2000-character limit. The control is shown only after the detail API reports the current separate permission; API transactions always recheck authority.

Initial test/type failures are preserved and explained in progress.json. Avoid rebuilding these completed fixes. Continue feature-batch reconciliation and retain valid prior evidence.

## Counts and preserved work

**88 verified /20 partial /214 pending =322 claims.234 unresolved task reviews are not coding effort.** Saved PR reviews: **42 closed /8 open /251 not reviewed** of301. Mapping counts205 unresolved/92 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. GitHub inventory still ends September3.12 older evidence refreshes remain separately queued.

Preserve registration/OTP, agents/invitations/ownership, session/recovery, profiles/onboarding, account-settings, addresses/current commercial-order and CRM closures. Address PR115/116 remain open for savings/solar product dependencies in V01/B01. Current address/order batch1c06613 has110 distinct API,24 Chromium and2 production migration cases; no rerun needed for worker-only changes. Pre-login CSRFf1b879b and shared CSRF race71f5e49 are completed. Do not rebuild them.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification remains unavailable and manual verification is supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB is separate. Lost-contact policy remains pending; do not ask again.

Migrations0123/0124 must precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not overlap consumer typechecks with shared/API builds or browser setup. Build web before browser fixtures. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Broad V02, coverage and image evidence remain revision-bound. Keep work active while meaningful tasks remain.
