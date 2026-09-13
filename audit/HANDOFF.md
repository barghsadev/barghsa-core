# Continue here

Read [fix-plan.md](fix-plan.md), especially its feature-batch rules, and the active batch in [progress.json](progress.json). Detailed completed reviews and valid evidence remain in [step-reviews.json](evidence/step-reviews.json). Do not reread the archive routinely.

## Current checkpoint

Branch `codex/audit-fixes`. Latest product/test **b83ef2c1**. **185 verified /33 partial /104 pending** of322 claims. Saved PRs: **158 closed /25 open /118 unreviewed**,301 total.58 skips:8 verified/1 partial/49 pending.3212 logs indexed;38 older refreshes remain. Saved inventory ends September3; no current GitHub/deployment claim.

Database foundations batch:5 task reviews verified/2 partial;4 PR reviews closed/2 open. Migration0133 adds timestamp triggers to37 uncovered tables, retaining existing domain triggers. API readiness verifies packaged schema head.742 distinct DB cases pass across package/focused runs;3 API HTTP cases, types/builds/snapshot/lint/format and11 provenance tests pass.17 immediate-base bindings refreshed. [Review](evidence/step-reviews.json#V01-database-foundations). PR47 replacement closes with original unmapped provenance retained.

PR23 remains open for38 tables missing universal base columns; preserve named/composite keys and immutable history until compatibility migrations or explicit exceptions resolve them. PR80 schema-health deferral is satisfied; external rollout/backup/down-migration proof remains open. R04/R05 evidence retained; ship both SPA entries together.

## Next action

V01: review seed/bootstrap/system-product workflow, saved PR81–86. Reuse current DB evidence; fix confirmed requirements only.

R03 native CSP question remains pending: signed-in reports return403 because browsers cannot add the CSRF header. Do not reask or waive the requirement. PR61 and other external prerequisites stay open. Then remaining V01/R06/V02/B01. Whole plan unfinished. Apply migrations through0133 before this API accepts traffic. Historical traces stay NULL.

## Preserve completed work and prerequisites

Earlier authentication/profile/CRM/finance repairs remain valid within their recorded source bindings. Do not charge current DRAFT orders: PR225 still lacks its actual submission caller. Refund/order/contract/document flows and legacy invoice/reversal CHECK validation retain their exact future/operational prerequisites in progress.json. Overpayment credit T-04.3.01.06 is already implemented.

Notification recipients/preferences, branding, templates, consent, delivery, reminders and receipt/expiry notices have consolidated review records. PR243/245/281/299/301 are locally closed. Preserve source-bound evidence. Production sends, live providers, legacy consent/secret/receipt reconciliation, infrastructure and monitoring delivery require external execution. No historical backfill/resend is authorized. Follow [delivery recovery](../docs/operations/notification-delivery-recovery.md) and [template seeding](../docs/operations/notification-template-seeding.md): deploy coordinated migrations/workers, drain old writers, publish templates. Reminder pools need2+ connections; older workers do not support minute windows, encrypted branding snapshots or language-specific SMS mappings.

Manual identity verification remains supported; no automatic identity provider exists. Preserve profile-specific notices and current channel choices. Real encrypted configuration, current authority, atomic version persistence, async processing and staff retry are prerequisites before enabling API verification. Never simulate approval or ask again for a provider. Pending signed-webhook wording and lost-contact owner policy remain unanswered; do not reask or silently waive them.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. Contacts:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors unchanged. September13: limited trusted server-side secret use approved for sending workers, authorized verified-recipient tests, webhook signing-secret verification, masking and rollback; canonical T-05.06.05 updated. Pre-login CSRF and shared session/CSRF races are repaired.

Use rtk and codebase-memory. Graph ranges can become stale after edits; read current bounded source. Keep output small; save full logs. Never edit source/tests while their checks run or overlap shared/API builds with consumer checks. Build web before browser checks. Read every process exit before edits/commits. Review each meaningful fix, run focused checks and consolidate once per feature batch. Reuse valid evidence.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment, external messages or PR304 action. Preserve completed work, exact qualified task IDs and pending external/future prerequisites.
