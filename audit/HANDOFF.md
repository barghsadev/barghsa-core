# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Branch codex/audit-fixes. Latest product/test HEAD **f61b6c20**. Marketing consent/channel batch PR182–184 closes locally:3 task acceptances verified/3 saved PR reviews closed. Consent now applies only to the current owned profile, with strict inputs, current session/CSRF/selection checks and atomic scoped audit.

Counts:157 verified/33 partial/132 pending claims;134 closed/25 open/142 unreviewed saved PRs.58 skips,3 verified/55 pending.2643 logs indexed. Saved GitHub inventory ends September3;38 older evidence refresh records remain. Full regression/coverage staysV02.

Consent evidence:43 distinct API cases,10 schema cases and2 FA/EN Chromium cases pass. API types/lint/format/build and OpenAPI generation pass. Prior42 size budgets remain valid; frontend unchanged.13 consent HTTP cases cover selected-profile isolation, malformed input, foreign/null/default contexts, unchanged timestamps, archive/ownership waits, session/CSRF/disable changes, audit rollback and session expiry before commit. A corrected selection-race test waits in the shared guard before handler selection; it verifies only the newly selected profile is written.2 immediate-base bindings refreshed.

Existing worker gate/loader source matches the verified recipient batch, and later transport/history source matches the completed delivery batch. Reuse those proofs. Before production marketing, review legacy opt-ins created by the old all-profile endpoint: old audits do not identify the intended profile. No bulk rewrite or production reconciliation executed.


Template evidence:18 DB/catalog cases,8 FA/EN Chromium cases, types/lint/format/build and42 unchanged budgets pass. Four seed baseline failures and two browser baseline failures reproduce repaired defects.35 Appendix events/all required channels/locales and160 templates checked. Nine controller method bodies and latest template service/HTTP/engine/authoring bindings are unchanged; reuse their recorded evidence.3 immediate-base bindings refreshed.

The notification-only data migration is explicit and separate from the schema journal. It creates only absent families as active version1, preserves drafts/archives/customized versions, serializes imports with admin family locks, and rolls back entirely on failure. Actual CLI execution passed against a disposable DB. Deployment must run it; no deployment claim. [Runbook](../docs/operations/notification-template-seeding.md). Refresh-token reuse still emits its private in-app notice directly; adding its template adds no email producer.

Inbox/policy atb168ee2b remains6 verified/6 closed. Its22 API/30 distinct web unit/14 distinct browser/50 i18n cases and42 budgets remain valid within recorded scope.35 classifications match; unchanged window evidence reused. See consolidated step records instead of repeating these tests.

Outbox/delivery remains7 closed/2 open. Durable send history at4614c8bf passes49 worker/47 API/12 browser cases; Grafana proof at05dc4f9b verifies all5 panels using local synthetic data. PR166 provider guarantees/reconciliation/key wording and PR168 deployed alerts remain explicit prerequisites. Unknown sends stay held. [Dashboard screenshot](evidence/r02-outbox-delivery/grafana-dashboard.png).

Migration0128 retains legacy history and snapshots available receipts; it cannot reconstruct missing attempts. Deploy API/web readers, drain older notification workers, then migrate/start updated workers. [Recovery runbook](../docs/operations/notification-delivery-recovery.md).

Active batch **R02-email-provider-callbacks**, saved PR185–191. Read exact requirements/bodies/deferrals; reuse earlier provider lifecycle/self-test/secret/activation/authoring evidence. Review remaining circuit and callback signature/replay/suppression behavior.

Build changed shared/i18n dependencies before consumer checks or web builds. Preserve completed work, valid evidence and all pending external/future prerequisites. Full regression staysV02.

## Next action

Review email provider lifecycle, SMTP/Resend configuration, admin UI, encrypted secrets, circuit behavior and callbacks, PR185–191. Read exact seven requirements and deferrals; preserve prior provider repairs and valid evidence.

Reuse completed producer, recipient, branding and provider evidence where source remains valid. Keep remaining inbox/classification and event-specific reminders in later R02 batches. Preserve local monitoring rules and their runbook; operational alert delivery needs external execution evidence.

Deploy minute-aware workers before enabling fractional-hour settings; old workers normalize them to defaults. Existing whole-hour settings remain supported. Auth worker rollout must replace older workers coherently; they do not understand encrypted brand snapshots. Previously attempted legacy auth jobs retain original plain content.

Preserve all verification repairs. Manual notices now identify the profile and explain corrections/support review. The banner reads the latest unread, state-matching notice for the current owner and selected profile; reading it cannot revive an older notice. Per-user channel choices/current verified recipients are repaired atdeeb133b; event-specific producers and policy remainR02. No production identity adapter exists. Encrypted/redacted credentials, current authority, atomic provider configuration, async verification and staff retry remain explicit prerequisites before enabling API mode. Never simulate approval or ask again for a provider. The framework's formerly permanent OPEN circuit now admits bounded recovery probes.

Graph snippets use indexed line ranges. After editing a file, reindex or read bounded current source before the next edit. Do not use stale ranges to generate patches.

## Preserve these boundaries

Prior authentication, profile/onboarding, contact/address, agents/invitations/ownership, CRM, wallet, receipt, online payment, chargeback and invoice repairs are consolidated. Wallet settlement/reversal atcb7ac5b and adjustment approval at8a9ea42 remain verified. Preserve them. PR225 auto-invoicing still has no actual submission caller; current DRAFT orders must not be charged. Refund/order/contract workflows retain their own prerequisites. Contract and ticket record-view dependencies have exact keys in `progress.json.open_domain_reviews`. Overpayment credit T-04.3.01.06 is already implemented.

R02 retains actual notification delivery, current queued-reminder policy, expiry/receipt notices and remaining producer/template payload contracts. PR243/245 and281/299/301 remain open. R03 retains shared contrast/localization and structured online-limit snapshots. Legacy invoice/reversal CHECK reconciliation and validation remainV01. No operational execution is claimed.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment-return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook wording and lost-contact owner policy remain pending. Do not ask again or change those requirements.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No automatic identity provider; supported manual verification remains. Contacts:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors remain unchanged.

Use rtk and codebase-memory. Keep output small. Save ended logs and inspect failures. Do not edit source/tests while their checks run or overlap shared/API builds with consumer checks. Build web before browser checks. Read every process exit before dependent edits or commits. Reuse valid evidence; do not rerun broad suites at each checkpoint.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124/0125/0126 precede API rollout.0126 preserves legacy active providers; operational retesting remains. SMS test UI now discloses and previews all mappings sent to the verified staff contact. Continue authorized work; the full plan is unfinished.
