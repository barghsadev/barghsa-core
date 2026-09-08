# Remaining repairs, reviews and skipped work

Current through product `5543cc2` on 2026-09-08. This is the single active plan. Read [progress.json](progress.json) for the next action and original F01–F23 groups. [Task acceptance](acceptance-closure.json) owns revision-bound task status.

## Current numbers

| Population | Recorded verified | Partial | Pending review | Total |
| --- | ---: | ---: | ---: | ---: |
| Tasks with merged PR evidence | 47 | 18 | 198 | 263 |
| Other historical claims | 3 | 0 | 56 | 59 |
| Combined | 50 | 18 | 254 | 322 |

There are **272 unresolved task reviews**, including the 18 partial reviews. Unresolved review does not establish that a task is unbuilt. These counts measure acceptance records, not coding effort or percentage of the repair plan completed. 12 verified records reference files changed by later commits; reconcile the relevant changes and later reviews before reusing their evidence. Exact keys and paths are in `progress.json.evidence_refresh_queue`.

The saved inventory contains **301 merged PRs**, last recorded as checked against GitHub on September 8. All saved PR bodies were read; their latest merge is September 3. GitHub could not be refreshed because `gh` remains unavailable; no newer inventory is claimed. The **58 historical skips** overlap the task population: 3 verified and 55 pending review. Another **1,033 queue gaps** are separate historical backlog evidence: 737 earlier gaps and 296 later tasks. None is automatically a missing implementation.

## Next bounded step

Continue R01 with the CSRF route/alternative and sensitive-action caller matrices for `02-auth-users-admin.md#T-02.02.03` and `T-02.02.04`. Then reconcile task-wide session acceptance. The [session caller matrix](session-caller-review.md) records covered triggers and reusable evidence for ten unchanged methods.

Latest repair `5543cc2` makes invitation membership, current-session rotation, other-session revocation and audit atomic. Original actor/invitation deadlines remain binding after lock/write waits.64 distinct API cases and4 focused desktop/mobile browser cases pass across recorded runs; types/lint/format and unchanged OpenAPI pass. Browser API fixtures exercise retries, refreshed profiles and the new CSRF cookie on the next action. The HTTP suite verifies real credential delivery and authorization. Full invitation/decline/details and agent/ownership acceptance remains in F07.

Use [step evidence](evidence/step-reviews.json) for earlier cookie, location, self-service, staff, ownership and reset checks. Do not rerun valid evidence or infer whole-task closure from one repaired boundary. Lost-contact policy remains pending. No later focused step renews the broad checkpoint.

## Ordered work

Each row is a phase. Select one exact requirement or reproduced defect inside it, implement it, review its diff and focused checks, then record evidence before proceeding.

| Order | Step / original groups | Remaining work and exit evidence |
| --- | --- | --- |
| 1 | R01 / F03–F08, F12–F16, F23 | Complete the critical checklist below. Required callers and negative paths must pass canonical requirements; every confirmed defect needs a repair or explicit disposition. |
| 2 | R02 / F09–F11, F17 | Active branding in email/notification rendering; integrated KB upload for `02-auth-users-admin.md#T-09.11.02`; actual-agent test-chat backend/panel for T-09.11.04; exact policy integration review. Finish provider/template/retry/inbox acceptance using existing evidence. Verify permissions, persisted results, failures/retries and fa/en. A provider connection test does not substitute for agent chat. |
| 3 | R03 / F19, F20 | Application-specific localized errors, correlation through required outbox/worker consumers, remaining screen/shared-control accessibility, RTL, themes and failure states. Validate required behavior; review the observed dark-theme terms-status error banner and remaining shared button/link/alert contrast consumers. Scanner warnings become work only when they establish a relevant defect. |
| 4 | R04 / F19 | Required eager customer purchase routes within unchanged complete-route budgets. Previous over-budget attempts were reverted. Production build, required loading and affected payload checks must pass. Retain Vite SPA. |
| 5 | R05 / F19 | Strict dependency checks in API/web/worker/DB. Last strict DB run recorded 146 declaration errors, 144 Drizzle and 2 Vite. Verify compatible dependencies or narrowly reviewed declarations, strict consumers, geoip-country maintenance/data-update disposition and frozen installation without broad suppressions or weaker requirements. |
| 6 | V01 / F01, F02, F18, F21, F22 | Remaining task/PR dispositions, the 12 verified-record evidence refreshes, loop durability, migrations, production packaging and repeated-task comparisons. Include every domain not closed above. All 322 claims need evidence-backed dispositions; all PR deferrals need reconciliation. |
| 7 | R06 / F19 | Close three recorded coverage gaps through meaningful missing-behavior tests. Preserve critical floors of 90% lines / 85% branches and general floors of 80% / 75%. |
| 8 | V02 / affected groups | One final regression checkpoint: unit/integration, required production-browser profiles, coverage, types, lint/format, OpenAPI, clean/upgrade/repeat migrations, snapshots, route budgets, loop safety and affected production images. Save exact revisions and exits. |
| 9 | B01 / F22 | Dependency-ordered handoff of only unmet skipped work, with exact identities, criteria and prerequisites. Preserve verified/incidental implementation. New feature builds follow repair closure. |

A01 cleanup and A02 reconciliation are complete. Nine phases remain: R01 active and eight queued. Their sizes differ; phase counts are not an effort estimate. All 23 original groups remain in progress.json. Historical implementation labels do not certify whole-group acceptance.

## R01 checklist

- Sessions/access: approximate country location, active-list filtering and current-session refresh after step-up are verified. Complete rotation/revocation, trusted-device, CSRF alternatives and sensitive-action caller matrices. Review staff roles, activation, OTP/reset/contact changes, manual verification, profile selection, membership, ownership and address boundaries.
- CRM: eight of nine F15 task records are verified locally, including list, search/filter and pending widget. T-05.02.06 local archival passes; future contract integration and approved retention policy remain explicit prerequisites.
- Tickets/finance: customer/staff privacy, attachments, assignment and transitions; receipt thresholds/independent approval, callbacks/replays, invoice arithmetic/snapshots and ledger integrity. Preserve useful corrective PRs. Future refund, ordering and contract consumers remain separate where the original task requires them separately.
- Recovery: confirmed contacts and intake/escalation runbook are implemented. Owner policy for lost-contact approvers/identity checks remains pending. A reviewed credential-change method and full case audit remain needed. Continue independent work while awaiting that answer.

The last full checkpoint at `9529872` recorded API-critical coverage 92.34% lines / 81.07% branches, web-critical 73.07% / 70.42%, and web-general 66.38% / 62.02%. Later focused checks do not renew that measurement or image evidence. See [checkpoint](final-repair-checkpoint.json) and [later step reviews](evidence/step-reviews.json).

## Every currently partial task

All 18 partial records are routed below. Read exact requirements and limitations in [acceptance](acceptance-closure.json) and [current requirements](current-task-requirements.json). Future features and operational evidence remain explicit dependencies.

| Qualified task | Remaining disposition / phase |
| --- | --- |
| 01-platform-infrastructure.md#T-01.02.02 | Strict declarations, R05. |
| 01-platform-infrastructure.md#T-01.03.03 | Eager purchase routes and lazy-boundary behavior, R04; future consumers separately. |
| 01-platform-infrastructure.md#T-01.04.02 | Three measured coverage gaps, R06/V02. |
| 01-platform-infrastructure.md#T-01.04.03 | Refund-worker/commercial-order concurrency depends on future features, V01/B01. |
| 01-platform-infrastructure.md#T-01.04.04 | Future critical flows and actual remote nightly execution, V01/B01. |
| 01-platform-infrastructure.md#T-01.04.06 | Production promotion depends on T-05.04.01 and executed release evidence, V01/B01. |
| 01-platform-infrastructure.md#T-01.05.01 | Domain errors and downstream correlation, R03. |
| 01-platform-infrastructure.md#T-04.01.04 | Production sizing, load, replica visibility and actual alerts, V01/external. |
| 02-auth-users-admin.md#T-02.02.01 | Remaining rotation callers; local cookie topology verified, R01. |
| 02-auth-users-admin.md#T-02.02.02 | Remaining revocation callers; approximate country location verified, R01. |
| 02-auth-users-admin.md#T-02.02.03 | Complete route/caller matrix and explicit CSRF alternatives, R01. |
| 02-auth-users-admin.md#T-02.02.04 | Built sensitive-action recovery matrix; future refund/contract consumers separate, R01. |
| 02-auth-users-admin.md#T-02.03.03 | Approved recovery policy, credential-change method and complete case audit, R01/external. |
| 02-auth-users-admin.md#T-05.02.06 | Future contract writer and approved retention policy, V01/B01/external. |
| 02-auth-users-admin.md#T-08.01.01 | Real contract summaries and future order/contract lists, V01/B01. |
| 02-auth-users-admin.md#T-08.01.03 | Real contract counts and filtered-list consumers, V01/B01. |
| 02-auth-users-admin.md#T-09.01.01 | Deployed asset/CDN caching and theme consumers, R02/R03/external. |
| 02-auth-users-admin.md#T-09.01.02 | Active branding in message rendering and complete theme acceptance, R02/R03. |

## Merged PR review

[The full checklist](merged-pr-review.md) retains every PR and all **23 repeated-task groups**.

| Disposition | Count |
| --- | ---: |
| PRs with unresolved mapped tasks | 249 |
| PRs mapping only to verified tasks | 48 |
| PRs with no current task mapping | 4 |
| Historical deferral statements | 170 across 101 PRs |

Review current combined implementation once per qualified task and associate all contributing PRs. The 48 PRs mapping only to verified tasks are not automatically 48 completed PR reviews. Their deferrals and changed-source evidence still need reconciliation. The 216 unresolved PR-backed tasks comprise infrastructure 50, auth/admin 78, core business 4, finance 52, notifications 29 and UI foundations 3. Another 56 unresolved claims have no direct PR mapping.

Handle #47 in R05 and #234/#235/#242 in V01. Compare #298 with `04-invoices-wallet-contracts.md#T-04.3.01.06` before calling that queue gap unbuilt. Five Docker groups were rebuilt after completion loss; fifteen wallet groups contain useful follow-up fixes. The other three repeated groups concern legal-profile slices, bookkeeping and replaced invoice snapshots. Repeated PRs alone do not justify code deletion. Preserve obsolete `01-platform-infrastructure.md#T-05.04.05` and `02-auth-users-admin.md#T-05.06.01` as provenance outside the 322 current claims.

Each deferral needs a disposition: satisfied by later implementation, confirmed repair remaining, separate future dependency, or external evidence required. Checked PR-body boxes are historical author claims. Refresh GitHub read-only when access is available, then reconcile additions explicitly. Do not silently change the frozen inventory or infer the other machine's state from this checkout.

## Skipped tasks

[All 58 qualified keys and titles](current-skipped-tasks.md) remain available with [JSON dispositions](current-skipped-tasks.json). Preserve the three verified infrastructure tasks: timezone utilities T-06.02.03, number/currency formatting T-06.02.05 and DatePicker T-06.03.04.

| Review / later build order | Pending skips | Range in `01-platform-infrastructure.md` |
| --- | ---: | --- |
| Shared libraries, locale and UI | 14 | T-06.* excluding the three verified tasks |
| Development, configuration and documentation | 21 | T-07.* |
| Deployment, operations and CI | 20 | T-05.* |

These are review batches; task dependencies override their order. Build only the unmet remainder after checking dependencies. The 55 pending skips overlap the 272 unresolved reviews; do not count twice. [Earlier gaps](archive/queue-gaps.json) and [unrecorded backlog](archive/unstarted-backlog.csv) remain historical inputs, not a dispatch queue.

## External prerequisites and decisions

Retain Vite SPA under ADR004. No identity provider exists; automatic verification stays unavailable and manual verification stays supported. Dependency license allowlist waived; coverage and route budgets unchanged. Confirmed contacts: `info@barghsa.com`, office `021-26658042`, mobile `09002550292`. Unsupported 24-hour response promise removed.

Real provider delivery, production sizing/TLS/DNS/proxies, monitoring/alerts, load, backups/restore, deployment and legacy credential/data/notification/receipt reconciliation need actual operational evidence. [Preflights](preflight/) are prerequisites, not proof of execution. Local implementation/commits are authorized; remote scheduler/state, PR #304, push, PR publication, merge and deployment remain outside current authority.

## Rules against repeated work

Keep one active plan and compact progress record. This directory-wide reread was requested once; do not repeat it routinely. Keep exhaustive historical dispositions in V01, after confirmed critical repairs. Pending paperwork does not justify rebuilding a task. After this full refresh, read only the selected task's requirements and relevant evidence. Freeze scope to original defects and exact claimed-task requirements; defer new noncritical improvements separately. Reuse evidence while relevant source, requirements and dependencies match. Keep tool output small; inspect saved log failures. Use focused checks per fix and broad checks at V02 unless a shared change warrants them sooner. Use lower effort for straightforward edits and higher effort for critical review.

Finish means confirmed local repairs pass, all 322 historical claims have truthful dispositions, every original group retains closure or exact remaining requirements, and external prerequisites/skipped work have an explicit handoff. Partial, blocked and deferred criteria never count as acceptance passes.
