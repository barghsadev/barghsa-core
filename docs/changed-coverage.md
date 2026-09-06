# Changed source coverage

CI runs package coverage first, then `scripts/check-changed-coverage.py` against the
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
are included when their source extent intersects the change. An empty executable
line or branch set adds no artificial hits or failures.

This gate does not certify unchanged critical files, runtime behavior or production
operations. Browser checks without instrumentation do not contribute coverage.
Coverage reports must come from the same checkout, after coverage execution; CI's
Turbo cache includes source inputs and restores the package coverage artifacts.
Existing package-wide Vitest floors remain in force. Passing a fixture test of this
checker is not evidence that the application meets its thresholds.

Run locally after package coverage, replacing the base with the reviewed commit:

```bash
python3 scripts/check-changed-coverage.py --base origin/main --report /tmp/changed-coverage.json
```
