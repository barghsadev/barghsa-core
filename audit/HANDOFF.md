# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Branch codex/audit-fixes. Product/test HEAD **fe7a366b**. Active batch **R02-notification-outbox-delivery**, saved PR163–170 and203. Ten confirmed defects repaired locally. Durable send protection, staff search and prior triage/inbox/monitoring repairs remain. Latest e2f994f4 clarifies processing-attempt history and leaves recovery duration blank; fe7a366b releases a finished worker's own leftover lease after bookkeeping failure.

**52 focused worker cases pass, including nine compiled-process cases.** Three new notification scenarios prove graceful drain, forced-deadline recovery and accepted-receipt recovery after repeated bookkeeping failure against PostgreSQL and a controlled SMS endpoint. A replacement worker does not resend; a stale worker cannot clear its successor's lease. Earlier 53 guard/recipient cases remain recorded; counts overlap. History clarification passes 33 worker cases, four overlapping FA/EN browser cases, 50 i18n cases and all 42 unchanged budgets. Previous 130 API/provider, 47 overlapping history API and 14 distinct browser cases remain within recorded source scope. Applicable types/lint/format/build pass. 2528 logs indexed.

Next is individual task/PR closure for the nine-task batch. Compare exact requirements and deferrals; close proven items independently. Provider-level SMS idempotency, authoritative reconciliation of unknown sends and deployed monitoring evidence remain explicit prerequisites. No provider-side exactly-once, eventual-delivery or operational execution claim. Unknown sends remain held. [Recovery/rollout runbook](../docs/operations/notification-delivery-recovery.md). Drain older senders before migration 0127 and updated API/workers.

History counts processing attempts, not physical sends. A dedicated recovery/hold marker is recorded as an optional improvement; do not add a new schema/history subsystem just to redo this clarification. Notification shutdown/restart evidence is now complete locally. Preserve the existing source refresh queue and final regression scope.

Counts unchanged:136 verified/31 partial/155 pending claims;113 closed/23 open/165 unreviewed saved PRs;58 skips,3 verified/55 pending. Exact nine requirements and saved deferrals have been read; do not close the batch on partial evidence. Prior foundation remains5 PRs closed/1 open, with PR156 themesR03. Saved GitHub inventory ends September3;38 older evidence refresh records remain. Full regression/coverage remainsV02.

Completed R01 work and valid tests remain recorded in progress/step reviews. Do not rebuild or repeat those reviews. The earlier wallet-controller fixture failures are fixed; the interrupted broad run is still not regression evidence.

## Next action

Finish individual task/PR dispositions for R02-notification-outbox-delivery (nine tasks, PR163–170/203), reusing recorded evidence. Verify each exact requirement and historical deferral; close proven items individually. Keep SMS provider-level idempotency/authoritative reconciliation and operational alert deployment explicitly unresolved. Then select the next bounded R02 workflow; do not repeat completed delivery/search/shutdown repairs.

Reuse completed producer, recipient, branding and provider evidence where source remains valid. Keep remaining inbox/classification and event-specific reminders in later R02 batches. Preserve local monitoring rules and their runbook; operational alert delivery needs external execution evidence.

Deploy minute-aware workers before enabling fractional-hour settings; old workers normalize them to defaults. Existing whole-hour settings remain supported. Auth worker rollout must replace older workers coherently; they do not understand encrypted brand snapshots. Previously attempted legacy auth jobs retain original plain content.

Preserve all verification repairs. Manual notices now identify the profile and explain corrections/support review. The banner reads the latest unread, state-matching notice for the current owner and selected profile; reading it cannot revive an older notice. Per-user channel choices/current verified recipients are repaired atdeeb133b; event-specific producers and policy remainR02. No production identity adapter exists. Encrypted/redacted credentials, current authority, atomic provider configuration, async verification and staff retry remain explicit prerequisites before enabling API mode. Never simulate approval or ask again for a provider. The framework's formerly permanent OPEN circuit now admits bounded recovery probes.

Graph snippets use indexed line ranges. After editing a file, reindex or read bounded current source before the next edit. Do not use stale ranges to generate patches.

## Preserve these boundaries

Prior authentication, profile/onboarding, contact/address, agents/invitations/ownership, CRM, wallet, receipt, online payment, chargeback and invoice repairs are consolidated. Wallet settlement/reversal atcb7ac5b and adjustment approval at8a9ea42 remain verified. Preserve them. PR225 auto-invoicing still has no actual submission caller; current DRAFT orders must not be charged. Refund/order/contract workflows retain their own prerequisites. Contract and ticket record-view dependencies have exact keys in `progress.json.open_domain_reviews`. Overpayment credit T-04.3.01.06 is already implemented.

R02 retains actual notification delivery, current queued-reminder policy, expiry/receipt notices and the missing auth.refresh_token_reused seed. PR243/245 and281/299/301 remain open. R03 retains shared contrast/localization and structured online-limit snapshots. Legacy invoice/reversal CHECK reconciliation and validation remainV01. No operational execution is claimed.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment-return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook wording and lost-contact owner policy remain pending. Do not ask again or change those requirements.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No automatic identity provider; supported manual verification remains. Contacts:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors remain unchanged.

Use rtk and codebase-memory. Keep output small. Save ended logs and inspect failures. Do not edit source/tests while their checks run or overlap shared/API builds with consumer checks. Build web before browser checks. Read every process exit before dependent edits or commits. Reuse valid evidence; do not rerun broad suites at each checkpoint.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124/0125/0126 precede API rollout.0126 preserves legacy active providers; operational retesting remains. SMS test UI now discloses and previews all mappings sent to the verified staff contact. Continue authorized work; the full plan is unfinished.
