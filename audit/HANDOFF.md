# Continue here

Read [fix-plan.md](fix-plan.md), especially its feature-batch rules, and the active batch in [progress.json](progress.json). Detailed completed reviews and valid evidence remain in [step-reviews.json](evidence/step-reviews.json). Do not reread the archive routinely.

## Current checkpoint

Branch `codex/audit-fixes`. Latest product/test **7eecc144**. **179 verified /32 partial /111 pending** of322 claims. Saved PRs: **153 closed /22 open /126 unreviewed**,301 total.58 skips:8 verified/1 partial/49 pending.3132 logs indexed;38 older refreshes remain. Saved GitHub inventory ends September3; no current GitHub/deployment claim.

R04 purchase loading verified; PR12 closes locally.29 final browser cases,59 web cases,3 budget cases, types/lint/format/build and42 unchanged budgets pass. Cold auth loads remain below150KB. Both entry outputs must ship together. 12 immediate-base bindings refreshed; earlier domain proof retained. [Review](evidence/step-reviews.json#R04-purchase-loading).

## Next action

R05: resolve strict API/web/worker/DB dependency declarations without blanket suppression; review geoip-country maintenance and saved repeated PR47.

R03 native CSP question remains pending: signed-in reports return403 because browsers cannot add the CSRF header. Do not reask or waive the requirement. PR61 and other external prerequisites stay open. Then R05/V01/R06/V02/B01. Whole plan unfinished. Apply migration0132 before updated API/workers; historical traces stay NULL.

## Preserve completed work and prerequisites

Earlier authentication/profile/CRM/finance repairs remain valid within their recorded source bindings. Do not charge current DRAFT orders: PR225 still lacks its actual submission caller. Refund/order/contract/document flows and legacy invoice/reversal CHECK validation retain their exact future/operational prerequisites in progress.json. Overpayment credit T-04.3.01.06 is already implemented.

Notification recipients/preferences, branding, templates, consent, delivery, reminders and receipt/expiry notices have consolidated review records. PR243/245/281/299/301 are locally closed. Preserve source-bound evidence. Production sends, live providers, legacy consent/secret/receipt reconciliation, infrastructure and monitoring delivery require external execution. No historical backfill/resend is authorized. Follow [delivery recovery](../docs/operations/notification-delivery-recovery.md) and [template seeding](../docs/operations/notification-template-seeding.md): deploy coordinated migrations/workers, drain old writers, publish templates. Reminder pools need2+ connections; older workers do not support minute windows, encrypted branding snapshots or language-specific SMS mappings.

Manual identity verification remains supported; no automatic identity provider exists. Preserve profile-specific notices and current channel choices. Real encrypted configuration, current authority, atomic version persistence, async processing and staff retry are prerequisites before enabling API verification. Never simulate approval or ask again for a provider. Pending signed-webhook wording and lost-contact owner policy remain unanswered; do not reask or silently waive them.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. Contacts:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors unchanged. September13: limited trusted server-side secret use approved for sending workers, authorized verified-recipient tests, webhook signing-secret verification, masking and rollback; canonical T-05.06.05 updated. Pre-login CSRF and shared session/CSRF races are repaired.

Use rtk and codebase-memory. Graph ranges can become stale after edits; read current bounded source. Keep output small; save full logs. Never edit source/tests while their checks run or overlap shared/API builds with consumer checks. Build web before browser checks. Read every process exit before edits/commits. Review each meaningful fix, run focused checks and consolidate once per feature batch. Reuse valid evidence.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment, external messages or PR304 action. Preserve completed work, exact qualified task IDs and pending external/future prerequisites.
