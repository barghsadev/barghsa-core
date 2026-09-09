# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Branch codex/audit-fixes. Product/test HEAD **d0d72ec9**. Active batch **R02-notification-outbox-delivery**, saved PR163–170 and203. Four confirmed defects are repaired locally: current session/CSRF/step-up and request-linked audit for triage at361f4b82; atomic inbox/job/log/outbox delivery and correct attempt counting at315c6c17; validated staff reads and exact action acknowledgments atd0d72ec9.

**70 focused API cases,8 chargeback integration cases,81 worker cases and10 distinct FA/EN browser cases pass.** Applicable types/lint/format/build and42 unchanged budgets pass. [Current checkpoint](evidence/step-reviews.json#R02-outbox-delivery-checkpoint) preserves initial failures and focused reruns. 2402 logs indexed. Counts unchanged:136 verified/31 partial/155 pending claims;113 closed/23 open/165 unreviewed saved PRs;58 skips,3 verified/55 pending. No task or PR closure claimed for this in-flight batch.

Confirmed next gaps: no staff per-attempt delivery history display and no notification accumulation alert rule. Implement those, then complete schema/interface, producer transaction, retry/lease/shutdown, logging and observability review. Worker inbox atomicity is proven; do not claim synchronous business-producer inbox insertion without evidence. Prior notification foundation remains complete locally,5 PRs closed/1 open; PR156 theme acceptance staysR03. Saved GitHub inventory ends September3;38 older source-evidence refresh records remain. Full regression/coverage remainsV02.

Completed R01 work and valid tests remain recorded in progress/step reviews. Do not rebuild or repeat those reviews. The earlier wallet-controller fixture failures are fixed; the interrupted broad run is still not regression evidence.

## Next action

Add and verify per-channel delivery history in the staff dead-letter panel, then accumulation alert rules. Finish the remaining nine-task batch review before assigning PR/task closure. Preserve the verified session, inbox-transaction, counter and UI acknowledgement repairs.

Reuse completed producer, recipient, branding and provider evidence where source remains valid. Keep remaining inbox/classification and event-specific reminder work in later R02 batches. Operational alert loading/delivery remains separate from local rules validation.

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
