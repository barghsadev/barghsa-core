# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **0ad0760**. Current ticket batch remains open. Prior wallet invoice payment/reversal batch completed locally atcb7ac5b: **5 tasks verified /13 saved PR reviews closed**, PRs271–275,282–285,290–293. Current owner/session/CSRF/step-up authority lasts through commit; confirmed amount, safe retries, atomic debit/Paid/audit/cache and compensating reversal history are verified. Repeated implementations contain useful fixes; no duplicate service needs deletion.

68 baseline payment/cache cases pass. After API integration,56 overlapping existing cases and9 new HTTP cases pass.5 new production Chromium cases,4 unchanged deadline cases and9 invoice-page cases pass. Reversal evidence is unchanged since ab17007 and reused. API/web types, lint, builds, OpenAPI and42 budgets pass. Electricity ordering is247.94KB/250KB after shortening hashed asset filenames; cache checks pass.25 prior current source bindings refreshed.2030 logs indexed, including failures. [Batch review](evidence/step-reviews.json#R01-wallet-invoice-payments-reversals).

Counts: **127 verified /27 partial /168 pending =322 claims**.195 unresolved task reviews are not an effort estimate. Saved PR reviews: **104 closed /18 open /179 unreviewed** of301.58 skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed.12 retained/identified evidence-refresh records remain. Full regression and coverage remain V02.

## Next action

Active **R01-tickets**, saved PRs138,139,140; `02-auth-users-admin.md#T-06.01.01` through `.03`. Exact requirements, all three PR bodies and the full Tickets component are read. Do not repeat those reads. Writes verified at5b637a8; reads atfa60a45 now bind current account, role, assignment scope and session authority through response assembly. Creation options recheck profile ownership. Attachments use the existing verified fixed-byte sealing and private-download implementation; current HTTP evidence covers it.

UI repair368c080 hides edit controls for tickets outside assigned-only write scope, even when staff can read the full queue. Ticket fields, notes, cards and lists use theme colors; primary-button hover remains readable. **10 production Chromium cases pass**, including Persian/English light/dark axe checks. Web build/types/lint/format and **42 unchanged budgets** pass.

Assignment repairs948a216 andb5c4e87 give both creation callers consistent profile/team/account lock order. Concurrent ticket assignment with staff ticket or identity-correction creation passes. Automatic and manual assignment now lock candidate roles through commit; both reproduced revocation races pass. **91 distinct cases pass** across the focused assignment/correction/ticket runs, including19 correction HTTP cases. One duplicate-team-name fixture failure was fixed; later9-case routing run passes. No provider or schema changes inb5c4e87.

Categories are complete at0ad0760. User approved **General, Billing, Orders**. Migration0125 adds the constrained defaulted field; existing tickets and omitted API categories default to General. Creation, list/detail, audit records and FA/EN selector are verified. **57 HTTP,22 service,10 production browser cases and42 unchanged budgets pass.** These overlap earlier runs. Three migration cases pass across focused runs: populated upgrades, legacy recovery, fresh schema/seed and preauth preservation. The generator timestamp was corrected to follow the existing future-dated journal; initial failures and the corrected legacy fixture are retained. API/web/DB types, lint, formatting, web build, OpenAPI, backlog and current requirements pass.24 previously current source bindings refreshed; stale ones remain pending. **2108 logs indexed.** No ticket task or PR closed yet.

Next: finish list related-record links and staff customer-information panel. Current detail contains userId/profileId and a profile quick-link, but no customer display metadata. Only customer invoice detail is an existing specific record route. `/admin/invoices` is a collection of manual/correction/deadline forms, not an invoice queue; its deadline lookup starts blank and has no deep-link input. No order detail route exists; `/electricity/order` creates orders. Contract linking deliberately returns409 pending the unbuilt table/workflow inV01/B01. Build supported links without inventing destinations, record dependencies, then consolidate PR138 attachment and PR140 assignment deferrals with individual task/PR dispositions. Reuse completed category, authority, attachment and transition evidence.

## Preserve these boundaries

Prior auth/profile/settings/address/CRM, wallet, receipt, online, chargeback and invoice batches are consolidated. Adjustment approval at8a9ea42 remains verified. Do not rebuild completed work. Refund and concrete order/contract submission workflows retain their prerequisites. PR225's auto-invoice service has no actual submission caller; current DRAFT orders must not be charged. PR227 retains contract/consultation target tables and foreign keys in V01/B01. T-04.3.01.06 overpayment credit is already implemented and reviewed; preserve it during B01.

R02 retains actual notification delivery, current queued-reminder policy, expiry/receipt notifications and the missing auth.refresh_token_reused seed. PR243/245 and281/299/301 remain open. R03 retains shared contrast/localization and structured online-limit snapshots. Legacy invoice/reversal CHECK reconciliation and validation remain V01. No operational execution is claimed.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook wording and lost-contact owner policy remain pending. Do not ask again or change requirements.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider; automatic verification unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB is initial load; estimator900KB separately. Ticket categories: General, Billing, Orders. Numeric budgets and coverage floors unchanged.

Use rtk and codebase-memory. Keep output small. Save ended logs and inspect failures. Do not edit source/tests while their checks run or overlap shared/API builds with consumer typechecks/browser setup. Build web before browser checks. Read every process exit before dependent edits or commits; a running/failed check is not a pass.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124/0125 precede API rollout. Continue authorized work; the full plan is unfinished.
