# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Branch codex/audit-fixes. Product/test repair **4614c8bf**; dashboard proof **05dc4f9b**. Notification outbox/delivery batch consolidated locally:7 task acceptances and7 saved PR reviews closed; PR166/168 remain partial/open for provider guarantees/reconciliation/key wording and deployed alerts.

Counts:143 verified/33 partial/146 pending claims;120 closed/25 open/156 unreviewed saved PRs.58 skips,3 verified/55 pending. 2569 logs indexed. Saved GitHub inventory ends September3;38 older evidence refresh records remain. Full regression/coverage staysV02.

Durable per-send history now commits before I/O and finishes with the receipt. Rejected retries retain prior attempts even without worker bookkeeping; restart/recovery reuses the original row/duration.49 distinct worker cases pass, including9 compiled-process cases;47 API,12 FA/EN Chromium,50 i18n cases and42 unchanged budgets pass. Applicable types/lint/format/build/contract/snapshot pass. Earlier scoped evidence remains recorded; overlapping tests are not additive.

Grafana11.2.0 and Prometheus3.5.0 imported the dashboard in an isolated local stack. All5 queries and rendered panels match controlled samples, including orange12.5% failure ratio. [Screenshot](evidence/r02-outbox-delivery/grafana-dashboard.png). Temporary containers/network/browser removed. Production scrape/Alertmanager evidence remains external.

Migration0128 retains legacy processing rows and snapshots retained receipts; it cannot reconstruct already missing attempts. Deploy API/web readers, drain older notification workers, then migrate and start updated workers. Unknown/sending receipts remain held. Do not invent provider-side exactly-once or eventual-delivery guarantees. [Recovery runbook](../docs/operations/notification-delivery-recovery.md).

Active batch **R02-inbox-notification-policy**, saved PR171–176, six qualified tasks in progress.json. Exact requirements, saved bodies and PR174/175 deferrals read. Next: source comparison for center API/UI, polling and classification/timezone/window policy. Preserve valid delivery/recipient/minute-window evidence; do not repeat the previous batch.

Completed R01 work and valid tests remain recorded in progress/step reviews. Do not rebuild or repeat those reviews. The earlier wallet-controller fixture failures are fixed; the interrupted broad run is still not regression evidence.

## Next action

Review R02 inbox/notification policy: exact PR171–176 requirements and deferrals are read. Compare current source once, reuse unchanged evidence, fix confirmed gaps and validate each meaningful change.

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
