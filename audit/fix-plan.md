# Remaining repair and review plan

Reconciled on 2026-09-08 through product commit `bb2d116`. Start here, then read [progress.json](progress.json) for the next action. All original F01–F23 groups remain there. Detailed completed work now lives in [step evidence](evidence/step-reviews.json).

## Current position

| Historical task population | Verified | Partial | Not yet reviewed | Total |
| --- | ---: | ---: | ---: | ---: |
| Tasks with merged PR evidence | 36 | 19 | 208 | 263 |
| Other historical completion claims | 3 | 0 | 56 | 59 |
| Combined | 39 | 19 | 264 | 322 |

These are task-acceptance counts, not percentages of implementation effort. A01 cleanup and A02 evidence reconciliation are complete. R01 is in progress; eight later steps remain. The recent session revocation, refresh-reuse alert, atomic step-up, public-auth CSRF, localized support navigation and confirmed contact repairs have focused passing evidence. Auth rate-limit task `02-auth-users-admin.md#T-02.04.01` is now verified locally. Do not rebuild those repairs. CRM verification and account-security tasks 02-auth-users-admin.md#T-05.02.03 and T-05.02.04 are now verified locally; their notices, permission races and confirmation fixes have passing evidence.

The saved inventory contains 301 merged PRs and was checked against GitHub on September 8. This refresh uses that inventory; it makes no new remote request. There are 58 historical skips within the 322 claims, with 3 verified and 55 awaiting review. Separately, 737 earlier queue gaps and 296 later tasks have no recorded completion. Those 1,033 gaps are not automatically missing implementations or additions to this repair scope.

## Confirmed remaining local work

| Step / group | Remaining requirement | Completion evidence |
| --- | --- | --- |
| R01 / F03 | Session list lacks required approximate location. Trace all rotation, revocation and sensitive-action callers before closing the four partial session tasks. | Exact current requirements, required caller matrix, meaningful HTTP/browser checks and privacy-safe location behavior. |
| R01 / F05 | Intake and escalation runbook is implemented; lost-contact recovery still needs owner-defined approvers/evidence policy and a reviewed credential-change method. Unsupported24-hour promise was removed. | Runbook grounded in supported staff actions, evidence/audit requirements and an exercised recovery or explicit escalation path. No invented provider or credential bypass. |
| R01 / F15 | Staff address editing is absent. Full profile view still lacks legal registration/representative/document fields and localized field/location labels. Required URL, lifecycle details, record tabs, keyboard navigation and password date are implemented and checked. | Complete partial tasks 02-auth-users-admin.md#T-05.02.01 and T-05.02.02 with authorized data, localized controls and focused HTTP/browser checks. Action tasks T-05.02.03/T-05.02.04 are already verified. |
| R02 / F09, F17 | Email and notification renderers do not consume active branding. | Versioned branding reaches the required rendered output; missing assets/configuration and localized behavior are exercised. |
| R02 / F17 | `02-auth-users-admin.md#T-09.11.02` has document selection but lacks integrated new-document upload. | Authorized upload, validation, persisted KB association, failure/retry and localized controls. Chunking/embedding stays an explicit separate dependency. |
| R02 / F17 | `02-auth-users-admin.md#T-09.11.04` lacks its actual-agent backend and test-chat panel. | Admin-authenticated chat reaches the selected agent with its required model/KB/policy configuration. A provider connection test does not satisfy this task. |
| R03 / F19, F20 | Application-specific localized errors and downstream outbox/worker correlation remain incomplete or unreviewed. | Stable error codes, safe localized messages and preserved correlation through the actual required consumers. Unmatched-route disclosure is already repaired. |
| R04 / F19 | Customer purchase routes remain lazy despite the eager-loading requirement. | Eager required purchase paths within unchanged complete-route budgets. Prior over-budget attempts were reverted; retain Vite SPA. |
| R05 / F19 | API/web/worker/DB still use `skipLibCheck`; the last strict DB check recorded 146 dependency declaration errors. | Compatible dependency or narrowly reviewed declaration repair, strict consumer checks and frozen installation. No suppressions or weakened requirements. |
| R06 / F19 | Three coverage groups failed at `9529872`. | Meaningful missing behavior checks and a fresh valid measurement at unchanged thresholds. API critical: 92.34% lines / 81.07% branches; web critical: 73.07% / 70.42%; web general: 66.38% / 62.02%. Required floors: 90/85 critical, 80/75 general. |

This table identifies known unmet work. Remaining domain reviews may reproduce further defects within the original scope; record new noncritical improvements separately.

Confirmed support contacts are now installed: `info@barghsa.com`, office `021-26658042`, mobile `09002550292`. The owner confirmed these contacts. Unsupported24-hour response-time copy was removed in6640012.

## Execution order

1. **R01 Critical acceptance.** Support recovery task `02-auth-users-admin.md#T-02.03.03` awaits owner policy. Continue required session/CSRF/step-up caller matrices and review staff roles/activation, OTP/contact changes, manual verification, profile/agent/ownership/address boundaries, CRM/tickets, receipts, callbacks, invoice arithmetic and ledger integrity. F03–F08, F12–F16, F23. Preserve unavailable automatic verification without a provider.
2. **R02 Required administration consumers.** Complete branding, KB upload and actual-agent test chat. Review the policy integration against its exact task requirements. Reuse current provider/template authorization and acknowledgement evidence. F09–F11, F17.
3. **R03 Errors and UI review.** Finish required localization/correlation and keyboard, focus, RTL, themes, loading/error and retry behavior. Review scanner findings against actual behavior; do not turn every warning into work. F19/F20.
4. **R04 Purchase loading.** Solve the eager-route requirement within current budgets; keep the approved Vite SPA architecture. F19.
5. **R05 Strict dependencies.** Resolve the recorded declaration failures, verify affected consumers and frozen installation. F19.
6. **V01 Remaining task and PR dispositions.** Complete domain reviews not already covered above, including loop durability, migrations, production packaging and repeated-task provenance. Use the checklist below. F01/F02/F18/F21/F22. Every claim needs a truthful status and exact remaining criteria; external or future requirements need explicit dispositions.
7. **R06 Coverage closure.** Measure after the preceding repairs. Add tests for untested required behavior, inspect failures, retain thresholds and classification. F19.
8. **V02 Final regression.** One complete checkpoint for unit/integration tests, required production-browser profiles, coverage, types, lint/format, OpenAPI, clean/upgrade/repeat migrations, snapshot checks, route budgets, loop safety and affected production images. Record exact revisions and exits. Earlier full runs do not certify later source changes.
9. **B01 Skipped-work handoff.** Turn reviewed historical skips into a dependency-ordered list of only unmet work. Reconcile incidental implementation in queue gaps before any later build. New skipped features follow current repair closure; this plan does not dispatch them.

## Remaining merged-PR review

[The full PR checklist](merged-pr-review.md) lists every merged PR, its qualified task mapping, current task acceptance, deferral count and all 23 repeated-task groups.

- 260 PRs have mapped tasks with partial or pending acceptance.
- 37 PRs map only to verified tasks. Reuse their task evidence; any separate deferral still needs reconciliation.
- 4 PRs lack current task mappings: #47 for strict dependencies; #234, #235 and #242 for loop protocol.
- 170 historical deferral statements across 101 PRs require comparison with later implementation.

Review the final implementation once per qualified task and associate every contributing PR. The remaining PR-backed task counts are infrastructure 50, auth/admin 89, core business 4, finance 52, notifications 29 and UI foundations 3, totaling 227. Also review 56 unresolved legacy claims. These figures overlap the partial/pending task counts above.

Repeated PRs alone do not justify deleting code. Preserve useful wallet/receipt follow-ups and test their combined behavior. Review PR #298's incidental overpayment-credit path before scheduling `04-invoices-wallet-contracts.md#T-04.3.01.06` as unbuilt. Preserve both obsolete task identities in the historical register instead of transferring their completion silently.

## Historical skips and future build order

[The complete skip list](current-skipped-tasks.md) retains all 58 qualified identities and their current dispositions. Three verified tasks must be preserved: timezone utilities, number/currency formatting and the localized DatePicker. The other 55 need source review before any build:

| Review batch | Pending historical skips | Future ordering |
| --- | ---: | --- |
| Shared libraries, locale and UI | 14 | Review foundations first; build only unmet controls/consumers. |
| Development, configuration and documentation | 21 | Follow the shared/security foundations; connect actual required consumers. |
| Deployment, operations and CI | 20 | Validate local gates first, then staging/production prerequisites and operator exercises. |

This is a dependency review sequence, not a claim that every item lacks code. The separate [earlier queue gaps](archive/queue-gaps.json) and [unstarted backlog](archive/unstarted-backlog.csv) remain historical evidence, not a dispatch queue.

## Review rules and finish criteria

Keep scope fixed to original confirmed defects and exact claimed-task requirements. Implement one bounded item, review its diff, inspect completed check exits, then record the result before continuing. Keep a short next action in progress.json; store detailed evidence outside it. Use targeted checks, small output and existing valid evidence. Reopen checks only when relevant source, requirements or dependencies changed. Use lower effort for straightforward edits and higher effort for complex or critical review; avoid repeated full-history reads.

All 322 claims must eventually have reviewed dispositions, all 23 groups must retain their remaining work or closure, and all confirmed local repairs must pass. Partial, blocked or deferred requirements must name exactly what remains; they are not acceptance passes. Finish with one regression checkpoint and a concise list of external prerequisites and skipped work.

External prerequisites include provider delivery, production topology/TLS/DNS, load/monitoring/alert delivery, backups/restore, and legacy credentials/data/receipt reconciliation. Operator SQL and runbooks are unexecuted prerequisites unless backed by an actual run record. No automatic identity provider exists. Remote loop recovery, PR #304, scheduler/state changes, push, merge and deployment remain outside current local authority.
