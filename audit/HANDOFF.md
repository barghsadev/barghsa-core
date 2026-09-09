# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **cb7ac5b**. Wallet invoice payment/reversal batch completed locally: **5 tasks verified /13 saved PR reviews closed**, PRs271–275,282–285,290–293. The missing customer API and confirmation UI are implemented. Current owner/session/CSRF/step-up authority lasts through commit; confirmed amount, safe retries, atomic debit/Paid/audit/cache and compensating reversal history are verified. Repeated implementations contain useful fixes; no duplicate service needs deletion.

68 baseline payment/cache cases pass. After API integration,56 overlapping existing cases and9 new HTTP cases pass.5 new production Chromium cases,4 unchanged deadline cases and9 invoice-page cases pass. Reversal evidence is unchanged since ab17007 and reused. API/web types, lint, builds, OpenAPI and42 budgets pass. Electricity ordering is247.94KB/250KB after shortening hashed asset filenames; cache checks pass.25 prior current source bindings refreshed.2030 logs indexed, including failures. [Batch review](evidence/step-reviews.json#R01-wallet-invoice-payments-reversals).

Counts: **127 verified /27 partial /168 pending =322 claims**.195 unresolved task reviews are not an effort estimate. Saved PR reviews: **104 closed /18 open /179 unreviewed** of301.58 skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed.10 retained evidence-refresh records remain. Full regression and coverage remain V02.

## Next action

Active **R01-tickets**, saved PRs138,139,140; `02-auth-users-admin.md#T-06.01.01` through `.03`. Read exact requirements and saved PR bodies, then review current customer/staff authority, privacy, attachments, assignment and transitions. Reuse existing repairs and tests. Fix confirmed gaps, review each meaningful change, then consolidate once. No new ticket acceptance is claimed yet.

## Preserve these boundaries

Prior auth/profile/settings/address/CRM, wallet, receipt, online, chargeback and invoice batches are consolidated. Adjustment approval at8a9ea42 remains verified. Do not rebuild completed work. Refund and concrete order/contract submission workflows retain their prerequisites. PR225's auto-invoice service has no actual submission caller; current DRAFT orders must not be charged. PR227 retains contract/consultation target tables and foreign keys in V01/B01. T-04.3.01.06 overpayment credit is already implemented and reviewed; preserve it during B01.

R02 retains actual notification delivery, current queued-reminder policy, expiry/receipt notifications and the missing auth.refresh_token_reused seed. PR243/245 and281/299/301 remain open. R03 retains shared contrast/localization and structured online-limit snapshots. Legacy invoice/reversal CHECK reconciliation and validation remain V01. No operational execution is claimed.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook wording and lost-contact owner policy remain pending. Do not ask again or change requirements.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider; automatic verification unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB is initial load; estimator900KB separately. Numeric budgets and coverage floors unchanged.

Use rtk and codebase-memory. Keep output small. Save ended logs and inspect failures. Do not edit source/tests while their checks run or overlap shared/API builds with consumer typechecks/browser setup. Build web before browser checks. Read every process exit before dependent edits or commits; a running/failed check is not a pass.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124 precede API rollout. Continue authorized work; the full plan is unfinished.
