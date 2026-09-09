# Remaining fix plan

Current through product/test `48ac9d7`, 2026-09-09. This is the only active plan. [progress.json](progress.json) tracks the next action and all 23 original F01–F23 groups. [acceptance-closure.json](acceptance-closure.json) owns historical task status. Archived plans are evidence, not instructions.

## Current position

| Population | Recorded verified | Partial | Pending | Total |
| --- | ---: | ---: | ---: | ---: |
| Tasks with merged PR evidence | 85 | 20 | 158 | 263 |
| Other historical claims | 3 | 0 | 56 | 59 |
| All claims | 88 | 20 | 214 | 322 |

**234 task reviews remain unresolved.** That is a review count, not a count of broken or unbuilt tasks and not a percentage of coding completed. Twelve verified records need evidence refreshed for later source changes. Exact paths are in `progress.json.evidence_refresh_queue`.

Saved inventory: **301 merged PRs**, **170 deferrals across 101 PRs**, **23 repeated-task groups** and **58 historical skips**. Latest saved merge is September 3. The September 8 refresh attempt could not run because `gh` is unavailable. Do not claim current GitHub coverage until a read-only refresh succeeds.

## Next step

First feature batch completed locally at `1bf4680`: agents, invitations and ownership, saved PRs #131–#135. **4 PR reviews closed / 1 open / 0 blocked**. Tasks T-05.04.01, .02, .03 and .05 are verified; T-05.04.04 remains partial until wallet/invoice/contract/order role evidence is linked from its assigned batches. All three PR132 deferrals are satisfied locally. [Consolidated batch review](evidence/step-reviews.json#R01-agents-invitations-ownership).

Current evidence:92 API cases,13 worker cases,80 distinct production-browser cases,50 i18n cases, applicable types/lint/format/OpenAPI and all41 unchanged route budgets. Focused reruns overlap these counts. Previous ownership API evidence is reused because its method bodies are unchanged. Deployed operations and the broad V02/coverage checkpoint are separate.

Registration/OTP batch completed locally at `c706820`: **9 tasks verified /9 PR reviews closed**, saved PRs #68–#76. Exact terms, local estimator, transactional registration/dedup/audit, configurable expiry and aggregate device quota are verified. Final affected API checkpoint164 distinct cases passes; terms/strength browser evidence100 distinct cases after overlap removal is reused with earlier unchanged checks. [Consolidated batch review](evidence/step-reviews.json#R01-registration-otp).

Session/recovery batch is consolidated at `1695680`: **4 task acceptances verified, including preserved reset /3 partial; 4 PR reviews closed /3 open**, saved PRs #89–#93, #99 and #100. Session creation/revocation and forgot/reset are locally verified. Pre-login CSRF is implemented; callback/telemetry and sensitive-domain reviews remain assigned. Lost-contact policy/execution remains open. [Consolidated review](evidence/step-reviews.json#R01-session-recovery) preserves repairs, exact checks and prior evidence.

Profile/onboarding batch is consolidated at `ab09a87`: **7 tasks verified /1 partial;8 PR reviews closed /1 open**, saved PRs #102–#110. Settings default selection, its required API endpoint, localized identifiers and first invited-profile default are repaired.53 distinct affected API cases and29 distinct current/reused browser cases support the batch;42 budgets pass. PR103 retains actual commercial-order enforcement acceptance. PR106's frontend deferral is satisfied by PR108 and the current form. [Consolidated review](evidence/step-reviews.json#R01-profiles-onboarding).

Account-settings batch is consolidated at `90f6415`, PRs111–114: **2 tasks verified /2 partial;2 PR reviews closed /2 open**. Profile confirmation/authority/history, contact OTP/session transactions, notification defaults/availability and timezone validation/audit are repaired. Shared CSRF lock-race71f5e49 is also repaired. Required notification delivery consumers remain R02 and all timestamp consumers R03. Checks and source reuse are recorded once in [consolidated review](evidence/step-reviews.json#R01-account-settings). Current explicit PR totals after the wallet batch: **42 closed /8 open /251 not reviewed**.

Address/order batch is consolidated at `1c06613`, saved PRs115–116 plus linked PR103: **2 tasks verified /1 partial;1 linked PR closed /2 open**. Address history/removal/session authority and current commercial-order verification are repaired.110 distinct affected API cases,24 distinct Chromium cases,2 migration cases and relevant quality gates pass. PR115's integration deferral is satisfied for electricity; required savings/solar consumers remain open with their product prerequisites. [Consolidated review](evidence/step-reviews.json#R01-profile-addresses) records source reuse and limits.1444 logs indexed.

Wallet/ledger batch is consolidated at `48ac9d7`: **8 new task acceptances plus preserved balance card;14 PR reviews closed**. Reconciliation now reports ledger sums beyond int8 instead of aborting.14 distinct scanner checks and worker quality gates pass; unchanged core money/concurrency and dashboard evidence is reused. Four repeated groups retain corrective implementations. PR252/254 caller deferrals belong to separate service-consumer stories. [Consolidated review](evidence/step-reviews.json#R01-wallet-ledger).1454 logs indexed.

Active **R01-bank-receipts-approval**:16 saved PRs195,196,266–268,278–279,286–287,296–302. Ten mapped tasks cover wallet/invoice receipt submission, confirmation/rejection, excess credit and shared dual approval. Exact keys, criteria and deferrals are in progress.json.active_batch. Review both transaction owners together and preserve valid wallet evidence. Provider callbacks/expiry stay in a following batch.

## Execution order

Fix confirmed defects in feature batches. Review each meaningful change with focused checks, then record one consolidated batch checkpoint. An unresolved review does not authorize rebuilding an implementation.

| Step / original groups | Remaining work | Exit evidence |
| --- | --- | --- |
| R01 / F03–F08, F12–F16, F23 | Critical authentication, permissions, money and domain acceptance listed below. | Required negative paths and transaction boundaries pass; each confirmed defect is repaired or explicitly dispositioned. |
| R02 / F09–F11, F17 | Active branding in email/notifications; integrated KB upload T-09.11.02; actual-agent test chat T-09.11.04; policy integration and remaining delivery/template/retry/inbox acceptance. | Required consumers, permissions, persisted outcomes, failures/retries and fa/en pass. A connection probe does not fulfill agent chat. |
| R03 / F19, F20 | Localized application errors; correlation through required outbox/worker consumers; remaining accessibility, RTL, themes and failure states. Check the recorded dark-theme terms error banner and shared button/link/alert contrast consumers. | Required screens and consumers pass relevant checks. Scanner warnings require a confirmed defect before becoming work. |
| R04 / F19 | Eager customer purchase routes within unchanged complete-route budgets. Earlier over-budget attempts were reverted. | Production build, required loading and affected payload budgets pass. Retain Vite SPA. |
| R05 / F19 | Strict dependency checks in API/web/worker/DB; geoip-country maintenance/data-update disposition. Last strict DB run found 146 declaration errors, 144 Drizzle and 2 Vite. | Compatible dependencies or narrowly reviewed declarations, strict consumers and frozen installation pass. No broad suppression or weaker requirement. |
| V01 / F01, F02, F18, F21, F22 | Remaining historical task/PR dispositions, 12 evidence refreshes, loop durability, migrations, production packaging and repeated-task comparisons. | Every claim and deferral has an evidence-backed disposition. Reuse valid checks; record future and external dependencies separately. |
| R06 / F19 | Three measured coverage gaps. | Meaningful missing-behavior tests meet unchanged critical floors of 90% lines / 85% branches and general floors of 80% / 75%. |
| V02 / affected groups | One final regression checkpoint after local repairs. | Required unit/integration/browser/coverage/types/lint/OpenAPI/migrations/snapshots/budgets/loop/image checks pass at recorded revisions. |
| B01 / F22 | Dependency-ordered handoff of unmet skipped work. | Exact keys, criteria and prerequisites; preserve verified and incidental implementation. Build new features after repair closure. |

Audit cleanup and inventory reconciliation are complete. R01 is active; eight phases are queued. Their sizes differ, so phase counts are not an effort estimate. The original 23 groups and their remaining requirements remain in progress.json.

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

- Sessions and permissions: finish activation and remaining manual-verification acceptance; profile/onboarding, contact/address boundaries and current commercial-order verification are consolidated; link the remaining cross-domain agent-role checks. Local agent/invitation/ownership acceptance is recorded above. Reuse [session caller evidence](session-caller-review.md) and [route/CSRF review](security-route-review.md). Guard registration alone does not prove handler, transaction or UI behavior.
- CSRF boundaries: pre-login tokens for public JSON authentication are implemented and verified at f1b879b. Explicitly disposition refresh, signed callbacks and CSP telemetry. Review the state-changing payment return GET with finance. Current inventory has 347 routes, 205 unsafe-method registrations and 122 guarded step-up routes.
- Finance and tickets: receipt thresholds and independent current approval; callback/replay safety; invoice arithmetic, snapshots and ledger integrity; customer/staff privacy, attachments, assignment and transitions. Preserve corrective PRs. Refund, order and contract features remain separate where requirements define them separately.
- CRM: eight of nine F15 records are verified locally. T-05.02.06 retains only future contract integration and approved retention policy prerequisites. Do not rebuild the reviewed CRM workflows.
- Lost-contact recovery: contacts and intake/escalation runbook are implemented. Owner policy for approvers/identity checks is still pending; do not ask again. A reviewed credential-change method and complete case audit remain. Continue independent work.

For all 20 partial records, use the exact limitations in [acceptance](acceptance-closure.json) alongside [current requirements](current-task-requirements.json). Infrastructure partials map to R03–R06 or V01 operational/future prerequisites. Session/recovery partials map to R01. CRM contract/summary/count partials map to V01/B01. Branding/theme partials map to R02/R03. Future dependencies never count as passed acceptance.

## Remaining merged-PR review

[merged-pr-review.md](merged-pr-review.md) lists every saved PR, mapping, deferral and repeated group.

| Current mapping | PRs |
| --- | ---: |
| At least one unresolved mapped task | 205 |
| Only recorded verified tasks | 92 |
| No current task mapping | 4 |

These are mapping counts, not completed PR-review counts. Even a PR mapped only to verified tasks may have an unresolved deferral or stale source evidence.

Review the combined implementation once per qualified task, then associate every contributing PR. The 178 unresolved PR-backed tasks comprise infrastructure 50, auth/admin 48, core business 4, finance 44, notifications 29 and UI foundations 3. Another 56 unresolved claims have no direct PR mapping.

For each of the 170 deferrals, record one disposition: satisfied by later implementation, confirmed repair remaining, separate future dependency, or external evidence required. PR-body checkboxes are author claims. Twelve statements in PR92/106/115/129/132/218/252/254 now have explicit dispositions in [pr-deferrals.json](pr-deferrals.json): required initial roles, email delivery, staff UI, invitation withdrawal/decisions and the invitation expiry worker are implemented locally; the proposed re-enable endpoint is outside T-10.01.01. PR92's frontend modal is satisfied; its other statement retains pending domain acceptance. PR106's legal frontend is satisfied by PR108 and the current repaired form. PR130 is covered by current role-assignment acceptance. PR115 remains open: electricity integration is satisfied, while required savings/solar consumers remain with their unbuilt product prerequisites.

Specific reconciliation remains for #47 in R05 and #234/#235/#242 in V01. Compare #298 with `04-invoices-wallet-contracts.md#T-04.3.01.06` before treating that gap as unbuilt. Five Docker groups were rebuilt after completion loss; fifteen wallet groups include useful corrective work. The other three repeated groups concern legal-profile slices, bookkeeping and replaced invoice snapshots. Repeated PRs alone do not justify deleting code.

Keep obsolete keys `01-platform-infrastructure.md#T-05.04.05` and `02-auth-users-admin.md#T-05.06.01` as provenance outside the 322 current claims. Refresh GitHub read-only when access is available and reconcile additions explicitly. This checkout cannot establish the other machine's scheduler state.

## Skipped tasks and later builds

[All 58 skipped keys and titles](current-skipped-tasks.md) and [their JSON dispositions](current-skipped-tasks.json) are retained. Three are verified: timezone utilities T-06.02.03, number/currency formatting T-06.02.05 and DatePicker T-06.03.04, all in `01-platform-infrastructure.md`.

| Later review/build batch | Pending skips |
| --- | ---: |
| Shared libraries, locale and UI, T-06.* | 14 |
| Development, configuration and documentation, T-07.* | 21 |
| Deployment, operations and CI, T-05.* | 20 |
| Total | 55 |

Task dependencies override batch order. These 55 overlap the 234 unresolved reviews, so do not add the counts. Review incidental implementation before scheduling a build.

Separately, [queue gaps](archive/queue-gaps.json) and [unstarted backlog](archive/unstarted-backlog.csv) retain 1,033 historical gaps: 737 earlier and 296 later tasks. They are historical evidence, not a dispatch queue or proof of missing implementation.

## Decisions, checks and stopping rules

Retain Vite SPA under ADR004. No identity provider exists; automatic verification remains unavailable and manual verification supported. A future provider requires its contract, current authorization/step-up, encrypted configuration, audit and atomic version persistence. Dependency license allowlist is waived; coverage floors and existing route numeric limits are unchanged. Owner approved September9 that auth budgets cover initial load, with the full password estimator measured separately:150KB auth initial limit and900KB interaction gate. Registration149.22KB and estimator837.80KB pass; eager imports still count against initial load. Canonical T-01.03.04 records this interpretation.

Confirmed contacts: `info@barghsa.com`, office `021-26658042`, mobile `09002550292`. The unsupported 24-hour response promise was removed.

Production delivery, sizing/load, TLS/DNS/proxies, monitoring/alerts, backups/restore, deployment and legacy data/credential/payment reconciliation require operational evidence. [Preflights](preflight/) list prerequisites; they do not prove execution. Local edits and commits are authorized. No push, PR publication/merge, deployment, remote scheduler/state change or PR #304 action.

The last broad checkpoint at `9529872` remains revision-bound. Its coverage gaps were API-critical 92.34% lines / 81.07% branches, web-critical 73.07% / 70.42%, and web-general 66.38% / 62.02%. Later focused tests do not renew broad, coverage or image evidence. [Checkpoint](final-repair-checkpoint.json).

Read this plan and progress.json, then only the selected requirements and relevant evidence. Do not routinely reread the archive or repeat valid checks. Save full logs; inspect failures and compact summaries. Use lower effort for straightforward edits, higher effort for critical review. Do not overlap consumer typechecks with shared/API builds or browser runs: Playwright global setup rebuilds API/shared. Build the frontend before browser fixtures.

Keep scope within original defects and exact claimed-task requirements. Record new noncritical improvements separately. Keep exhaustive historical dispositions in V01, after confirmed critical repairs. Finish local repairs with one final regression run and a concise handoff of remaining external, future and skipped work. Partial/deferred requirements never count as acceptance passes.
