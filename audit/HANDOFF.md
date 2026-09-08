# Continue the repair plan

Read [fix-plan.md](fix-plan.md), then [progress.json](progress.json). The latter records the active step, completed steps, remaining work and all F01–F23 groups. Update it after every reviewed step. Do not reload the archive routinely.

The latest reconciliation includes the support contacts supplied by the owner and the previously unrecorded rate-limit review. Follow the next action in progress.json; do not restart that review. Full completed-step detail is in [step evidence](evidence/step-reviews.json). [PR review](merged-pr-review.md) and [historical skips](current-skipped-tasks.md) are generated from current acceptance, not independent status authorities.

Repository `/Users/majid/www/barghsa/barghsa-core`; branch `codex/audit-fixes`. Read Git HEAD and working-tree status before continuing. The user authorized direct Codex implementation and review. Work locally; no push, PR, merge, deployment, remote scheduler/state change or PR #304 action.

Retain Vite SPA under ADR004. No identity-verification provider exists; automatic verification remains unavailable and manual verification stays supported. The dependency license allowlist was waived. Coverage and route budgets were not waived.

Follow the selected step through implementation, change review and focused checks. Record new noncritical improvements separately. Reuse evidence only where requirements, relevant source and dependencies still match. Run broad regressions at the final checkpoint, or earlier when a shared change requires them. Historical task review is now explicitly included, but must reuse existing evidence and review tasks by domain rather than replay every PR independently.

Commands begin with `rtk`. Prefer the codebase-memory project `Users-majid-www-barghsa-barghsa-core` for code discovery. Stage explicit paths. Do not run API typechecks while Vitest global setup rebuilds packages, or builds while browser fixtures are running. Collect coverage only on its required clean revision.

Latest complete runtime/image checkpoint and subsequent focused evidence are in [final-repair-checkpoint.json](final-repair-checkpoint.json). Use [evidence/index.json](evidence/index.json) when a former temporary log is unavailable. Full-run results do not automatically cover later changes.
