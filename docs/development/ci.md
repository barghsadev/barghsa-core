# CI execution modes

Enabled on 2026-09-20 at the project owner's request to reduce batch turnaround.

Pull requests run affected workspace tests without coverage instrumentation. They retain builds, types, formatting, lint, contract and database snapshot checks, task-board integrity checks, dependency scanning, static security analysis, and secret scanning.

The full production browser suite and coverage collection/enforcement are temporarily disabled for pull requests. The existing combined coverage check reports this exemption explicitly and still fails if tests or integrity checks fail. Its green result in fast mode does not mean coverage was measured. Do not use it as coverage evidence in a handoff.

Pushes to main retain full tests, browser checks, and coverage enforcement. Nightly browser checks remain unchanged. New pushes cancel obsolete CI runs for the same pull request.

Restore full PR checks with `gh variable set CI_FULL_PR_CHECKS --body true`, then rerun CI. Delete the variable or set it to false to return to temporary mode. Remove the FULL_CI conditions and this document when the temporary exception ends.

Tradeoff: PRs no longer block on browser regressions or coverage thresholds; those are detected by the full main-branch run. Keep task-specific browser validation for changed user flows before pushing.

Manual development now pushes directly to main. CI does not block staging deployment. See `kanban/WORKFLOW.md` for current release authority.

## Reusing local builds

Build the required shared, API, worker and web outputs once before their
consumers. After verifying that those outputs match the selected sources, pass
`BARGHSA_TEST_PREBUILT=1` to both native API tests and the production-browser
runner. For example:

```sh
rtk proxy env BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs e2e/onboarding-wizard.spec.ts --project=chromium
```

The flag does not validate freshness. Do not use it with missing or stale
artifacts. Without it, Playwright's `e2e/global-setup.ts` calls the API test
builder, which rewrites shared, worker and API outputs even for a browser suite
using mocked responses. Running that build beside native HTTP tests can remove
modules or expose partially written Nest providers during startup. Such failures
are not evidence of an application circular dependency.

Native and browser checks may run together only when all required outputs are
verified and neither runner will rewrite them. Keep builds sequential with their
consumers, diagnose artifact changes before retrying, and rerun only the affected
cases. Preserve original failed receipts and assertions.
