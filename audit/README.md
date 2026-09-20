# Audit

Start with [fix-plan.md](fix-plan.md). [progress.json](progress.json) owns execution state, unfinished files and evidence-refresh work; [HANDOFF.md](HANDOFF.md) gives brief continuation instructions. There is one active plan. Archived plans are provenance only.

| Record | Purpose |
| --- | --- |
| [Acceptance](acceptance-closure.json) | Sole historical status authority for 322 claims; evidence is revision-bound |
| [Requirements](current-task-requirements.json) | Current canonical requirements for every key |
| [PR checklist](merged-pr-review.md) | 301 saved PRs, deferrals and repeated tasks |
| [Skipped tasks](current-skipped-tasks.md) | All 58 historical skips and current dispositions |
| [Checkpoint](final-repair-checkpoint.json) | Revision-bound broad checks and later evidence pointers |
| [Step reviews](evidence/step-reviews.json) / [logs](evidence/index.json) | Reviewed work and saved check results |
| [Preflights](preflight/) | Operational prerequisites; execution requires separate evidence |
| [Archive](archive/README.md) / [manifest](cleanup-manifest.json) | Historical evidence, provenance and latest directory reconciliation |

Historical root JSON inputs, constraint inventory, staff/template SQL and schema-snapshot review keep their paths because tools, tests and immutable migrations reference them. Old status claims do not override acceptance or authorize dispatch. Keep unique evidence; remove only proven redundant copies and update references.

Validate with `python3 audit/check_audit.py`, `python3 audit/current_requirements.py`, `python3 audit/current_skipped_tasks.py` and `python3 audit/current_pr_reviews.py`. Use generator `--write` only after deliberate input changes.
