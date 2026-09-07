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
Standalone component-test servers are also outside the production-app source map.
Their scripts are counted separately as ignored non-application scripts; missing
assets from the application origin still fail collection.
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
