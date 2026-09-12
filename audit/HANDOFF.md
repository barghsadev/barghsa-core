# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Branch codex/audit-fixes. Latest product/test commit **088b010e**. Reminder batch PR243/245:2 task acceptances verified/2 saved PR reviews closed. Prior email batch remains6 verified/1 partial; PR190 still needs deployed ops alert delivery.

Counts:165 verified/32 partial/125 pending claims;142 closed/24 open/135 unreviewed saved PRs.58 skips,3 verified/55 pending.2756 logs indexed. Saved GitHub inventory ends September3;38 older evidence refresh records remain. Full regression/coverage staysV02.

Reminder sender now checks current offsets/dirty plans and transfers all channel jobs once, preserving later wake-ups. Queued delivery checks current invoice/deadline/owner/account/offset/window under locks through provider dispatch. Accepted/unknown receipts remain durable. SMS supports exact FA/EN mappings with shared legacy fallback; every saved mapping must pass provider testing.75 scheduler/sender,25 overlapping sender,49 final worker plus26 unchanged runner/receipt,102 API,7 shared and10 distinct FA/EN browser cases support the batch. Types/lint/format/build and42 unchanged budgets pass.31 immediate-base bindings refreshed. [Batch review](evidence/step-reviews.json#R02-invoice-reminder-delivery).

Drain older workers before rollout; reminder pools need at least2 connections. Coordinate API/web/SMS workers before saving language mappings. Legacy occurrences with missing channel jobs remain held for reconciliation; no history deletion or automatic resend. [Runbook](../docs/operations/notification-delivery-recovery.md). No live send, rollout or data reconciliation claimed.

Fixed actual Resend payload/signatures, callback provider identity and physical-send history, rolling transient circuit thresholds, complaint correction tasks and SMTP DNS address pinning.25 callback/correction HTTP,203 expanded circuit/lifecycle API,75 worker,89 SMTP API,60 shared guard,18 secret,1 migration and4 new FA/EN browser cases pass; counts overlap and must not be summed.10 neighboring browser cases and matching prior provider lifecycle/UI evidence remain valid. Applicable types/lint/format/build/OpenAPI/snapshot checks and42 budgets pass.21 immediate-base source bindings refreshed; older38 retained.

Deploy migrations0129–0131 with coordinated API/worker rollout described in the delivery and monitoring runbooks. Complaints create one open correction per address; audited completion requires current staff authority and step-up, and never removes suppression. Legacy unidentified callbacks, unknown sends and historical plaintext-secret compatibility retain their explicit operational review. No deployment, live sending, GitHub refresh or scheduler change claimed.

Consent evidence:43 distinct API cases,10 schema cases and2 FA/EN Chromium cases pass. API types/lint/format/build and OpenAPI generation pass. Prior42 size budgets remain valid; frontend unchanged.13 consent HTTP cases cover selected-profile isolation, malformed input, foreign/null/default contexts, unchanged timestamps, archive/ownership waits, session/CSRF/disable changes, audit rollback and session expiry before commit. A corrected selection-race test waits in the shared guard before handler selection; it verifies only the newly selected profile is written.2 immediate-base bindings refreshed.

Existing worker gate/loader source matches the verified recipient batch, and later transport/history source matches the completed delivery batch. Reuse those proofs. Before production marketing, review legacy opt-ins created by the old all-profile endpoint: old audits do not identify the intended profile. No bulk rewrite or production reconciliation executed.


Template evidence:18 DB/catalog cases,8 FA/EN Chromium cases, types/lint/format/build and42 unchanged budgets pass. Four seed baseline failures and two browser baseline failures reproduce repaired defects.35 Appendix events/all required channels/locales and160 templates checked. Nine controller method bodies and latest template service/HTTP/engine/authoring bindings are unchanged; reuse their recorded evidence.3 immediate-base bindings refreshed.

The notification-only data migration is explicit and separate from the schema journal. It creates only absent families as active version1, preserves drafts/archives/customized versions, serializes imports with admin family locks, and rolls back entirely on failure. Actual CLI execution passed against a disposable DB. Deployment must run it; no deployment claim. [Runbook](../docs/operations/notification-template-seeding.md). Refresh-token reuse still emits its private in-app notice directly; adding its template adds no email producer.

Inbox/policy atb168ee2b remains6 verified/6 closed. Its22 API/30 distinct web unit/14 distinct browser/50 i18n cases and42 budgets remain valid within recorded scope.35 classifications match; unchanged window evidence reused. See consolidated step records instead of repeating these tests.

Outbox/delivery remains7 closed/2 open. Durable send history at4614c8bf passes49 worker/47 API/12 browser cases; Grafana proof at05dc4f9b verifies all5 panels using local synthetic data. PR166 provider guarantees/reconciliation/key wording and PR168 deployed alerts remain explicit prerequisites. Unknown sends stay held. [Dashboard screenshot](evidence/r02-outbox-delivery/grafana-dashboard.png).

Migration0128 retains legacy history and snapshots available receipts; it cannot reconstruct missing attempts. Deploy API/web readers, drain older notification workers, then migrate/start updated workers. [Recovery runbook](../docs/operations/notification-delivery-recovery.md).

Active batch **R02-receipt-expiry-notices**, saved PR267/270/278/281/286/289/299/301 for three qualified tasks. Reuse finance authority/transaction evidence; review notification producers and exact recipient/template payloads.

Build changed shared/i18n dependencies before consumer checks or web builds. Preserve completed work, valid evidence and all pending external/future prerequisites. Full regression staysV02.

## Next action

Read exact receipt-confirmation/rejection and online top-up expiry requirements, all eight contributing PR bodies and deferrals. Trace producers through outbox delivery and active FA/EN templates; repair confirmed gaps without rebuilding verified finance work.

Reuse completed producer, recipient, branding and provider evidence where source remains valid. Keep remaining inbox/classification and event-specific reminders in later R02 batches. Preserve local monitoring rules and their runbook; operational alert delivery needs external execution evidence.

Deploy minute-aware workers before enabling fractional-hour settings; old workers normalize them to defaults. Existing whole-hour settings remain supported. Auth worker rollout must replace older workers coherently; they do not understand encrypted brand snapshots. Previously attempted legacy auth jobs retain original plain content.

Preserve all verification repairs. Manual notices now identify the profile and explain corrections/support review. The banner reads the latest unread, state-matching notice for the current owner and selected profile; reading it cannot revive an older notice. Per-user channel choices/current verified recipients are repaired atdeeb133b; event-specific producers and policy remainR02. No production identity adapter exists. Encrypted/redacted credentials, current authority, atomic provider configuration, async verification and staff retry remain explicit prerequisites before enabling API mode. Never simulate approval or ask again for a provider. The framework's formerly permanent OPEN circuit now admits bounded recovery probes.

Graph snippets use indexed line ranges. After editing a file, reindex or read bounded current source before the next edit. Do not use stale ranges to generate patches.

## Preserve these boundaries

Prior authentication, profile/onboarding, contact/address, agents/invitations/ownership, CRM, wallet, receipt, online payment, chargeback and invoice repairs are consolidated. Wallet settlement/reversal atcb7ac5b and adjustment approval at8a9ea42 remain verified. Preserve them. PR225 auto-invoicing still has no actual submission caller; current DRAFT orders must not be charged. Refund/order/contract workflows retain their own prerequisites. Contract and ticket record-view dependencies have exact keys in `progress.json.open_domain_reviews`. Overpayment credit T-04.3.01.06 is already implemented.

R02 retains expiry/receipt notices and remaining producer/template payload contracts. PR243/245 are locally closed; PR281/299/301 remain open. R03 retains shared contrast/localization and structured online-limit snapshots. Legacy invoice/reversal CHECK reconciliation and validation remainV01. No operational execution is claimed.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment-return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook wording and lost-contact owner policy remain pending. Do not ask again or change those requirements.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No automatic identity provider; supported manual verification remains. Contacts:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors remain unchanged. September13: limited trusted server-side secret decryption approved for sending workers, authorized verified-recipient tests, webhook signing-secret verification, masking and rollback; canonical T-05.06.05 updated.

Use rtk and codebase-memory. Keep output small. Save ended logs and inspect failures. Do not edit source/tests while their checks run or overlap shared/API builds with consumer checks. Build web before browser checks. Read every process exit before dependent edits or commits. Reuse valid evidence; do not rerun broad suites at each checkpoint.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124/0125/0126 precede API rollout.0126 preserves legacy active providers; operational retesting remains. SMS test UI now discloses and previews all mappings sent to the verified staff contact. Continue authorized work; the full plan is unfinished.
