# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements/evidence. Use feature batches. Preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **0e370f7**. Invoice creation/calculation consolidated: **7 tasks verified, including4 preserved earlier acceptances /2 partial;8 PR reviews closed /2 open**. Three repairs: linked VAT validity, guarded manual creation/profile-search API, localized staff form with exact preview and safe retries. [Consolidated review](evidence/step-reviews.json#R01-invoice-creation-calculation).

122 calculation/service and36 DB cases pass. Reuse39 VAT/auto/replay and12 HTTP plus29 manual/replay cases without adding overlaps. Four distinct production Chromium cases cover FA/EN, light/dark, accessibility, step-up and same-key retries after503/malformed results. API/web quality checks, UI distribution5 and42 unchanged budgets pass. Initial dropdown attempts exceeded the electricity gate; native selector resolves the shared-chunk overhead. Electricity249.98KB/250KB; registration149.79KB/150KB; estimator837.80KB/900KB. Failed logs retained.

PR225 remains open: no concrete auto-invoice submission caller; OrdersService saves DRAFTs, which must not be charged. PR227 remains open: contract/consultation target tables/FKs missing. V01/B01 owns these prerequisites. Existing services and snapshots are retained. VAT evidence refreshed; snapshot refresh now retains only correction-consumer paths.

Manual form follow-up03bcf45 fixes canonical nested error.code handling. Corrected browser fixture fails before the fix;4 browser cases and real HTTP envelope assertion now pass, with42 budgets and quality checks. Earlier string-only fixture had missed this gap.

## Next action

Active **R01-invoice-deadlines-reminders**:10 saved PRs236–241,243–246; tasks `04-invoices-wallet-contracts.md#T-04.1.03.01` through `.04` and `T-04.1.04.01` through `.06`. Exact story/task requirements and all10 full PR descriptions read. First repair0e370f7 binds deadline reads/mutations to current session authority through commit;21 distinct API cases and quality checks pass. Existing reminder rows still use the old deadline after override, and staff override UI lacks step-up/response validation. Continue those repairs; batch remains open. Inspect defaults, permission/reason override, customer-visible reason, issue scheduling, offset/timezone/preferences, outbox, idempotency and terminal-state cancellation. Reuse21 overdue worker and state/creation/receipt checks. Actual delivery remains linked to R02. Review each confirmed repair, then consolidate once.

## Counts and preserved work

**110 verified /25 partial /187 pending =322 claims.212 unresolved reviews are not a coding-effort estimate.** Saved PR reviews: **79 closed /16 open /206 not reviewed** of301.58 historical skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed.11 older evidence refreshes remain separately queued.1814 logs indexed.

Preserve earlier auth/profile/settings/address/CRM, wallet, receipt, online and chargeback batches. Chargebacks have1 verified/1 partial and2 closed/2 open PR reviews. Signed-webhook CSRF wording already asked and pending; do not ask again or change the requirement. Browser payment GET is read-only and explicit confirmation requires session CSRF. Pre-login CSRFf1b879b and shared race71f5e49 complete.

Chargeback seed check12 pass/1 pre-existing failure: auth.refresh_token_reused lacks a seeded template. R02 retains this confirmed gap and actual customer/email delivery, including PR281/299/301. Do not claim seed-suite success, external delivery or PSP/deployment evidence. Incidental T-04.3.01.06 overpayment credit is already implemented/reviewed; retain for B01. PR115/116 savings/solar prerequisites remain V01/B01. Wallet reverseTransaction and other unchanged methods retain their recorded evidence; do not repeat the full finance suite. R03 localization must preserve the structured online limit snapshot.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB separate. Lost-contact policy pending; do not ask again.

Migrations0123/0124 precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not edit source/tests while their tests run. Do not overlap consumer types with shared/API builds or browser setup. Build web before production-preview tests. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Keep working while meaningful tasks remain.
