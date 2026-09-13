# Remaining fix plan

Current through product/test `3fd776a9` and approved requirements `981e98d6`, 2026-09-13. This is the only active plan. [progress.json](progress.json) tracks the next action and all 23 original F01–F23 groups. [acceptance-closure.json](acceptance-closure.json) owns historical task status. Archived plans are evidence, not instructions.

## Current position

| Population | Recorded verified | Partial | Pending | Total |
| --- | ---: | ---: | ---: | ---: |
| Tasks with merged PR evidence | 184 | 33 | 46 | 263 |
| Other historical claims | 10 | 1 | 48 | 59 |
| All claims | 194 | 34 | 94 | 322 |

**128 task reviews remain unresolved.** That is a review count, not a count of broken or unbuilt tasks and not a percentage of coding completed.38 retained/identified records need evidence refreshed for later source changes. The latest increase identifies older stale bindings, not new coding defects. Exact paths are in `progress.json.evidence_refresh_queue`.

Saved inventory: **301 merged PRs**, **170 deferrals across 101 PRs**, **23 repeated-task groups** and **58 historical skips**. Latest saved merge is September 3. The September 8 refresh attempt could not run because `gh` is unavailable. Do not claim current GitHub coverage until a read-only refresh succeeds.

## Next step

Development workflow verified at3fd776a9:4 newly verified tasks and4 newly closed PRs, with PR74 closure preserved. Global194 verified/34 partial/94 pending;172 PRs closed/27 open/102 unreviewed.18 immediate-base bindings refreshed;38 older refreshes retained. Next **V01-runtime-lifecycle**, saved PR29/39–42. [Review](evidence/step-reviews.json#V01-local-development).

Seed/bootstrap remains5 verified/1 partial; PR84 retains production seed execution. Database PR17–22 remains5 closed/1 open, with PR21 future refund/order concurrency outstanding. Preserve migrations0133/0134 and legacy reconciliation prerequisites.

Earlier checkpoints, retained for evidence reuse:

Receipt/expiry notices complete locally atb8201978:3 task acceptances verified (1 newly verified,2 preserved);8 contributing saved PR reviews closed,3 newly closed and5 preserved. At the receipt checkpoint,2771 logs were indexed.35 worker and38 shared cases pass, including8 actual seeded FA/EN receipt/expiry delivery cases. Worker/shared types/lint/format pass. Matching prior receipt API/UI and42 budget evidence reused.10 immediate-base bindings refreshed; older38 retained. [Batch review](evidence/step-reviews.json#R02-receipt-expiry-notices).

Next batch: integrated KB uploads and real agent test chat, PR208/210; qualified tasks02-auth-users-admin.md#T-09.11.02 andT-09.11.04. Read exact criteria, bodies and current implementation; a provider connection probe is insufficient. Reuse provider/storage authority work.

Reminder PR243/245 remain locally closed at088b010e. Preserve coordinated worker/SMS rollout, minimum2 worker pool connections and legacy incomplete-occurrence reconciliation. Expiry workers now queue customer notices atomically; replace older expiry workers and publish templates before dispatch. No historical expiry backfill or production execution claimed.

Email provider/callback batch remains6 verified/1 partial. PR190 retains deployed ops alert delivery. Prior migration0129–0131 and legacy-secret prerequisites remain.

Marketing consent/channel PR182–184 remains verified. Legacy opt-ins from the old all-profile endpoint need owner review before production marketing; old audits lack profile identity.

Template lifecycle PR177–181 remains5 verified/5 closed. Seed safety/catalog coverage and preview identity repairs pass18 DB/catalog cases and8 browser cases. Preserve the [explicit data migration](../docs/operations/notification-template-seeding.md) and prior provider/engine evidence.

Notification delivery foundation completes locally atc6588610: **5 PR reviews closed /1 open**, PR113/156/161/192/193/194. Email drafts preserve saved settings and expose timeouts, tests show the chosen verified recipient, and edits clear stale test outcomes. Template authoring accepts new event keys and native drag/keyboard insertion. T-09.04.01/T-09.06.01 and PR161/192 close; PR156 remains partial/open for R03 themes with its branding deferral satisfied.38 distinct browser cases,50 i18n cases and42 unchanged budgets pass; applicable types/lint/format/build pass. Backend behavior is unchanged this step; prior authority/verification/activation/branding evidence is reused.2373 logs indexed;3 immediate-base bindings refreshed and38 older records retained. [Foundation closure](evidence/step-reviews.json#R02-provider-template-authoring). Saved PR totals **113 closed /23 open /165 unreviewed**. Preserve migrations0123–0126 and coordinated minute-window/auth-branding worker rollout requirements; no operational execution claimed.

Verification batch consolidated at709d28b:3 task acceptances partial/3 saved PR reviews open. Mode Draft→Active at1858caf passes90 backend/18 browser cases. Named actionable notices/current-owner dashboard/inbox atd74c8f8 pass68 backend/6 browser cases. Circuit recovery at709d28b passes29 distinct provider cases across focused runs. API/web types, lint/format, build, OpenAPI and42 unchanged budgets pass.2154 logs indexed;22 further current bindings refreshed. [Review](evidence/step-reviews.json#R01-verification-policy). Current saved PR totals113 closed/23 open/165 unreviewed.

Real-provider API activation/integration remains an external prerequisite; never simulate approval or ask again. Per-user delivery choices are repaired atdeeb133b. Event-specific notification/reminder delivery acceptance remainsR02. No partial criterion counts as passed. The two wallet-controller mock failures from the interrupted, accidentally unfiltered API run are repaired atd594990. That run remains invalid broad-regression evidence; full V02 still required.

Ticket batch consolidated at `d776019`: **1 task verified /2 partial;1 saved PR review closed /2 open**. PR140 staff management and both historical team/assignment deferrals are verified. PR138 attachments are complete; contract linking remains an unbuilt dependency. PR139 customer invoice links are complete; order/contract detail destinations remain dependencies. Current authority, sealed attachments, assignment, categories, customer context and FA/EN UI are reviewed.74 final ticket API/service cases and14 distinct browser cases pass;9 assignment and19 correction cases are reused.3 migration cases and42 unchanged budgets pass. [Batch review](evidence/step-reviews.json#R01-tickets).2117 logs indexed. Saved PR totals:105 closed/20 open/176 unreviewed.

First feature batch completed locally at `1bf4680`: agents, invitations and ownership, saved PRs #131–#135. **4 PR reviews closed / 1 open / 0 blocked**. Tasks T-05.04.01, .02, .03 and .05 are verified; T-05.04.04 remains partial until wallet/invoice/contract/order role evidence is linked from its assigned batches. All three PR132 deferrals are satisfied locally. [Consolidated batch review](evidence/step-reviews.json#R01-agents-invitations-ownership).

Current evidence:92 API cases,13 worker cases,80 distinct production-browser cases,50 i18n cases, applicable types/lint/format/OpenAPI and all41 unchanged route budgets. Focused reruns overlap these counts. Previous ownership API evidence is reused because its method bodies are unchanged. Deployed operations and the broad V02/coverage checkpoint are separate.

Registration/OTP batch completed locally at `c706820`: **9 tasks verified /9 PR reviews closed**, saved PRs #68–#76. Exact terms, local estimator, transactional registration/dedup/audit, configurable expiry and aggregate device quota are verified. Final affected API checkpoint164 distinct cases passes; terms/strength browser evidence100 distinct cases after overlap removal is reused with earlier unchanged checks. [Consolidated batch review](evidence/step-reviews.json#R01-registration-otp).

Session/recovery batch is consolidated at `1695680`: **4 task acceptances verified, including preserved reset /3 partial; 4 PR reviews closed /3 open**, saved PRs #89–#93, #99 and #100. Session creation/revocation and forgot/reset are locally verified. Pre-login CSRF is implemented; callback/telemetry and sensitive-domain reviews remain assigned. Lost-contact policy/execution remains open. [Consolidated review](evidence/step-reviews.json#R01-session-recovery) preserves repairs, exact checks and prior evidence.

Profile/onboarding batch is consolidated at `ab09a87`: **7 tasks verified /1 partial;8 PR reviews closed /1 open**, saved PRs #102–#110. Settings default selection, its required API endpoint, localized identifiers and first invited-profile default are repaired.53 distinct affected API cases and29 distinct current/reused browser cases support the batch;42 budgets pass. PR103 retains actual commercial-order enforcement acceptance. PR106's frontend deferral is satisfied by PR108 and the current form. [Consolidated review](evidence/step-reviews.json#R01-profiles-onboarding).

Account-settings batch is consolidated at `90f6415`, PRs111–114: **2 tasks verified /2 partial;2 PR reviews closed /2 open**. Profile confirmation/authority/history, contact OTP/session transactions, notification defaults/availability and timezone validation/audit are repaired. Shared CSRF lock-race71f5e49 is also repaired. Required notification delivery consumers remain R02 and all timestamp consumers R03. Checks and source reuse are recorded once in [consolidated review](evidence/step-reviews.json#R01-account-settings). Current explicit PR totals after the invoice-state batch: **71 closed /14 open /216 not reviewed**.

Address/order batch is consolidated at `1c06613`, saved PRs115–116 plus linked PR103: **2 tasks verified /1 partial;1 linked PR closed /2 open**. Address history/removal/session authority and current commercial-order verification are repaired.110 distinct affected API cases,24 distinct Chromium cases,2 migration cases and relevant quality gates pass. PR115's integration deferral is satisfied for electricity; required savings/solar consumers remain open with their product prerequisites. [Consolidated review](evidence/step-reviews.json#R01-profile-addresses) records source reuse and limits.1444 logs indexed.

Wallet/ledger batch is consolidated at `48ac9d7`: **8 new task acceptances plus preserved balance card;14 PR reviews closed**. Reconciliation now reports ledger sums beyond int8 instead of aborting.14 distinct scanner checks and worker quality gates pass; unchanged core money/concurrency and dashboard evidence is reused. Four repeated groups retain corrective implementations. PR252/254 caller deferrals belong to separate service-consumer stories. [Consolidated review](evidence/step-reviews.json#R01-wallet-ledger).1454 logs indexed.

Receipt/approval batch is consolidated at `b4356e0`: **9 tasks verified /1 partial;14 PR reviews closed /2 open**, saved PRs195,196,266–268,278–279,286–287,296–302. Twelve repairs cover customer/staff authority through commit, threshold and independent approvers, sealed attachments, audited emergency settlement, required UI and safe upload retries. Overlapping checks stay separate in [consolidated review](evidence/step-reviews.json#R01-bank-receipts-approval). Latest customer checks:49 web unit and8 distinct production Chromium cases. Eight wallet/card source bindings refreshed without rerunning unchanged finance tests. Customer delivery keeps PR299/301 open for R02. Incidental T-04.3.01.06 already has a reviewed separate overpayment credit; retain it during B01.1579 logs indexed.

Online batch is consolidated at `a1d9959`: **3 tasks verified /1 partial;7 PR reviews closed /2 open**, saved PRs259,265,269,270,280,281,288,289,303. Six repairs cover current initiation/limit authority, expiry recovery, safe browser confirmation, callback channel and recovered-credit binding. Checks are recorded once in [consolidated review](evidence/step-reviews.json#R01-online-topups-callbacks), including69 provider,24 expiry worker,4 production Chromium and42 unchanged payload checks. API counts overlap across repairs and must not be added. PR265 awaits explicit signed-webhook CSRF wording; PR281 retains actual expiry notification delivery in R02.

Chargeback batch is consolidated at `ab17007`: **1 task verified /1 partial;2 PR reviews closed /2 open**, saved PRs276,277,294,295. Four repairs restrict mapping to online credits, send private account alerts to authorized Finance staff, preserve dashboard warnings on failed refreshes, and alert successful reversals.63 distinct API,17 shared,8 production Chromium,3 dashboard unit and42 unchanged budget checks are recorded with reused evidence in [the consolidated review](evidence/step-reviews.json#R01-chargebacks-alerts). PR276/294 remain open solely for the pending signed-webhook CSRF requirements decision. The earlier missing auth.refresh_token_reused seed is now repaired in the template lifecycle batch;18 current seed/catalog checks pass.1714 logs indexed.

Invoice-state batch is consolidated at `7dd8ede`: **6 tasks verified /6 PR reviews closed**, saved PRs150,151,152,220,221,222. Two repairs validate payment/refund states from locked stored amounts and restrict cancellation to its required source states.113 current API,35 DB and21 worker cases pass. Earlier caller/audit evidence is reused without adding overlapping counts. Production migration path and transaction/audit boundaries are reviewed. PR150 contract-FK deferral remains explicitly assigned to the separate origin-link/contracts requirement. [Consolidated review](evidence/step-reviews.json#R01-invoice-state-transitions).1730 logs indexed.

Invoice creation/calculation is consolidated at `7d4c577`: **7 tasks verified, including4 preserved earlier acceptances /2 partial;8 PR reviews closed /2 open**, saved PRs223–229,231–233. Linked VAT validity and staff manual creation/API/UI are repaired.122 calculation/service cases and36 DB cases pass; earlier39 VAT/auto/replay and12 HTTP plus29 manual/replay cases are reused without adding overlaps. Four distinct production Chromium cases, quality gates and42 unchanged budgets pass. [Consolidated review](evidence/step-reviews.json#R01-invoice-creation-calculation).1795 logs indexed. One VAT evidence refresh closes; the later correction batch closes its snapshot-consumer refresh.

PR225 remains open for missing concrete submission workflows; existing order creation saves DRAFTs and must not issue invoices. PR227 remains open for missing contract/consultation target tables/FKs. Preserve the working automatic service and current snapshot implementation; no duplicate deletion is needed.

Invoice deadlines/reminders consolidated at `6b9831c`: **8 tasks verified /2 partial;8 PR reviews closed /2 open**, saved PRs236–241,243–246. Seven repairs cover deadline authority and forms, reminder replanning, public customer reasons, reminder-setting authority/confirmation, and missing default-period administration.69 DB and71 reminder worker cases pass; other focused counts and valid reuse are recorded in [the consolidated review](evidence/step-reviews.json#R01-invoice-deadlines-reminders). All42 budgets pass.1911 logs indexed.

PR243/245 are now locally closed by R02-invoice-reminder-delivery: actual versioned FA/EN delivery and current invoice/deadline/channel/window/offset policy are verified for planned and queued reminders. The historical new-plans-only limitation is repaired. Historical overrides without dirty markers require operational reconciliation; updated worker must precede or accompany API rollout. No deployment occurred.

Active **R01-wallet-invoice-payments-reversals**:5 tasks T-04.2.03.01–.04 and T-04.2.04.01, saved PRs271–275,282–285,290–293. Exact story/task criteria read. All13 saved PR bodies are read and68 payment/cache cases pass; reuse wallet/chargeback money and authority evidence, compare useful repeated implementations, then review actual payment/reversal callers and repair confirmed gaps.

## Execution order

Fix confirmed defects in feature batches. Review each meaningful change with focused checks, then record one consolidated batch checkpoint. An unresolved review does not authorize rebuilding an implementation.

| Step / original groups | Remaining work | Exit evidence |
| --- | --- | --- |
| R01 / F03–F08, F12–F16, F23 | Critical authentication, permissions, money and domain acceptance listed below. | Required negative paths and transaction boundaries pass; each confirmed defect is repaired or explicitly dispositioned. |
| R02 / F09–F11, F17 | Active branding in email/notifications; integrated KB upload T-09.11.02; actual-agent test chat T-09.11.04; policy integration and remaining delivery/template/retry/inbox acceptance. Invoice reminders PR243/245 are verified; retain their rollout/legacy reconciliation prerequisites. | Required consumers, permissions, persisted outcomes, failures/retries and fa/en pass. A connection probe does not fulfill agent chat. |
| R03 / F19, F20 | Localized application errors; correlation through required outbox/worker consumers; remaining accessibility, RTL, themes and failure states. Check the recorded dark-theme terms error banner and shared button/link/alert contrast consumers. | Required screens and consumers pass relevant checks. Scanner warnings require a confirmed defect before becoming work. |
| R04 / F19 | Eager customer purchase routes within unchanged complete-route budgets. Earlier over-budget attempts were reverted. | Production build, required loading and affected payload budgets pass. Retain Vite SPA. |
| R05 / F19 | Strict dependency checks in API/web/worker/DB; geoip-country maintenance/data-update disposition. Last strict DB run found 146 declaration errors, 144 Drizzle and 2 Vite. | Compatible dependencies or narrowly reviewed declarations, strict consumers and frozen installation pass. No broad suppression or weaker requirement. |
| V01 / F01, F02, F18, F21, F22 | Remaining historical task/PR dispositions, 38 evidence refreshes, loop durability, migrations, production packaging and repeated-task comparisons. | Every claim and deferral has an evidence-backed disposition. Reuse valid checks; record future and external dependencies separately. |
| R06 / F19 | Three measured coverage gaps. | Meaningful missing-behavior tests meet unchanged critical floors of 90% lines / 85% branches and general floors of 80% / 75%. |
| V02 / affected groups | One final regression checkpoint after local repairs. | Required unit/integration/browser/coverage/types/lint/OpenAPI/migrations/snapshots/budgets/loop/image checks pass at recorded revisions. |
| B01 / F22 | Dependency-ordered handoff of unmet skipped work. | Exact keys, criteria and prerequisites; preserve verified and incidental implementation. Build new features after repair closure. |

Audit cleanup and inventory reconciliation are complete. R01 is partial for explicit R02, owner-policy and future/operational dependencies; R02 local repairs are complete with explicit future/operational prerequisites; R03 local repairs are complete apart from the pending CSP decision; R04/R05 are completed, V01 is active and three phases are queued. Their sizes differ, so phase counts are not an effort estimate. The original 23 groups and their remaining requirements remain in progress.json.

Invoice corrections consolidated at `0aae9d5`: **4 tasks verified /4 PR reviews closed**, saved PRs247–250. Paid Overdue correction, missing staff API/UI, safe retries and customer read authority are repaired.54 correction service/HTTP,30 customer read/assembly,5 deadline compatibility and40 DB cases support the batch; counts overlap earlier runs.12 current production Chromium cases,3 host cases and42 unchanged budgets pass. [Consolidated review](evidence/step-reviews.json#R01-invoice-corrections) preserves failed logs and valid evidence reuse; one snapshot refresh closes,10 remain. Credit wallet payout belongs to S-04.4.01; old-writer retirement and legacy CHECK validation remain V01 operational work. No external execution claimed. Active next batch: wallet invoice payments and reversals,13 saved PRs for5 tasks.

Invoice-adjustment approval follow-up is verified at `8a9ea42`. The new manual-adjustment route now consumes the configured threshold through the existing queue, with atomic approval/issuance and safe retries.146 backend,23 distinct browser and42 budget checks pass. Existing task/PR counts are preserved. See [review](evidence/step-reviews.json#R01-invoice-adjustment-approval).

Wallet invoice payment/reversal is consolidated at `cb7ac5b`: **5 tasks verified /13 PR reviews closed**. The customer API/UI now binds current owner/session/CSRF/step-up authority and exact confirmed amount through atomic settlement.68 baseline payment/cache cases pass;56 overlapping existing cases and9 new HTTP cases pass after API integration.5 new production Chromium cases,4 unchanged deadline cases,9 invoice-page unit cases and42 budgets pass. Reversal evidence is unchanged and reused.25 prior source bindings refreshed;2030 logs indexed. [Consolidated review](evidence/step-reviews.json#R01-wallet-invoice-payments-reversals) retains every historical deferral and failed log. Saved PR totals are104 closed/18 open/179 unreviewed. Legacy reversal CHECK validation stays V01; abandoned-claim cleanup is a future worker.

Notification outbox/delivery has individual dispositions at `05dc4f9b`: seven closed/two open PR reviews. Inbox/policy batch now closes six more reviews atb168ee2b; continue template lifecycle/seeding. Preserve valid delivery/search/shutdown evidence.

KB/agent batch at0e59d835 repaired uploads and transaction authorization. PR208/210 remain open; both tasks partial for future processing/policy/chat prerequisites. Continue AI model/policy/slot settings, PR207/209/211. [Review](evidence/step-reviews.json#R02-kb-agent-integration).

AI settings checkpoint c4098cdd: PR207/209 closed,PR211 open for unbuilt runtime slot consumers. Current168 verified/34 partial/120 pending;147 closed/24 open/130 unreviewed PRs. Continue catalogue/VAT and sensitive price callers,PR92/212/213. [Review](evidence/step-reviews.json#R02-ai-settings).

## Feature-batch rules

Approved September 8 to reduce repeated discovery, checks and audit work. This changes execution granularity, not requirements, acceptance thresholds, authority or phase order. Finish an in-flight change/check safely before switching. The supervisor's one-task/one-PR dispatch protocol remains separate and unchanged.

1. **Bound the batch.** Group tasks and contributing PRs by one workflow and shared dependencies. Around 5–15 PRs can be a useful starting size, never a quota. Before editing, record exact PR numbers, qualified task keys, remaining criteria, historical deferrals and existing evidence. Split an oversized batch at a workflow boundary.
2. **Review the current implementation once.** Combine duplicate requirements while preserving their task/PR links. Reuse valid earlier reviews and tests. Read historical diffs only to resolve behavior, provenance, deferrals or conflicting implementations. A repeated PR is not a reason to rebuild or delete code.
3. **Fix and review meaningful changes.** Repair confirmed gaps within the frozen batch scope. Review each logical change and run its relevant checks before proceeding, especially authorization, money and transaction changes. Use cohesive commits; avoid a full acceptance cycle or audit rewrite per small edit. Record newly found noncritical improvements for later.
4. **Verify the workflow once at the batch checkpoint.** Run the affected integration/browser checks and relevant quality gates after the batch repairs. Reuse valid unchanged evidence. Broaden or repeat only for new failures, shared changes or unresolved risk. Keep the complete repository regression at V02 unless a shared change requires it earlier.
5. **Close items individually and report once.** Record one batch review in `evidence/step-reviews.json`, then reconcile `acceptance-closure.json`, relevant `pr-deferrals.json` entries and `progress.json` together. Include explicit PR dispositions: closed, open, or blocked, with task links, evidence and remaining criteria. A PR closes only when every mapped requirement and historical deferral has an explicit supported disposition, with required evidence current. Task verification alone does not close a PR. An unresolved item does not prevent other items closing. Never count future/deferred requirements as passed.

Keep the active batch summary in `progress.json`: batch name, exact PR/task membership, confirmed remaining defects, reused/new evidence and next action. Save detailed closure once per batch in the existing step-review file; use a small interruption checkpoint only when needed. Do not create another parallel progress history. Regenerate the existing review summaries using their scripts after changing the ledgers; do not hand-edit generated tables. Report explicit closed/open/blocked PR counts separately from the existing task-mapping counts, and count each PR once.

First batch, now locally complete with PR134 still open for linked domain review:

| Feature batch | Saved PRs | Qualified tasks | Boundary |
| --- | --- | --- | --- |
| Agents, invitations and ownership | #131, #132, #133, #134, #135 | `02-auth-users-admin.md#T-05.04.01` through `T-05.04.05` | Consolidate list/privacy, invitation preview/delivery/decisions, role authority and ownership presentation with existing API repairs. Explicitly resolve PR132's three recorded deferrals. |

T-05.04.04 spans several domains. Assign each remaining wallet/invoice/contract/order permission criterion to its owning feature batch and link the resulting evidence back; do not pull those entire domains into this first batch or mark the task closed early. Local batch work can finish while that task remains partial.

Then form bounded batches within the existing phase order, such as remaining account/session recovery, wallet/ledger, receipts/approvals, payments/callbacks, invoices and ticket workflows in R01; related notification/branding and KB/agent-chat work in R02. Derive their exact PR membership from the saved inventory when selecting each batch. These are grouping candidates, not new features or claimed completed reviews. Keep skipped builds in B01 and dependencies in their recorded phases.

## R01 remaining acceptance

- Sessions and permissions: activation, manual-verification controls, profile/onboarding and implemented commercial-order boundaries are consolidated. Completed agent-role and sensitive-action domain evidence is linked in [cross-domain review](evidence/step-reviews.json#R01-cross-domain-authorization). Provider/storage/price callers remain assigned to R02; exact future contract/refund consumers remain V01/B01. Guard registration alone does not prove handler, transaction or UI behavior.
- CSRF boundaries: public pre-login tokens and refresh binding are verified. Browser payment return GET and explicit session/CSRF confirmation are repaired. Signed-webhook wording awaits the owner; email webhook acceptance is R02 and CSP telemetry R03. The earlier registration inventory records347 routes,205 unsafe registrations and122 step-up routes at its stated revision; it is not a current full-route certification. V01 must reconcile later registrations.
- Finance: remaining refund/order/contract authority. Ticket repairs are consolidated; contract linking and unavailable order/contract/staff-invoice destinations are recorded under V01/B01, with prerequisite task keys in `progress.json.open_domain_reviews`. Wallet settlement/reversal, receipt, online-payment and chargeback repairs are consolidated above; preserve their evidence and the pending signed-webhook decision. Keep separate workflows in their assigned feature batches.
- CRM: eight of nine F15 records are verified locally. T-05.02.06 retains only future contract integration and approved retention policy prerequisites. Do not rebuild the reviewed CRM workflows.
- Lost-contact recovery: contacts and intake/escalation runbook are implemented. Owner policy for approvers/identity checks is still pending; do not ask again. A reviewed credential-change method and complete case audit remain. Continue independent work.

For all34 partial records, use the exact limitations in [acceptance](acceptance-closure.json) alongside [current requirements](current-task-requirements.json). Infrastructure partials map to R03–R06 or V01 operational/future prerequisites. Session/recovery partials map to R01. CRM/ticket contract and record-view dependencies map to V01/B01. Verification retains real-provider prerequisites and R02 delivery. Branding/theme partials map to R02/R03. Future dependencies never count as passed acceptance.

## Remaining merged-PR review

[merged-pr-review.md](merged-pr-review.md) lists every saved PR, mapping, deferral and repeated group.

| Current mapping | PRs |
| --- | ---: |
| At least one unresolved mapped task | 86 |
| Only recorded verified tasks | 211 |
| No current task mapping | 4 |

These are mapping counts, not completed PR-review counts. Even a PR mapped only to verified tasks may have an unresolved deferral or stale source evidence.

Review the combined implementation once per qualified task, then associate every contributing PR. There are79 unresolved PR-backed task claims. Another 49 unresolved claims have no direct PR mapping, including4 newly partial shared-library reviews.

For each of the 170 deferrals, record one disposition: satisfied by later implementation, confirmed repair remaining, separate future dependency, or external evidence required. PR-body checkboxes are author claims. Twelve statements in PR92/106/115/129/132/218/252/254 now have explicit dispositions in [pr-deferrals.json](pr-deferrals.json): required initial roles, email delivery, staff UI, invitation withdrawal/decisions and the invitation expiry worker are implemented locally; the proposed re-enable endpoint is outside T-10.01.01. PR92's frontend modal is satisfied; its other statement retains pending domain acceptance. PR106's legal frontend is satisfied by PR108 and the current repaired form. PR130 is covered by current role-assignment acceptance. PR115 remains open: electricity integration is satisfied, while required savings/solar consumers remain with their unbuilt product prerequisites.

PR47 is closed by verified R05 replacement while preserving its unmapped inventory. Loop PR234/235/242 reconciliation remains V01. Compare #298 with `04-invoices-wallet-contracts.md#T-04.3.01.06` before treating that gap as unbuilt. Five Docker groups were rebuilt after completion loss; fifteen wallet groups include useful corrective work. The other three repeated groups concern legal-profile slices, bookkeeping and replaced invoice snapshots. Repeated PRs alone do not justify deleting code.

Keep obsolete keys `01-platform-infrastructure.md#T-05.04.05` and `02-auth-users-admin.md#T-05.06.01` as provenance outside the 322 current claims. Refresh GitHub read-only when access is available and reconcile additions explicitly. This checkout cannot establish the other machine's scheduler state.

## Skipped tasks and later builds

[All58 skipped keys and titles](current-skipped-tasks.md) and [their JSON dispositions](current-skipped-tasks.json) are retained.8 verified,1 partial,49 pending. Preserve verified and incidental implementation.

| Later review/build batch | Unresolved skips |
| --- | ---: |
| Deployment, operations and CI, T-05.* | 20 |
| Shared libraries, locale and UI, T-06.* | 9 |
| Development, configuration and documentation, T-07.* | 21 |
| Total | 50 |

Dependencies override batch order. These50 unresolved skips overlap128 unresolved reviews; do not add the counts. Review incidental implementation before scheduling a build.

Separately, [queue gaps](archive/queue-gaps.json) and [unstarted backlog](archive/unstarted-backlog.csv) retain 1,033 historical gaps: 737 earlier and 296 later tasks. They are historical evidence, not a dispatch queue or proof of missing implementation.

## Decisions, checks and stopping rules

Retain Vite SPA under ADR004. No identity provider exists; automatic verification remains unavailable and manual verification supported. A future provider requires its contract, current authorization/step-up, encrypted configuration, audit and atomic version persistence. Dependency license allowlist is waived; coverage floors and existing route numeric limits are unchanged. Owner approved September9 that auth budgets cover initial load, with the full password estimator measured separately:150KB auth initial limit and900KB interaction gate. Registration149.22KB and estimator837.80KB pass; eager imports still count against initial load. Canonical T-01.03.04 records this interpretation.

Confirmed contacts: `info@barghsa.com`, office `021-26658042`, mobile `09002550292`. The unsupported 24-hour response promise was removed.

Production delivery, sizing/load, TLS/DNS/proxies, monitoring/alerts, backups/restore, deployment and legacy data/credential/payment reconciliation require operational evidence. [Preflights](preflight/) list prerequisites; they do not prove execution. Local edits and commits are authorized. No push, PR publication/merge, deployment, remote scheduler/state change or PR #304 action.

The last broad checkpoint at `9529872` remains revision-bound. Its coverage gaps were API-critical 92.34% lines / 81.07% branches, web-critical 73.07% / 70.42%, and web-general 66.38% / 62.02%. Later focused tests do not renew broad, coverage or image evidence. [Checkpoint](final-repair-checkpoint.json).

Read this plan and progress.json, then only the selected requirements and relevant evidence. Do not routinely reread the archive or repeat valid checks. Save full logs; inspect failures and compact summaries. Use lower effort for straightforward edits, higher effort for critical review. Do not overlap consumer typechecks with shared/API builds or browser runs: Playwright global setup rebuilds API/shared. Build the frontend before browser fixtures.

Keep scope within original defects and exact claimed-task requirements. Record new noncritical improvements separately. Keep exhaustive historical dispositions in V01, after confirmed critical repairs. Finish local repairs with one final regression run and a concise handoff of remaining external, future and skipped work. Partial/deferred requirements never count as acceptance passes.
