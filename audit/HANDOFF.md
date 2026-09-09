# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **948a216**. Current ticket batch remains open. Prior wallet invoice payment/reversal batch completed locally atcb7ac5b: **5 tasks verified /13 saved PR reviews closed**, PRs271–275,282–285,290–293. Current owner/session/CSRF/step-up authority lasts through commit; confirmed amount, safe retries, atomic debit/Paid/audit/cache and compensating reversal history are verified. Repeated implementations contain useful fixes; no duplicate service needs deletion.

68 baseline payment/cache cases pass. After API integration,56 overlapping existing cases and9 new HTTP cases pass.5 new production Chromium cases,4 unchanged deadline cases and9 invoice-page cases pass. Reversal evidence is unchanged since ab17007 and reused. API/web types, lint, builds, OpenAPI and42 budgets pass. Electricity ordering is247.94KB/250KB after shortening hashed asset filenames; cache checks pass.25 prior current source bindings refreshed.2030 logs indexed, including failures. [Batch review](evidence/step-reviews.json#R01-wallet-invoice-payments-reversals).

Counts: **127 verified /27 partial /168 pending =322 claims**.195 unresolved task reviews are not an effort estimate. Saved PR reviews: **104 closed /18 open /179 unreviewed** of301.58 skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed.10 retained evidence-refresh records remain. Full regression and coverage remain V02.

## Next action

Active **R01-tickets**, saved PRs138,139,140; `02-auth-users-admin.md#T-06.01.01` through `.03`. Exact requirements, all three PR bodies and the full Tickets component are read. Do not repeat those reads. Writes verified at5b637a8; reads atfa60a45 now bind current account, role, assignment scope and session authority through response assembly. Creation options recheck profile ownership. Attachments use the existing verified fixed-byte sealing and private-download implementation; current HTTP evidence covers it.

UI repair368c080 hides edit controls for tickets outside assigned-only write scope, even when staff can read the full queue. Ticket fields, notes, cards and lists use theme colors; primary-button hover remains readable. **10 production Chromium cases pass**, including Persian/English light/dark axe checks. Web build/types/lint/format and **42 unchanged budgets** pass.

Assignment repair948a216 moves automatic ticket assignment before actor locking and includes the actor with candidate accounts in stable order, after teams. The reproduced concurrent staff creation/manual-assignment500 now passes. **70 cases pass:41 ticket HTTP,22 service,7 assignment HTTP**. These overlap earlier runs, so do not add counts. API types/lint/format/OpenAPI pass; HTTP setup rebuilt API.34 additional ended logs, including failed baselines and intermediate checks, are archived. **2078 logs indexed.** No ticket task or PR is closed yet.

Next: verify the remaining shared assignment risk before UI work. `VerificationCaseService.createCase`, the other `choose` caller, still locks its actor before teams. Prove or dismiss a cross-workflow deadlock with a focused regression before changing it; current assignee-role authority also needs final review. Then address missing category/type selector, list related-record links and staff customer-information panel. Category taxonomy is unspecified; existing related type/record selection is not a separate category. Verify routes before adding links. Invoice customer detail exists; staff invoice currently links to the queue. Contract linking deliberately returns409 pending the unbuilt table/workflow inV01/B01. Consolidate PR138 attachment and PR140 assignment deferrals with individual task/PR dispositions once these remaining criteria are handled. Preserve valid evidence.

## Preserve these boundaries

Prior auth/profile/settings/address/CRM, wallet, receipt, online, chargeback and invoice batches are consolidated. Adjustment approval at8a9ea42 remains verified. Do not rebuild completed work. Refund and concrete order/contract submission workflows retain their prerequisites. PR225's auto-invoice service has no actual submission caller; current DRAFT orders must not be charged. PR227 retains contract/consultation target tables and foreign keys in V01/B01. T-04.3.01.06 overpayment credit is already implemented and reviewed; preserve it during B01.

R02 retains actual notification delivery, current queued-reminder policy, expiry/receipt notifications and the missing auth.refresh_token_reused seed. PR243/245 and281/299/301 remain open. R03 retains shared contrast/localization and structured online-limit snapshots. Legacy invoice/reversal CHECK reconciliation and validation remain V01. No operational execution is claimed.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook wording and lost-contact owner policy remain pending. Do not ask again or change requirements.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider; automatic verification unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB is initial load; estimator900KB separately. Numeric budgets and coverage floors unchanged.

Use rtk and codebase-memory. Keep output small. Save ended logs and inspect failures. Do not edit source/tests while their checks run or overlap shared/API builds with consumer typechecks/browser setup. Build web before browser checks. Read every process exit before dependent edits or commits; a running/failed check is not a pass.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124 precede API rollout. Continue authorized work; the full plan is unfinished.
