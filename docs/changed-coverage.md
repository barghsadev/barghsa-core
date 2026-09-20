# Changed source coverage

CI runs package coverage and production-browser checks, merges their reports, then runs
`scripts/check-changed-coverage.py` against the
pull request base or the preceding main commit. The checker uses the merge base and
committed HEAD, recording both hashes in its JSON artifact. Test failures remain
failures even when the coverage artifact passes.

Changed application and package source is grouped by package and criticality.
General changed executable lines require 80% line and 75% branch coverage. Modified
critical files require 90% line and 85% branch coverage across the whole file.
Results cannot be averaged across packages or between critical and general groups.
Exact integer comparisons enforce thresholds without rounding a failure into a pass.

Critical path segments include authentication, authorization, sessions, CSRF, OTP,
permissions, staff/roles, administration, verification, rate limits, finance,
orders, payments, wallet, refunds, pricing, contracts, invoices and state machines.
The explicit classifier lives in the checker and has regression fixtures. A newly
named domain must be reviewed against that classifier. There is no exception file
or automatic threshold reduction.

The checker consumes package-local Istanbul `coverage-final.json` reports from
Vitest, including the API's HTTP-process coverage provider. Missing source entries,
missing or malformed reports and inconsistent counters fail the check. Generated
source, declarations and test code are excluded. Deleted lines need no coverage.
General line coverage follows Istanbul statement-start line semantics; branches
are included when their source extent intersects the change. Minified spans whose
mapped end precedes their start use the interval between those endpoints; hit
counts are unchanged. An empty executable
line or branch set adds no artificial hits or failures.

The browser job builds a separate `dist-coverage` directory with hidden source maps.
Normal production output stays in `dist` without maps. Chromium collects V8 ranges
through the shared test fixture. Collection verifies the executed JavaScript against
the built asset before mapping it back to workspace source, including the shared
and i18n packages' intermediate TypeScript maps. Missing maps or records
fail; source-map failure never becomes zero reported flakes or successful coverage.
Every record captures the tested revision and whether the checkout was dirty. The
merge rejects stale revisions and dirty runs. Unit coverage is retained for source
not exercised in the browser. Additional browser contexts outside the shared page
fixture are not included.
Calendar and table component tests retain their separate production builds with hidden
source maps while collecting coverage. Each record explicitly registers those local
origins and build directories. Collection verifies their asset bytes and maps them
using the same checks as the application build; component asset counts stay explicit.
Unregistered origins receive no credit. Missing assets/maps, foreign registered
origins, escaped paths and symlinked component directories fail collection.
Chromium occasionally discards a script's optional source text after navigation.
Those ranges receive no coverage credit and are reported as unmeasured. Supplied
source that differs from the built asset still fails collection.

A separate CI job combines unit and browser artifacts for the same HEAD. PR coverage
always includes the web, UI, shared and i18n packages, even when the changed package
set is smaller, so each mapped browser consumer has a unit baseline.

This gate does not certify unchanged critical files or production operations.
Coverage reports must come from the same checkout, after coverage execution. CI's
Turbo cache includes shared configuration and source inputs and restores package artifacts.
Existing package-wide Vitest floors remain in force. Passing a fixture test of this
checker is not evidence that the application meets its thresholds.

Run locally after package coverage, replacing the base with the reviewed commit:

```bash
python3 scripts/check-changed-coverage.py --base origin/main --report /tmp/changed-coverage.json
```

## Compiled worker process coverage

API and worker coverage use `scripts/process-v8-provider.mjs` to merge child-process V8 execution with the package unit report. The API maps `dist/src`; the worker maps `dist`. Both require the emitted source map for every included compiled module. The shared collector participates in Turbo cache inputs. Raw records are retained under the package coverage directory in `process-v8`.

Worker tests rebuild the worker and workspace dependencies before starting a compiled process against an isolated PostgreSQL database migrated by the production command. The process suite exercises health/readiness/metrics, recurring jobs, database outage and recovery, invalid interval defaults, SIGINT/SIGTERM drain, and the forced shutdown deadline. Fixture database controls never target an existing application database. Missing system-actor failures and recovery are asserted explicitly.

Run `pnpm --filter @barghsa/worker test:coverage` to collect both unit and compiled-process evidence. A focused process run is useful for diagnostics but does not replace the full package report used by the acceptance gate.

Compiler source maps can disagree on branch end positions. Before combining unit and process reports, the collector aligns only unique branches with the same type, exact source start and ordered arm starts. Different types, arm counts, unknown positions or ambiguous identities remain separate. This removes duplicate zero-hit placeholders without inventing coverage for unexecuted arms. The merger regression runs in CI.
