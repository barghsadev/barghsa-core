# Continue here

Read [fix-plan.md](fix-plan.md), especially its feature-batch rules, and the active batch in [progress.json](progress.json). Detailed completed reviews and valid evidence remain in [step-reviews.json](evidence/step-reviews.json). Do not reread the archive routinely.

## Current checkpoint

Branch `codex/audit-fixes`. Latest product/test **761ef274**. **197 verified /35 partial /90 pending** of322 claims. Saved PRs: **178 closed /28 open /95 unreviewed**,301 total.58 skips:8 verified/1 partial/49 pending.3307 logs indexed;38 older refreshes remain. Saved inventory ends September3; no current GitHub/deployment claim.

Seed/bootstrap batch:5 tasks verified/1 partial;5 PRs closed/1 open. Migration0134 protects canonical electricity identities and allows zero/zero limits while rejecting new negative bounds. Seed counts/concurrency/force boundaries are repaired; legacy conflicts stop seed without replacement. Green-rule consumers recognize canonical and legacy keys, reject ambiguity. All747 DB cases,88 distinct affected API cases and14 shared cases pass; types/builds/snapshot/lint/format pass.39 immediate-base bindings refreshed. [Review](evidence/step-reviews.json#V01-seed-bootstrap). PR84 retains production initial-seed execution.

Database foundations retain5 verified/2 partial and PR47 closure. PR23's38 base-column deviations await the owner decision already asked; do not reask. PR80 retains external rollout/backup/down-migration prerequisites. R04/R05 proof remains valid; ship both SPA entries together.

## Next action

Runtime batch complete at645dda1c:3 newly verified/1 partial;3 newly closed PRs/1 open; PR29 closure preserved. Real storage health, bounded API/worker shutdown and complete web response draining repaired.10 distinct API,28 shared,2 worker and26 web cases pass; current types/builds/lint/format pass.118 immediate-base bindings refreshed;38 older refreshes retained. PR42 keeps future AI/bill-data maintenance consumers open. [Review](evidence/step-reviews.json#V01-runtime-lifecycle). Loop batch verified at761ef274:58 distinct protocol cases and9 audit cases pass; PR234/235/242 locally closed. Malformed review values now fail safely. Current three-round policy preserved. Live state bootstrap/recovery and PR304 remain external. Next: **V01-operations-configuration**, saved PR43/44/45/46/48/49. [Loop review](evidence/step-reviews.json#V01-loop-durability).

Database PR17–22 remains5 closed/1 open. PR21 retains future refund/order concurrency. README traceability is current.

R03 native CSP question remains pending: signed-in reports return403 because browsers cannot add the CSRF header. Do not reask or waive the requirement. PR61 and other external prerequisites stay open. Then remaining V01/R06/V02/B01. Whole plan unfinished. Apply migrations through0134 before this API accepts traffic. Reconcile conflicting legacy electricity identities before seeding; validate nonnegative limit CHECK only after legacy reconciliation. Historical traces stay NULL.

## Preserve completed work and prerequisites

Earlier authentication/profile/CRM/finance repairs remain valid within their recorded source bindings. Do not charge current DRAFT orders: PR225 still lacks its actual submission caller. Refund/order/contract/document flows and legacy invoice/reversal CHECK validation retain their exact future/operational prerequisites in progress.json. Overpayment credit T-04.3.01.06 is already implemented.

Notification recipients/preferences, branding, templates, consent, delivery, reminders and receipt/expiry notices have consolidated review records. PR243/245/281/299/301 are locally closed. Preserve source-bound evidence. Production sends, live providers, legacy consent/secret/receipt reconciliation, infrastructure and monitoring delivery require external execution. No historical backfill/resend is authorized. Follow [delivery recovery](../docs/operations/notification-delivery-recovery.md) and [template seeding](../docs/operations/notification-template-seeding.md): deploy coordinated migrations/workers, drain old writers, publish templates. Reminder pools need2+ connections; older workers do not support minute windows, encrypted branding snapshots or language-specific SMS mappings.

Manual identity verification remains supported; no automatic identity provider exists. Preserve profile-specific notices and current channel choices. Real encrypted configuration, current authority, atomic version persistence, async processing and staff retry are prerequisites before enabling API verification. Never simulate approval or ask again for a provider. Pending signed-webhook wording and lost-contact owner policy remain unanswered; do not reask or silently waive them.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. Contacts:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors unchanged. September13: limited trusted server-side secret use approved for sending workers, authorized verified-recipient tests, webhook signing-secret verification, masking and rollback; canonical T-05.06.05 updated. Pre-login CSRF and shared session/CSRF races are repaired.

Use rtk and codebase-memory. Graph ranges can become stale after edits; read current bounded source. Keep output small; save full logs. Never edit source/tests while their checks run or overlap shared/API builds with consumer checks. Build web before browser checks. Read every process exit before edits/commits. Review each meaningful fix, run focused checks and consolidate once per feature batch. Reuse valid evidence.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment, external messages or PR304 action. Preserve completed work, exact qualified task IDs and pending external/future prerequisites.
