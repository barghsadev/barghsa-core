# Remaining fix plan

Current through product `a4cd929`, 2026-09-08. This is the only active plan. [progress.json](progress.json) tracks the next action and all 23 original F01–F23 groups. [acceptance-closure.json](acceptance-closure.json) owns historical task status. Archived plans are evidence, not instructions.

## Current position

| Population | Recorded verified | Partial | Pending | Total |
| --- | ---: | ---: | ---: | ---: |
| Tasks with merged PR evidence | 47 | 18 | 198 | 263 |
| Other historical claims | 3 | 0 | 56 | 59 |
| All claims | 50 | 18 | 254 | 322 |

**272 task reviews remain unresolved.** That is a review count, not a count of broken or unbuilt tasks and not a percentage of coding completed. Twelve verified records need evidence refreshed for later source changes. Exact paths are in `progress.json.evidence_refresh_queue`.

Saved inventory: **301 merged PRs**, **170 deferrals across 101 PRs**, **23 repeated-task groups** and **58 historical skips**. Latest saved merge is September 3. The September 8 refresh attempt could not run because `gh` is unavailable. Do not claim current GitHub coverage until a read-only refresh succeeds.

## Next step

Consolidate the staff requirements for `02-auth-users-admin.md#T-05.03.01`, `T-05.03.02` and `T-10.01.01`. Reuse current API evidence and source-bound UI evidence. Record each unmet criterion before editing more code. Then continue remaining domain callers and explicit CSRF alternatives in R01.

Staff creation is repaired at `640108c`. Role changes, disablement and activation resend are repaired at `a4cd929`: current authentication is checked through persistence, audit includes verified time and request correlation, and expiry/failure rolls back changes. All 231 selected API/unit cases pass across recorded runs, plus types, lint, formatting and API-contract comparison. This closes that repair step; whole staff-task reviews remain. [Exact review and logs](evidence/step-reviews.json#R01-staff-sensitive-actions).

## Execution order

Fix confirmed defects first. Review each changed step with focused checks, record its evidence, then move on. An unresolved review does not authorize rebuilding an implementation.

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

## R01 remaining acceptance

- Sessions and permissions: finish staff task consolidation, profile selection, agent roles, membership/ownership, activation, OTP/reset/contact changes, manual verification and address boundaries. Reuse [session caller evidence](session-caller-review.md) and [route/CSRF review](security-route-review.md). Guard registration alone does not prove handler, transaction or UI behavior.
- CSRF alternatives: explicitly disposition public JSON authentication, refresh, signed callbacks and CSP telemetry. Review the state-changing payment return GET with finance. Current inventory has 342 routes, 203 unsafe-method registrations and 121 guarded step-up routes.
- Finance and tickets: receipt thresholds and independent current approval; callback/replay safety; invoice arithmetic, snapshots and ledger integrity; customer/staff privacy, attachments, assignment and transitions. Preserve corrective PRs. Refund, order and contract features remain separate where requirements define them separately.
- CRM: eight of nine F15 records are verified locally. T-05.02.06 retains only future contract integration and approved retention policy prerequisites. Do not rebuild the reviewed CRM workflows.
- Lost-contact recovery: contacts and intake/escalation runbook are implemented. Owner policy for approvers/identity checks is still pending; do not ask again. A reviewed credential-change method and complete case audit remain. Continue independent work.

For all 18 partial records, use the exact limitations in [acceptance](acceptance-closure.json) alongside [current requirements](current-task-requirements.json). Infrastructure partials map to R03–R06 or V01 operational/future prerequisites. Session/recovery partials map to R01. CRM contract/summary/count partials map to V01/B01. Branding/theme partials map to R02/R03. Future dependencies never count as passed acceptance.

## Remaining merged-PR review

[merged-pr-review.md](merged-pr-review.md) lists every saved PR, mapping, deferral and repeated group.

| Current mapping | PRs |
| --- | ---: |
| At least one unresolved mapped task | 249 |
| Only recorded verified tasks | 48 |
| No current task mapping | 4 |

These are mapping counts, not completed PR-review counts. Even a PR mapped only to verified tasks may have an unresolved deferral or stale source evidence.

Review the combined implementation once per qualified task, then associate every contributing PR. The 216 unresolved PR-backed tasks comprise infrastructure 50, auth/admin 78, core business 4, finance 52, notifications 29 and UI foundations 3. Another 56 unresolved claims have no direct PR mapping.

For each of the 170 deferrals, record one disposition: satisfied by later implementation, confirmed repair remaining, separate future dependency, or external evidence required. PR-body checkboxes are author claims.

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

Task dependencies override batch order. These 55 overlap the 272 unresolved reviews, so do not add the counts. Review incidental implementation before scheduling a build.

Separately, [queue gaps](archive/queue-gaps.json) and [unstarted backlog](archive/unstarted-backlog.csv) retain 1,033 historical gaps: 737 earlier and 296 later tasks. They are historical evidence, not a dispatch queue or proof of missing implementation.

## Decisions, checks and stopping rules

Retain Vite SPA under ADR004. No identity provider exists; automatic verification remains unavailable and manual verification supported. A future provider requires its contract, current authorization/step-up, encrypted configuration, audit and atomic version persistence. Dependency license allowlist is waived; coverage and route budgets are unchanged.

Confirmed contacts: `info@barghsa.com`, office `021-26658042`, mobile `09002550292`. The unsupported 24-hour response promise was removed.

Production delivery, sizing/load, TLS/DNS/proxies, monitoring/alerts, backups/restore, deployment and legacy data/credential/payment reconciliation require operational evidence. [Preflights](preflight/) list prerequisites; they do not prove execution. Local edits and commits are authorized. No push, PR publication/merge, deployment, remote scheduler/state change or PR #304 action.

The last broad checkpoint at `9529872` remains revision-bound. Its coverage gaps were API-critical 92.34% lines / 81.07% branches, web-critical 73.07% / 70.42%, and web-general 66.38% / 62.02%. Later focused tests do not renew broad, coverage or image evidence. [Checkpoint](final-repair-checkpoint.json).

Read this plan and progress.json, then only the selected requirements and relevant evidence. Do not routinely reread the archive or repeat valid checks. Save full logs; inspect failures and compact summaries. Use lower effort for straightforward edits, higher effort for critical review. Do not overlap consumer typechecks with shared/API builds, or builds with browser fixtures.

Keep scope within original defects and exact claimed-task requirements. Record new noncritical improvements separately. Keep exhaustive historical dispositions in V01, after confirmed critical repairs. Finish local repairs with one final regression run and a concise handoff of remaining external, future and skipped work. Partial/deferred requirements never count as acceptance passes.
