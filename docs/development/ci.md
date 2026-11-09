# CI execution modes

Ordinary pushes and pull requests run affected workspace tests. The integrity gate includes builds, types, formatting, lint, contracts, the task board, dependency and image scans, static analysis, and secret scanning. Fast-mode results explicitly report the scope of coverage measured.

Manually dispatch CI to run the full release checks. They include coverage from the last released commit, the Chromium production-browser suite, and the strict release policy checks. The existing `CI_FULL_CHECKS` and `CI_FULL_PR_CHECKS` variables can also select full checks for their respective event scopes.

Direct pushes to `main` require **Verify monorepo integrity** on the exact candidate. Seed preflight refs at the verified remote `main` SHA and push the candidate as the next update. A stack can fast-forward together after the exact tip passes. Seeding at an unpublished candidate can create duplicate check contexts when a later push cancels the seed run. Keep diagnostic snapshots on a parent that already contains their board changes because the secret scanner reads all branch history.

Nightly jobs are separate from the integrity check. The release workflow in `kanban/WORKFLOW.md` governs when to enqueue staging after the verified release push.

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
