# Remaining repair and acceptance plan

Reconciled on 2026-09-08 at implementation revision `612434d`. [progress.json](progress.json) is the compact execution record and F01–F23 rollup. Update that file after each step; task acceptance lives only in [acceptance-closure.json](acceptance-closure.json).

## Fixed scope and current counts

| Population | Verified in ledger | Partial | Pending | Total |
| --- | ---: | ---: | ---: | ---: |
| Tasks with merged PR evidence | 32 | 13 | 218 | 263 |
| Other historical completion claims | 3 | 0 | 56 | 59 |
| Combined historical task population | 35 | 13 | 274 | 322 |

GitHub's 301 merged PRs were checked on 2026-09-08: no additions to the saved inventory. Of the 35 verified records, 23 reference subsequently changed files and require an evidence refresh. A changed file does not prove regression. These are acceptance counts, not implementation percentages.

The 58 historical skips are already included above: three verified, 55 pending. The separate 737 earlier queue gaps and 296 later tasks are not additional historical completion claims. Broad selectors in the old findings include unstarted tasks; do not expand repair scope to those tasks automatically.

## Ordered work

1. **A01 Audit cleanup.** Archive superseded reports and narratives; remove only byte-identical duplicate copies. Retain stable reconciliation inputs, original hashes and provenance. Preserve current temporary evidence. Establish this plan and the compact execution record. Validate all identities, links and generators.
2. **A02 Evidence reconciliation.** Review the 23 changed verified records and the 13 partial records. Replace stale remaining-work descriptions using later source and test evidence. Keep original assessments in history. Do not upgrade acceptance from a commit title or test count. Review only affected requirements; reuse unchanged evidence.
3. **R01 Critical acceptance and repairs.** Review authentication/session/CSRF, current capabilities, profile/agent/ownership boundaries, rate limits, receipts, callbacks, invoice arithmetic and ledger integrity. Use existing production-migrated HTTP/concurrency tests; add meaningful missing cases and fix reproduced defects. F03–F08, F12–F16, F23.
4. **R02 Required administration consumers.** Finish email/notification branding, knowledge-base upload controls and the required actual-agent test chat. Reconcile policy integration with the exact original task boundary. Preserve current provider/template step-up and recovery repairs. Document chunk/embedding processing as a separate dependency. F09–F11, F17.
5. **R03 Errors and UI acceptance.** Finish stable localized errors and downstream correlation checks; complete required keyboard, focus, RTL, light/dark, loading/error and retry acceptance. Triage scanner findings against behavior; do not convert all warnings into new work. F19/F20.
6. **R04 Purchase loading.** Meet the eager customer purchase-path requirement within unchanged complete-route budgets. Retain Vite SPA. Prior eager-loading attempts exceeded auth/order budgets and were reverted; do not repeat that implementation unchanged. F19.
7. **R05 Strict dependencies.** Resolve the recorded database/tool declaration failures through compatible dependency fixes or narrowly reviewed declaration patches. Verify strict consumers and frozen installation; do not add suppressions. F19.
8. **V01 Complete task and PR dispositions.** Use the review matrix below and current requirements. Finish remaining domain reviews, fix demonstrated original-scope defects, and record exact unmet future dependencies. Include F01/F02/F18/F21 local durability, migration and production-image evidence. F22 owns ledger completion.
9. **R06 Coverage closure.** Use meaningful tests from prior work to close the three remaining measured groups: API critical 92.34/81.07, web critical 73.07/70.42, web general 66.38/62.02, all measured at `9529872`. Required line/branch floors are 90/85 critical and 80/75 general. Refresh measurement after code changes; never weaken classification or thresholds.
10. **V02 Final checkpoint.** Run the complete unit/integration and required production-browser suites, coverage, types, lint/format, OpenAPI, clean/upgrade/repeat migrations, snapshot validation, route budgets, loop checks and affected images. Evidence must identify its exact source revision and scope. Record external blockers separately.
11. **B01 Skipped-work handoff.** Reconcile all historical skips and queue gaps against actual implementation. Produce a dependency-ordered list of only unmet work. New skipped features follow repair closure; no automatic feature dispatch is authorized.

## Remaining merged-work review

| Domain | PR-backed tasks still partial or pending |
| --- | ---: |
| Infrastructure | 51 |
| Authentication and administration | 92 |
| Core business | 4 |
| Finance | 52 |
| Notifications | 29 |
| UI foundations | 3 |
| Total | 231 |

Also review the 56 unresolved legacy claims. Review by task and domain, associating all contributing PRs with one final implementation. Record canonical requirements, required callers, current source/test evidence, reviewed revision and exact remaining criteria.

Reconcile 170 deferral statements from 101 PRs against later implementation. Explicitly disposition PRs #47, #234, #235 and #242, which have no current task mapping. Preserve all 23 repeated-task groups and useful financial corrections; do not delete code because a task has several PRs. Inspect overpayment-credit coverage from PR #298 before treating `04-invoices-wallet-contracts.md#T-04.3.01.06` as unbuilt.

The 55 pending historical skips comprise 20 deployment/operations/CI, 14 shared-library/localization/UI, and 21 development/configuration/documentation tasks. Record what exists, what is unmet, dependencies and future build order. Retain verified timezone, numeral-formatting and DatePicker implementations.

## Per-step review and stopping rules

Implement one bounded step, review its diff and run focused checks before moving on. Add cases for real behavioral boundaries rather than mirroring implementation. Reuse evidence only when its requirements, relevant code and dependencies remain valid. Keep output compact and store logs; avoid repeated full runs without a shared-change reason. Record new noncritical improvements separately rather than extending current repairs.

All 23 groups must retain an explicit disposition. Finish the local phase only after confirmed local repairs pass, all 322 claims have truthful reviewed dispositions, and skipped-task follow-ups identify unmet work. Report implementation, acceptance, external blockers and future features separately. Completion does not mean every historical claim became verified.

External prerequisites remain unverified: real identity provider, controlled real-provider delivery, production TLS/DNS/proxy/cancellation, measured load/monitoring/alerts, backups/restore, credential and legacy-data reconciliation. Production records must not be repaired from ambiguous evidence. No remote loop recovery, scheduler/state change, push, merge, deployment or PR #304 action is authorized here. These prerequisites must remain blocked, not counted as passing local checks.
