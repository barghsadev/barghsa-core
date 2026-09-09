# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then selected requirements/evidence. Use feature batches. Preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **ab17007**. Chargeback batch **R01-chargebacks-alerts** consolidated: **1 task verified /1 partial;2 PR reviews closed /2 open**. Four repairs: match only online credits; deliver private account alerts to authorized Finance staff without a customer profile; retain unresolved warnings across failed/malformed refreshes and serialize polls; alert successful reversals with distinct fa/en notices. Full review is in [step-reviews.json](evidence/step-reviews.json#R01-chargebacks-alerts).

Current chargeback evidence:63 distinct API cases after correcting one old no-alert assertion;17 shared alert/registry/inbox cases;12 matching-helper cases reused.3 dashboard unit and8 distinct production Chromium cases cover chargeback/CRM, fa/en, light/dark and accessibility.42 unchanged route/interaction limits pass after final shared additions. API/shared/DB types, lint/format and builds pass. No new HTTP response shape; earlier fresh OpenAPI evidence is reused. Counts overlap across repairs; do not add them.

Seed check:12 pass/1 pre-existing failure. `auth.refresh_token_reused` has no seeded template before or after this batch. This confirmed R02 gap is recorded; no seed-suite pass is claimed. New reversed-chargeback template variables/locales/channels are valid and prior templates unchanged. Actual in-app delivery and real HTTP permission/revocation are proved. External email, PSP and deployment are not claimed.

PR276/294 and task T-04.2.04.02 retain the already-asked signed-webhook CSRF requirements decision. Do not ask again or silently change the requirement. PR277/295 and task T-04.2.04.03 are verified locally. Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment GET is read-only; explicit confirmation requires session CSRF.

## Next action

Active **R01-invoice-state-transitions**:6 saved PRs150,151,152,220,221,222; qualified keys `04-invoices-wallet-contracts.md#T-04.1.01.01` through `.06`. Membership is bounded; read exact requirements and six full descriptions, then trace state guards, amount constraints, audit transaction boundaries and caller authority. Reuse receipt/ledger evidence where valid. Creation/VAT/snapshots, due dates/reminders and corrections remain separate batches. Review each confirmed repair, then record one consolidated batch review.

## Counts and preserved work

**101 verified /23 partial /198 pending =322 claims.221 unresolved reviews are not a coding-effort estimate.** Saved PR reviews: **65 closed /14 open /222 not reviewed** of301.58 historical skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed.12 older evidence refreshes remain separately queued.1714 logs indexed. One previously current CRM dashboard binding was refreshed after its focused checks; older stale shared bindings were preserved.

Preserve earlier auth/profile/settings/address/CRM, wallet, receipt and online batches. Online payments have3 verified/1 partial and7 closed/2 open PR reviews. PR265 retains signed-webhook wording; PR281 actual expiry customer notice delivery is R02. Receipt batch has9 verified/1 partial and14 closed/2 open PRs; actual customer delivery keeps PR299/301 open in R02. Incidental T-04.3.01.06 overpayment credit is already implemented/reviewed; retain for B01. PR115/116 savings/solar prerequisites remain V01/B01.

Wallet reversal evidence remains valid: every WalletService method except getWallet/createWallet matches48ac9d7; their only changes accept an optional existing query client. Do not repeat the full finance suite. Raw English over-limit API explanations still drive the current UI classifier; R03 localization must use the existing structured limit snapshot.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB separate. Lost-contact policy pending; do not ask again.

Migrations0123/0124 precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not edit source/tests while their tests run. Do not overlap consumer types with shared/API builds or browser setup. Build web before production-preview tests. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Keep working while meaningful tasks remain.
