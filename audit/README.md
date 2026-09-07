# Implemented-task audit

The recorded completion list is not a reliable statement that the built features are finished. The review found working components alongside critical wiring failures, incomplete user flows, and skipped tasks recorded as done.

Baseline: `2f80d92df51556d47f778b5230e5eea577e2a8d4`. Latest included merge is PR #303. All 301 merged PR records were reconciled. Open #304 is excluded from completion. The other machine and its cron were not inspected.

## Repair status

Repairs are in progress on the local `codex/audit-fixes` branch. [Repair progress](repair-progress.md) records each implementation step, review, test result and remaining limit. The findings and verification table below describe the original audit baseline, not the current implementation. The complete plan has not passed its exit rule, and merged task records remain distinct from acceptance verification.

No identity-verification provider has been selected. Automatic approval stays unavailable; manual verification remains supported. The dependency license restriction was waived by the user. Production data reconciliation, deployment and the other machine's scheduler are not certified by local tests.

## Current requirement bindings

Use [current task requirements](current-task-requirements.json) when continuing acceptance review. The historical report generator selected only third-level headings, so 98 infrastructure tasks inherited the wrong story and 22 original extracts included the next fourth-level story. The overlay uses the same canonical context parser as dispatch and binds every original qualified task key to source-file and context hashes. It also includes the approved Vite requirements change. Historical task-review files remain baseline evidence; their context fields are superseded by this overlay. No completion or acceptance status changes follow from regenerating requirements.

Run `python3 audit/current_requirements.py` to reject stale bindings, or add `--write` after reviewing canonical requirements changes. The historical report generator now uses that same parser for future generation. It has not been rerun over the old findings.

## Scope and limits

- 263 distinct current tasks have merged PR evidence: infrastructure 72, auth/admin 99, core business 4, finance 56, notifications 29, UI foundations 3.
- 59 additional current completion claims lack a directly mapped PR. Combined, 322 current task keys are in the review register. Two obsolete keys are tracked separately.
- Requirements were compared with current source paths, route/worker wiring and PR scope. The register retains task requirements, parent context, PRs and current source files. Review depth is strongest on shared runtime boundaries and high-risk workflows. It does not claim a line-by-line proof of every implementation or a passing end-to-end test for every row.
- No task is certified solely because its PR merged, its source exists, or type checking passed. Remaining acceptance work is explicit in F22.

## Initial audit findings

1. The production migration journal omits foundational and many later migrations. A clean production database is not established by the current journal.
2. Session guards expect parsed cookies that bootstrap does not install. A real HTTP reproduction of the guard ordering accepted a POST without a CSRF token.
3. Staff creation sets administrator authority for all staff, and its role-ID validator disagrees with the predefined role IDs.
4. OTP generation is not connected to external delivery. Registration still uses a placeholder TOS version. API-mode profile verification can mark a profile verified without calling a provider.
5. The worker registers only in-app notification transport. Retry deduplication, quiet-hour scheduling and legacy/new inbox integration have gaps.
6. Overdue-payment rules conflict with the state machine. Wallet and invoice bank-receipt paths apply different dual-approval controls.
7. Several “completed” tasks are API-only slices with required UI still absent. CRM shows a placeholder; ownership transfer has initiation but no completion.
8. Production compose omits the worker; the Docker image and shutdown tests do not cover the actual production paths consistently.

The [repair plan](fix-plan.md) contains 23 groups with evidence, concrete actions, task scope and acceptance checks. The groups include confirmed defects, incomplete required slices, requirements conflicts and explicit verification work. They are not 23 independently reproduced runtime bugs.

## Skipped work

There are 58 history-confirmed skips. One later has a directly mapped merged PR, but still needs acceptance repair. Many others have partial implementation from later features. [The skipped-task register](skipped-tasks.md) lists all 58 and the existing pieces to preserve.

There are also 737 unrecorded keys before the furthest merged task in today's queue, plus 296 later unstarted keys. These are listed separately to avoid confusing queue position with an intentional historical skip. Six earlier auth keys concern closure/export, staff/customer operating context, and the stricter staff-profile exception. F04 repairs permissions in already-built staff flows; it does not silently mark those separate context tasks done.

## Duplicate work

23 task keys have multiple merged PRs. Five Docker tasks were rebuilt after their completion entries disappeared. Fifteen wallet groups contain useful follow-up fixes. The remaining three groups are complementary legal-profile slices, bookkeeping, and a reverted/replaced invoice snapshot. Preserve the useful corrections. The concrete cleanup is the competing web server entry points plus task/provenance reconciliation. See [loop and duplicate evidence](loop-and-duplicates-audit.md).

## Initial verification performed

| Check | Result |
|---|---|
| Backlog validation | 1,355 tasks and 116 traceability entries pass the current checker |
| Type checking | 11/11 tasks pass; one cached |
| Build | 7/7 tasks pass; four cached |
| Shared tests | 620 tests in 44 files pass |
| Web tests | 107 tests in 15 files pass |
| Full root test suite | Blocked at PostgreSQL Testcontainers setup: no working container engine found; full API/DB/worker suite is not reported as passed |
| Bundle check | Passes configured limits; main entry 220.12 kB gzip exceeds the separate 150 KB auth requirement |
| Suppressed TypeScript errors | Pass |
| Loop protocol tests | 25 pass with BARGHSA_LOOP_BASE set to this checkout; default path caused two file-not-found errors before rerun |
| HTTP guard-order reproduction | Actual compiled CSRF guard plus route session guard accepts missing-CSRF POST, returns 201; Cookie header remains unparsed |
| React Doctor | 173 files scanned, score 45/100, 237 diagnostics; triage required, not 237 confirmed defects |

The initial review made no product, kanban, GitHub or scheduler changes. Its generated route-tree change was restored. The audit artifacts were subsequently copied into this project’s `audit/` directory at the user’s request; authorized local implementation repairs are recorded in the progress log.

## Files

- [Repair plan](fix-plan.md)
- [Current acceptance evidence](acceptance-closure.json)
- [Current canonical task requirements](current-task-requirements.json)
- [Readable task-by-task review](task-review.md)
- [Task register CSV](task-review.csv) and [JSON with requirements and source evidence](task-review.json)
- [History-confirmed skipped tasks](skipped-tasks.md), [CSV](skipped-tasks.csv), [JSON](skipped-tasks.json)
- [All 737 earlier queue gaps](queue-gaps.csv)
- [All 1,033 unrecorded current tasks](unstarted-backlog.csv)
- [Historical PR deferrals](pr-deferrals.json)
- [All merged PR evidence](merged-pr-evidence.json)
