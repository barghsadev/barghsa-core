# Local repair completion

The consolidated repair sprint is complete at `7b45c21507ad4fae597e4b00227f3a770b25f7e9`. [Final checkpoint](final-repair-checkpoint.json) records validation, revisions and evidence reuse. [Progress](progress.json) retains all 23 original repair groups. This replaces the serial feature-batch plan; archived plans remain historical evidence.

## Result

| Population | Verified/closed | Partial/open | Deferred | Pending/unreviewed |
| --- | ---: | ---: | ---: | ---: |
| 322 historical claims | 219 | 54 | 49 | 0 |
| 301 saved merged PRs | 242 | 59 | — | 0 |
| 58 historical skips | 8 | 1 | 49 | 0 |

These are local audit dispositions, not a claim that every feature is implemented. All partial and deferred requirements retain their exact unmet criteria in [acceptance](acceptance-closure.json) and [skipped-work handoff](skipped-work-handoff.md). The saved GitHub inventory ends September 3; no fresh remote inventory or hosted CI result is claimed.

## Repairs completed

- Administration mutations retain current session, permission and required step-up authority through commit.
- Geography changes are transactional, versioned and audited. Referenced cities cannot be deactivated through either mutation path. Persian/English city management and bounded atomic bulk import are implemented.
- Support breach/escalation scans use stable paging and process records beyond the first 500 without repeatedly starving later records.
- Scrollable SMS tables support keyboard access. Regression fixtures follow current CSRF, session, product-key and UI contracts; expiry and navigation races have deterministic checks.
- Coverage meets the original general 80% lines/75% branches and critical 90%/85% thresholds. No floor, exclusion or critical-file classifier was relaxed.

## Acceptance evidence

The optimized production build passes all 769 browser tests; the separate clean, unminified coverage build passes the same 769 tests. The collector includes both application and dedicated authentication assets. Worker 458, database 760, shared 976, web777, UI 58, i18n 50 and configuration 3 unit/integration tests pass. The full API run passed 5017 of 5019; its two timing-fixture failures were repaired and the affected 103-case suite passes. Additional boundary runs pass 288 cases and an extended 114-case subset; these overlap and must not be added as distinct totals.

Frozen installation, production builds, 11 workspace typechecks, lint, formatting, contract, route budgets, migration snapshot and tooling/loop checks pass. Actual local production images pass packaged migration/boot, readiness recovery, graceful drain and retry-after-deadline tests. [Coverage report](combined-coverage-checkpoint.json) and [evidence index](evidence/index.json) retain exact results, earlier failures, original measurements and source hashes. Invalid negative converted worker/browser branches retain all arms as uncovered; it earns no coverage credit.

One combined independent review found a city deactivation bypass, which was fixed and regression-tested. Focused follow-ups found no remaining blockers. Prior source bindings are retained in [source refresh evidence](evidence/completion-sprint/source-refresh.json).

## Remaining prerequisites

1. Owner decisions already recorded: lost-contact recovery approval/evidence policy; signed-provider callback and native CSP-report CSRF wording; 38 base-column design exceptions; Node 24 versus literal Node 20; Base UI/base-nova versus literal Radix/new-york. Do not silently waive or repeatedly reask these.
2. Future consumers/features: consultation assignment/targets; full ordering submission and green snapshots; contract/document workflows; after-payment cancellation/refunds; remaining reconciliation producers/navigation; deferred UI controls. Their task dependencies remain in the ledger.
3. Deployment evidence: credentials, real provider delivery, production inventory, TLS/proxy/firewall, backup/restore/RPO/RTO/load, monitoring delivery, installed schedules, rollout and recovery. Local tests do not certify these.
4. Remote loop bootstrap/PR304 reconciliation and the paused scheduler remain outside this local sprint.

Follow [HANDOFF](HANDOFF.md) for preserved rollout constraints and [skipped-work handoff](skipped-work-handoff.md) for dependency order. These are separately scoped future work, not another serial review of completed repairs.

## Budget and authority

Approved September 20: continuous local implementation, focused safety checks, one combined review and one final acceptance cycle. Weekly baseline 0%; latest account-wide usage 19%; ceiling 50%, with a 45% stop target. The account meter is not an exact per-task token bill.

Local commits only. No push, PR publication/merge, deployment, external message or scheduler/state change. User-owned `output/` is preserved.
