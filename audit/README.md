# Audit

Start with [the current fix plan](fix-plan.md), then [progress and next action](progress.json).

The plan covers remaining repairs, acceptance review of merged work, and historical skips. The latest inventory has 301 merged PRs and 322 task claims. These populations overlap; a merge or a historical completion flag is not acceptance evidence.

- [Task acceptance](acceptance-closure.json) is the authoritative task-status ledger.
- [Current requirements](current-task-requirements.json) bind those tasks to canonical epic context.
- [Historical skip dispositions](current-skipped-tasks.md) are generated from that ledger. Review existing implementation before building an unmet requirement.
- [Latest regression checkpoint](final-repair-checkpoint.json) separates revision-bound full runs from later focused repairs.
- [Saved evidence](evidence/index.json) maps former temporary logs to durable copies.
- [Operator preflights](preflight/) retain migration and deployment prerequisites. Their presence does not mean they were executed on production.
- [Historical archive](archive/README.md) preserves old findings and repair narratives. Read it only to investigate specific evidence.

The root task-review, skipped-task and merged-task JSON files remain as historical inputs to existing validators and reconciliation tools. Their historical assessments are superseded by the current acceptance ledger and requirement overlay. They do not authorize dispatch.

The root constraint inventory, staff-administrator SQL, notification-template-history SQL and schema-snapshot review also retain their original paths: tests, maintenance tools and immutable migrations reference them. The cleanup validator checks these paths.

Checks: `python3 audit/check_audit.py`, `python3 audit/current_requirements.py`, and `python3 audit/current_skipped_tasks.py`. Use `--write` on a generator only after its inputs were deliberately reviewed.
