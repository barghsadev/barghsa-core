# Continue here

Read the feature-batch rules in [fix-plan.md](fix-plan.md) and `active_batch` in [progress.json](progress.json). Completed reviews and valid evidence live in [step-reviews.json](evidence/step-reviews.json). Do not reread the archive routinely.

## Current checkpoint

Branch `codex/audit-fixes`. Latest product/test **b514bd11**. **209 verified /47 partial /66 pending** of322 claims. Saved PRs: **201 closed /43 open /57 unreviewed**,301 total.58 skips:8 verified/1 partial/49 pending.3544 logs indexed;37 older evidence refreshes remain. Inventory ends September3; no current GitHub or deployment claim.

Login review consolidated at **b514bd11**: saved PR77/78/87/88/101 all close. Existing5 task acceptances retained; later auth/CSRF/delivery/contact/UI changes reconciled.95 API and40 distinct desktop/mobile browser cases pass. Canceled-animation waiting and obsolete hidden-mobile-brand test assertions repaired; authentication code unchanged. PR87 migration/test deferrals are satisfied. One older CRM binding refreshed;37 older refresh records remain. [Batch review](evidence/step-reviews.json#V01-login-authentication).

**Next:** terms lifecycle and acceptance, saved PR117/118/119/159/160. Reuse completed terms/registration evidence and inspect later changes once. UI stack question and literal table-hook wording remain pending; keep the tested implementation. Full regression stays V02.

UI foundations checkpoint **21438625** verifies1 task;2 remain partial for explicit stack/table requirement discrepancies. PR65 closed;66/67 open. Font/PostCSS/keyboard-highlight repairs pass45 browser,56 UI and42 budget checks. Both PR67 visual/form deferrals are satisfied.

Edge/cache checkpoint **6d801999** verifies4 tasks and closes PR60/62/63/64.42 focused cases and actual NGINX TLS/routing/gzip/cache/limits/SSE/WebSocket checks pass. Deploy web/proxy cache changes together; production TLS/topology and final image regression remain external/V02. PR61's pending CSP decision stays open.

Previous storage checkpoint **cf0fa042** verifies3 tasks and closes3 PRs; PR57 retains deployed retention/future classifiers, PR59 future contract/document integration.180 affected cases pass. Redis checkpoint **c32ff819** closes PR51/53/54 using matching prior evidence. Preserve both consolidated reviews.

## Preserve completed work

Reuse source-bound authentication, profiles, CRM, finance, notification, UI, database, operations, container, runtime and loop reviews. Their exact limitations remain in [acceptance](acceptance-closure.json) and `progress.json.open_domain_reviews`; do not rebuild completed workflows or count future/operational prerequisites as passed.

- Apply migrations through0134 before this API accepts traffic. Reconcile legacy electricity identities/nonnegative limits before seed/constraint validation. Historical traces stay NULL. Published image tags, current packaged-image refresh and production seed remain separate evidence.
- Do not charge DRAFT orders: PR225 still lacks its submission caller. Refund/order/contract/document consumers and legacy invoice/reversal constraint validation retain their recorded prerequisites.
- Notifications require coordinated migrations/workers, published templates/mappings and old-writer retirement. Reminder pools need2+ connections. Follow [delivery recovery](../docs/operations/notification-delivery-recovery.md) and [template seeding](../docs/operations/notification-template-seeding.md). No historical backfill/resend or live send is authorized.
- Storage rollout must ship API/helpers together, permit If-None-Match in bucket CORS, drain old writers and expire old PUT URLs for at least1hour. Reconcile deployed lifecycle rules/MinIO multipart settings. No real bucket or elapsed-day expiry proof. Future scanner/quarantine/SHA256 and document consumers remain separate. Manual hold edits must not race classification; independent hold authority requires provider Object Lock.
- Production TLS/firewall/load, off-server backups, secrets, installed schedules, quarterly recovery and delivered monitoring alerts remain unverified. Loop state bootstrap/recovery and PR304 remain external; scheduler stays unchanged.

## Decisions and pending questions

Retain Vite SPA/ADR004. License restrictions waived. No automatic identity provider exists; manual verification remains supported. Never simulate approval or ask again for a provider. Support:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets/coverage floors unchanged. Pre-login CSRF is implemented. Limited trusted server-side secret uses approved September13 and T-05.06.05 updated.

Already asked, still pending: lost-contact recovery policy; signed-webhook CSRF wording; authenticated native CSP-report exception;38 base-column deviations; retain tested Node24 images versus literal Node20 requirement; retain tested Base UI/base-nova versus Radix/new-york. Do not reask or silently waive these. Continue independent work.

## Execution

Local edits and explicit commits only. No push, PR publication/merge, deployment, scheduler/state changes, external messages or PR304 action. Preserve user-owned untracked `output/`.

Use rtk and codebase-memory. Keep outputs small; save complete logs. Review each meaningful fix, run focused checks, consolidate once per feature batch. Reuse valid evidence. Full regression stays V02; skipped builds follow repair closure/B01 handoff.

API/worker test setup rebuilds shared packages and applications. Run those checks alone, then consumer checks. Never edit source/tests while their checks run or overlap shared/API builds with consumer checks. Read every process exit before edits/commits. Build web before browser checks. Graph ranges can be stale after edits; read bounded current source.
