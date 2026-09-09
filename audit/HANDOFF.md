# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements/evidence. Use feature batches. Preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **1b1d7d1**. Last consolidated invoice-state batch **R01-invoice-state-transitions** consolidated: **6 tasks verified /6 PR reviews closed**. Two repairs: stored amounts under row lock authorize payment/refund states; direct PartiallyFunded cancellation is rejected. [Consolidated review](evidence/step-reviews.json#R01-invoice-state-transitions).

113 current API cases pass, including state/model/audit/concurrency and cancel/replace integration.35 DB cases cover schema/constraints and legacy backfill;21 worker cases cover overdue state/audit writes. Earlier120-case caller/audit checks remain valid for unchanged settlement paths and overlap the current API count. API types/lint/format pass. Production migrations0080/0081 were reviewed; API fixtures apply the complete production journal. No product migration, HTTP shape or browser changes in this batch.

PR150 optional contractId column is verified. Its future foreign key is explicitly retained under the separate origin-link/contracts requirement, not claimed implemented. Creation, refund, notification, reminder and correction consumer acceptance remain separate batches.

## Next action

Active **R01-invoice-creation-calculation**:10 saved PRs223,224,225,226,227,228,229,231,232,233; qualified keys `04-invoices-wallet-contracts.md#T-04.1.02.01` through `.09`. Exact requirements and all10 full PR descriptions read. Two repairs built/reviewed: f5b743b fixes linked VAT rate validity windows with39 API cases;1b1d7d1 exposes guarded manual invoice creation and profile search with12 HTTP cases plus29 unchanged service/replay cases. API types/lint/format/build/OpenAPI pass. Tests had fixture/type failures before the recorded fixes; logs retain them.

Next build the staff manual-invoice form and verify its browser flow. Then finish the remaining review. Existing OrdersService creates DRAFTs, so do not charge draft creation; concrete submission workflows remain product prerequisites. Contract/consultation target tables/FKs still missing. Creation batch remains open; counts below unchanged. Review line/item constraints, manual/automatic creation authority and transaction boundaries, VAT/rounding, origin links/idempotency and snapshot replay. Reuse state/receipt/ledger evidence. Keep dates/reminders and corrections separate. Review each confirmed repair, then save one consolidated batch review.

## Counts and preserved work

**107 verified /23 partial /192 pending =322 claims.215 unresolved reviews are not a coding-effort estimate.** Saved PR reviews: **71 closed /14 open /216 not reviewed** of301.58 historical skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed.12 older evidence refreshes remain separately queued.1757 logs indexed.

Preserve earlier auth/profile/settings/address/CRM, wallet, receipt, online and chargeback batches. Chargebacks have1 verified/1 partial and2 closed/2 open PR reviews. Signed-webhook CSRF wording already asked and pending; do not ask again or change the requirement. Browser payment GET is read-only and explicit confirmation requires session CSRF. Pre-login CSRFf1b879b and shared race71f5e49 complete.

Chargeback seed check12 pass/1 pre-existing failure: auth.refresh_token_reused lacks a seeded template. R02 retains this confirmed gap and actual customer/email delivery, including PR281/299/301. Do not claim seed-suite success, external delivery or PSP/deployment evidence. Incidental T-04.3.01.06 overpayment credit is already implemented/reviewed; retain for B01. PR115/116 savings/solar prerequisites remain V01/B01. Wallet reverseTransaction and other unchanged methods retain their recorded evidence; do not repeat the full finance suite. R03 localization must preserve the structured online limit snapshot.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB separate. Lost-contact policy pending; do not ask again.

Migrations0123/0124 precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not edit source/tests while their tests run. Do not overlap consumer types with shared/API builds or browser setup. Build web before production-preview tests. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Keep working while meaningful tasks remain.
